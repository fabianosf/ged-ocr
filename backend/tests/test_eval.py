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
