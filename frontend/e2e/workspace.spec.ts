import { expect, test, type Page } from "@playwright/test";
import type { Document } from "../src/types";

const field = (valor: string | number | boolean | null) => ({
  valor, confianca: 0.85, bbox: [0.1, 0.2, 0.6, 0.3] as [number, number, number, number],
  revisado: false, flags: [],
});
const fixture: Document = {
  id: "workspace-test", correlation_id: "synthetic", tipo_nome: "Formulário sintético",
  status: "revisao", etapa: "concluido", versao: 1,
  criado_em: "2026-10-31T17:00:00Z", atualizado_em: "2026-10-31T17:00:00Z",
  ged_status: "nao_configurado", ged_erro_codigo: "", ged_erro_mensagem: "",
  erro_codigo: "", erro_mensagem: "", erros_validacao: [],
  pode_excluir: true, pode_reprocessar: false, pode_reenviar_ged: false, pode_aprovar_tipo: true,
  proposta: {
    nome_sugerido: "Formulário sintético", descricao_reconhecimento: "Código e tabela Itens",
    campos: [{ chave: "codigo", titulo: "Código", tipo: "texto", obrigatorio: false }],
    tabelas: [{ chave: "itens", titulo: "Itens", colunas: [
      { chave: "quantidade", titulo: "Quantidade", tipo: "inteiro" },
      { chave: "ativo", titulo: "Ativo", tipo: "booleano" },
    ] }],
  },
  proposta_original: {}, esquema_provisorio: { type: "object" },
  esquema: { type: "object", properties: {
    codigo: { type: ["string", "null"], title: "Código" },
    itens: { type: "array", title: "Itens", maxItems: 2, items: {
      type: "object", properties: {
        quantidade: { type: ["integer", "null"], title: "Quantidade" },
        ativo: { type: ["boolean", "null"], title: "Ativo" },
      },
    } },
  } },
  resultado: { codigo: field("TESTE"), itens: [
    { quantidade: field(0), ativo: field(false) },
  ] },
};

async function mockWorkspace(page: Page, initial: Document = fixture, loggedIn = true) {
  let document = structuredClone(initial);
  const submitted: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith("/session/")) {
      if (request.method() === "POST") {
        submitted.push({ path: "session", body: Object.fromEntries(new URLSearchParams(request.postData() ?? "")) });
        loggedIn = true;
      }
      await route.fulfill({ json: {
        autenticado: loggedIn, admin: true, csrfToken: "synthetic", llm_configurado: true,
      } });
    } else if (url.endsWith("/auditoria/")) {
      await route.fulfill({ json: [] });
    } else if (url.endsWith("/ativos/")) {
      await route.fulfill({ json: [] });
    } else if (url.endsWith("/foto/")) {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="800"><rect width="500" height="800" fill="#eee"/></svg>' });
    } else if (url.includes("/tipos/")) {
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        submitted.push({ path: "type", body });
        await route.fulfill({ json: { id: 1, ...body } });
      } else {
        await route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } });
      }
    } else if (url.endsWith("/upload/")) {
      submitted.push({ path: "upload", body: request.postData() });
      document = { ...document, status: "pendente", etapa: "", pode_excluir: false };
      await route.fulfill({ status: 202, json: { job_id: document.id } });
    } else if (url.endsWith("/definir-tipo/")) {
      submitted.push({ path: "discovery", body: request.postDataJSON() });
      document = { ...document, status: "pendente", etapa: "", versao: 2, pode_excluir: false };
      await route.fulfill({ status: 202, json: document });
    } else if (url.endsWith("/revisao/") && request.method() === "PATCH") {
      const body = request.postDataJSON();
      submitted.push({ path: "review", body });
      document = { ...document, resultado: body.resultado, versao: 2 };
      await route.fulfill({ json: document });
    } else {
      await route.fulfill({ json: url.includes("?page=")
        ? { count: 1, next: null, previous: null, results: [document] } : document });
    }
  });

  await page.goto("/");
  return { submitted };
}

test("cancelling document action keeps local review navigation protected", async ({ page }) => {
    await mockWorkspace(page);
    await page.locator(".job-open").click();
    await page.getByRole("textbox", { name: "Código", exact: true }).fill("EDITADO");
    await page.getByRole("button", { name: "Rejeitar", exact: true }).click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("alertdialog").getByRole("button", { name: "Descartar ajustes", exact: true }).click();
    await page.getByRole("button", { name: "Configuração", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("document type edits are protected when leaving configuration", async ({ page }) => {
    await mockWorkspace(page);
    await page.getByRole("button", { name: "Configuração", exact: true }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Tipo alterado");
    await page.getByRole("button", { name: "Documentos", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });
test("branded login uses accessible controls and authenticates without changing the contract", async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page, fixture, false);
  await expect(page.getByRole("heading", { name: "Acesse seu workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar", exact: true }))
    .toHaveCSS("background-color", "rgb(15, 89, 102)");
  await expect(page.locator(".login-story svg[aria-hidden=true]").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
  await page.getByLabel("Usuário", { exact: true }).fill("synthetic-user");
  await page.getByLabel("Senha", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Novo documento", exact: true })).toBeVisible();
  expect(mock.submitted[0]).toEqual({
    path: "session", body: { username: "synthetic-user", password: "synthetic-password" },
  });
});

test("upload works after asynchronous confirmation and decorative effects do not intercept input", async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.getByLabel("Foto do documento", { exact: true }).setInputFiles({
    name: "synthetic.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Enviar para processamento", exact: true }).click();
  await expect(page.locator("section.processing").getByRole("progressbar")).toBeVisible();
  expect(mock.submitted.find((item) => item.path === "upload")?.body).toContain('filename="synthetic.png"');
  await expect(page.getByLabel("Foto do documento", { exact: true })).toHaveValue("");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator(".upload > [aria-hidden=true]").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("review checkbox and table edits retain metadata and row sources", async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page);
  await page.locator(".job-open").click();
  await expect(page.locator(".job-open")).toHaveCSS("display", "grid");
  await page.getByRole("button", { name: "Localizar na foto: Código", exact: true }).click();
  await expect(page.getByRole("img", { name: "Área do campo selecionado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar revisão", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("review.png"), fullPage: true });
  const reviewed = page.getByRole("checkbox", { name: "Revisado", exact: true }).first();
  await reviewed.focus();
  await page.keyboard.press("Space");
  await expect(reviewed).toBeChecked();
  await page.getByRole("spinbutton", { name: "Quantidade · Linha 1", exact: true }).fill("7");
  await page.getByRole("combobox", { name: "Ativo · Linha 1", exact: true }).selectOption("true");
  await page.getByRole("button", { name: "Adicionar linha manual", exact: true }).click();
  await expect(page.getByRole("button", { name: "Adicionar linha manual", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remover linha 1 de Itens", exact: true }).click();
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar revisão", exact: true })).toBeDisabled();
  const saved = mock.submitted.find((item) => item.path === "review")?.body as {
    linhas: { itens: (number | null)[] }; resultado: Document["resultado"];
  };
  expect(saved.linhas.itens).toEqual([null]);
  expect(saved.resultado.codigo).toEqual({ ...fixture.resultado.codigo, revisado: true });
  expect(Array.isArray(saved.resultado.itens) && saved.resultado.itens[0].quantidade).toMatchObject({
    valor: null, bbox: null, revisado: false, confianca: 0,
  });
});

test("unsaved navigation uses branded confirmation and configuration controls save the same schema", async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page);
  await page.locator(".job-open").click();
  await page.getByRole("textbox", { name: "Código", exact: true }).fill("AJUSTE");
  await page.getByRole("button", { name: "Configuração", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Continuar editando", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Código", exact: true })).toHaveValue("AJUSTE");
  await page.getByRole("button", { name: "Configuração", exact: true }).click();
  await dialog.getByRole("button", { name: "Descartar ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tipos de documento" })).toBeVisible();
  await expect(page.locator("#configuracao .app-notice")).toHaveCSS("background-color", "rgb(240, 250, 245)");
  await page.getByLabel("Nome", { exact: true }).fill("Tipo sintético");
  await page.getByLabel("Descrição para detecção", { exact: true }).fill("Código impresso");
  await page.getByRole("checkbox", { name: "Ativo", exact: true }).uncheck();
  await page.getByRole("button", { name: "Salvar configuração", exact: true }).click();
  await expect(page.getByText("Configuração salva.", { exact: false })).toBeVisible();
  expect(mock.submitted.find((item) => item.path === "type")?.body).toMatchObject({
    nome: "Tipo sintético", descricao: "Código impresso", ativo: false,
    esquema: { type: "object", additionalProperties: false },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("configuration-mobile.png"), fullPage: true });
});

test("discovery preserves editable types, bbox selection and mandatory reprocessing", async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page, { ...fixture, status: "revisao_tipo", tipo_nome: null });
  await page.locator(".job-open").click();
  const field = page.getByRole("group", { name: "Código", exact: true });
  await field.getByRole("button", { name: "Localizar na foto: TESTE", exact: true }).click();
  await expect(page.getByRole("img", { name: "Área do campo selecionado" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("discovery.png"), fullPage: true });
  await field.getByText("Ajustar nome e tipo do campo", { exact: true }).click();
  await field.getByRole("combobox", { name: "Tipo de dado" }).selectOption("data");
  await expect(field.getByRole("button", { name: "Localizar na foto: TESTE", exact: true })).toHaveCount(0);
  await field.getByRole("checkbox", { name: "Obrigatório", exact: false }).check();
  await expect(page.getByRole("button", { name: "Salvar como novo tipo e continuar revisão" })).toBeDisabled();
  await page.getByRole("button", { name: "Reprocessar com ajustes" }).click();
  await expect(page.locator("section.processing").getByRole("progressbar")).toBeVisible();
  expect(mock.submitted.find((item) => item.path === "discovery")?.body).toMatchObject({
    versao: 1, proposta: { campos: [{ chave: "codigo", tipo: "data", obrigatorio: true }] },
  });
});
