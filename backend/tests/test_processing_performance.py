import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from documents.models import Documento
from documents.pipeline import PipelineError, ask_llm, ocr_engine
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


def test_ocr_model_initialized_once_and_invalidated_on_configuration_change(monkeypatch):
    constructor = Mock()
    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCR=constructor))
    ocr_engine.cache_clear()
    try:
        first = ocr_engine("det", "rec")
        assert ocr_engine("det", "rec") is first
        assert constructor.call_count == 1
        assert constructor.call_args.kwargs["cpu_threads"] == 2
        ocr_engine("new_det", "rec")
        assert constructor.call_count == 2
    finally:
        ocr_engine.cache_clear()


def test_incomplete_output_fails_explicitly():
    response = response_for({"ok": True})
    response.json.return_value["choices"][0]["finish_reason"] = "length"
    with patch("documents.pipeline.requests.post", return_value=response):
        with pytest.raises(PipelineError, match="llm_resposta_incompleta"):
            ask_llm(b"synthetic", "JSON")


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
