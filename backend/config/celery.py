import logging
import os
from logging.config import dictConfig

from celery import Celery
from celery.signals import setup_logging, worker_process_init
from django.conf import settings

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("ged_ocr")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@setup_logging.connect
def configure_worker_logging(**kwargs) -> None:
    dictConfig(settings.LOGGING)


@worker_process_init.connect
def warmup_ocr_engine(**kwargs) -> None:
    from documents.pipeline import ocr_engine

    logger = logging.getLogger("documents")
    logger.info("ocr_warmup_started")
    try:
        ocr_engine(settings.OCR_DETECTION_MODEL, settings.OCR_RECOGNITION_MODEL)
    except Exception as exc:
        logger.error("exception=%s correlation_id=-", type(exc).__name__)
        return
    logger.info("ocr_warmup_finished")
