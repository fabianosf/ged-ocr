from documents.models import registrar_evento


def test_detail_audit_revision_changes_without_document_version(client, document):
    path = f"/api/documentos/{document.pk}/"
    first = client.get(path).data
    registrar_evento(document, "processing_started")
    second = client.get(path).data
    assert first["versao"] == second["versao"]
    assert first["auditoria_id"] != second["auditoria_id"]
