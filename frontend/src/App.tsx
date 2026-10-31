import { useEffect, useRef, useState } from "react";
import { ApiError, api, message, setCsrfToken } from "./api";
import { Discovery } from "./Discovery";
import { Review } from "./Review";
import { Types } from "./Types";
import type { Document, Page, Session } from "./types";

const labels: Record<Document["status"], string> = {
  pendente: "Na fila", processando: "Processando", revisao: "Revisão",
  revisao_tipo: "Documento novo",
  aprovado: "Aprovado", erro: "Erro",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [documents, setDocuments] = useState<Page<Document> | null>(null);
  const [selected, setSelected] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [config, setConfig] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  const mayLeave = () => {
    if (dirty.current && !window.confirm("Descartar a revisão ainda não salva?")) return false;
    return true;
  };
  const openConfig = () => {
    if (mayLeave()) { dirty.current = false; setConfig(true); }
  };
  const onUpdated = (document: Document) => {
    dirty.current = false;
    setSelected(document);
  };

  const updateSession = (value: Session) => {
    setCsrfToken(value.csrfToken);
    setSession(value);
  };
  useEffect(() => {
    const controller = new AbortController();
    api<Session>("session/", { signal: controller.signal }).then(updateSession)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, []);

  const selectedId = selected?.id;
  const authenticated = session?.autenticado;
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const list = await api<Page<Document>>(`documentos/?page=${page}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setDocuments(list);
        if (selectedId) {
          const document = await api<Document>(`documentos/${selectedId}/`, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setSelected((current) => dirty.current ? current : current?.id === document.id
            && current.versao === document.versao && current.status === document.status
            && current.ged_status === document.ged_status
            && current.pode_reprocessar === document.pode_reprocessar
            && current.pode_reenviar_ged === document.pode_reenviar_ged ? current : document);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(message(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2500);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authenticated, page, selectedId]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      updateSession(await api<Session>("session/", {
        method: "POST",
        body: new URLSearchParams({
          username: String(data.get("username")), password: String(data.get("password")),
        }),
      }));
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!mayLeave()) return;
    setBusy(true); setError("");
    try {
      updateSession(await api<Session>("session/", { method: "DELETE" }));
      dirty.current = false;
      setSelected(null); setDocuments(null); setConfig(false); setPage(1);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayLeave()) return;
    setBusy(true); setError("");
    try {
      const job = await api<{ job_id: string }>("documentos/upload/", {
        method: "POST", body: new FormData(event.currentTarget),
      });
      setSelected(await api<Document>(`documentos/${job.job_id}/`));
      dirty.current = false;
      setPage(1);
      if (photoInput.current) photoInput.current.value = "";
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function retry(document: Document, ged = false) {
    setBusy(true); setError("");
    try {
      await api(`documentos/${document.id}/${ged ? "reenviar-ged" : "reprocessar"}/`, { method: "POST" });
      setSelected(await api<Document>(`documentos/${document.id}/`));
    } catch (cause) {
      setError(message(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        try { setSelected(await api<Document>(`documentos/${document.id}/`)); }
        catch (refreshError) { setError(`${message(cause)} ${message(refreshError)}`); }
      }
    }
    finally { setBusy(false); }
  }

  return (
    <main>
      <header className="topbar">
        <div><h1>GED <span>OCR</span></h1><p>Da foto ao dado, com revisão humana.</p></div>
        {session?.autenticado && <nav className="actions">
          <button onClick={() => { if (config) setConfig(false); }}>Documentos</button>
          <button onClick={openConfig}>Configuração</button>
          <button disabled={busy} onClick={() => void signOut()}>Sair</button>
        </nav>}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!session ? <p>Conectando…</p> : !session.autenticado ? (
        <form className="login" onSubmit={(event) => void signIn(event)}>
          <h2>Entrar</h2>
          <label>Usuário<input name="username" autoComplete="username" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary" disabled={busy}>Entrar</button>
        </form>
      ) : config ? (
        <>
          <section id="configuracao">
            <h2>Configuração de processamento</h2>
            <p className={session.llm_configurado ? "notice" : "error"}>
              {session.llm_configurado ? "LLM configurado no servidor."
                : "LLM não configurado. Não é possível descobrir ou extrair documentos ainda."}
            </p>
            <p>O administrador do servidor deve configurar <code>LLM_BASE_URL</code>,{" "}
              <code>LLM_API_KEY</code> e <code>LLM_MODEL</code> no ambiente e recriar backend e worker.
              Não informe chaves em campos de documento.</p>
            <p>Configure <code>TYPE_MIN_CONFIDENCE</code> para o limiar de classificação (0 a 1).
              Fotos/OCR são enviados ao provedor configurado; confirme autorização e retenção.</p>
            {!session.admin && <p>O cadastro e edição global de tipos é reservado à equipe.</p>}
          </section>
          {session.admin && <Types />}
        </>
      ) : (
        <>
          <form className="upload" onSubmit={(event) => void upload(event)}>
            <label>Foto do documento
              <input ref={photoInput} type="file" name="foto" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <button className="primary" disabled={busy}>Enviar para processamento</button>
            <small>JPEG, PNG ou WEBP · até 15 MB / 40 MP · extração assíncrona</small>
          </form>
          <section className="jobs">
            <h2>Documentos</h2>
            {documents?.count === 0 && <p>Nenhum documento enviado.</p>}
            <div className="job-list">{documents?.results.map((document) => (
              <button key={document.id} className={selectedId === document.id ? "selected" : ""}
                onClick={() => {
                  if (selectedId !== document.id && mayLeave()) {
                    dirty.current = false; setError(""); setSelected(document);
                  }
                }}>
                <strong>{document.tipo_nome ?? (document.status === "revisao_tipo"
                  ? "Documento novo" : "Tipo a identificar")}</strong>
                <span>{labels[document.status]}</span>
                <small>{new Date(document.criado_em).toLocaleString("pt-BR")} · {document.id.slice(0, 8)}</small>
              </button>
            ))}</div>
            <div className="actions pagination">
              <button disabled={!documents?.previous} onClick={() => setPage(page - 1)}>Anterior</button>
              <span>Página {page} · {documents?.count ?? 0} documento(s)</span>
              <button disabled={!documents?.next} onClick={() => setPage(page + 1)}>Próxima</button>
            </div>
          </section>
          {selected?.status === "revisao_tipo" ? (
            <Discovery key={`${selected.id}:${selected.versao}`} document={selected}
              onDirtyChange={(value) => { dirty.current = value; }} onUpdated={onUpdated} />
          ) : selected && (selected.status === "revisao" || selected.status === "aprovado") ? (
            <>
              <Review key={`${selected.id}:${selected.versao}`} document={selected}
                onDirtyChange={(value) => { dirty.current = value; }}
                onUpdated={onUpdated} />
              {selected.pode_reenviar_ged && (
                <button disabled={busy} onClick={() => void retry(selected, true)}>Reenviar ao GED</button>
              )}
            </>
          ) : selected && (
            <section className="notice">
              <h2>{labels[selected.status]}</h2>
              <p>{selected.erro_mensagem || "O processamento ocorre no worker Celery."}</p>
              {selected.erro_codigo === "llm_nao_configurado" && (
                <p><a href="#configuracao" onClick={(event) => {
                  event.preventDefault(); openConfig();
                }}>Abrir Configuração</a></p>
              )}
              <small>correlation_id: {selected.correlation_id}</small>
              {selected.pode_reprocessar && (
                selected.erro_codigo !== "llm_nao_configurado" || session.llm_configurado
              ) && <p><button disabled={busy} onClick={() => void retry(selected)}>
                {selected.status === "erro" ? "Tentar novamente" : "Recuperar job interrompido"}
              </button></p>}
              {!selected.pode_reprocessar && (
                selected.status === "pendente" || selected.status === "processando"
              ) && <p>Aguarde o processamento automático. Se o job ficar interrompido,
                a recuperação será liberada após 11 minutos sem atualização.</p>}
            </section>
          )}
        </>
      )}
    </main>
  );
}
