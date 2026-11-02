from unittest.mock import patch

from documents.models import Documento, TipoDocumento
from documents.tasks import process_document


def test_classification_limits_types_and_logs_only_safe_metadata(document, result):
    TipoDocumento.objects.bulk_create([
        TipoDocumento(nome=f"private-type-{index}", esquema=document.esquema)
        for index in range(102)
    ])
    document.status = Documento.Status.PENDENTE
    document.save()
    with (
        patch("documents.tasks.prepare_image", return_value=b"synthetic"),
        patch("documents.tasks.run_ocr", return_value=[]),
        patch("documents.tasks.detect_type", return_value=document.tipo_id) as classify,
        patch("documents.tasks.extract", return_value=result),
        patch("documents.tasks.logger.warning") as log,
    ):
        process_document(str(document.pk), 1)
    types = classify.call_args.args[2]
    assert len(types) == 100
    assert all(set(item) == {"id", "nome", "descricao"} for item in types)
    assert [item["id"] for item in types] == sorted(item["id"] for item in types)
    log.assert_called_once_with(
        "classification_types_truncated correlation_id=%s limit=%s", document.correlation_id, 100,
    )
