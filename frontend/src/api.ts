let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string, correlation: string | null) {
    super(detail + (correlation ? ` · Referência: ${correlation}` : ""));
    this.name = "ApiError";
    this.status = status;
  }
}

function errorDetail(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorDetail).filter(Boolean).join(" ");
  if (typeof value === "object" && value !== null) {
    if ("erro" in value) return errorDetail(value.erro);
    if ("detail" in value) return errorDetail(value.detail);
    if ("mensagem" in value) return errorDetail(value.mensagem);
    return Object.entries(value)
      .filter(([key]) => key !== "correlation_id" && key !== "job_id")
      .map(([key, detail]) => `${key}: ${errorDetail(detail)}`).join(" ");
  }
  return "";
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== "GET") {
    headers.set("X-CSRFToken", csrfToken);
  }
  if (options.body && !(options.body instanceof FormData)
      && !(options.body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api/${path}`, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const correlation = response.headers.get("X-Correlation-ID");
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      throw new ApiError(response.status,
        `O servidor retornou uma resposta de erro inválida (HTTP ${response.status}).`, correlation);
    }
    throw new ApiError(response.status,
      errorDetail(payload) || `Falha na solicitação (HTTP ${response.status}).`, correlation);
  }
  return response.json() as Promise<T>;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada. Atualize a página.";
}
