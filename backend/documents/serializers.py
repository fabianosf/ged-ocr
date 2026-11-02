from pydantic import ValidationError as ProposalValidationError
from rest_framework import serializers

from .messages import error_message
from .models import Documento, TipoDocumento
from .schema import InvalidDocument, check_schema
from .services.schema_builder import Proposal, build_schema


def can_approve_type(user) -> bool:
    return user.is_staff or user.has_perm("documents.add_tipodocumento")


class TipoSerializer(serializers.ModelSerializer):
    class Meta:
        model = TipoDocumento
        fields = ["id", "nome", "descricao", "esquema", "ativo"]

    def validate_esquema(self, value):
        try:
            check_schema(value)
        except InvalidDocument as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return value


class DocumentoSerializer(serializers.ModelSerializer):
    auditoria_id = serializers.SerializerMethodField()
    tipo_nome = serializers.CharField(source="tipo.nome", read_only=True, default=None)
    pode_aprovar_tipo = serializers.SerializerMethodField()
    erro_mensagem = serializers.SerializerMethodField()
    ged_erro_mensagem = serializers.SerializerMethodField()
    pode_reprocessar = serializers.BooleanField(read_only=True)
    pode_reenviar_ged = serializers.BooleanField(read_only=True)
    pode_excluir = serializers.BooleanField(read_only=True)

    def get_auditoria_id(self, obj):
        return obj.eventos_auditoria.order_by("-id").values_list("id", flat=True).first()

    def get_pode_aprovar_tipo(self, obj) -> bool:
        return can_approve_type(self.context["request"].user)

    def get_erro_mensagem(self, obj) -> str:
        return error_message(obj.erro_codigo)

    def get_ged_erro_mensagem(self, obj) -> str:
        return error_message(obj.ged_erro_codigo)

    class Meta:
        model = Documento
        fields = [
            "id", "correlation_id", "tipo", "tipo_nome", "esquema", "resultado",
            "erros_validacao", "status", "erro_codigo", "versao", "criado_em",
            "atualizado_em", "aprovado_em", "ged_status", "ged_erro_codigo",
            "proposta", "proposta_original", "esquema_provisorio",
            "pode_aprovar_tipo", "erro_mensagem",
            "pode_reprocessar", "pode_reenviar_ged", "pode_excluir",
            "ged_erro_mensagem",
            "etapa", "auditoria_id",
        ]
        read_only_fields = fields


class ReviewSerializer(serializers.Serializer):
    versao = serializers.IntegerField(min_value=1)
    resultado = serializers.JSONField()
    linhas = serializers.DictField(
        child=serializers.ListField(
            child=serializers.IntegerField(min_value=0, allow_null=True),
        ),
        required=False,
    )


class VersionSerializer(serializers.Serializer):
    versao = serializers.IntegerField(min_value=1)


class AssignTypeSerializer(VersionSerializer):
    tipo_id = serializers.IntegerField(min_value=1)


class DefineTypeSerializer(VersionSerializer):
    proposta = serializers.JSONField()

    def validate_proposta(self, value):
        try:
            proposal = Proposal.model_validate(value)
            build_schema(proposal)
        except (ProposalValidationError, InvalidDocument) as exc:
            raise serializers.ValidationError(
                "Proposta inválida: confira tipos, chaves snake_case únicas e limites de campos."
            ) from exc
        return proposal.model_dump()


class AuditEntrySerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    documento_id_snapshot = serializers.UUIDField()
    evento = serializers.CharField()
    versao = serializers.IntegerField()
    status = serializers.CharField()
    tipo_id_snapshot = serializers.IntegerField(allow_null=True)
    ged_status = serializers.CharField()
    detalhes = serializers.JSONField()
    criado_em = serializers.DateTimeField()
    ator = serializers.SerializerMethodField()

    def get_ator(self, obj):
        return obj.ator.get_username() if obj.ator else None
