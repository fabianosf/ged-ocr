let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
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
    const payload = await response.text();
    const correlation = response.headers.get("X-Correlation-ID");
    throw new Error(
      `HTTP ${response.status}: ${payload || response.statusText}`
      + (correlation ? ` · correlation_id: ${correlation}` : ""),
    );
  }
  return response.json() as Promise<T>;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada. Atualize a página.";
}
