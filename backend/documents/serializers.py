from rest_framework import serializers

from .models import Documento, TipoDocumento
from .schema import InvalidDocument, check_schema


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
    tipo_nome = serializers.CharField(source="tipo.nome", read_only=True, default=None)

    class Meta:
        model = Documento
        fields = [
            "id", "correlation_id", "tipo", "tipo_nome", "esquema", "resultado",
            "erros_validacao", "status", "erro_codigo", "versao", "criado_em",
            "atualizado_em", "aprovado_em", "ged_status", "ged_erro_codigo",
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
