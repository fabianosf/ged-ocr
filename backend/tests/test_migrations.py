import importlib

import pytest
from django.apps import apps
from django.db import connection

from documents.models import DocumentoAuditoria, registrar_evento


@pytest.mark.django_db(transaction=True)
def test_backfill_audit_owners_is_reversible_and_preserves_existing(document):
    legacy = registrar_evento(document, "legacy")
    existing = registrar_evento(document, "existing")
    DocumentoAuditoria.objects.filter(pk=legacy.pk).update(proprietario_id_snapshot=None)
    migration = importlib.import_module("documents.migrations.0007_backfill_audit_owners")
    with connection.schema_editor(atomic=False) as editor:
        migration.forward(apps, editor)
    legacy.refresh_from_db()
    existing.refresh_from_db()
    assert legacy.proprietario_id_snapshot == document.usuario_id
    with connection.schema_editor(atomic=False) as editor:
        migration.backward(apps, editor)
    legacy.refresh_from_db()
    existing.refresh_from_db()
    assert legacy.proprietario_id_snapshot is None
    assert existing.proprietario_id_snapshot == document.usuario_id
