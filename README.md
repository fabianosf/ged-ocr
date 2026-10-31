# GED OCR

MVP para fotos de documentos impressos/manuscritos: upload → Celery → preparação
da imagem → PaddleOCR → classificação ou descoberta de layout → extração multimodal → validação →
revisão humana → PostgreSQL/JSONB → GED.

## Executar

Requer Docker Compose. Nenhum tipo de documento ou usuário é criado automaticamente.

```sh
cp .env.example .env
# Edite .env: gere DJANGO_SECRET_KEY e configure senha do banco, DATABASE_URL e LLM.
docker compose up --build -d --wait
docker compose exec backend python manage.py createsuperuser
```

Abra http://localhost:5173 e entre com o usuário criado. Tipos podem ser cadastrados
em **Configuração** ou descobertos a partir de uma foto, sem cadastro prévio.
A descrição deve explicar como reconhecer o layout, sem incluir dados pessoais. Envie
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
| `POST /api/documentos/{job_id}/definir-tipo/` | `{versao, proposta}`; 202, reenfileira somente extração |
| `POST /api/documentos/{job_id}/aprovar-tipo/` | `{versao}`; cria tipo e passa à revisão dos valores |
| `/api/tipos/` | GET autenticado; POST/PUT/PATCH apenas equipe; sem DELETE |

Conflito de versão/estado retorna **409**. `linhas` mapeia cada tabela para uma
lista de índices das linhas da revisão anterior: `{"itens": [1, 0, null]}` mantém
proveniência ao reordenar e adiciona uma linha manual. Índices duplicados são
rejeitados; sem mapeamento, mantém-se a ordem e quantidade de linhas anterior.
Um valor modificado deve vir com `revisado: true`.

Publicação na fila ocorre após commit. Falha do broker retorna **503**, inclui
`job_id` e persiste erro; não responde 202 falsamente. Estados principais:
`pendente`, `processando`, `revisao_tipo`, `revisao`, `aprovado`, `erro`.
Os erros retornam códigos sanitizados. Jobs presos em fila/processamento/envio
podem ser recuperados após 660 segundos. Gerações de tarefa impedem entregas
antigas de sobrescrever uma revisão nova. Limites do worker: 540s soft / 600s hard.
Não há retry automático de serviços pagos: o usuário pode reenfileirar
explicitamente. O worker usa concurrency 1 no Compose para limitar consumo.

GET detalhe informa `pode_reprocessar` e `pode_reenviar_ged`, calculados pelas
mesmas regras usadas nas ações da API. A interface não oferece recuperação
prematura de jobs em fila/processamento ou reenvio de GED ainda em andamento.
Esses indicadores são atualizados pelo polling, inclusive quando o prazo de
660 segundos é ultrapassado. Com `llm_nao_configurado`, a tela orienta abrir
Configuração antes de repetir uma operação que falharia novamente.
Erros HTTP são apresentados em português, sem JSON bruto e com uma única
referência de correlação. Uma tentativa de recuperação em conflito atualiza
o estado do job, sem reenfileirar silenciosamente.
Mensagens de processamento não são erros: a tela informa recebimento, leitura ou
necessidade de retomada, sem apresentar 11 minutos como tempo estimado.
Erros atuais, históricos (inclusive `tipos_nao_configurados`) e falhas do GED têm
explicações em português e próximos passos. Códigos/referências dos jobs ficam
recolhidos em **Detalhes para suporte**; o GET mantém os códigos técnicos para
integrações e acrescenta `ged_erro_mensagem`. Nenhuma mensagem inclui valores
extraídos ou a resposta bruta do provedor.

## LLM e GED

Configure `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL`. O provedor deve suportar
`POST /chat/completions`, imagens inline e `response_format: json_object`.
Layouts conhecidos usam duas chamadas: classificação nos tipos ativos e extração
com seu esquema. Layout desconhecido adiciona descoberta entre classificação e
extração. Sem tipos ativos, pula classificação: descoberta + extração.
Sem LLM configurado, o job fica em erro `llm_nao_configurado`, com mensagem em
português e link **Abrir Configuração**. Essa tela explica as variáveis do servidor;
não recebe nem expõe chaves. Recrie backend/worker após alterar o ambiente.
Não se usa um resultado fictício. Textos/fotos e descrições de tipos são dados,
nunca instruções; as saídas continuam sujeitas a revisão humana.

## Modo descoberta

Nenhum tipo ativo ou classificação sem correspondência acima de
`TYPE_MIN_CONFIDENCE` (padrão 0.7, intervalo 0..1) ativa descoberta. O limiar é
independente de `MIN_CONFIDENCE`, que controla os valores extraídos.
Uma resposta de classificação malformada, falha de rede ou JSON inválido
permanece erro explícito: não se disfarça falha de integração como layout novo.

O serviço `backend/documents/services/discovery.py` recebe foto + OCR e pede
somente rótulos visíveis, inclusive campos vazios, nomes reais de colunas e uma
descrição estável do layout. Valores pessoais não devem compor nomes/descrições.
A proposta usa Pydantic estrito (sem campos extras ou coerção de tipos):

```json
{
  "nome_sugerido": "Formulário exemplo",
  "descricao_reconhecimento": "Título Formulário, rótulos Código e Data e tabela Itens.",
  "campos": [
    {"chave": "codigo", "titulo": "Código", "tipo": "texto", "obrigatorio": true},
    {"chave": "data", "titulo": "Data", "tipo": "data", "obrigatorio": false}
  ],
  "tabelas": [
    {
      "chave": "itens",
      "titulo": "Itens",
      "colunas": [{"chave": "quantidade", "titulo": "Quantidade", "tipo": "inteiro"}]
    }
  ]
}
```

Conversor puro `services/schema_builder.py`:

- Tipos: `texto` → string, `numero` → number, `inteiro` → integer,
  `data` → string + `format: date` (ISO `YYYY-MM-DD`), `booleano` → boolean.
- Campos opcionais e todas as colunas aceitam `null`. Obrigatórios não aceitam
  `null` e entram em `required`; ilegíveis continuam sendo extraídos como null,
  mas a validação impede aprovação até correção humana.
- Raiz com 1..100 propriedades (campos + tabelas); cada tabela com 1..100 colunas
  e `maxItems: 200`. Sem obrigatoriedade inferida para tabelas/colunas, minItems,
  defaults, regras de negócio ou propriedades aninhadas.
- Chaves ASCII snake_case: letra inicial minúscula, segmentos alfanuméricos
  separados por um único `_`, até 100 caracteres; únicas na raiz e em cada tabela.
- Nome/títulos não vazios, até 120 caracteres; descrição não vazia, até 2000.
  Propostas vazias, duplicadas, desconhecidas ou acima dos limites são rejeitadas.

Após descoberta, o worker salva `proposta_original` e `esquema_provisorio` como
snapshots iniciais imutáveis pelo fluxo, antes de extrair. `proposta`/`esquema`
são a versão corrente. `extraido` mantém a primeira extração bem-sucedida.
Todos os snapshots são privados no banco; GET detalhe expõe proposta corrente,
proposta original e esquema provisório, nunca o texto OCR armazenado.

Na tela **Documento novo**, confira a foto à esquerda e edite à direita nome,
descrição, campos e colunas: chave/rótulo, tipo, obrigatoriedade, adicionar/remover.
Os valores sugeridos são somente leitura e pertencem à última extração, não a
ajustes locais ainda não processados; mostram confiança, bbox e flags.
**Reprocessar com ajustes** chama `definir-tipo` com proposta + versão, recria o
esquema, limpa sugestões/revisões correntes e responde 202 depois de enfileirar.
Só a extração roda novamente em Celery: reutiliza OCR privado, sem classificação
ou descoberta. Nenhum valor/revisão antigos são transferidos entre chaves/tipos.
Polling não sobrescreve ajustes locais. Conflito retorna 409; atualize o job.
Falha de extração mantém snapshots e permite tentar novamente pelo job em erro.

**Salvar como novo tipo e continuar revisão** exige proposta já processada,
versão corrente e usuário de equipe ou com permissão Django
`documents.add_tipodocumento`. Outros usuários podem editar seus próprios jobs,
mas não cadastrar tipos. Equipe vê todos os jobs. Nome duplicado retorna 400,
sem criar tipo ou mudar o job parcialmente. O cadastro persiste nome, descrição
de reconhecimento em `TipoDocumento.descricao` e esquema, liga o job ao tipo
ativo e muda para `revisao`. **Isso não aprova os dados nem envia ao GED.**
Todos os valores precisam da revisão humana normal antes de aprovação.

O próximo upload usa a descrição do tipo na classificação; não há correspondência
automática garantida nem treinamento do modelo. Uma classificação ainda incerta
abre nova descoberta. O LLM pode alucinar rótulos e confiança pode estar errada:
Pydantic valida formato/limites, não prova que um rótulo realmente está na foto.

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
npm test
npm run build
npm run dev
```

Testes padrão usam SQLite em memória; para repetir em PostgreSQL:

```sh
cd backend
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/ged_ocr ../.venv/bin/pytest
```

Use um banco dedicado com permissão de criar o banco de teste. Os testes cobrem
contratos com LLM/GED simulados e fotos sintéticas, sem dados pessoais, incluindo
descoberta sem tipos, layout desconhecido, limites exatos da proposta, conversão,
permissões, conflitos de versão, snapshots, reextração sem OCR/classificação e
reconhecimento do tipo aprovado no segundo envio.
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
