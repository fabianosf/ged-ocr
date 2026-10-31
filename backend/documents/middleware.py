import logging
import uuid
from collections.abc import Callable

from django.http import HttpRequest, HttpResponse
from rest_framework.views import exception_handler

logger = logging.getLogger("documents")


class CorrelationMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        # Only server-generated identifiers enter logs.
        request.correlation_id = str(uuid.uuid4())
        response = self.get_response(request)
        response["X-Correlation-ID"] = request.correlation_id
        if response.status_code >= 400:
            logger.warning("http_error correlation_id=%s status=%s",
                           request.correlation_id, response.status_code)
        return response


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        response.data = {
            "erro": response.data,
            "correlation_id": context["request"].correlation_id,
        }
    return response
