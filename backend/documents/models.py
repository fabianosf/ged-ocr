import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from .schema import InvalidDocument, check_schema


def photo_path(instance: "Documento", filename: str) -> str:
    return f"documentos/{instance.id}/foto{filename}"


class TipoDocumento(models.Model):
    nome = models.CharField(max_length=120, unique=True)
    descricao = models.TextField(blank=True)
    esquema = models.JSONField()
    ativo = models.BooleanField(default=True)

    def clean(self) -> None:
        super().clean()
        try:
            check_schema(self.esquema)
        except InvalidDocument as exc:
            raise ValidationError({"esquema": str(exc)}) from exc

    def __str__(self) -> str:
        return self.nome


class Documento(models.Model):
    class Status(models.TextChoices):
        PENDENTE = "pendente", "Pendente"
        PROCESSANDO = "processando", "Processando"
        REVISAO = "revisao", "Em revisão"
        REVISAO_TIPO = "revisao_tipo", "Documento novo"
        APROVADO = "aprovado", "Aprovado"
        ERRO = "erro", "Erro"

    class GEDStatus(models.TextChoices):
        NAO_CONFIGURADO = "nao_configurado", "Não configurado"
        PENDENTE = "pendente", "Pendente"
        ENVIANDO = "enviando", "Enviando"
        ENVIADO = "enviado", "Enviado"
        ERRO = "erro", "Erro"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    correlation_id = models.UUIDField(default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    foto = models.ImageField(upload_to=photo_path)
    tipo = models.ForeignKey(TipoDocumento, null=True, blank=True, on_delete=models.PROTECT)
    esquema = models.JSONField(default=dict)
    proposta = models.JSONField(default=dict)
    proposta_original = models.JSONField(default=dict, editable=False)
    esquema_provisorio = models.JSONField(default=dict, editable=False)
    ocr = models.JSONField(default=list, editable=False)
    somente_extracao = models.BooleanField(default=False, editable=False)
    extracao_versao = models.PositiveIntegerField(default=0, editable=False)
    extraido = models.JSONField(default=dict)
    resultado = models.JSONField(default=dict)
    erros_validacao = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=Status, default=Status.PENDENTE)
    erro_codigo = models.CharField(max_length=64, blank=True)
    versao = models.PositiveIntegerField(default=1)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)
    aprovado_em = models.DateTimeField(null=True, blank=True)
    revisado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.PROTECT, related_name="revisoes",
    )
    ged_status = models.CharField(
        max_length=20, choices=GEDStatus, default=GEDStatus.NAO_CONFIGURADO,
    )
    ged_erro_codigo = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-criado_em"]

    @property
    def pode_reprocessar(self) -> bool:
        stale = (timezone.now() - self.atualizado_em).total_seconds() > 660
        return self.status == self.Status.ERRO or (
            stale and self.status in (self.Status.PENDENTE, self.Status.PROCESSANDO)
        )

    @property
    def pode_reenviar_ged(self) -> bool:
        stale = (timezone.now() - self.atualizado_em).total_seconds() > 660
        return bool(settings.GED_URL) and self.status == self.Status.APROVADO and (
            self.ged_status in (self.GEDStatus.ERRO, self.GEDStatus.NAO_CONFIGURADO)
            or stale and self.ged_status in (self.GEDStatus.PENDENTE, self.GEDStatus.ENVIANDO)
        )
