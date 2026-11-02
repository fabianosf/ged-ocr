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
As APIs DRF limitam anônimos a 60 requisições/minuto e usuários autenticados a
600/minuto. O login aceita até 5 POSTs/minuto por IP, incluindo logins válidos;
GET de sessão e logout não consomem esse limite. Exceder o limite retorna 429
com `Retry-After`, sem alterar as demais respostas. O cache de throttling usa o
Redis já configurado em `CELERY_BROKER_URL`, compartilhado entre os workers da
API; os testes usam cache em memória isolado.
O Nginx sobrescreve `X-Forwarded-For` com o IP observado e o DRF confia em um
proxy. Mantenha a porta direta do backend restrita a `127.0.0.1`, como no Compose;
ao adicionar outros proxies, revise essa configuração de confiança.
O modelo OCR é reutilizado por processo do worker, com duas threads de CPU, sem
guardar fotos/OCR no cache do modelo. O Compose desativa a checagem inicial de
conectividade com repositórios de modelos; downloads necessários continuam sujeitos
a falha explícita. A tela informa preparação, leitura, classificação, descoberta
ou extração via `etapa`. Logs registram etapa, duração e correlation_id, nunca os dados.
Para o host oficial `api.deepseek.com`, as chamadas desativam o modo thinking
(raciocínio prolongado, habilitado por padrão no provedor). Isso reduz trabalho
desnecessário de transcrição, mas não garante latência ou acurácia. A resposta
continua estritamente validada; saída truncada/fora do contrato não é aprovada.
`LLM_MAX_OUTPUT_TOKENS` define explicitamente o limite de saída para descoberta
e extração (padrão 32768, intervalo 1024..65536; deve ser aceito pelo provedor).
Classificação usa só 256 tokens. JSON compacto reduz a saída sem retirar nenhum
metadado. `maxItems` não instrui o modelo a preencher linhas inexistentes: somente
linhas visíveis são extraídas. O teto maior não reserva cobrança antecipada, mas
permite respostas maiores, que podem aumentar custo e latência se geradas.
Não há continuação de JSON truncado nem nova chamada paga automática: `length`
gera erro explícito, mesmo se o trecho recebido parecer um JSON válido.
Documentos muito extensos ainda podem atingir o teto/contexto do provedor; o
administrador deve verificar o limite e o tamanho da tabela antes de repetir.

Para parar: `docker compose down`. Não use `down -v` se precisar preservar os dados.

Backend e worker executam como `app` (UID/GID `10001`), sem privilégios de root.
O cache Paddle fica em `/home/app/.paddlex`. Volumes novos já recebem as
permissões corretas. Ao atualizar uma instalação com volumes criados pela versão
anterior, faça backup e ajuste apenas a propriedade desses volumes antes de subir:

```sh
docker compose stop backend worker frontend
docker compose build backend worker
docker compose run --rm --no-deps --user root backend \
  chown -R 10001:10001 /app/media /app/staticfiles
docker compose run --rm --no-deps --user root worker \
  chown -R 10001:10001 /home/app/.paddlex
docker compose up -d --wait
```

### Backup e restauração local

Para manter banco e fotos consistentes, pare temporariamente a aplicação e o
worker, mantenha o PostgreSQL ativo e gere a cópia:

```sh
docker compose stop backend worker frontend
./scripts/backup.sh
docker compose up -d --wait
```

Os arquivos ficam em `./backups/`, com acesso restrito ao usuário local, e
backups com mais de 30 dias são removidos. Para armazená-los em outro local,
defina `BACKUP_DIR=/caminho/seguro/ged-ocr ./scripts/backup.sh`. Os backups
contêm documentos e dados pessoais: proteja o destino, criptografe cópias
externas e teste periodicamente a restauração. O script não faz cópia externa
nem substitui uma política organizacional de backup.

Para restaurar **sobre a instalação existente** (isso substitui os dados
atuais), mantenha backend, worker e frontend parados e o banco em execução.
Use arquivos do mesmo horário:

```sh
docker compose stop backend worker frontend
docker compose exec -T db sh -c \
  'pg_restore --clean --if-exists --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < ./backups/ged-ocr-db-AAAAMMDDTHHMMSSZ.dump
docker compose run --rm --no-deps backend sh -c 'tar -C /app -xzf -' \
  < ./backups/ged-ocr-media-AAAAMMDDTHHMMSSZ.tar.gz
docker compose up -d --wait
```

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

### Excluir tentativas antigas

Cada cartão da lista tem **Excluir**, com confirmação de exclusão definitiva.
O modal shadcn/ui abre com foco em **Cancelar**, limita a navegação pelo teclado
à janela e aceita Escape para cancelar. Durante o pedido, impede novos cliques
e fechamento; em falha, mantém a confirmação aberta com erro explícito.
Após excluir, a lista é atualizada e exibe confirmação, sem excluir outros jobs.
Nenhum documento é apagado automaticamente. A exclusão remove o registro do job
(incluindo OCR, valores e propostas) e sua foto do armazenamento ativo. Não remove
o TipoDocumento cadastrado, outras tentativas, cópias de backup nem documentos
já enviados ao GED.

`DELETE /api/documentos/{job_id}/` recebe `{"versao": 1}` e retorna **204**.
Somente o proprietário ou a equipe pode excluir. Versão desatualizada, job na fila/
processando ou envio GED pendente/em andamento retorna **409**, sem apagar a foto.
A foto só é removida após o commit da exclusão. Falha no banco preserva a foto.
Falha posterior no armazenamento retorna erro explícito: o registro já foi excluído,
e o administrador deve remover a foto órfã do armazenamento.
Mensagens gerais podem ser fechadas por **Fechar mensagem**; isso não apaga jobs.
Tarefas antigas reenviadas pela fila ignoram registros já excluídos.

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
| `POST /api/documentos/{job_id}/atribuir-tipo/` | `{versao, tipo_id}`; associa tipo ativo e reextrai sem repetir OCR/classificação |
| `POST /api/documentos/{job_id}/rejeitar/` | `{versao}`; rejeita documento em revisão |
| `POST /api/documentos/{job_id}/arquivar/` | `{versao}`; arquiva sem excluir foto e dados |
| `GET /api/documentos/{job_id}/auditoria/` | Últimas 100 ações e mudanças de estado, sem valores extraídos |
| `GET /api/auditoria/` | Histórico paginado; proprietário vê seus eventos (inclusive exclusões), equipe vê todos |
| `/api/tipos/` | GET autenticado; POST/PUT/PATCH apenas equipe; sem DELETE |
| `/api/tipos/ativos/` | Tipos ativos disponíveis para associação manual |

Conflito de versão/estado retorna **409**. `linhas` mapeia cada tabela para uma
lista de índices das linhas da revisão anterior: `{"itens": [1, 0, null]}` mantém
proveniência ao reordenar e adiciona uma linha manual. Índices duplicados são
rejeitados; sem mapeamento, mantém-se a ordem e quantidade de linhas anterior.
Um valor modificado deve vir com `revisado: true`.

Publicação na fila ocorre após commit. Falha do broker retorna **503**, inclui
`job_id` e persiste erro; não responde 202 falsamente. Estados principais:
`pendente`, `processando`, `revisao_tipo`, `revisao`, `aprovado`, `rejeitado`,
`arquivado`, `erro`.
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
Cada campo/coluna já mostra ao lado da foto seu valor sugerido da última extração,
confiança e flags. Clique no valor sugerido (ou navegue até ele pelo teclado) para
destacar a bbox na foto. Na revisão, clicar no campo ou em **Localizar na foto**
também destaca a origem, sem marcar o valor como revisado. Campos sem bbox mostram
**Sem localização na foto**, sem inventar uma posição.
Em telas pequenas, a foto permanece em um painel compacto no topo durante a
conferência; o destaque desloca somente a foto, sem tirar o foco da edição.
Tabelas aparecem em uma grade de linhas e colunas tanto na descoberta quanto na
revisão, com rolagem horizontal/vertical e cabeçalhos fixos. Cada célula preserva
confiança, flags e revisão individual; adicionar/remover linhas continua disponível
na revisão e mantém a associação à extração original.
Configuração de chave/rótulo/tipo fica em **Ajustar nome e tipo**, sem
uma segunda lista de valores no fim da página. Valores são somente leitura:
revisão/edição dos valores ocorre após salvar o tipo. Alterar chave/tipo, adicionar
campos ou duplicar chaves não transfere sugestões antigas; a tela pede reextração.
Alterar apenas o rótulo preserva a associação pela chave e tipo.
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

A interface usa **Tailwind CSS 4**, integrado ao Vite por `@tailwindcss/vite`,
e componentes locais **shadcn/ui** (Button, Badge, AlertDialog, Input, Textarea,
NativeSelect, Checkbox, Card e Alert) com primitivas Radix específicas.
A identidade clara usa azul-petróleo, neutros e cores semânticas para avisos.
Login, envio, lista, descoberta, revisão e configuração compartilham os controles.
**Magic UI** fornece Shine Border nas áreas de entrada e Grid Pattern no login;
efeitos são decorativos, não capturam cliques e respeitam movimento reduzido.
A licença MIT acompanha os componentes em `frontend/src/components/ui/MAGIC-UI-LICENSE`.
Não há recursos visuais carregados de CDNs nem biblioteca de animação adicional.
Os tokens e o CSS do aplicativo ficam em `frontend/src/styles.css`: tipografia
em `@layer base` e superfícies/layout em `@layer components`, sem substituir
as utilidades Tailwind dos componentes. Aliases `@/` estão no Vite e TypeScript;
`frontend/components.json` configura a geração de componentes.
Para adicionar outro componente, use `npx shadcn@4.23.0 add <componente>` em
`frontend/`, revise os imports/dependências gerados e execute testes/build.
O CLI não faz parte das dependências permanentes do aplicativo.
As confirmações de descarte de ajustes também usam AlertDialog: cancelar mantém
os dados locais; confirmar descarta somente os ajustes e executa a ação solicitada.

Jobs na fila ou processando mostram uma barra de atividade no cartão e um painel
com as etapas reais do worker ao abrir o documento. A etapa de IA distingue
classificação, descoberta e extração. O polling atualiza a etapa automaticamente
e abre a revisão quando a extração termina. A barra é **indeterminada**: o provedor
não informa porcentagem nem previsão de término. Não há avanço simulado por tempo.
Jobs interrompidos exibem uma barra parada e orientação de recuperação; erros e
documentos em revisão não continuam mostrando loading. Animações respeitam
`prefers-reduced-motion` e mudanças de etapa são anunciadas por leitores de tela.
`npm run test:e2e` executa as regressões de interface em navegador com uma
prévia isolada na porta 5174 e APIs simuladas: nenhum documento real é apagado.
Use um Chromium do Playwright disponível, ou execute
`CHROME_BIN=/usr/bin/google-chrome npm run test:e2e` quando o Chrome já estiver instalado. Os testes cobrem foco,
Escape, erros/conflitos, bloqueio durante o pedido e ajustes ainda não salvos.

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
Exceções registram somente o nome da classe e `correlation_id`, sem mensagem,
argumentos ou traceback. Os loggers Django e Celery aceitam nível `ERROR` com
saída sanitizada; eventos sem contexto de requisição/tarefa usam `-` no identificador.
O superusuário gerencia tipos pelo frontend; admin Django é apenas complementar.
O histórico de atividades registra autor, horário, estado e versão, mas não
armazena valores extraídos ou o conteúdo da foto. Isso não substitui controles
de acesso ao banco nem políticas de retenção. Rejeição, arquivamento e associação
manual de tipo estão disponíveis; ainda não há antivírus, busca GED ou exportação
para tabelas físicas. O contrato GED descrito neste README precisa ser confirmado
com o fornecedor e testado em ambiente de homologação antes de configurar
`GED_URL`. Chamadas pagas de IA não são repetidas automaticamente; em caso de
falha, a retomada continua manual. O worker agora expõe o estado de saúde pelo
`docker compose ps`; monitore também o espaço em disco e a execução dos backups.
