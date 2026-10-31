import math
from copy import deepcopy
from typing import Any, Iterator

from django.conf import settings
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

JSON = dict[str, Any]
METADATA = {"valor", "confianca", "bbox", "revisado", "flags"}
FLAGS = {"ilegivel", "baixa_confianca", "preenchido_manual"}


class InvalidDocument(ValueError):
    pass


def check_schema(schema: JSON) -> None:
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise InvalidDocument("Esquema JSON Schema inválido.") from exc

    def visit(node: Any, level: int = 0) -> None:
        if not isinstance(node, dict) or level > 3:
            raise InvalidDocument("Estrutura de esquema não suportada.")
        if any(key in node for key in ("$ref", "$dynamicRef", "allOf", "anyOf", "oneOf", "not")):
            raise InvalidDocument("Referências e composição não são suportadas.")
        kind = node.get("type")
        types = kind if isinstance(kind, list) else [kind]
        non_null = [value for value in types if value != "null"]
        if len(non_null) != 1:
            raise InvalidDocument("Declare um tipo por campo, opcionalmente com null.")
        kind = non_null[0]
        allowed = {"type", "title", "description", "enum", "const"}
        allowed |= {
            "object": {"properties", "additionalProperties", "required"},
            "array": {"items", "minItems", "maxItems", "uniqueItems"},
            "string": {"minLength", "maxLength", "pattern", "format"},
            "number": {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"},
            "integer": {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"},
            "boolean": set(),
        }.get(kind, set())
        if set(node) - allowed:
            raise InvalidDocument("Esquema contém palavras-chave não suportadas.")
        if "format" in node and node["format"] not in FormatChecker.checkers:
            raise InvalidDocument("Formato de validação não suportado.")
        if level == 0 and kind != "object":
            raise InvalidDocument("A raiz deve ser um objeto.")
        if kind == "object":
            if level not in (0, 2) or not node.get("properties"):
                raise InvalidDocument("Objetos só na raiz ou nas linhas de tabela.")
            if node.get("additionalProperties") is not False:
                raise InvalidDocument("Use additionalProperties: false em objetos.")
            if len(node["properties"]) > 100:
                raise InvalidDocument("Limite de 100 campos por objeto.")
            for key, child in node["properties"].items():
                if not key or len(key) > 100:
                    raise InvalidDocument("Nome de campo inválido.")
                visit(child, level + 1)
        elif kind == "array":
            if level != 1:
                raise InvalidDocument("Tabelas só são permitidas na raiz.")
            if node.get("maxItems", 0) not in range(1, 201):
                raise InvalidDocument("Tabelas exigem maxItems entre 1 e 200.")
            if not isinstance(node.get("items"), dict) or node["items"].get("type") != "object":
                raise InvalidDocument("Linhas de tabela devem ser objetos.")
            visit(node.get("items"), level + 1)
        elif kind not in ("string", "integer", "number", "boolean"):
            raise InvalidDocument("Tipo de campo não suportado.")

    visit(schema)


def kind_of(schema: JSON) -> str:
    kind = schema["type"]
    return next(value for value in kind if value != "null") if isinstance(kind, list) else kind


def leaves(result: JSON, schema: JSON, prefix: str = "") -> Iterator[tuple[str, JSON]]:
    for key, field_schema in schema["properties"].items():
        path = f"{prefix}{key}"
        if kind_of(field_schema) == "array":
            for index, row in enumerate(result[key]):
                yield from leaves(row, field_schema["items"], f"{path}.{index}.")
        else:
            yield path, result[key]


def normalize_result(result: Any, schema: JSON, *, extraction: bool = False) -> JSON:
    if not isinstance(result, dict) or set(result) != set(schema["properties"]):
        raise InvalidDocument("Campos divergentes do esquema.")
    normalized: JSON = {}
    for key, field_schema in schema["properties"].items():
        field = result[key]
        if kind_of(field_schema) == "array":
            if not isinstance(field, list) or len(field) > field_schema["maxItems"]:
                raise InvalidDocument("Tabela inválida ou com linhas demais.")
            normalized[key] = [
                normalize_result(row, field_schema["items"], extraction=extraction)
                for row in field
            ]
            continue
        if not isinstance(field, dict) or set(field) != METADATA:
            raise InvalidDocument("Metadados incompletos.")
        confidence = field["confianca"]
        if (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
                or not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise InvalidDocument("Confiança deve estar entre 0 e 1.")
        bbox = field["bbox"]
        if bbox is not None:
            if (not isinstance(bbox, list) or len(bbox) != 4
                    or any(isinstance(v, bool) or not isinstance(v, (int, float))
                           or not math.isfinite(v) or not 0 <= v <= 1 for v in bbox)
                    or bbox[0] > bbox[2] or bbox[1] > bbox[3]):
                raise InvalidDocument("bbox deve ser [x1,y1,x2,y2] normalizado.")
        if not isinstance(field["revisado"], bool):
            raise InvalidDocument("revisado deve ser booleano.")
        if (not isinstance(field["flags"], list)
                or any(not isinstance(flag, str) or flag not in FLAGS for flag in field["flags"])):
            raise InvalidDocument("Flags inválidas.")
        value = field["valor"]
        if isinstance(value, (dict, list)):
            raise InvalidDocument("Valor deve ser escalar.")
        if value is not None:
            # Constraints are reported for review, but a wrong scalar type is malformed output.
            expected = kind_of(field_schema)
            valid = {
                "string": isinstance(value, str),
                "number": isinstance(value, (int, float)) and not isinstance(value, bool),
                "integer": isinstance(value, int) and not isinstance(value, bool),
                "boolean": isinstance(value, bool),
            }[expected]
            if not valid or (isinstance(value, float) and not math.isfinite(value)):
                raise InvalidDocument("Valor incompatível com o tipo do campo.")
        item = deepcopy(field)
        if extraction:
            item["revisado"] = False
            item["flags"] = []
            if confidence < settings.MIN_CONFIDENCE:
                item["valor"] = None
                item["flags"].append("baixa_confianca")
            if item["valor"] is None or "ilegivel" in field["flags"]:
                item["valor"] = None
                item["flags"].append("ilegivel")
        elif value is None and "ilegivel" not in item["flags"]:
            item["flags"].append("ilegivel")
        normalized[key] = item
    return normalized


def values_only(result: JSON, schema: JSON) -> JSON:
    return {
        key: [values_only(row, child["items"]) for row in result[key]]
        if kind_of(child) == "array" else result[key]["valor"]
        for key, child in schema["properties"].items()
    }


def validation_errors(result: JSON, schema: JSON) -> list[JSON]:
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    # Never return the jsonschema message: it includes the personal value.
    return [
        {"campo": ".".join(str(part) for part in error.absolute_path),
         "regra": error.validator, "mensagem": "Valor não atende ao esquema."}
        for error in validator.iter_errors(values_only(result, schema))
    ]


def blank_row(schema: JSON) -> JSON:
    return {
        key: {"valor": None, "confianca": 0, "bbox": None,
              "revisado": False, "flags": ["preenchido_manual", "ilegivel"]}
        for key in schema["properties"]
    }


def merge_review(
    proposed: JSON, current: JSON, schema: JSON,
    row_sources: dict[str, list[int | None]] | None = None,
) -> JSON:
    result = normalize_result(proposed, schema)
    row_sources = row_sources or {}
    if set(row_sources) - {
        key for key, child in schema["properties"].items() if kind_of(child) == "array"
    }:
        raise InvalidDocument("Mapeamento contém tabela desconhecida.")
    for key, child in schema["properties"].items():
        if kind_of(child) == "array":
            sources = row_sources.get(key, list(range(len(current[key]))))
            if not isinstance(sources, list) or len(sources) != len(result[key]):
                raise InvalidDocument("Mapeamento de linhas incompatível.")
            used = set()
            for source in sources:
                if source is not None:
                    if (isinstance(source, bool) or not isinstance(source, int)
                            or source not in range(len(current[key])) or source in used):
                        raise InvalidDocument("Origem de linha inválida ou duplicada.")
                    used.add(source)
            result[key] = [
                merge_review(
                    row, blank_row(child["items"]) if source is None else current[key][source],
                    child["items"],
                )
                for row, source in zip(result[key], sources, strict=True)
            ]
        else:
            field, old = result[key], current[key]
            field["confianca"], field["bbox"] = old["confianca"], old["bbox"]
            field["flags"] = [flag for flag in old["flags"] if flag != "ilegivel"]
            if field["valor"] is None:
                field["flags"].append("ilegivel")
            if field["valor"] != old["valor"] and "preenchido_manual" not in field["flags"]:
                field["flags"].append("preenchido_manual")
            if field["valor"] != old["valor"] and not field["revisado"]:
                raise InvalidDocument("Valores alterados devem ser marcados como revisados.")
    return result
