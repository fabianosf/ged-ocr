import importlib


def test_eval_reports_field_and_table_accuracy_nulls_and_tokens():
    evaluate = importlib.import_module("eval.run")
    report = evaluate.score(
        {"codigo": "A", "itens": [{"nome": "X"}, {"nome": None}]},
        {"codigo": "B", "itens": [{"nome": "X"}, {"nome": "Y"}]},
    )
    assert report["fields"]["codigo"] == {"correct": 0, "total": 1, "nulls": 0}
    assert report["tables"]["itens"]["correct"] == 0
    assert report["tables"]["itens"]["cells"] == {"correct": 1, "total": 2, "nulls": 1}
    assert evaluate.estimate_tokens({"messages": [{"content": "abcd"}]}, "abcdefgh") > 0


def test_eval_missing_field_and_wrong_scalar_type_are_not_correct():
    evaluate = importlib.import_module("eval.run")
    report = evaluate.score(
        {"itens": [{"valor": True}]}, {"ausente": None, "itens": [{"valor": 1}]},
    )
    assert report["fields"]["ausente"]["correct"] == 0
    assert report["tables"]["itens"]["correct"] == 0


def test_eval_runs_real_pipeline_boundaries_and_accounts_provider_tokens(tmp_path):
    import json
    from unittest.mock import Mock, patch

    from PIL import Image

    evaluate = importlib.import_module("eval.run")
    Image.new("RGB", (16, 16), "white").save(tmp_path / "synthetic.png")
    manifest = {
        "types": [{
            "id": 1, "nome": "Synthetic", "descricao": "",
            "esquema": {
                "type": "object", "additionalProperties": False,
                "properties": {"codigo": {"type": "string"}},
            },
        }],
        "documents": [{"file": "synthetic.png", "expected": {"codigo": "EXEMPLO"}}],
    }
    truth = tmp_path / "truth.json"
    truth.write_text(json.dumps(manifest))
    answers = [
        {"tipo_id": 1, "confianca": 1.0},
        {"codigo": {
            "valor": "EXEMPLO", "confianca": 1.0, "bbox": None,
            "revisado": False, "flags": [],
        }},
    ]
    responses = []
    for answer in answers:
        response = Mock(status_code=200)
        response.json.return_value = {
            "choices": [{"message": {"content": json.dumps(answer)}}],
            "usage": {"total_tokens": 50},
        }
        responses.append(response)
    with (
        patch("documents.pipeline.run_ocr", return_value=[]),
        patch("requests.post", side_effect=responses),
    ):
        report = evaluate.run(tmp_path, truth)
    assert report["tokens"] == {"provider_reported": 100, "estimated": 0, "calls": 2}
    assert report["documents"][0]["fields"]["codigo"]["accuracy"] == 1
