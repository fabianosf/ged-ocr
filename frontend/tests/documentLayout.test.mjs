import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let Discovery;
let Review;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false },
  });
  ({ Discovery } = await server.ssrLoadModule("/src/Discovery.tsx"));
  ({ Review } = await server.ssrLoadModule("/src/Review.tsx"));
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
  assert.match(html, /disabled="">Adicionar linha manual/);
  assert.equal((html.match(/Revisado/g) ?? []).length, 5);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
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
