from documents.models import Documento


def test_list_can_filter_by_status(client, document, user, photo, schema, result):
    other = Documento.objects.create(
        usuario=user, foto=photo, esquema=schema, extraido=result, resultado=result,
        status=Documento.Status.ERRO,
    )
    listing = client.get("/api/documentos/?resumo=1")
    assert listing.data["count"] == 2
    filtered = client.get("/api/documentos/?resumo=1&status=erro")
    assert filtered.data["count"] == 1
    assert filtered.data["results"][0]["id"] == str(other.pk)
    assert client.get("/api/documentos/?status=inexistente").status_code == 400


def test_summary_list_is_opt_in_and_does_not_load_full_payload(client, document):
    full = client.get("/api/documentos/").data["results"][0]
    summary = client.get("/api/documentos/?resumo=1").data["results"][0]
    assert {"esquema", "resultado", "proposta"} <= full.keys()
    assert not {"esquema", "resultado", "proposta", "proposta_original",
                "esquema_provisorio"} & summary.keys()
    assert summary["id"] == full["id"]
    assert client.get(f"/api/documentos/{document.pk}/").data == full
