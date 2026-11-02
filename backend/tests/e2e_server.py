import os
import signal
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def main():
    if os.getenv("GED_E2E_TEST_MODE") != "1":
        raise RuntimeError("This server is only available with GED_E2E_TEST_MODE=1.")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.e2e_settings"

    def stop(signum, frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    with TemporaryDirectory(prefix="ged-ocr-e2e-") as directory:
        os.environ["GED_E2E_DATABASE"] = str(Path(directory) / "db.sqlite3")
        os.environ["GED_E2E_MEDIA"] = str(Path(directory) / "media")
        import django

        django.setup()
        from django.contrib.auth import get_user_model
        from django.core.management import call_command

        from documents.models import TipoDocumento

        call_command("migrate", interactive=False, verbosity=0)
        get_user_model().objects.create_user(
            username="e2e-user", password="e2e-only-password",
        )
        document_type = TipoDocumento.objects.create(
            nome="Tipo sintético", descricao="Código sintético",
            esquema={
                "type": "object", "additionalProperties": False, "required": ["codigo"],
                "properties": {"codigo": {"type": "string", "title": "Código"}},
            },
        )

        def fake_llm(image, prompt, **kwargs):
            if "Identifique o tipo" in prompt:
                return {"tipo_id": document_type.pk, "confianca": 1.0}
            return {"codigo": {
                "valor": "SINTETICO-001", "confianca": 1.0, "bbox": None,
                "revisado": False, "flags": [],
            }}

        with (
            patch("documents.tasks.run_ocr", return_value=[]),
            patch("documents.pipeline.ask_llm", side_effect=fake_llm),
        ):
            call_command("runserver", "127.0.0.1:8765", use_reloader=False, verbosity=0)


if __name__ == "__main__":
    main()
