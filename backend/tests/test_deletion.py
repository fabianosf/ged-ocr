from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from documents.models import Documento, DocumentoAuditoria, TipoDocumento
from documents.tasks import process_document, sync_ged


def delete(client, document, version=1):
    return client.delete(
        f"/api/documentos/{document.id}/", {"versao": version}, format="json",
    )


@pytest.mark.parametrize("state", ["erro", "revisao", "revisao_tipo", "aprovado"])
def test_delete_removes_photo_and_data_but_preserves_type(client, document, state):
    document.status = state
    document.save()
    storage, name, type_id = document.foto.storage, document.foto.name, document.tipo_id
    assert storage.exists(name)
    assert client.get(f"/api/documentos/{document.id}/").data["pode_excluir"]
    assert delete(client, document).status_code == 204
    assert not Documento.objects.filter(pk=document.pk).exists()
    assert not storage.exists(name)
    assert TipoDocumento.objects.filter(pk=type_id).exists()
    assert client.get(f"/api/documentos/{document.id}/foto/").status_code == 404


@pytest.mark.parametrize("state,ged", [
    ("pendente", "nao_configurado"), ("processando", "nao_configurado"),
    ("aprovado", "pendente"), ("aprovado", "enviando"),
])
def test_active_jobs_cannot_be_deleted(client, document, state, ged):
    document.status, document.ged_status = state, ged
    document.save()
    assert not client.get(f"/api/documentos/{document.id}/").data["pode_excluir"]
    assert delete(client, document).status_code == 409
    assert Documento.objects.filter(pk=document.pk).exists()
    assert document.foto.storage.exists(document.foto.name)


def test_delete_requires_current_version(client, document):
    assert delete(client, document, 2).status_code == 409
    assert client.delete(f"/api/documentos/{document.id}/", {}, format="json").status_code == 400
    assert document.foto.storage.exists(document.foto.name)


def test_repeated_delete_is_not_found(client, document):
    assert delete(client, document).status_code == 204
    assert delete(client, document).status_code == 404


def test_deletion_keeps_audit_event_after_document_removal(client, document):
    document_id = document.id
    assert delete(client, document).status_code == 204
    event = DocumentoAuditoria.objects.get(
        documento_id_snapshot=document_id, evento="document_deleted",
    )
    assert event.documento is None
    assert event.ator == document.usuario
    response = client.get("/api/auditoria/")
    assert response.status_code == 200
    assert response.data["results"][0]["documento_id_snapshot"] == str(document_id)


def test_delete_does_not_remove_external_ged_copy(client, document):
    document.status = Documento.Status.APROVADO
    document.ged_status = Documento.GEDStatus.ENVIADO
    document.save()
    with patch("documents.tasks.sync_ged.apply_async") as task:
        assert delete(client, document).status_code == 204
    task.assert_not_called()


def test_delete_is_owner_or_staff_only(client, document, user):
    owner = get_user_model().objects.create_user(username="other-owner")
    document.usuario = owner
    document.save()
    assert delete(APIClient(), document).status_code == 403
    assert delete(client, document).status_code == 404
    user.is_staff = True
    user.save()
    assert delete(client, document).status_code == 204


def test_storage_failure_keeps_document_and_logs_no_personal_data(client, document):
    with (
        patch.object(document.foto.storage, "delete", side_effect=OSError("private-path")),
        patch("documents.views.logger.error") as log,
    ):
        response = delete(client, document)
    assert response.status_code == 500
    assert "documento foi mantido" in str(response.data)
    assert Documento.objects.filter(pk=document.pk).exists()
    assert document.foto.storage.exists(document.foto.name)
    log.assert_called_once_with(
        "photo_delete_failed correlation_id=%s", document.correlation_id,
    )
    assert "private-path" not in str(response.data)


def test_redelivered_tasks_do_not_recreate_deleted_documents(client, document):
    job_id = str(document.id)
    assert delete(client, document).status_code == 204
    with patch("documents.tasks.prepare_image") as prepare, patch("documents.tasks.send_document") as send:
        process_document(job_id, 1)
        sync_ged(job_id, 1)
    prepare.assert_not_called()
    send.assert_not_called()
    assert not Documento.objects.filter(pk=job_id).exists()
