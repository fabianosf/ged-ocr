import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let Discovery;
let Review;
let Button;
let Badge;
let ProcessingProgress;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false },
  });
  ({ Discovery } = await server.ssrLoadModule("/src/Discovery.tsx"));
  ({ Review } = await server.ssrLoadModule("/src/Review.tsx"));
  ({ Button } = await server.ssrLoadModule("/src/components/ui/button.tsx"));
  ({ Badge } = await server.ssrLoadModule("/src/components/ui/badge.tsx"));
  ({ ProcessingProgress } = await server.ssrLoadModule("/src/components/ProcessingProgress.tsx"));
});
after(async () => { await server?.close(); });

const field = (valor, bbox = [0.1, 0.2, 0.4, 0.3]) => ({
  valor, confianca: 0.8, bbox, revisado: false, flags: valor === null ? ["ilegivel"] : [],
});
const proposal = {
  nome_sugerido: "Layout sintético",
  descricao_reconhecimento: "Código e tabela Itens",
  campos: [{ chave: "codigo", titulo: "Código", tipo: "texto", obrigatorio: false }],
  tabelas: [{
    chave: "itens", titulo: "Itens", colunas: [
      { chave: "quantidade", titulo: "Quantidade", tipo: "inteiro" },
      { chave: "ativo", titulo: "Ativo", tipo: "booleano" },
    ],
  }],
};
const document = {
  id: "synthetic", status: "revisao_tipo", versao: 1, proposta: proposal,
  pode_aprovar_tipo: true, erros_validacao: [],
  esquema: {
    type: "object", properties: {
      codigo: { type: ["string", "null"], title: "Código" },
      itens: { type: "array", title: "Itens", maxItems: 2, items: {
        type: "object", properties: {
          quantidade: { type: ["integer", "null"], title: "Quantidade" },
          ativo: { type: ["boolean", "null"], title: "Ativo" },
        },
      } },
    },
  },
  resultado: {
    codigo: field("TESTE"),
    itens: [
      { quantidade: field(0), ativo: field(false) },
      { quantidade: field(null, null), ativo: field(true) },
    ],
  },
};
const render = (component, value = document) => renderToStaticMarkup(createElement(component, {
  document: value, onUpdated() {}, onDirtyChange() {},
}));

test("discovery renders one grid with rows, columns and clickable scalar suggestions", () => {
  const html = render(Discovery);
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  assert.equal((html.match(/<th scope="row">/g) ?? []).length, 2);
  assert.match(html, /Quantidade/);
  assert.match(html, /Ativo/);
  assert.match(html, /aria-label="Localizar na foto: TESTE"/);
  assert.match(html, /aria-label="Localizar na foto: 0"/);
  assert.match(html, /aria-label="Localizar na foto: false"/);
  assert.match(html, /Ilegível \/ ausente \(null\)/);
  assert.match(html, /Sem localização na foto/);
  assert.match(html, /80%/);
  assert.doesNotMatch(html, /selected-field/);
});

test("review grid retains per-cell editing, human checks, row actions and maxItems", () => {
  const html = render(Review, { ...document, status: "revisao" });
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  assert.equal((html.match(/<th scope="row">/g) ?? []).length, 2);
  assert.match(html, /aria-label="Quantidade · Linha 1"/);
  assert.match(html, /aria-label="Ativo · Linha 2"/);
  assert.match(html, /aria-label="Remover linha 2 de Itens"/);
  const addRow = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
    .find((button) => button.includes("Adicionar linha manual"));
  assert.ok(addRow);
  assert.match(addRow, /disabled=""/);
  assert.equal((html.match(/Revisado/g) ?? []).length, 5);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
});

test("read-only review keeps photo location buttons but removes mutation actions", () => {
  const html = render(Review, { ...document, status: "aprovado", ged_status: "nao_configurado" });
  assert.match(html, /aria-label="Localizar na foto: Quantidade · Linha 1"/);
  assert.doesNotMatch(html, /Remover linha|Adicionar linha manual|Salvar revisão/);
});

test("empty discovery table keeps column configuration and explicit no-rows notice", () => {
  const html = render(Discovery, { ...document, resultado: { ...document.resultado, itens: [] } });
  assert.match(html, /Nenhuma linha identificada/);
  assert.match(html, /Ajustar nome e tipo da coluna/);
  assert.equal((html.match(/<th scope="row">/g) ?? []).length, 0);
});

test("shadcn destructive button exposes its action and disabled loading state", () => {
  const html = renderToStaticMarkup(createElement(Button, {
    variant: "destructive", disabled: true, type: "button",
  }, "Excluindo…"));
  assert.match(html, /data-slot="button"/);
  assert.match(html, /data-variant="destructive"/);
  assert.match(html, /bg-destructive/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Excluindo…/);
});

test("status badge has readable text, not just a color", () => {
  const html = renderToStaticMarkup(createElement(Badge, {
    variant: "outline", className: "status-erro",
  }, "Precisa de atenção"));
  assert.match(html, /data-slot="badge"/);
  assert.match(html, /status-erro/);
  assert.match(html, /Precisa de atenção/);
});

for (const [status, etapa, label] of [
  ["pendente", "extracao", "Aguardando na fila"],
  ["processando", "preparacao", "Preparando a foto"],
  ["processando", "leitura", "Lendo o documento"],
  ["processando", "classificacao", "Identificando o tipo com IA"],
  ["processando", "descoberta", "Descobrindo campos com IA"],
  ["processando", "extracao", "Extraindo valores com IA"],
  ["processando", "desconhecida", "Iniciando processamento"],
]) {
  test(`progress reflects ${status}/${etapa} without fabricated percentages`, () => {
    const html = renderToStaticMarkup(createElement(ProcessingProgress, {
      document: { status, etapa, pode_reprocessar: false },
    }));
    assert.match(html, /role="progressbar"/);
    assert.ok(html.includes(label));
    assert.match(html, /Progresso indeterminado/);
    assert.doesNotMatch(html, /aria-valuenow|aria-valuemax|[0-9]+%/);
    assert.match(html, /Revisão humana/);
    assert.match(html, /Nenhum valor é aprovado automaticamente/);
  });
}

test("stale progress stops animation and completed or failed jobs have no loading bar", () => {
  const html = renderToStaticMarkup(createElement(ProcessingProgress, {
    document: { status: "processando", etapa: "extracao", pode_reprocessar: true },
  }));
  assert.match(html, /paused/);
  assert.match(html, /Recuperar processamento/);
  for (const status of ["erro", "revisao", "revisao_tipo", "aprovado"]) {
    assert.equal(renderToStaticMarkup(createElement(ProcessingProgress, {
      document: { status, etapa: "extracao", pode_reprocessar: false },
    })), "");
  }
});
