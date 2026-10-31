from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from kombu.exceptions import OperationalError
from rest_framework.test import APIClient

from documents.models import Documento
from documents.schema import leaves


def url(document, action=""):
    return f"/api/documentos/{document.id}/{action + '/' if action else ''}"


def reviewed(result, schema):
    result = deepcopy(result)
    for _, value in leaves(result, schema):
        value["revisado"] = True
    return result


def test_requires_authentication(db):
    client = APIClient()
    assert client.get("/api/documentos/").status_code == 403


def test_upload_is_async_202(client, photo, django_capture_on_commit_callbacks):
    with patch("documents.views.process_document.apply_async") as task:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post("/api/documentos/upload/", {"foto": photo}, format="multipart")
    assert response.status_code == 202
    assert set(response.data) == {"job_id", "correlation_id", "status"}
    document = Documento.objects.get(pk=response.data["job_id"])
    assert document.status == Documento.Status.PENDENTE
    assert document.resultado == {}
    assert "nome-nao-deve-ser-salvo" not in document.foto.name
    assert str(document.correlation_id) == response["X-Correlation-ID"]
    assert task.call_args.kwargs["args"] == [str(document.id), 1]


@pytest.mark.django_db(transaction=True)
def test_queue_failure_is_visible_and_persisted(client, photo):
    with patch("documents.views.process_document.apply_async", side_effect=OperationalError("offline")):
        response = client.post("/api/documentos/upload/", {"foto": photo}, format="multipart")
    assert response.status_code == 503
    document = Documento.objects.get()
    assert str(document.id) in str(response.data)
    assert document.status == Documento.Status.ERRO
    assert document.erro_codigo == "fila_indisponivel"


@pytest.mark.parametrize("content", [b"fake-image", b"%PDF-1.0"])
def test_invalid_upload(client, content):
    from django.core.files.uploadedfile import SimpleUploadedFile

    photo = SimpleUploadedFile("fake.jpg", content, "image/jpeg")
    assert client.post("/api/documentos/upload/", {"foto": photo}).status_code == 400
    assert Documento.objects.count() == 0


@pytest.mark.parametrize("extra_bytes, expected", [(0, 202), (1, 400)])
def test_exact_upload_size_limit(
    client, photo, extra_bytes, expected, django_capture_on_commit_callbacks,
):
    from django.core.files.uploadedfile import SimpleUploadedFile

    content = photo.read()
    padded = content + b"\0" * (15 * 1024 * 1024 - len(content) + extra_bytes)
    upload = SimpleUploadedFile("synthetic.png", padded, "image/png")
    with patch("documents.views.process_document.apply_async"):
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post("/api/documentos/upload/", {"foto": upload}, format="multipart")
    assert response.status_code == expected


@pytest.mark.parametrize("height, expected", [(5000, 202), (5001, 400)])
def test_exact_image_pixel_limit(client, height, expected, django_capture_on_commit_callbacks):
    from io import BytesIO

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    buffer = BytesIO()
    with Image.new("L", (8000, height), "white") as image:
        image.save(buffer, "PNG")
    upload = SimpleUploadedFile("synthetic.png", buffer.getvalue(), "image/png")
    with patch("documents.views.process_document.apply_async"):
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post("/api/documentos/upload/", {"foto": upload}, format="multipart")
    assert response.status_code == expected


def test_user_isolation(client, document):
    other = get_user_model().objects.create_user(username="other")
    document.usuario = other
    document.save()
    assert client.get(url(document)).status_code == 404
    assert client.get(url(document, "foto")).status_code == 404
    assert client.get("/api/documentos/").data["count"] == 0


def test_photo_requires_authenticated_owner(client, document):
    response = client.get(url(document, "foto"))
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    response.close()


def test_review_and_approval(client, document, result, schema):
    draft = reviewed(result, schema)
    draft["codigo"]["valor"] = "DOC-02"
    response = client.patch(url(document, "revisao"), {
        "versao": 1, "resultado": draft,
    }, format="json")
    assert response.status_code == 200
    assert response.data["versao"] == 2
    response = client.post(url(document, "aprovar"), {"versao": 2}, format="json")
    assert response.status_code == 200
    document.refresh_from_db()
    assert document.status == Documento.Status.APROVADO
    assert document.ged_status == Documento.GEDStatus.NAO_CONFIGURADO
    assert document.aprovado_em is not None
    assert document.extraido["codigo"]["valor"] == "DOC-01"
    assert client.patch(url(document, "revisao"), {
        "versao": 3, "resultado": draft,
    }, format="json").status_code == 409


def test_unreviewed_fields_block_approval(client, document):
    assert client.post(url(document, "aprovar"), {"versao": 1}, format="json").status_code == 400


def test_invalid_required_value_blocks_approval(client, document, schema, result):
    draft = reviewed(result, schema)
    draft["codigo"]["valor"] = None
    response = client.patch(url(document, "revisao"), {
        "versao": 1, "resultado": draft,
    }, format="json")
    assert response.status_code == 200
    assert response.data["erros_validacao"][0]["regra"] == "type"
    assert client.post(url(document, "aprovar"), {"versao": 2}, format="json").status_code == 400


def test_optimistic_lock(client, document, result, schema):
    draft = reviewed(result, schema)
    data = {"versao": 1, "resultado": draft}
    assert client.patch(url(document, "revisao"), data, format="json").status_code == 200
    assert client.patch(url(document, "revisao"), data, format="json").status_code == 409


def test_schema_snapshot_is_stable(client, document, document_type):
    document_type.esquema["properties"]["novo"] = {"type": "string"}
    document_type.save()
    assert "novo" not in client.get(url(document)).data["esquema"]["properties"]


def test_types_write_is_admin_only(client, user, schema):
    body = {"nome": "Tipo novo", "esquema": schema}
    assert client.post("/api/tipos/", body, format="json").status_code == 403
    user.is_staff = True
    user.save()
    assert client.post("/api/tipos/", body, format="json").status_code == 201
    body["nome"] = "Inválido"
    body["esquema"] = {"type": "object"}
    assert client.post("/api/tipos/", body, format="json").status_code == 400


def test_approval_dispatches_ged_after_commit(
    client, document, result, schema, settings, django_capture_on_commit_callbacks,
):
    settings.GED_URL = "https://ged.example.invalid/upload"
    document.resultado = reviewed(result, schema)
    document.save()
    with patch("documents.views.sync_ged.apply_async") as task:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(url(document, "aprovar"), {"versao": 1}, format="json")
    assert response.status_code == 200
    assert response.data["ged_status"] == "pendente"
    assert task.call_args.kwargs["args"] == [str(document.id), 2]


def test_reprocess_only_error_or_stale(client, document, django_capture_on_commit_callbacks):
    assert client.post(url(document, "reprocessar")).status_code == 409
    document.status = Documento.Status.PROCESSANDO
    document.save()
    Documento.objects.filter(pk=document.pk).update(
        atualizado_em=timezone.now() - timedelta(seconds=700),
    )
    with patch("documents.views.process_document.apply_async"):
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(url(document, "reprocessar"))
    assert response.status_code == 202
    document.refresh_from_db()
    assert document.status == Documento.Status.PENDENTE
    assert document.versao == 2


def test_login_and_logout_enforce_csrf(user):
    client = APIClient(enforce_csrf_checks=True)
    session = client.get("/api/session/")
    token = session.json()["csrfToken"]
    credentials = {"username": "tester", "password": "test-password"}
    assert client.post("/api/session/", credentials).status_code == 403
    response = client.post("/api/session/", credentials, HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 200
    assert response.json()["autenticado"] is True
    assert client.delete("/api/session/").status_code == 403
    response = client.delete("/api/session/", HTTP_X_CSRFTOKEN=response.json()["csrfToken"])
    assert response.json()["autenticado"] is False
