import logging
import warnings

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.http import FileResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from kombu.exceptions import OperationalError
from PIL import Image, UnidentifiedImageError
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Documento, TipoDocumento
from .schema import InvalidDocument, leaves, merge_review, validation_errors
from .serializers import (
    DefineTypeSerializer,
    DocumentoSerializer,
    ReviewSerializer,
    TipoSerializer,
    VersionSerializer,
    can_approve_type,
)
from .services.schema_builder import Proposal, build_schema
from .tasks import process_document, sync_ged

logger = logging.getLogger("documents")


class Conflict(APIException):
    status_code = 409
    default_detail = "Estado ou versão alterado. Atualize o documento."


class QueueUnavailable(APIException):
    status_code = 503
    default_detail = "Fila indisponível. Consulte o job e tente novamente."


@require_http_methods(["GET", "POST", "DELETE"])
@csrf_protect
def session_view(request):
    if request.method == "POST":
        user = authenticate(
            request, username=request.POST.get("username", ""),
            password=request.POST.get("password", ""),
        )
        if user is None:
            return JsonResponse({"erro": "Credenciais inválidas."}, status=400)
        login(request, user)
    elif request.method == "DELETE":
        logout(request)
    return JsonResponse({
        "autenticado": request.user.is_authenticated,
        "admin": request.user.is_staff,
        "pode_criar_tipo": (
            request.user.is_authenticated and can_approve_type(request.user)
        ),
        "llm_configurado": bool(settings.LLM_API_KEY and settings.LLM_MODEL),
        "csrfToken": get_token(request),
    })


class TypePermission(permissions.BasePermission):
    def has_permission(self, request, view) -> bool:
        return request.user.is_authenticated and (
            request.method in permissions.SAFE_METHODS or request.user.is_staff
        )


class TipoViewSet(viewsets.ModelViewSet):
    queryset = TipoDocumento.objects.all().order_by("nome")
    serializer_class = TipoSerializer
    permission_classes = [TypePermission]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]


def enqueue(document: Documento, *, ged: bool = False) -> None:
    try:
        task = sync_ged if ged else process_document
        task.apply_async(
            args=[str(document.id), document.versao],
            task_id=f"{document.id}:{document.versao}:{'ged' if ged else 'ocr'}",
        )
    except (OperationalError, ConnectionError, TimeoutError) as exc:
        changes = (
            {"ged_status": Documento.GEDStatus.ERRO, "ged_erro_codigo": "fila_indisponivel"}
            if ged else {"status": Documento.Status.ERRO, "erro_codigo": "fila_indisponivel"}
        )
        pending = Documento.objects.filter(pk=document.pk, versao=document.versao)
        pending = (
            pending.filter(ged_status=Documento.GEDStatus.PENDENTE) if ged
            else pending.filter(status=Documento.Status.PENDENTE)
        )
        pending.update(**changes, atualizado_em=timezone.now())
        logger.error("queue_failed correlation_id=%s", document.correlation_id)
        error = QueueUnavailable()
        error.detail = {"mensagem": str(error.default_detail), "job_id": str(document.id)}
        raise error from exc


class DocumentoViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DocumentoSerializer

    def get_queryset(self):
        queryset = Documento.objects.select_related("tipo")
        return queryset if self.request.user.is_staff else queryset.filter(usuario=self.request.user)

    def create(self, request):
        photo = request.FILES.get("foto")
        if photo is None or photo.size > 15 * 1024 * 1024:
            raise ValidationError("Envie uma foto de até 15 MB.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(photo) as image:
                    if image.format not in ("JPEG", "PNG", "WEBP"):
                        raise ValidationError("Formato permitido: JPEG, PNG ou WEBP.")
                    if image.width * image.height > 40_000_000:
                        raise ValidationError("Foto excede 40 megapixels.")
                    extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}[image.format]
                    image.verify()
            photo.seek(0)
            photo.name = extension
        except (UnidentifiedImageError, OSError, ValueError,
                Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValidationError("Arquivo de imagem inválido.") from exc
        with transaction.atomic():
            document = Documento.objects.create(
                usuario=request.user, foto=photo, correlation_id=request.correlation_id,
            )
            transaction.on_commit(lambda: enqueue(document))
        return Response({
            "job_id": str(document.id), "correlation_id": str(document.correlation_id),
            "status": document.status,
        }, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser],
            url_path="upload")
    def upload(self, request):
        return self.create(request)

    @action(detail=True, methods=["get"])
    def foto(self, request, pk=None):
        document = self.get_object()
        response = FileResponse(document.foto.open("rb"), as_attachment=False)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @action(detail=True, methods=["post"], url_path="definir-tipo")
    def definir_tipo(self, request, pk=None):
        serializer = DefineTypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if (document.status != Documento.Status.REVISAO_TIPO
                    or document.versao != serializer.validated_data["versao"]):
                raise Conflict()
            document.proposta = serializer.validated_data["proposta"]
            document.esquema = build_schema(Proposal.model_validate(document.proposta))
            document.status = Documento.Status.PENDENTE
            document.somente_extracao = True
            document.resultado = {}
            document.erros_validacao = []
            document.erro_codigo = ""
            document.versao += 1
            document.save()
            transaction.on_commit(lambda: enqueue(document))
        return Response(self.get_serializer(document).data, status=202)

    @action(detail=True, methods=["post"], url_path="aprovar-tipo")
    def aprovar_tipo(self, request, pk=None):
        if not can_approve_type(request.user):
            raise PermissionDenied("Somente equipe ou usuário autorizado pode criar tipos.")
        serializer = VersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if (document.status != Documento.Status.REVISAO_TIPO
                    or document.versao != serializer.validated_data["versao"]
                    or document.extracao_versao != document.versao or not document.resultado):
                raise Conflict()
            proposal = Proposal.model_validate(document.proposta)
            schema = build_schema(proposal)
            if schema != document.esquema:
                raise Conflict()
            try:
                with transaction.atomic():
                    document_type = TipoDocumento.objects.create(
                        nome=proposal.nome_sugerido,
                        descricao=proposal.descricao_reconhecimento, esquema=schema,
                    )
            except IntegrityError as exc:
                if not TipoDocumento.objects.filter(nome=proposal.nome_sugerido).exists():
                    raise
                raise ValidationError("Já existe um tipo com esse nome. Renomeie a proposta.") from exc
            document.tipo = document_type
            document.somente_extracao = False
            document.status = Documento.Status.REVISAO
            document.versao += 1
            document.save()
        logger.info("type_approved correlation_id=%s", document.correlation_id)
        return Response(self.get_serializer(document).data)

    @action(detail=True, methods=["patch"])
    def revisao(self, request, pk=None):
        serializer = ReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if (document.status != Documento.Status.REVISAO
                    or document.versao != serializer.validated_data["versao"]):
                raise Conflict()
            try:
                document.resultado = merge_review(
                    serializer.validated_data["resultado"], document.resultado, document.esquema,
                    serializer.validated_data.get("linhas"),
                )
            except InvalidDocument as exc:
                raise ValidationError(str(exc)) from exc
            document.erros_validacao = validation_errors(document.resultado, document.esquema)
            document.versao += 1
            document.revisado_por = request.user
            document.save()
        return Response(self.get_serializer(document).data)

    @action(detail=True, methods=["post"])
    def aprovar(self, request, pk=None):
        serializer = VersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if (document.status != Documento.Status.REVISAO
                    or document.versao != serializer.validated_data["versao"]):
                raise Conflict()
            errors = validation_errors(document.resultado, document.esquema)
            if errors or any(not field["revisado"] for _, field in leaves(
                document.resultado, document.esquema,
            )):
                raise ValidationError("Revise todos os campos e resolva as validações.")
            document.status = Documento.Status.APROVADO
            document.aprovado_em = timezone.now()
            document.revisado_por = request.user
            document.versao += 1
            document.ged_status = (
                Documento.GEDStatus.PENDENTE if settings.GED_URL
                else Documento.GEDStatus.NAO_CONFIGURADO
            )
            document.save()
            if settings.GED_URL:
                transaction.on_commit(lambda: enqueue(document, ged=True))
        logger.info("review_approved correlation_id=%s", document.correlation_id)
        return Response(self.get_serializer(document).data)

    @action(detail=True, methods=["post"])
    def reprocessar(self, request, pk=None):
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            # An interrupted worker can be recovered after its hard time limit plus a margin.
            stale = (timezone.now() - document.atualizado_em).total_seconds() > 660
            if not (document.status == Documento.Status.ERRO or (
                stale and document.status in (Documento.Status.PENDENTE, Documento.Status.PROCESSANDO)
            )):
                raise Conflict()
            document.status = Documento.Status.PENDENTE
            document.erro_codigo = ""
            document.versao += 1
            document.save()
            transaction.on_commit(lambda: enqueue(document))
        return Response({"job_id": str(document.id)}, status=202)

    @action(detail=True, methods=["post"], url_path="reenviar-ged")
    def reenviar_ged(self, request, pk=None):
        if not settings.GED_URL:
            raise ValidationError("GED não configurado.")
        with transaction.atomic():
            document = self.get_queryset().select_for_update(of=("self",)).get(pk=self.get_object().pk)
            stale = (timezone.now() - document.atualizado_em).total_seconds() > 660
            if document.status != Documento.Status.APROVADO or not (
                document.ged_status in (Documento.GEDStatus.ERRO, Documento.GEDStatus.NAO_CONFIGURADO)
                or stale and document.ged_status in (
                    Documento.GEDStatus.PENDENTE, Documento.GEDStatus.ENVIANDO,
                )
            ):
                raise Conflict()
            document.ged_status = Documento.GEDStatus.PENDENTE
            document.ged_erro_codigo = ""
            document.versao += 1
            document.save()
            transaction.on_commit(lambda: enqueue(document, ged=True))
        return Response({"job_id": str(document.id)}, status=202)
