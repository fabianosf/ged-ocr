from unittest.mock import patch

import pytest
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from documents.views import SessionLoginThrottle


def test_login_limit_preserves_csrf_and_session_contract(user):
    client = APIClient(enforce_csrf_checks=True)
    session = client.get("/api/session/").json()
    token = session["csrfToken"]
    credentials = {"username": user.username, "password": "invalid"}
    assert SessionLoginThrottle().rate == "5/min"
    with patch("documents.views.authenticate", return_value=None) as authenticate:
        for _ in range(5):
            assert client.post("/api/session/", credentials).status_code == 403
            response = client.post("/api/session/", credentials, HTTP_X_CSRFTOKEN=token)
            assert response.status_code == 400
            assert response.json() == {"erro": "Credenciais inválidas."}
        response = client.post("/api/session/", credentials, HTTP_X_CSRFTOKEN=token)
        assert response.status_code == 429
        assert 0 < int(response["Retry-After"]) <= 60
        assert set(response.json()) == {"erro"}
        assert authenticate.call_count == 5
    assert client.get("/api/session/").status_code == 200
    assert client.delete("/api/session/", HTTP_X_CSRFTOKEN=token).status_code == 200
    assert client.post(
        "/api/session/", credentials, HTTP_X_CSRFTOKEN=token, REMOTE_ADDR="192.0.2.1",
    ).status_code == 400


def test_login_limit_also_applies_to_authenticated_users(client, user):
    user.set_password("synthetic-login-password")
    user.save()
    credentials = {"username": user.username, "password": "synthetic-login-password"}
    for _ in range(5):
        response = client.post("/api/session/", credentials)
        assert response.status_code == 200
        assert response.json()["autenticado"] is True
    assert client.post("/api/session/", credentials).status_code == 429


def test_login_limit_uses_only_the_ip_supplied_by_the_trusted_proxy(db):
    client = APIClient()
    with patch("documents.views.authenticate", return_value=None) as authenticate:
        for index in range(5):
            response = client.post(
                "/api/session/", {},
                HTTP_X_FORWARDED_FOR=f"192.0.2.{index}, 198.51.100.1",
            )
            assert response.status_code == 400
        response = client.post(
            "/api/session/", {},
            HTTP_X_FORWARDED_FOR="192.0.2.99, 198.51.100.1",
        )
        assert response.status_code == 429
        assert authenticate.call_count == 5
        assert client.post(
            "/api/session/", {}, HTTP_X_FORWARDED_FOR="198.51.100.2",
        ).status_code == 400


@pytest.mark.parametrize("authenticated", [False, True])
def test_api_rate_limits_by_ip_or_user(user, authenticated):
    class PublicView(APIView):
        permission_classes = [AllowAny]

        def get(self, request):
            return Response({})

    def request():
        incoming = APIRequestFactory().get("/")
        incoming.correlation_id = "test-correlation-id"
        if authenticated:
            force_authenticate(incoming, user)
        return incoming

    view = PublicView.as_view()
    throttle_class = UserRateThrottle if authenticated else AnonRateThrottle
    assert throttle_class().rate == ("600/min" if authenticated else "60/min")
    for _ in range(600 if authenticated else 60):
        assert view(request()).status_code == 200
    response = view(request())
    assert response.status_code == 429
    assert 0 < int(response["Retry-After"]) <= 60
    assert set(response.data) == {"erro", "correlation_id"}
