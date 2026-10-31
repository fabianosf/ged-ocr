# GED OCR

MVP para fotos de documentos impressos/manuscritos: upload → Celery → preparação
da imagem → PaddleOCR → classificação e extração multimodal → validação →
revisão humana → PostgreSQL/JSONB → GED.

## Executar

Requer Docker Compose. Nenhum tipo de documento ou usuário é criado automaticamente.

```sh
cp .env.example .env
# Edite .env: gere DJANGO_SECRET_KEY e configure senha do banco, DATABASE_URL e LLM.
docker compose up --build -d --wait
docker compose exec backend python manage.py createsuperuser
```

Abra http://localhost:5173, entre com o usuário criado e cadastre um tipo em
**Configuração**. A descrição deve explicar como reconhecer aquele tipo. Envie
uma foto, acompanhe o job, confira os campos na imagem e salve a revisão antes de
aprovar. Cada campo deve ser explicitamente marcado como revisado. Colunas de
tabelas também têm revisão individual; linhas podem ser adicionadas/removidas.

O worker baixa modelos PaddleOCR no primeiro uso, exigindo internet e recursos
de CPU/memória. O primeiro processamento pode ser mais lento. A API não importa
OpenCV/PaddleOCR e não executa inferência. Arquivos ficam em volume compartilhado
privado; não há rota pública de mídia.

Para parar: `docker compose down`. Não use `down -v` se precisar preservar os dados.

## Esquemas configuráveis

`TipoDocumento.esquema` utiliza um subconjunto explícito de JSON Schema 2020-12.
Campos são propriedades escalares; tabelas são arrays de objetos. **Não são
criadas tabelas físicas por tipo**: campos/tabelas lógicos ficam em JSONB.
Cada job mantém uma cópia do esquema e da extração original para preservar
proveniência e não mudar quando a configuração for alterada.

Exemplo fictício, para cadastrar pela interface:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["codigo", "itens"],
  "properties": {
    "codigo": {
      "type": "string",
      "title": "Código",
      "pattern": "^DOC-[0-9]+$"
    },
    "data": {
      "type": ["string", "null"],
      "title": "Data",
      "format": "date"
    },
    "total": {
      "type": ["number", "null"],
      "title": "Total",
      "minimum": 0
    },
    "itens": {
      "type": "array",
      "title": "Itens",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["quantidade"],
        "properties": {
          "descricao": {"type": ["string", "null"], "title": "Descrição"},
          "quantidade": {"type": "integer", "minimum": 1, "title": "Quantidade"}
        }
      }
    }
  }
}
```

Suportados: `string`, `number`, `integer`, `boolean`, união com `null`,
`title`, `description`, `enum`, `const`, `required`, `pattern`, `format` conhecido
pelo jsonschema, limites numéricos/comprimento, `multipleOf`,
`minItems`, `maxItems`, `uniqueItems`. Objetos exigem `additionalProperties: false`;
arrays exigem `maxItems` de 1 a 200; até 100 propriedades por objeto.
Não há objetos aninhados fora das linhas, arrays aninhados, referências externas,
composição, código executável, defaults ou validadores específicos por documento.
Validações entre campos não fazem parte deste MVP.

Todos os campos são materializados mesmo quando ausentes. Para permitir ausência
ou ilegibilidade, inclua `null` no tipo. Para impedir aprovação de um campo
ausente, não permita `null`; `required` sozinho exige a chave, não um valor legível.

Um campo extraído:

```json
{
  "valor": null,
  "confianca": 0.32,
  "bbox": [0.1, 0.2, 0.6, 0.3],
  "revisado": false,
  "flags": ["baixa_confianca", "ilegivel"]
}
```

`bbox` é normalizado em `[x1,y1,x2,y2]`, relativo à imagem orientada enviada ao
modelo; pode ser `null` se não localizado. Confiança abaixo de `MIN_CONFIDENCE`
vira `null`; a flag `ilegivel` também força `null`, mesmo com um valor proposto.
A confiança é estimada pelo modelo, não uma probabilidade calibrada. Prompts
proíbem inventar/completar valores, mas **nenhum modelo garante ausência de
alucinação**: revisão humana é obrigatória e não existe aprovação automática.
Edits humanos preservam confiança/bbox e marcam `preenchido_manual`.
Linhas novas têm confiança 0 e bbox null; a extração original permanece imutável.

## API

Autenticação por sessão e proteção CSRF, mesma origem via proxy.
`GET /api/session/` entrega `csrfToken`; envie `X-CSRFToken` nas mutações.
Login: `POST /api/session/`, formulário `username`/`password`; logout: `DELETE`.
O token deve ser atualizado após login/logout.

| Rota | Comportamento |
|---|---|
| `POST /api/documentos/upload/` | multipart `foto`; **202** `{job_id, correlation_id, status}` |
| `GET /api/documentos/` | Lista paginada; usuário vê seus jobs, equipe vê todos |
| `GET /api/documentos/{job_id}/` | Estado, resultado, esquema, validações e versão |
| `GET /api/documentos/{job_id}/foto/` | Foto privada, autenticada |
| `PATCH /api/documentos/{job_id}/revisao/` | `{versao, resultado, linhas?}`; recalcula validações |
| `POST /api/documentos/{job_id}/aprovar/` | `{versao}`; exige todos revisados e esquema válido |
| `POST /api/documentos/{job_id}/reprocessar/` | Reenfileira erro/job interrompido |
| `POST /api/documentos/{job_id}/reenviar-ged/` | Reenvia aprovado com falha/GED agora configurado |
| `/api/tipos/` | GET autenticado; POST/PUT/PATCH apenas equipe; sem DELETE |

Conflito de versão/estado retorna **409**. `linhas` mapeia cada tabela para uma
lista de índices das linhas da revisão anterior: `{"itens": [1, 0, null]}` mantém
proveniência ao reordenar e adiciona uma linha manual. Índices duplicados são
rejeitados; sem mapeamento, mantém-se a ordem e quantidade de linhas anterior.
Um valor modificado deve vir com `revisado: true`.

Publicação na fila ocorre após commit. Falha do broker retorna **503**, inclui
`job_id` e persiste erro; não responde 202 falsamente. Estados principais:
`pendente`, `processando`, `revisao`, `aprovado`, `erro`.
Os erros retornam códigos sanitizados. Jobs presos em fila/processamento/envio
podem ser recuperados após 660 segundos. Gerações de tarefa impedem entregas
antigas de sobrescrever uma revisão nova. Limites do worker: 540s soft / 600s hard.
Não há retry automático de serviços pagos: o usuário pode reenfileirar
explicitamente. O worker usa concurrency 1 no Compose para limitar consumo.

## LLM e GED

Configure `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL`. O provedor deve suportar
`POST /chat/completions`, imagens inline e `response_format: json_object`.
São duas chamadas: classificação nos tipos ativos e extração com seu esquema.
Sem configuração ou tipo reconhecido, o job fica em erro explícito; não se usa
um resultado fictício. Textos/fotos são tratados como dados, não instruções.

**Fotos e OCR serão enviados ao provedor configurado.** Avalie consentimento,
retenção, localização dos dados e requisitos LGPD antes de usar documentos reais.
Não use serviços externos sem autorização.

GED sem contrato fornecido: adaptador explícito em `backend/documents/ged.py`.
Ao configurar `GED_URL`, o serviço deve aceitar:

- POST multipart com `arquivo` e `documento` (string JSON).
- JSON: `job_id`, `tipo_id`, `esquema`, `campos` com metadados e `valores` simples.
- Headers `Authorization: Bearer ...`, `X-Correlation-ID` e
  `Idempotency-Key: <job_id>`.
- Resposta 2xx somente depois de aceitar o documento de forma durável.
- Deduplicação pela chave idempotente, inclusive após timeout/reenvio.

Confirme/adapte esse contrato antes de preencher `GED_URL`. Aprovação grava
primeiro no banco e enfileira o envio. Sem URL, fica `nao_configurado` (nunca
`enviado`). Falha de envio fica `erro`. Não se armazena nem se loga corpo de
resposta do GED. Destinos são configurados pelo operador, não pelo upload.

## Desenvolvimento e validação

Python 3.12 e Node 22:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
cd backend
../.venv/bin/pytest
../.venv/bin/ruff check .
../.venv/bin/python manage.py check --settings=config.test_settings
cd ../frontend
npm ci
npm run build
npm run dev
```

Testes padrão usam SQLite em memória; para repetir em PostgreSQL:

```sh
cd backend
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/ged_ocr ../.venv/bin/pytest
```

Use um banco dedicado com permissão de criar o banco de teste. Os testes cobrem
contratos com LLM/GED simulados e fotos sintéticas, sem dados pessoais.
Para executar OCR real fora do Docker, instale `requirements-worker.txt` e as
bibliotecas nativas OpenCV/Paddle (`libgomp1`, `libgl1`, `libglib2.0-0` em Debian).
`OCR_DETECTION_MODEL` usa detecção mobile; `OCR_RECOGNITION_MODEL` usa reconhecimento
Latin mobile, incluindo português, por padrão. Troque o reconhecedor para outros idiomas.
API local: exporte as variáveis de `.env`, rode migrations e
`python manage.py runserver`; worker: `celery -A config worker --concurrency=1`.
Não use o backend de testes em produção.

## Limites operacionais

Compose é um ambiente local/MVP, não uma instalação de produção endurecida.
Portas HTTP estão ligadas somente a loopback. Para exposição externa, configure
TLS, hosts/origens confiáveis, `COOKIE_SECURE=1`, rate limiting de login/upload,
backup/retention dos volumes, permissões, monitoramento e atualização de dependências.
Não publique PostgreSQL/Redis nem mídia diretamente. Não ative logs de
debug, access logs ou dumps de exceção que possam incluir payloads. Logs da
aplicação contêm somente evento, código, estado HTTP e `correlation_id` gerado
no servidor; frameworks/provedores não têm logs detalhados habilitados.
O superusuário gerencia tipos pelo frontend; admin Django é apenas complementar.
Não há antivírus, trilha de cada edição intermediária, rejeição/arquivamento,
busca GED, exportação para tabelas físicas ou correção manual de tipo desconhecido.
