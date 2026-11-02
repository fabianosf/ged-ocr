def test_summary_list_is_opt_in_and_does_not_load_full_payload(client, document):
    full = client.get("/api/documentos/").data["results"][0]
    summary = client.get("/api/documentos/?resumo=1").data["results"][0]
    assert {"esquema", "resultado", "proposta"} <= full.keys()
    assert not {"esquema", "resultado", "proposta", "proposta_original",
                "esquema_provisorio"} & summary.keys()
    assert summary["id"] == full["id"]
    assert client.get(f"/api/documentos/{document.pk}/").data == full
