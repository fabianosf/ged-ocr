import json
import logging
from unittest.mock import Mock, patch

import pytest
import requests

from documents.ged import send_document
from documents.models import Documento
from documents.pipeline import PipelineError, ask_llm, detect_type, extract, prepare_image
from documents.tasks import process_document, sync_ged


def response_for(data):
    response = Mock(status_code=200)
    response.json.return_value = {"choices": [{"message": {"content": json.dumps(data)}}]}
    return response


def test_llm_requires_explicit_configuration(settings):
    settings.LLM_API_KEY = ""
    with pytest.raises(PipelineError, match="llm_nao_configurado"):
        ask_llm(b"synthetic", "test")


def test_multimodal_json_contract(settings):
    settings.LLM_API_KEY = "synthetic-test-key"
    settings.LLM_MODEL = "synthetic-model"
    with patch("documents.pipeline.requests.post", return_value=response_for({"ok": True})) as post:
        assert ask_llm(b"synthetic-image", "test") == {"ok": True}
    payload = post.call_args.kwargs["json"]
    assert payload["response_format"] == {"type": "json_object"}
    image = payload["messages"][1]["content"][1]["image_url"]["url"]
    assert image.startswith("data:image/jpeg;base64,")
    assert post.call_args.kwargs["allow_redirects"] is False


def test_llm_network_error_is_safe(settings):
    settings.LLM_API_KEY = "synthetic"
    settings.LLM_MODEL = "synthetic"
    with patch("documents.pipeline.requests.post", side_effect=requests.Timeout("private-detail")):
        with pytest.raises(PipelineError) as exc:
            ask_llm(b"synthetic", "test")
    assert str(exc.value) == "llm_indisponivel"


@pytest.mark.parametrize("content", ["not json", "[]", '{"wrong": "shape"}'])
def test_llm_invalid_json(content, settings):
    settings.LLM_API_KEY = "synthetic"
    settings.LLM_MODEL = "synthetic"
    response = response_for({})
    response.json.return_value["choices"][0]["message"]["content"] = content
    with patch("documents.pipeline.requests.post", return_value=response):
        if content.startswith('{"wrong"'):
            assert ask_llm(b"x", "x") == {"wrong": "shape"}
        else:
            with pytest.raises(PipelineError, match="llm_resposta_invalida"):
                ask_llm(b"x", "x")


@pytest.mark.parametrize("answer", [
    {"tipo_id": None, "confianca": 0.99},
    {"tipo_id": 42, "confianca": 0.99},
    {"tipo_id": 1, "confianca": 0.69},
])
def test_unknown_or_uncertain_type(answer):
    with patch("documents.pipeline.ask_llm", return_value=answer):
        assert detect_type(b"synthetic", [], [{"id": 1}]) is None


@pytest.mark.parametrize("answer", [
    {"tipo_id": True, "confianca": 0.99},
    {"tipo_id": 1, "confianca": float("nan")},
    {"tipo_id": 1, "confianca": 1.1},
    {"tipo_id": "1", "confianca": 0.99},
    {"tipo_id": None},
])
def test_malformed_classification_is_not_discovery(answer):
    with patch("documents.pipeline.ask_llm", return_value=answer):
        with pytest.raises(PipelineError, match="classificacao_resposta_invalida"):
            detect_type(b"synthetic", [], [{"id": 1}])


def test_extract_always_normalizes(schema, result):
    result["codigo"].update(confianca=0.2, revisado=True)
    with patch("documents.pipeline.ask_llm", return_value=result):
        output = extract(b"synthetic", [], schema)
    assert output["codigo"]["valor"] is None
    assert output["codigo"]["revisado"] is False


def test_malformed_extraction_fails_instead_of_filling_defaults(schema):
    with patch("documents.pipeline.ask_llm", return_value={"unknown": "synthetic"}):
        with pytest.raises(PipelineError, match="extracao_invalida"):
            extract(b"synthetic", [], schema)


def test_prepare_image_runs_only_on_worker(document):
    image = prepare_image(document.foto.path)
    assert image.startswith(b"\xff\xd8")


def test_worker_success_and_duplicate_delivery(document, result, document_type):
    document.status = Documento.Status.PENDENTE
    document.save()
    with (
        patch("documents.tasks.prepare_image", return_value=b"image"),
        patch("documents.tasks.run_ocr", return_value=[{"texto": "dados sintéticos"}]) as ocr,
        patch("documents.tasks.detect_type", return_value=document_type.id),
        patch("documents.tasks.extract", return_value=result),
    ):
        process_document(str(document.id), 1)
        process_document(str(document.id), 1)
    assert ocr.call_count == 1
    document.refresh_from_db()
    assert document.status == Documento.Status.REVISAO
    assert document.extraido == result
    assert document.esquema == document_type.esquema
    assert document.ocr == [{"texto": "dados sintéticos"}]


def test_manual_type_assignment_reuses_saved_ocr(document, result, document_type):
    document.status = Documento.Status.PENDENTE
    document.somente_extracao = True
    document.ocr = [{"texto": "dados sintéticos"}]
    document.save()
    with (
        patch("documents.tasks.prepare_image", return_value=b"image"),
        patch("documents.tasks.run_ocr") as ocr,
        patch("documents.tasks.detect_type") as classify,
        patch("documents.tasks.extract", return_value=result) as extract_result,
    ):
        process_document(str(document.id), 1)
    ocr.assert_not_called()
    classify.assert_not_called()
    extract_result.assert_called_once()
    document.refresh_from_db()
    assert document.status == Documento.Status.REVISAO
    assert document.tipo_id == document_type.id
    assert document.ocr == [{"texto": "dados sintéticos"}]


def test_stale_delivery_does_not_process_new_generation(document):
    document.status = Documento.Status.PENDENTE
    document.versao = 2
    document.save()
    with patch("documents.tasks.run_ocr") as ocr:
        process_document(str(document.id), 1)
    ocr.assert_not_called()


def test_failure_state_and_logs_are_safe(document, caplog, monkeypatch):
    document.status = Documento.Status.PENDENTE
    document.save()
    monkeypatch.setattr(logging.getLogger("documents"), "propagate", True)
    with patch("documents.tasks.prepare_image", side_effect=PipelineError("imagem_invalida")):
        process_document(str(document.id), 1)
    document.refresh_from_db()
    assert document.status == Documento.Status.ERRO
    assert document.erro_codigo == "imagem_invalida"
    assert str(document.correlation_id) in caplog.text
    assert "DOC-01" not in caplog.text
    assert "Item sintético" not in caplog.text


def test_unexpected_task_failure_is_persisted_without_details(document):
    document.status = Documento.Status.PENDENTE
    document.save()
    with patch("documents.tasks.prepare_image", side_effect=TypeError("private-detail")):
        task = process_document.apply(args=[str(document.id), 1], throw=False)
    assert task.failed()
    document.refresh_from_db()
    assert document.erro_codigo == "processamento_falha_interna"


def test_ged_contract_and_idempotency(document, settings):
    settings.GED_URL = "https://ged.example.invalid/upload"
    settings.GED_TOKEN = "synthetic"
    with patch("documents.ged.requests.post", return_value=Mock(status_code=201)) as post:
        send_document(document)
    options = post.call_args.kwargs
    assert options["headers"]["Idempotency-Key"] == str(document.id)
    assert options["headers"]["X-Correlation-ID"] == str(document.correlation_id)
    payload = json.loads(options["data"]["documento"])
    assert payload["campos"]["codigo"]["revisado"] is False
    assert payload["valores"]["total"] is None
    assert options["allow_redirects"] is False


def test_ged_sync_success_and_failure(document):
    document.status = Documento.Status.APROVADO
    document.ged_status = Documento.GEDStatus.PENDENTE
    document.save()
    with patch("documents.tasks.send_document") as send:
        sync_ged(str(document.id), 1)
        sync_ged(str(document.id), 1)
    assert send.call_count == 1
    document.refresh_from_db()
    assert document.ged_status == Documento.GEDStatus.ENVIADO
    document.ged_status = Documento.GEDStatus.PENDENTE
    document.save()
    with patch("documents.tasks.send_document", side_effect=PipelineError("ged_indisponivel")):
        sync_ged(str(document.id), 1)
    document.refresh_from_db()
    assert document.ged_status == Documento.GEDStatus.ERRO
    assert document.ged_erro_codigo == "ged_indisponivel"
