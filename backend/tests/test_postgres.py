from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

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
