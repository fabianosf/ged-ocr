from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from documents.models import Documento

from .test_api import reviewed, url


@pytest.mark.django_db(transaction=True)
def test_parallel_revisions_cannot_overwrite(document, user, result, schema):
    if connection.vendor != "postgresql":
        pytest.skip("Concorrência real exige PostgreSQL.")
    barrier = Barrier(2)

    def save():
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user=user)
        barrier.wait(timeout=10)
        try:
            response = client.patch(url(document, "revisao"), {
                "versao": 1, "resultado": reviewed(result, schema),
            }, format="json")
            return response.status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: save(), range(2)))
    assert sorted(results) == [200, 409]
    document.refresh_from_db()
    assert document.versao == 2


def test_storage_is_jsonb(document):
    if connection.vendor != "postgresql":
        pytest.skip("JSONB exige PostgreSQL.")
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'documents_documento' AND column_name = 'resultado'",
        )
        assert cursor.fetchone() == ("jsonb",)


@pytest.mark.django_db(transaction=True)
def test_approval_and_revision_compete_for_same_version(document, user, result, schema):
    if connection.vendor != "postgresql":
        pytest.skip("Concorrência real exige PostgreSQL.")
    document.resultado = reviewed(result, schema)
    document.save()
    barrier = Barrier(2)

    def request(action):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user=user)
        barrier.wait(timeout=10)
        try:
            if action == "aprovar":
                return client.post(url(document, action), {"versao": 1}, format="json").status_code
            return client.patch(url(document, action), {
                "versao": 1, "resultado": reviewed(result, schema),
            }, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(request, ["aprovar", "revisao"]))
    assert sorted(responses) == [200, 409]
    document.refresh_from_db()
    assert document.versao == 2
    client = APIClient()
    client.force_authenticate(user=user)
    assert client.post(url(document, "aprovar"), {"versao": 1}, format="json").status_code == 409
    assert client.patch(url(document, "revisao"), {
        "versao": 1, "resultado": reviewed(result, schema),
    }, format="json").status_code == 409


@pytest.mark.django_db(transaction=True)
def test_failure_after_file_removal_does_not_restore_deleted_database_row(client, document):
    if connection.vendor != "postgresql":
        pytest.skip("Commit real exige PostgreSQL.")
    storage, name = document.foto.storage, document.foto.name
    remove = storage.delete

    def remove_then_fail(path):
        remove(path)
        raise OSError("private-storage-detail")

    with patch.object(storage, "delete", side_effect=remove_then_fail):
        response = client.delete(url(document), {"versao": 1}, format="json")
    assert response.status_code == 500
    assert not Documento.objects.filter(pk=document.pk).exists()
    assert not storage.exists(name)
    assert "private-storage-detail" not in str(response.data)


def test_ci_runs_postgres_integration_suite():
    from pathlib import Path

    workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml").read_text()
    assert "postgres:16" in workflow
    assert "TEST_DATABASE_URL:" in workflow
