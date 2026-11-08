import logging
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from documents.models import Documento
from documents.pipeline import PipelineError, ask_llm, detect_type, extract, ocr_engine
from documents.tasks import process_document

from .test_pipeline import response_for


@pytest.mark.parametrize("base_url, disabled", [
    ("https://api.deepseek.com", True),
    ("https://api.deepseek.com/v1", True),
    ("https://api.openai.com/v1", False),
    ("https://api.groq.com/openai/v1", False),
    ("https://api.deepseek.com.example.invalid", False),
])
def test_thinking_disabled_only_for_official_deepseek(settings, base_url, disabled):
    settings.LLM_BASE_URL = base_url
    with patch("documents.pipeline.requests.post", return_value=response_for({"ok": True})) as post:
        assert ask_llm(b"synthetic", "JSON") == {"ok": True}
    payload = post.call_args.kwargs["json"]
    assert ("thinking" in payload) is disabled
    if disabled:
        assert payload["thinking"] == {"type": "disabled"}


def test_ocr_model_initialized_once_and_invalidated_on_configuration_change(monkeypatch, settings):
    constructor = Mock()
    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCR=constructor))
    settings.OCR_CPU_THREADS = 4
    ocr_engine.cache_clear()
    try:
        first = ocr_engine("det", "rec")
        assert ocr_engine("det", "rec") is first
        assert constructor.call_count == 1
        assert constructor.call_args.kwargs["cpu_threads"] == 4
        assert constructor.call_args.kwargs["use_textline_orientation"] is True
        assert constructor.call_args.kwargs["use_doc_unwarping"] is False
        ocr_engine("new_det", "rec")
        assert constructor.call_count == 2
    finally:
        ocr_engine.cache_clear()


def test_ocr_warmup_loads_configured_engine_in_worker_child(settings, caplog, monkeypatch):
    from config.celery import warmup_ocr_engine

    monkeypatch.setattr(logging.getLogger("documents"), "propagate", True)
    settings.OCR_DETECTION_MODEL = "det"
    settings.OCR_RECOGNITION_MODEL = "rec"
    with caplog.at_level("INFO", logger="documents"):
        with patch("documents.pipeline.ocr_engine") as engine:
            warmup_ocr_engine()
    engine.assert_called_once_with("det", "rec")
    assert "ocr_warmup_started" in caplog.text
    assert "ocr_warmup_finished" in caplog.text


def test_ocr_warmup_failure_does_not_raise(caplog, monkeypatch):
    from config.celery import warmup_ocr_engine

    monkeypatch.setattr(logging.getLogger("documents"), "propagate", True)
    with caplog.at_level("ERROR", logger="documents"):
        with patch("documents.pipeline.ocr_engine", side_effect=RuntimeError("private")):
            warmup_ocr_engine()
    assert "exception=RuntimeError correlation_id=-" in caplog.text
    assert "private" not in caplog.text


def test_incomplete_output_fails_explicitly():
    response = response_for({"ok": True})
    response.json.return_value["choices"][0]["finish_reason"] = "length"
    with patch("documents.pipeline.requests.post", return_value=response):
        with pytest.raises(PipelineError, match="llm_resposta_incompleta"):
            ask_llm(b"synthetic", "JSON")


def test_configured_output_budget_is_sent(settings):
    settings.LLM_MAX_OUTPUT_TOKENS = 48000
    with patch("documents.pipeline.requests.post", return_value=response_for({"ok": True})) as post:
        assert ask_llm(b"synthetic", "JSON") == {"ok": True}
    assert post.call_args.kwargs["json"]["max_tokens"] == 48000
    assert "JSON compact" in post.call_args.kwargs["json"]["messages"][0]["content"]


def test_classification_uses_small_explicit_budget():
    with patch("documents.pipeline.requests.post", return_value=response_for({
        "tipo_id": 1, "confianca": 0.99,
    })) as post:
        assert detect_type(b"synthetic", [], [{"id": 1}]) == 1
    assert post.call_args.kwargs["json"]["max_tokens"] == 256


def test_table_extraction_keeps_all_metadata_with_large_output_budget(settings):
    settings.LLM_MAX_OUTPUT_TOKENS = 32768
    columns = {f"coluna_{index}": {"type": ["string", "null"]} for index in range(21)}
    schema = {
        "type": "object", "additionalProperties": False,
        "properties": {"tabela": {
            "type": "array", "maxItems": 200,
            "items": {"type": "object", "additionalProperties": False, "properties": columns},
        }},
    }
    cell = {"valor": None, "confianca": 0, "bbox": None, "revisado": False, "flags": ["ilegivel"]}
    output = {"tabela": [{key: dict(cell) for key in columns} for _ in range(20)]}
    with patch("documents.pipeline.requests.post", return_value=response_for(output)) as post:
        actual = extract(b"synthetic", [], schema)
    assert len(actual["tabela"]) == 20
    assert all(len(row) == 21 for row in actual["tabela"])
    assert all(set(value) == set(cell) for row in actual["tabela"] for value in row.values())
    assert all(
        value["valor"] is None and not value["revisado"]
        and value["flags"] == ["baixa_confianca", "ilegivel"]
        for row in actual["tabela"] for value in row.values()
    )
    payload = post.call_args.kwargs["json"]
    assert payload["max_tokens"] == 32768
    assert "Não gere linhas vazias" in payload["messages"][1]["content"][0]["text"]


def test_processing_stage_saved_before_each_call(document, document_type, result):
    document.status = Documento.Status.PENDENTE
    document.save()
    observed = []

    def stage(value):
        def run(*args):
            document.refresh_from_db()
            observed.append(document.etapa)
            return value
        return run

    with (
        patch("documents.tasks.prepare_image", side_effect=stage(b"image")),
        patch("documents.tasks.run_ocr", side_effect=stage([])),
        patch("documents.tasks.detect_type", side_effect=stage(document_type.id)),
        patch("documents.tasks.extract", side_effect=stage(result)),
    ):
        process_document(str(document.id), 1)
    assert observed == ["preparacao", "leitura", "classificacao", "extracao"]
    document.refresh_from_db()
    assert document.etapa == "concluido"
    assert document.status == Documento.Status.REVISAO
