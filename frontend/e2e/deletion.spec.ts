import { expect, test, type Page } from "@playwright/test";

const base = {
  correlation_id: "synthetic", tipo_nome: "Documento sintético",
  proposta: {}, resultado: { codigo: {
    valor: "TESTE", confianca: 0.9, bbox: null, revisado: false, flags: [],
  } }, esquema: { type: "object", properties: { codigo: { type: "string", title: "Código" } } },
  erros_validacao: [],
  versao: 2, criado_em: "2026-10-31T17:00:00Z", atualizado_em: "2026-10-31T17:00:00Z",
  ged_status: "nao_configurado", erro_codigo: "", erro_mensagem: "Tentativa sintética",
  pode_reprocessar: false, pode_reenviar_ged: false,
};

async function mockDocuments(
  page: Page, mode: "success" | "conflict" | "delayed" = "success", status = "erro",
) {
  let documents = [
    { ...base, id: "modal-smoke", status, pode_excluir: true },
    { ...base, id: "active-smoke", status: "processando", pode_excluir: false },
  ];
  let calls = 0;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/foto/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
      });
    } else if (request.url().endsWith("/session/")) {
      await route.fulfill({ json: {
        autenticado: true, admin: true, csrfToken: "synthetic",
        llm_configurado: true, pode_criar_tipo: true,
      } });
    } else if (request.method() === "DELETE") {
      calls++;
      expect(request.postDataJSON()).toEqual({ versao: 2 });
      if (mode === "conflict") {
        await route.fulfill({ status: 409, json: { detail: "O documento mudou. Atualize a lista." } });
      } else {
        if (mode === "delayed") await pending;
        documents = documents.filter((document) => document.id !== "modal-smoke");
        await route.fulfill({ status: 204 });
      }
    } else if (request.url().includes("?page=")) {
      await route.fulfill({ json: { count: documents.length, next: null, previous: null, results: documents } });
    } else {
      await route.fulfill({ json: documents.find((document) => request.url().includes(document.id)) });
    }
  });
  await page.goto("/");
  return { calls: () => calls, finish: () => finish?.() };
}

test("cancel and Escape keep data, trap focus and restore the originating button", async ({ page }) => {
  const mock = await mockDocuments(page);
  const trigger = page.getByRole("button", { name: "Excluir documento modal-sm", exact: true });
  await expect(page.getByRole("button", { name: "Excluir documento active-s", exact: true })).toBeDisabled();
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  const cancel = dialog.getByRole("button", { name: "Cancelar", exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Excluir definitivamente", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(mock.calls()).toBe(0);
  await trigger.click();
  await cancel.click();
  expect(mock.calls()).toBe(0);
});

test("mobile confirmation stays open on conflict and reports the error inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await mockDocuments(page, "conflict");
  await page.getByRole("button", { name: "Excluir documento modal-sm", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(dialog).toContainText("Tipos cadastrados e cópias já enviadas ao GED serão mantidos.");
  await dialog.getByRole("button", { name: "Excluir definitivamente", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("O documento mudou");
  await expect(dialog.getByRole("alert")).toContainText("Cancele");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(mock.calls()).toBe(1);
  await expect(page.getByRole("button", { name: "Excluir documento modal-sm", exact: true })).toBeVisible();
});

test("pending deletion blocks repeat actions and success removes only the confirmed document", async ({ page }) => {
  const mock = await mockDocuments(page, "delayed");
  await page.getByRole("button", { name: "Excluir documento modal-sm", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Excluir definitivamente", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Excluindo…", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(mock.calls()).toBe(1);
  mock.finish();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excluir documento modal-sm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excluir documento active-s", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Documento excluído");
  await expect(page.getByLabel("Foto do documento", { exact: true })).toBeFocused();
});

test("selected document warns about unsaved review and cancellation preserves edits", async ({ page }) => {
  const mock = await mockDocuments(page, "success", "revisao");
  await page.locator(".job-open").first().click();
  const input = page.getByRole("textbox", { name: "Código", exact: true });
  await input.fill("AJUSTE");
  const trigger = page.getByRole("button", { name: "Excluir documento modal-sm", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Os ajustes não salvos deste documento também serão perdidos.");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(input).toHaveValue("AJUSTE");
  expect(mock.calls()).toBe(0);
  await trigger.click();
  await dialog.getByRole("button", { name: "Excluir definitivamente", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Documento excluído");
  expect(mock.calls()).toBe(1);
});
