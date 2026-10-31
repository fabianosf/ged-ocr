import { expect, test } from "@playwright/test";

test("worker stages update loading automatically and completion opens human review", async ({ page }) => {
  let document = {
    id: "processing-test", correlation_id: "synthetic", tipo_nome: "Documento sintético",
    status: "pendente", etapa: "", versao: 1, criado_em: "2026-10-31T17:00:00Z",
    atualizado_em: "2026-10-31T17:00:00Z", ged_status: "nao_configurado",
    pode_reprocessar: false, pode_excluir: false, pode_reenviar_ged: false,
    resultado: { codigo: { valor: "TESTE", confianca: 0.9, bbox: null, revisado: false, flags: [] } },
    esquema: { type: "object", properties: { codigo: { type: "string", title: "Código" } } },
    erros_validacao: [], erro_codigo: "", proposta: {},
  };
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/session/")) {
      await route.fulfill({ json: { autenticado: true, admin: true, csrfToken: "synthetic", llm_configurado: true } });
    } else if (url.endsWith("/foto/")) {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' });
    } else {
      await route.fulfill({ json: url.includes("?page=")
        ? { count: 1, next: null, previous: null, results: [document] } : document });
    }
  });
  await page.goto("/");
  await page.locator(".job-open").click();
  const panel = page.locator("section.processing");
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /Aguardando na fila/);
  document = { ...document, status: "processando", etapa: "descoberta" };
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /Descobrindo campos com IA/);
  await expect(panel.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  await expect(panel.getByRole("listitem").filter({ hasText: "Análise pela IA" })).toHaveAttribute("aria-current", "step");
  document = { ...document, etapa: "extracao" };
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /Extraindo valores com IA/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await panel.locator(".processing-indicator").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  document = { ...document, status: "revisao", etapa: "concluido", pode_excluir: true };
  await expect(page.getByRole("textbox", { name: "Código", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Revisado", exact: true })).not.toBeChecked();
});

test("interrupted processing pauses the bar instead of pretending the AI is still progressing", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const item = {
      id: "stale-test", status: "processando", etapa: "extracao", versao: 1,
      pode_reprocessar: true, pode_excluir: false, tipo_nome: null,
      criado_em: "2026-10-31T17:00:00Z", atualizado_em: "2026-10-31T17:00:00Z",
      ged_status: "nao_configurado", resultado: {}, esquema: {}, correlation_id: "synthetic",
    };
    await route.fulfill({ json: route.request().url().endsWith("/session/")
      ? { autenticado: true, csrfToken: "synthetic", llm_configurado: true }
      : route.request().url().includes("?page=")
        ? { count: 1, next: null, previous: null, results: [item] } : item });
  });
  await page.goto("/");
  await page.locator(".job-open").click();
  const panel = page.locator("section.processing");
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Processamento precisa ser retomado");
  expect(await panel.locator(".processing-indicator").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(panel.getByRole("button", { name: "Recuperar processamento", exact: true })).toBeVisible();
});
