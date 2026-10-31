import pytest

from documents.messages import ERROR_MESSAGES, error_message

from .test_api import url


@pytest.mark.parametrize("code", list(ERROR_MESSAGES))
def test_known_errors_have_human_guidance(client, document, code):
    document.erro_codigo = code
    document.ged_erro_codigo = code
    document.save()
    data = client.get(url(document)).data
    assert data["erro_mensagem"] == ERROR_MESSAGES[code]
    assert data["ged_erro_mensagem"] == ERROR_MESSAGES[code]
    assert code not in data["erro_mensagem"]
    assert len(data["erro_mensagem"]) > 35


def test_old_jobs_offer_discovery_without_registration(client, document):
    document.erro_codigo = "tipos_nao_configurados"
    document.save()
    message = client.get(url(document)).data["erro_mensagem"]
    assert "Tentar novamente" in message
    assert "sem cadastro prévio" in message


def test_unknown_error_does_not_leak_internal_code():
    message = error_message("unexpected-private-detail")
    assert "unexpected-private-detail" not in message
    assert "administrador" in message


def test_no_error_has_no_message():
    assert error_message("") == ""
