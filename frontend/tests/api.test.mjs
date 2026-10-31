import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, api } from "../src/api.ts";

test("409 presents readable detail and only one correlation reference", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    erro: { detail: "Aguarde o processamento automático." }, correlation_id: "safe-id",
  }), { status: 409, headers: { "X-Correlation-ID": "safe-id" } }));
  await assert.rejects(() => api("documentos/job/reprocessar/", { method: "POST" }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.message, "Aguarde o processamento automático. · Referência: safe-id");
    assert.equal(error.message.includes("{"), false);
    return true;
  });
});

test("field validation messages are readable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    erro: { proposta: ["Proposta inválida."] },
  }), { status: 400 }));
  await assert.rejects(() => api("test/"), { message: "proposta: Proposta inválida." });
});

test("non-JSON error is explicit without dumping server HTML", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(() => api("test/"), {
    message: "O servidor retornou uma resposta de erro inválida (HTTP 502).",
  });
});

test("successful response is unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ job_id: "job" }), {
    status: 202,
  }));
  assert.deepEqual(await api("test/"), { job_id: "job" });
});

test("deletion accepts 204 without trying to parse an empty JSON body", async (t) => {
  t.mock.method(globalThis, "fetch", async (_, options) => {
    assert.equal(options.method, "DELETE");
    assert.deepEqual(JSON.parse(options.body), { versao: 3 });
    return new Response(null, { status: 204 });
  });
  assert.equal(await api("documentos/job/", {
    method: "DELETE", body: JSON.stringify({ versao: 3 }),
  }), undefined);
});
