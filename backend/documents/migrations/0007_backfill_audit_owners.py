from django.db import migrations

MARKER = "_owner_backfilled_0007"


def forward(apps, schema_editor):
    events = apps.get_model("documents", "DocumentoAuditoria").objects.using(
        schema_editor.connection.alias,
    )
    for event in events.filter(
        proprietario_id_snapshot__isnull=True, documento__isnull=False,
    ).select_related("documento").iterator():
        event.proprietario_id_snapshot = event.documento.usuario_id
        event.detalhes = {**event.detalhes, MARKER: True}
        event.save(update_fields=["proprietario_id_snapshot", "detalhes"])


def backward(apps, schema_editor):
    events = apps.get_model("documents", "DocumentoAuditoria").objects.using(
        schema_editor.connection.alias,
    )
    for event in events.filter(detalhes__has_key=MARKER).iterator():
        event.proprietario_id_snapshot = None
        event.detalhes = {key: value for key, value in event.detalhes.items() if key != MARKER}
        event.save(update_fields=["proprietario_id_snapshot", "detalhes"])


class Migration(migrations.Migration):
    dependencies = [("documents", "0006_documento_documento_usuario_criado_idx_and_more")]
    operations = [migrations.RunPython(forward, backward)]
