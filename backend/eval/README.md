# Avaliação offline

Execute de `backend/`, com ambiente Django configurado:

```sh
DJANGO_SETTINGS_MODULE=config.test_settings ../.venv/bin/python -m eval.run \
  eval/example eval/example/truth.json --synthetic
python -m eval.run /pasta/autorizada /pasta/autorizada/truth.json
```

O exemplo PPM é uma imagem branca sintética: demonstra apenas o cálculo das
métricas com predições explícitas, não acurácia OCR. O modo normal prepara cada
foto, roda OCR, classificação (até 100 tipos por ID), descoberta quando necessária
e extração, sem persistir documentos no banco. Requer dependências do worker e
LLM configurado; faz chamadas pagas e envia fotos/OCR ao provedor. Use somente
dados autorizados fora do repositório.

O gabarito segue o exemplo: `types` contém `id`, `nome`, `descricao`, `esquema`;
`documents` contém `file` e `expected` com valores simples, sem metadados. O modo
normal ignora `synthetic_prediction`. Falhas interrompem a execução com status
não zero; não são contadas como extrações bem-sucedidas.

A saída JSON mostra por amostra/campo acertos, denominador, nulos, acurácia
(`correct/total`) e taxa nula (`nulls/total`). Tabelas mostram igualdade integral,
quantidade de linhas e métricas por célula/coluna, alinhadas pela posição, sem
normalização de caixa, tipos ou tolerância numérica. Linhas extras contam como
erros. Denominador zero produz `null`, não uma porcentagem fictícia.

Tokens usam `usage.total_tokens` quando disponível. Sem isso, o custo estimado
é `ceil(caracteres textuais/4) + --image-tokens` por chamada (padrão 1000 para
imagem; ajuste ao provedor). É aproximação, não cobrança/calibração do provedor.
O modo sintético informa zero chamadas/tokens. A saída não imprime valores
documentais nem nomes dos arquivos; mantenha também gabaritos e relatórios
privados. Não há retentativa automática.
