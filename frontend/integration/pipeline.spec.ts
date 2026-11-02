import { expect, test } from "@playwright/test";

test("real backend handles upload review and approval with isolated fake OCR and LLM", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("e2e-user");
  await page.getByLabel("Senha", { exact: true }).fill("e2e-only-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Foto do documento", { exact: true }).setInputFiles({
    name: "synthetic.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP8//8/AymAiSTVoxpGNQwpDQBVbQMdPVIhQwAAAABJRU5ErkJggg==", "base64"),
  });
  await page.getByRole("button", { name: "Enviar para processamento", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Código", exact: true })).toHaveValue("SINTETICO-001");
  await page.getByRole("checkbox", { name: "Revisado", exact: true }).check();
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar revisão", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Aprovar documento", exact: true }).click();
  await expect(page.getByText("Documento aprovado e salvo", { exact: true })).toBeVisible();
  const detail = await page.request.get("/api/documentos/");
  expect(detail.ok()).toBeTruthy();
  const document = (await detail.json()).results[0];
  expect(document.status).toBe("aprovado");
  expect(document.versao).toBe(3);
  expect(document.resultado.codigo.revisado).toBe(true);
});
