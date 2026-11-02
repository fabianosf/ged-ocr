from unittest.mock import patch


def test_unhandled_api_error_is_safe_json(client):
    client.raise_request_exception = False
    with patch("documents.views.DocumentoViewSet.get_queryset", side_effect=RuntimeError("private")):
        response = client.get("/api/documentos/")
    assert response.status_code == 500
    assert response["Content-Type"] == "application/json"
    assert set(response.json()) == {"erro", "correlation_id"}
    assert response.json()["correlation_id"] == response["X-Correlation-ID"]
    assert "private" not in response.content.decode()
