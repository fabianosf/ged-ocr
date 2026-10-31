import json

import requests
from django.conf import settings

from .models import Documento
from .pipeline import PipelineError
from .schema import values_only


def send_document(document: Documento) -> None:
    if not settings.GED_URL:
        raise PipelineError("ged_nao_configurado")
    # This is an explicit adapter contract, not a claim of universal GED compatibility.
    with document.foto.open("rb") as photo:
        try:
            response = requests.post(
                settings.GED_URL,
                headers={
                    "Authorization": f"Bearer {settings.GED_TOKEN}",
                    "Idempotency-Key": str(document.id),
                    "X-Correlation-ID": str(document.correlation_id),
                },
                data={"documento": json.dumps({
                    "job_id": str(document.id), "tipo_id": document.tipo_id,
                    "esquema": document.esquema, "campos": document.resultado,
                    "valores": values_only(document.resultado, document.esquema),
                }, ensure_ascii=False)},
                files={"arquivo": ("documento", photo, "application/octet-stream")},
                timeout=(10, settings.GED_TIMEOUT),
                allow_redirects=False,
            )
            if not 200 <= response.status_code < 300:
                raise PipelineError("ged_resposta_invalida")
        except requests.RequestException as exc:
            raise PipelineError("ged_indisponivel") from exc
