import logging
from unittest.mock import patch

import pytest
from django.test import RequestFactory

from documents.middleware import api_exception_handler
from documents.models import Documento
from documents.tasks import process_document


@pytest.mark.parametrize("name", ["django.request", "celery.app.trace"])
def test_framework_errors_hide_messages_arguments_and_tracebacks(name, caplog, monkeypatch):
    logger = logging.getLogger(name)
    monkeypatch.setattr(logging.getLogger(name.split(".")[0]), "propagate", True)
    request = RequestFactory().get("/private-document-path/")
    request.correlation_id = "server-generated-correlation"
    try:
        raise ValueError("private-document-value")
    except ValueError:
        logger.exception(
            "private-document-message %s", "private-document-argument",
            extra={"request": request},
        )
    assert caplog.records[-1].getMessage() == (
        "exception=ValueError correlation_id=server-generated-correlation"
    )
    assert caplog.records[-1].exc_info is None
    assert "private-document" not in caplog.text
    assert "Traceback" not in caplog.text
    assert logging.getLogger(name.split(".")[0]).level == logging.ERROR


def test_unexpected_api_exception_logs_only_class_and_correlation(caplog, monkeypatch):
    monkeypatch.setattr(logging.getLogger("documents"), "propagate", True)
    request = RequestFactory().get("/")
    request.correlation_id = "server-generated-correlation"
    assert api_exception_handler(
        ValueError("private-document-value"), {"request": request},
    ) is None
    assert caplog.records[-1].getMessage() == (
        "exception=ValueError correlation_id=server-generated-correlation"
    )
    assert "private-document" not in caplog.text


def test_task_failure_and_celery_trace_hide_exception_details(document, caplog, monkeypatch):
    for name in ("documents", "celery"):
        monkeypatch.setattr(logging.getLogger(name), "propagate", True)
    document.status = Documento.Status.PENDENTE
    document.save()
    with patch("documents.tasks.prepare_image", side_effect=TypeError("private-document-value")):
        task = process_document.apply(args=[str(document.id), 1], throw=False)
    assert task.failed()
    document.refresh_from_db()
    assert document.erro_codigo == "processamento_falha_interna"
    errors = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert len(errors) == 2
    for record in errors:
        assert record.getMessage() == (
            f"exception=TypeError correlation_id={document.correlation_id}"
        )
        assert record.exc_info is None
    assert "private-document" not in caplog.text
    assert "DOC-01" not in caplog.text
