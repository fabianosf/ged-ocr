from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from ..schema import JSON, check_schema

Key = Annotated[str, StringConstraints(
    min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
DataType = Literal["texto", "numero", "inteiro", "data", "booleano"]


class Column(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    chave: Key
    titulo: Title
    tipo: DataType


class ProposedField(Column):
    obrigatorio: bool


class Table(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    chave: Key
    titulo: Title
    colunas: Annotated[list[Column], Field(min_length=1, max_length=100)]

    @model_validator(mode="after")
    def unique_columns(self) -> Self:
        if len({column.chave for column in self.colunas}) != len(self.colunas):
            raise ValueError("Chaves de colunas duplicadas.")
        return self


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    nome_sugerido: Title
    descricao_reconhecimento: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000),
    ]
    campos: Annotated[list[ProposedField], Field(max_length=100)]
    tabelas: Annotated[list[Table], Field(max_length=100)]

    @model_validator(mode="after")
    def unique_root(self) -> Self:
        keys = [item.chave for item in (*self.campos, *self.tabelas)]
        if not 1 <= len(keys) <= 100:
            raise ValueError("A raiz exige de 1 a 100 propriedades.")
        if len(set(keys)) != len(keys):
            raise ValueError("Chaves de campos e tabelas devem ser únicas.")
        return self


def scalar_schema(column: Column, *, required: bool = False) -> JSON:
    kind = {
        "texto": "string", "numero": "number", "inteiro": "integer",
        "data": "string", "booleano": "boolean",
    }[column.tipo]
    schema: JSON = {"type": kind if required else [kind, "null"], "title": column.titulo}
    if column.tipo == "data":
        schema["format"] = "date"
    return schema


def build_schema(proposal: Proposal) -> JSON:
    """Convert a validated proposal without IO, defaults or document-specific rules."""
    properties = {
        field.chave: scalar_schema(field, required=field.obrigatorio) for field in proposal.campos
    }
    for table in proposal.tabelas:
        properties[table.chave] = {
            "type": "array", "title": table.titulo, "maxItems": 200,
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {column.chave: scalar_schema(column) for column in table.colunas},
            },
        }
    schema: JSON = {
        "type": "object", "additionalProperties": False,
        "properties": properties,
        "required": [field.chave for field in proposal.campos if field.obrigatorio],
    }
    check_schema(schema)
    return schema
