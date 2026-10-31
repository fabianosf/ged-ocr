import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestedField, suggestedRows } from "../src/discoverySuggestions.ts";

const column = { chave: "codigo", titulo: "Código", tipo: "texto" };
const field = { valor: "DOC-123", confianca: 0.9, bbox: [0, 0, 1, 1], revisado: false, flags: [] };
const result = { codigo: field };

test("automatically associates a field with all extraction metadata", () => {
  assert.equal(suggestedField(column, [column], [column], result), field);
});

test("editing title preserves value but changing key or type requires reprocessing", () => {
  assert.equal(suggestedField({ ...column, titulo: "Novo título" }, [column], [column], result), field);
  assert.equal(suggestedField({ ...column, chave: "novo" }, [column], [column], result), null);
  assert.equal(suggestedField({ ...column, tipo: "data" }, [column], [column], result), null);
});

test("duplicate or newly added fields never inherit suggestions", () => {
  assert.equal(suggestedField(column, [column, column], [column], result), null);
  assert.equal(suggestedField(column, [column], [], result), null);
  assert.equal(suggestedField(column, [column], [column], { codigo: [] }), null);
});

test("null, zero and false remain distinct", () => {
  for (const value of [null, 0, false]) {
    const actual = suggestedField(column, [column], [column], { codigo: { ...field, valor: value } });
    assert.equal(actual.valor, value);
  }
});

test("table rows stay associated by table key, not by index", () => {
  const table = { chave: "itens", titulo: "Itens", colunas: [column] };
  const proposal = { campos: [], tabelas: [table] };
  const rows = [result, { codigo: { ...field, valor: null } }];
  assert.equal(suggestedRows("itens", proposal, proposal, { itens: rows }), rows);
  assert.equal(suggestedRows("novo", { campos: [], tabelas: [{ ...table, chave: "novo" }] },
    proposal, { itens: rows }), null);
  assert.equal(suggestedRows("itens", { campos: [{ ...column, chave: "itens" }], tabelas: [table] },
    proposal, { itens: rows }), null);
});
