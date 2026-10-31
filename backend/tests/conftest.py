from copy import deepcopy
from io import BytesIO

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from documents.models import Documento, TipoDocumento


def field(value="DOC-01", confidence=0.95, reviewed=False):
    return {
        "valor": value, "confianca": confidence, "bbox": [0.1, 0.2, 0.6, 0.3],
        "revisado": reviewed, "flags": ["ilegivel"] if value is None else [],
    }


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.LLM_API_KEY = "synthetic-test-key"
    settings.LLM_MODEL = "synthetic-model"


@pytest.fixture
def schema():
    return {
        "type": "object", "additionalProperties": False, "required": ["codigo"],
        "properties": {
            "codigo": {"type": "string", "pattern": "^DOC-[0-9]+$", "title": "Código"},
            "total": {"type": ["number", "null"], "minimum": 0},
            "linhas": {
                "type": "array", "maxItems": 20, "minItems": 1,
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "descricao": {"type": ["string", "null"]},
                        "quantidade": {"type": "integer", "minimum": 1},
                    },
                    "required": ["quantidade"],
                },
            },
        },
    }


@pytest.fixture
def result():
    return {
        "codigo": field(), "total": field(None, 0.2),
        "linhas": [{"descricao": field("Item sintético"), "quantidade": field(2)}],
    }


@pytest.fixture
def photo():
    buffer = BytesIO()
    Image.new("RGB", (100, 80), "white").save(buffer, "PNG")
    return SimpleUploadedFile("nome-nao-deve-ser-salvo.png", buffer.getvalue(), "image/png")


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="tester", password="test-password")


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_login(user)
    return client


@pytest.fixture
def document_type(db, schema):
    return TipoDocumento.objects.create(nome="Exemplo sintético", esquema=schema)


@pytest.fixture
def document(user, document_type, photo, schema, result):
    return Documento.objects.create(
        usuario=user, tipo=document_type, foto=photo, esquema=deepcopy(schema),
        extraido=deepcopy(result), resultado=deepcopy(result), status=Documento.Status.REVISAO,
    )
