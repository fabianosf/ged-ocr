import logging
from contextlib import contextmanager
from copy import deepcopy
from time import monotonic

from billiard.exceptions import SoftTimeLimitExceeded
from celery import Task, shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .ged import send_document
from .models import Documento, TipoDocumento, registrar_evento
from .pipeline import PipelineError, detect_type, extract, prepare_image, run_ocr
from .schema import InvalidDocument, check_schema, validation_errors
from .services.discovery import discover
from .services.schema_builder import build_schema

logger = logging.getLogger("documents")


@contextmanager
def processing_stage(document: Documento, version: int, name: str):
    Documento.objects.filter(
        pk=document.pk, versao=version, status=Documento.Status.PROCESSANDO,
    ).update(etapa=name, atualizado_em=timezone.now())
    logger.info("stage_started correlation_id=%s stage=%s", document.correlation_id, name)
    started = monotonic()
    try:
        yield
    finally:
        logger.info(
            "stage_finished correlation_id=%s stage=%s duration_ms=%s",
            document.correlation_id, name, round((monotonic() - started) * 1000),
        )


class SafeDocumentTask(Task):
    abstract = True

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        job_id, version = args
        document = Documento.objects.filter(pk=job_id).first()
        if document is None:
            logger.info("task_document_removed")
            return
        changes = (
            {"ged_status": Documento.GEDStatus.ERRO, "ged_erro_codigo": "ged_falha_interna"}
            if self.name.endswith("sync_ged")
            else {"status": Documento.Status.ERRO, "erro_codigo": "processamento_falha_interna"}
        )
        with transaction.atomic():
            current = Documento.objects.select_for_update().filter(
                pk=job_id, versao=version,
            ).first()
            if current:
                for field, value in changes.items():
                    setattr(current, field, value)
                current.save(update_fields=[*changes, "atualizado_em"])
                registrar_evento(current, "task_failed")
        logger.error("task_failed correlation_id=%s code=falha_interna", document.correlation_id)


@shared_task(base=SafeDocumentTask)
def process_document(job_id: str, version: int) -> None:
    with transaction.atomic():
        document = Documento.objects.select_for_update().filter(pk=job_id).first()
        if document is None:
            logger.info("task_document_removed")
            return
        if document.status != Documento.Status.PENDENTE or document.versao != version:
            return
        document.status = Documento.Status.PROCESSANDO
        document.save(update_fields=["status", "atualizado_em"])
        registrar_evento(document, "processing_started")
    logger.info("process_started correlation_id=%s", document.correlation_id)
    try:
        types = list(TipoDocumento.objects.filter(ativo=True).values(
            "id", "nome", "descricao", "esquema",
        ))
        if not settings.LLM_API_KEY or not settings.LLM_MODEL:
            raise PipelineError("llm_nao_configurado")
        with processing_stage(document, version, "preparacao"):
            image = prepare_image(document.foto.path)
        if document.somente_extracao:
            ocr, type_id, schema = document.ocr, document.tipo_id, document.esquema
        else:
            with processing_stage(document, version, "leitura"):
                ocr = run_ocr(image)
            type_id = None
            if types:
                with processing_stage(document, version, "classificacao"):
                    type_id = detect_type(image, ocr, [
                        {key: item[key] for key in ("id", "nome", "descricao")} for item in types
                    ])
            if type_id is None:
                with processing_stage(document, version, "descoberta"):
                    proposal = discover(image, ocr)
                schema = build_schema(proposal)
                # Save once before extraction, so its failure cannot lose the original proposal.
                with transaction.atomic():
                    current = Documento.objects.select_for_update().get(pk=job_id)
                    if current.versao != version or current.status != Documento.Status.PROCESSANDO:
                        return
                    current.proposta = proposal.model_dump()
                    current.proposta_original = deepcopy(current.proposta)
                    current.esquema = schema
                    current.esquema_provisorio = deepcopy(schema)
                    current.ocr = ocr
                    current.somente_extracao = True
                    current.save()
                    document = current
            else:
                schema = next(item["esquema"] for item in types if item["id"] == type_id)
        check_schema(schema)
        with processing_stage(document, version, "extracao"):
            result = extract(image, ocr, schema)
        changes = {"extraido": result} if not document.extraido else {}
        with transaction.atomic():
            current = Documento.objects.select_for_update().filter(
                pk=job_id, versao=version, status=Documento.Status.PROCESSANDO,
            ).first()
            if current:
                current.extraido = changes.get("extraido", current.extraido)
                current.tipo_id = type_id
                current.esquema = schema
                current.resultado = result
                current.extracao_versao = version
                current.erros_validacao = validation_errors(result, schema)
                current.status = (
                    Documento.Status.REVISAO_TIPO if type_id is None
                    else Documento.Status.REVISAO
                )
                current.erro_codigo = ""
                current.etapa = "concluido"
                current.save()
                registrar_evento(current, "processing_completed")
        logger.info("process_completed correlation_id=%s", document.correlation_id)
    except (PipelineError, InvalidDocument, SoftTimeLimitExceeded, OSError) as exc:
        code = exc.code if isinstance(exc, PipelineError) else (
            "tempo_excedido" if isinstance(exc, SoftTimeLimitExceeded) else "processamento_invalido"
        )
        with transaction.atomic():
            current = Documento.objects.select_for_update().filter(
                pk=job_id, versao=version,
            ).first()
            if current:
                current.status = Documento.Status.ERRO
                current.erro_codigo = code
                current.save(update_fields=["status", "erro_codigo", "atualizado_em"])
                registrar_evento(current, "processing_failed")
        logger.error("process_failed correlation_id=%s code=%s", document.correlation_id, code)


@shared_task(base=SafeDocumentTask)
def sync_ged(job_id: str, version: int) -> None:
    with transaction.atomic():
        document = Documento.objects.select_for_update().filter(pk=job_id).first()
        if document is None:
            logger.info("task_document_removed")
            return
        if (document.status != Documento.Status.APROVADO
                or document.ged_status != Documento.GEDStatus.PENDENTE
                or document.versao != version):
            return
        document.ged_status = Documento.GEDStatus.ENVIANDO
        document.save(update_fields=["ged_status", "atualizado_em"])
        registrar_evento(document, "ged_sending")
    try:
        send_document(document)
        with transaction.atomic():
            current = Documento.objects.select_for_update().filter(
                pk=job_id, versao=version,
            ).first()
            if current:
                current.ged_status = Documento.GEDStatus.ENVIADO
                current.ged_erro_codigo = ""
                current.save(update_fields=["ged_status", "ged_erro_codigo", "atualizado_em"])
                registrar_evento(current, "ged_sent")
        logger.info("ged_completed correlation_id=%s", document.correlation_id)
    except (PipelineError, OSError, SoftTimeLimitExceeded) as exc:
        code = exc.code if isinstance(exc, PipelineError) else "ged_envio_interrompido"
        with transaction.atomic():
            current = Documento.objects.select_for_update().filter(
                pk=job_id, versao=version,
            ).first()
            if current:
                current.ged_status = Documento.GEDStatus.ERRO
                current.ged_erro_codigo = code
                current.save(update_fields=["ged_status", "ged_erro_codigo", "atualizado_em"])
                registrar_evento(current, "ged_failed")
        logger.error("ged_failed correlation_id=%s code=%s", document.correlation_id, code)
