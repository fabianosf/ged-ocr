import logging

from celery import current_task


class SafeExceptionFilter(logging.Filter):
    def filter(self, record):
        request = getattr(record, "request", None)
        if request is None and current_task:
            request = current_task.request
        record.msg = "exception=%s correlation_id=%s"
        record.args = (
            record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else "Unknown",
            getattr(request, "correlation_id", "-"),
        )
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True
