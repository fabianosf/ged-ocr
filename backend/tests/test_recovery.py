from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from documents.models import Documento

from .test_api import url


@pytest.mark.parametrize("state", ["pendente", "processando"])
@pytest.mark.parametrize("seconds, expected", [(659, False), (660, False), (660.001, True)])
def test_recovery_exact_deadline(client, document, state, seconds, expected):
    now = timezone.now()
    document.status = state
    document.save()
    Documento.objects.filter(pk=document.pk).update(atualizado_em=now - timedelta(seconds=seconds))
    with patch("documents.models.timezone.now", return_value=now):
        assert client.get(url(document)).data["pode_reprocessar"] is expected
        if not expected:
            response = client.post(url(document, "reprocessar"))
            assert response.status_code == 409
            assert "aguarde" in str(response.data)
    document.refresh_from_db()
    assert document.status == state


@pytest.mark.parametrize("state, expected", [
    ("erro", True), ("revisao", False), ("revisao_tipo", False), ("aprovado", False),
])
def test_recovery_state_contract(client, document, state, expected):
    document.status = state
    document.save()
    assert client.get(url(document)).data["pode_reprocessar"] is expected


def test_ged_retry_requires_configuration_and_valid_state(client, document, settings):
    document.status = Documento.Status.APROVADO
    document.ged_status = Documento.GEDStatus.ERRO
    document.save()
    settings.GED_URL = ""
    assert not client.get(url(document)).data["pode_reenviar_ged"]
    settings.GED_URL = "https://ged.example.invalid/upload"
    assert client.get(url(document)).data["pode_reenviar_ged"]
    document.ged_status = Documento.GEDStatus.ENVIANDO
    document.save()
    assert not client.get(url(document)).data["pode_reenviar_ged"]
