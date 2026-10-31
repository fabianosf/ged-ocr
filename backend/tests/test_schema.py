from copy import deepcopy

import pytest

from documents.schema import (
    InvalidDocument,
    blank_row,
    check_schema,
    leaves,
    merge_review,
    normalize_result,
    validation_errors,
    values_only,
)

from .conftest import field


def test_configurable_fields_and_tables(schema, result):
    check_schema(schema)
    assert values_only(result, schema) == {
        "codigo": "DOC-01", "total": None,
        "linhas": [{"descricao": "Item sintético", "quantidade": 2}],
    }
    assert validation_errors(result, schema) == []
    assert len(list(leaves(result, schema))) == 4


@pytest.mark.parametrize("confidence", [0, 0.699999])
def test_low_confidence_becomes_null_with_flags(schema, result, confidence):
    result["codigo"] = field("DOC-999", confidence, reviewed=True)
    normalized = normalize_result(result, schema, extraction=True)
    assert normalized["codigo"]["valor"] is None
    assert normalized["codigo"]["flags"] == ["baixa_confianca", "ilegivel"]
    assert normalized["codigo"]["revisado"] is False
    assert result["codigo"]["valor"] == "DOC-999"


def test_exact_confidence_threshold(schema, result):
    result["codigo"]["confianca"] = 0.7
    assert normalize_result(result, schema, extraction=True)["codigo"]["valor"] == "DOC-01"


def test_illegible_flag_overrides_plausible_value(schema, result):
    result["codigo"]["flags"] = ["ilegivel"]
    assert normalize_result(result, schema, extraction=True)["codigo"]["valor"] is None


@pytest.mark.parametrize("change", [
    {"confianca": float("nan")}, {"confianca": 1.01}, {"confianca": True},
    {"bbox": [0, 0, 2, 1]}, {"bbox": [0.7, 0, 0.1, 1]}, {"bbox": [0, 1]},
    {"valor": 123}, {"revisado": "false"}, {"flags": ["inventado"]},
])
def test_malformed_metadata_is_rejected(schema, result, change):
    result["codigo"].update(change)
    with pytest.raises(InvalidDocument):
        normalize_result(result, schema)


def test_missing_and_extra_fields_are_rejected(schema, result):
    del result["total"]
    with pytest.raises(InvalidDocument):
        normalize_result(result, schema)
    result["total"] = field(None)
    result["extra"] = field()
    with pytest.raises(InvalidDocument):
        normalize_result(result, schema)


def test_validation_messages_do_not_include_values(schema, result):
    result["codigo"]["valor"] = "PRIVATE-SYNTHETIC-VALUE"
    errors = validation_errors(result, schema)
    assert errors[0]["campo"] == "codigo"
    assert errors[0]["regra"] == "pattern"
    assert "PRIVATE-SYNTHETIC-VALUE" not in str(errors)


def test_review_preserves_provenance(schema, result):
    proposed = deepcopy(result)
    proposed["codigo"].update(valor="DOC-02", confianca=1, bbox=None, revisado=True)
    merged = merge_review(proposed, result, schema)
    assert merged["codigo"]["confianca"] == result["codigo"]["confianca"]
    assert merged["codigo"]["bbox"] == result["codigo"]["bbox"]
    assert merged["codigo"]["flags"] == ["preenchido_manual"]
    assert result["codigo"]["valor"] == "DOC-01"


def test_changed_value_requires_review(schema, result):
    proposed = deepcopy(result)
    proposed["codigo"]["valor"] = "DOC-02"
    with pytest.raises(InvalidDocument):
        merge_review(proposed, result, schema)


def test_manual_rows_and_removal_keep_provenance(schema, result):
    proposed = deepcopy(result)
    proposed["linhas"].append(blank_row(schema["properties"]["linhas"]["items"]))
    proposed["linhas"][1]["quantidade"].update(valor=3, revisado=True)
    merged = merge_review(proposed, result, schema, {"linhas": [0, None]})
    assert merged["linhas"][1]["quantidade"]["bbox"] is None
    assert merged["linhas"][1]["quantidade"]["confianca"] == 0
    assert "preenchido_manual" in merged["linhas"][1]["quantidade"]["flags"]
    assert result["linhas"][0]["quantidade"]["bbox"] is not None
    proposed["linhas"] = [proposed["linhas"][1]]
    merged = merge_review(proposed, result, schema, {"linhas": [None]})
    assert merged["linhas"][0]["quantidade"]["valor"] == 3


@pytest.mark.parametrize("sources", [[0, 0], [999], [True], ["0"]])
def test_invalid_row_sources(schema, result, sources):
    with pytest.raises(InvalidDocument):
        merge_review(result, result, schema, {"linhas": sources})


@pytest.mark.parametrize("patch", [
    {"$ref": "https://example.invalid/schema"},
    {"if": {"$ref": "https://example.invalid/schema"}},
    {"additionalProperties": True}, {"type": "array"}, {"properties": {}},
])
def test_unsupported_schema_is_explicit_error(schema, patch):
    schema.update(patch)
    with pytest.raises(InvalidDocument):
        check_schema(schema)


def test_tables_are_bounded(schema):
    del schema["properties"]["linhas"]["maxItems"]
    with pytest.raises(InvalidDocument):
        check_schema(schema)


def test_scalar_table_items_are_not_supported(schema):
    schema["properties"]["linhas"]["items"] = {"type": "string"}
    with pytest.raises(InvalidDocument):
        check_schema(schema)


def test_format_validation(schema, result):
    schema["properties"]["codigo"] = {"type": "string", "format": "date"}
    result["codigo"]["valor"] = "2026-02-30"
    assert validation_errors(result, schema)[0]["regra"] == "format"
