ERROR_MESSAGES = {
    "llm_resposta_incompleta": (
        "A resposta da inteligência artificial atingiu o limite de tamanho antes de concluir "
        "os dados. Nenhum resultado parcial foi aprovado. "
        "Peça ao administrador para verificar LLM_MAX_OUTPUT_TOKENS e o tamanho da tabela "
        "antes de tentar novamente."
    ),
    "tipos_nao_configurados": (
        "Este documento foi processado antes de existir a descoberta automática. "
        "Clique em Tentar novamente para identificar um novo tipo, sem cadastro prévio."
    ),
    "tipo_nao_identificado": (
        "Não foi possível reconhecer o tipo nesta tentativa. "
        "Tente novamente para descobrir a estrutura do documento."
    ),
    "llm_nao_configurado": "LLM não configurado. Acesse Configuração para orientações.",
    "llm_indisponivel": (
        "Não conseguimos concluir a comunicação com o serviço de inteligência artificial. "
        "Tente novamente. Se continuar, peça ao administrador para conferir a chave, "
        "o modelo, os limites de uso e a conexão."
    ),
    "llm_resposta_invalida": (
        "O serviço de inteligência artificial devolveu uma resposta que não conseguimos ler. "
        "Tente novamente; nenhum valor foi aprovado automaticamente."
    ),
    "classificacao_resposta_invalida": (
        "Não foi possível interpretar a identificação do documento. Tente novamente."
    ),
    "descoberta_proposta_invalida": (
        "Não foi possível montar uma estrutura válida para este documento. "
        "Tente novamente. Se persistir, confira se a foto mostra os rótulos com nitidez."
    ),
    "extracao_invalida": (
        "Os dados sugeridos não seguiram a estrutura esperada do documento. "
        "Tente novamente; os valores não foram aprovados."
    ),
    "imagem_invalida": (
        "Não conseguimos abrir a foto. Envie novamente em JPEG, PNG ou WEBP, "
        "com o documento inteiro e boa iluminação."
    ),
    "ocr_indisponivel": (
        "A leitura da foto não pôde ser concluída. Tente novamente. "
        "Se persistir, peça ao administrador para verificar o serviço de leitura."
    ),
    "fila_indisponivel": (
        "Não foi possível iniciar esta operação porque o serviço de processamento "
        "está indisponível. Tente novamente em instantes."
    ),
    "tempo_excedido": (
        "Esta tentativa demorou além do limite e foi interrompida. "
        "Tente novamente; se persistir, envie uma foto mais nítida."
    ),
    "processamento_invalido": (
        "Não conseguimos concluir a leitura deste documento. "
        "Tente novamente ou envie outra foto com os campos bem visíveis."
    ),
    "processamento_falha_interna": (
        "O processamento foi interrompido por uma falha interna. "
        "Tente novamente. Se continuar, compartilhe a referência de suporte com o administrador."
    ),
    "ged_nao_configurado": (
        "O documento está salvo no aplicativo, mas a integração com o GED ainda não foi configurada."
    ),
    "ged_indisponivel": (
        "Não conseguimos confirmar o envio ao GED. O documento continua salvo no aplicativo. "
        "Tente reenviar; se persistir, peça ao administrador para verificar a integração."
    ),
    "ged_resposta_invalida": (
        "O GED não confirmou a aceitação do documento. Ele continua salvo no aplicativo. "
        "Confira a configuração da integração antes de reenviar."
    ),
    "ged_envio_interrompido": (
        "O envio ao GED foi interrompido antes da confirmação. "
        "O documento continua salvo no aplicativo e pode ser reenviado."
    ),
    "ged_falha_interna": (
        "Uma falha interna impediu a confirmação do envio ao GED. "
        "O documento continua salvo no aplicativo. Peça ajuda ao administrador se persistir."
    ),
}


def error_message(code: str) -> str:
    if not code:
        return ""
    return ERROR_MESSAGES.get(
        code,
        "Não foi possível concluir esta operação. Tente novamente. "
        "Se persistir, compartilhe a referência de suporte com o administrador.",
    )
