import logging

from billiard.exceptions import SoftTimeLimitExceeded
from celery import Task, shared_task
from django.db import transaction
from django.utils import timezone

from .ged import send_document
from .models import Documento, TipoDocumento
from .pipeline import PipelineError, detect_type, extract, prepare_image, run_ocr
from .schema import InvalidDocument, check_schema, validation_errors

logger = logging.getLogger("documents")


class SafeDocumentTask(Task):
    abstract = True

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        job_id, version = args
        document = Documento.objects.get(pk=job_id)
        changes = (
            {"ged_status": Documento.GEDStatus.ERRO, "ged_erro_codigo": "ged_falha_interna"}
            if self.name.endswith("sync_ged")
            else {"status": Documento.Status.ERRO, "erro_codigo": "processamento_falha_interna"}
        )
        Documento.objects.filter(pk=job_id, versao=version).update(
            **changes, atualizado_em=timezone.now(),
        )
        logger.error("task_failed correlation_id=%s code=falha_interna", document.correlation_id)


@shared_task(base=SafeDocumentTask)
def process_document(job_id: str, version: int) -> None:
    with transaction.atomic():
        document = Documento.objects.select_for_update().get(pk=job_id)
        if document.status != Documento.Status.PENDENTE or document.versao != version:
            return
        document.status = Documento.Status.PROCESSANDO
        document.save(update_fields=["status", "atualizado_em"])
    logger.info("process_started correlation_id=%s", document.correlation_id)
    try:
        types = list(TipoDocumento.objects.filter(ativo=True).values(
            "id", "nome", "descricao", "esquema",
        ))
        if not types:
            raise PipelineError("tipos_nao_configurados")
        image = prepare_image(document.foto.path)
        ocr = run_ocr(image)
        type_id = detect_type(image, ocr, [
            {key: item[key] for key in ("id", "nome", "descricao")} for item in types
        ])
        schema = next(item["esquema"] for item in types if item["id"] == type_id)
        check_schema(schema)
        result = extract(image, ocr, schema)
        Documento.objects.filter(
            pk=job_id, versao=version, status=Documento.Status.PROCESSANDO,
        ).update(
            tipo_id=type_id, esquema=schema, extraido=result, resultado=result,
            erros_validacao=validation_errors(result, schema),
            status=Documento.Status.REVISAO, atualizado_em=timezone.now(),
        )
        logger.info("process_completed correlation_id=%s", document.correlation_id)
    except (PipelineError, InvalidDocument, SoftTimeLimitExceeded, OSError) as exc:
        code = exc.code if isinstance(exc, PipelineError) else (
            "tempo_excedido" if isinstance(exc, SoftTimeLimitExceeded) else "processamento_invalido"
        )
        Documento.objects.filter(pk=job_id, versao=version).update(
            status=Documento.Status.ERRO, erro_codigo=code, atualizado_em=timezone.now(),
        )
        logger.error("process_failed correlation_id=%s code=%s", document.correlation_id, code)


@shared_task(base=SafeDocumentTask)
def sync_ged(job_id: str, version: int) -> None:
    with transaction.atomic():
        document = Documento.objects.select_for_update().get(pk=job_id)
        if (document.status != Documento.Status.APROVADO
                or document.ged_status != Documento.GEDStatus.PENDENTE
                or document.versao != version):
            return
        document.ged_status = Documento.GEDStatus.ENVIANDO
        document.save(update_fields=["ged_status", "atualizado_em"])
    try:
        send_document(document)
        Documento.objects.filter(pk=job_id, versao=version).update(
            ged_status=Documento.GEDStatus.ENVIADO, ged_erro_codigo="",
            atualizado_em=timezone.now(),
        )
        logger.info("ged_completed correlation_id=%s", document.correlation_id)
    except (PipelineError, OSError, SoftTimeLimitExceeded) as exc:
        code = exc.code if isinstance(exc, PipelineError) else "ged_envio_interrompido"
        Documento.objects.filter(pk=job_id, versao=version).update(
            ged_status=Documento.GEDStatus.ERRO, ged_erro_codigo=code,
            atualizado_em=timezone.now(),
        )
        logger.error("ged_failed correlation_id=%s code=%s", document.correlation_id, code)
