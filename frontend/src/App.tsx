import { useEffect, useRef, useState } from "react";
import { ApiError, api, message, setCsrfToken } from "./api";
import { Discovery } from "./Discovery";
import { Review } from "./Review";
import { Types } from "./Types";
import { DeleteDocumentDialog } from "./components/DeleteDocumentDialog";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { ProcessingProgress, stageMessages } from "./components/ProcessingProgress";
import {
  ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, FileScan, Files,
  LoaderCircle, LogOut, Settings2, Trash2, UploadCloud, X,
} from "lucide-react";
import type { Document, Page, Session } from "./types";

const labels: Record<Document["status"], string> = {
  pendente: "Na fila", processando: "Processando", revisao: "Revisão",
  revisao_tipo: "Documento novo",
  aprovado: "Aprovado", erro: "Precisa de atenção",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [documents, setDocuments] = useState<Page<Document> | null>(null);
  const [selected, setSelected] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [config, setConfig] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [success, setSuccess] = useState("");
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
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
    if (!authenticated || deletingId) return;
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
            && current.etapa === document.etapa
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
  }, [authenticated, page, selectedId, deletingId, listVersion]);

  async function deleteDocument(document: Document) {
    if (!document.pode_excluir || busy) return;
    setDeletingId(document.id); setBusy(true); setDeleteError(""); setSuccess("");
    try {
      await api<void>(`documentos/${document.id}/`, {
        method: "DELETE", body: JSON.stringify({ versao: document.versao }),
      });
      if (selectedId === document.id) { dirty.current = false; setSelected(null); }
      setDocuments((current) => current ? {
        ...current, count: Math.max(0, current.count - 1),
        results: current.results.filter((item) => item.id !== document.id),
      } : current);
      if (documents?.results.length === 1 && page > 1) setPage(page - 1);
      setDeleteTarget(null);
      setSuccess("Documento excluído. A foto e os dados desta tentativa foram removidos.");
    } catch (cause) {
      setDeleteError(message(cause) + (cause instanceof ApiError && cause.status === 409
        ? " Cancele e abra a confirmação novamente após atualizar a lista." : ""));
    }
    finally {
      setDeletingId(null); setBusy(false); setListVersion((current) => current + 1);
    }
  }

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
      setDeleteTarget(null); setSuccess("");
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
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <FileScan className="size-6" aria-hidden="true" />
          </div>
          <div><h1>GED <span>OCR</span></h1>
            <p className="mb-0 text-sm text-muted-foreground">Da foto ao dado, com revisão humana.</p></div>
        </div>
        {session?.autenticado && <nav className="actions">
          <Button variant={config ? "ghost" : "secondary"} disabled={busy}
            aria-current={!config ? "page" : undefined}
            onClick={() => { if (config) setConfig(false); }}><Files />Documentos</Button>
          <Button variant={config ? "secondary" : "ghost"} disabled={busy}
            aria-current={config ? "page" : undefined} onClick={openConfig}><Settings2 />Configuração</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void signOut()}><LogOut />Sair</Button>
        </nav>}
      </header>
      {error && <div className="error" role="alert">
        <div className="flex items-start justify-between gap-3">
          <p className="mb-0">{error}</p>
          <Button variant="ghost" size="icon-sm" aria-label="Fechar mensagem"
            onClick={() => setError("")}><X /></Button>
        </div>
      </div>}
      {success && <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" /><span className="flex-1">{success}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar confirmação"
          onClick={() => setSuccess("")}><X /></Button>
      </div>}
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
            <div className="flex w-full items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><UploadCloud className="size-5" aria-hidden="true" /></div>
              <div><h2 className="mb-1">Novo documento</h2>
                <p className="mb-0 text-sm text-muted-foreground">Envie uma foto nítida e confira os dados extraídos.</p></div>
            </div>
            <label>Foto do documento
              <input ref={photoInput} type="file" name="foto" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <Button disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <UploadCloud />}
              Enviar para processamento
            </Button>
            <small>JPEG, PNG ou WEBP · até 15 MB / 40 MP · extração assíncrona</small>
          </form>
          <section className="jobs">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="mb-1">Seus documentos</h2>
                <p className="mb-0 text-sm text-muted-foreground">Abra para conferir ou exclua tentativas que não precisa manter.</p></div>
              <Badge variant="secondary">{documents?.count ?? 0} documento(s)</Badge>
            </div>
            {documents?.count === 0 && <div className="empty-state">
              <Files className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
              <p className="mb-1 font-medium">Nenhum documento enviado.</p>
              <p className="mb-0 text-sm text-muted-foreground">Comece enviando uma foto acima.</p>
            </div>}
            <div className="job-list">{documents?.results.map((document) => (
              <div key={document.id} className={`job-card ${selectedId === document.id ? "selected" : ""}`}>
              <button disabled={busy} className="job-open" aria-pressed={selectedId === document.id}
                onClick={() => {
                  if (selectedId !== document.id && mayLeave()) {
                    dirty.current = false; setError(""); setSelected(document);
                  }
                }}>
                <FileScan className="size-5 text-primary" aria-hidden="true" />
                <strong>{document.tipo_nome ?? (document.status === "revisao_tipo"
                  ? "Documento novo" : "Tipo a identificar")}</strong>
                <Badge variant={document.status === "erro" ? "outline" : "secondary"}
                  className={`status-${document.status}`}>
                  {document.status === "erro" ? <CircleAlert />
                    : document.status === "aprovado" ? <CheckCircle2 />
                    : ["processando", "pendente"].includes(document.status) ? <LoaderCircle /> : <FileScan />}
                  {labels[document.status]}
                </Badge>
                <small>{new Date(document.criado_em).toLocaleString("pt-BR")} · {document.id.slice(0, 8)}</small>
                <ProcessingProgress document={document} compact />
              </button>
              <Button variant="ghost" size="sm" className="job-delete text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy || !document.pode_excluir}
                title={document.pode_excluir ? "Excluir foto e dados definitivamente"
                  : "Aguarde o processamento ou envio ao GED terminar"}
                aria-label={`Excluir documento ${document.id.slice(0, 8)}`}
                onClick={(event) => {
                  deleteTrigger.current = event.currentTarget;
                  setDeleteError(""); setDeleteTarget(document);
                }}>
                <Trash2 aria-hidden="true" />
                {deletingId === document.id ? "Excluindo…" : "Excluir"}
              </Button>
              </div>
            ))}</div>
            <div className="actions pagination">
              <Button variant="outline" size="sm" disabled={busy || !documents?.previous}
                onClick={() => setPage(page - 1)}><ArrowLeft />Anterior</Button>
              <span className="text-sm text-muted-foreground">Página {page} · {documents?.count ?? 0} documento(s)</span>
              <Button variant="outline" size="sm" disabled={busy || !documents?.next}
                onClick={() => setPage(page + 1)}>Próxima<ArrowRight /></Button>
            </div>
            <p className="mt-4 mb-0 text-xs text-muted-foreground">
              Exclusão bloqueada durante processamento ou envio ao GED. Nenhuma tentativa é apagada automaticamente.
            </p>
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
            <section className={selected.status === "erro" ? "error" : "processing"}
              role={selected.status === "erro" ? "alert" : undefined}>
              <h2>{selected.status === "erro" ? "Não foi possível concluir esta tentativa"
                : selected.pode_reprocessar ? "O processamento precisa ser retomado"
                : selected.status === "pendente" ? "Documento recebido"
                : "Estamos lendo seu documento"}</h2>
              {selected.status === "erro" ? <p>{selected.erro_mensagem}</p>
                : <ProcessingProgress document={selected} />}
              {selected.erro_codigo === "llm_nao_configurado" && (
                <p><a href="#configuracao" onClick={(event) => {
                  event.preventDefault(); openConfig();
                }}>Abrir Configuração</a></p>
              )}
              {selected.pode_reprocessar && (
                selected.erro_codigo !== "llm_nao_configurado" || session.llm_configurado
              ) && <p><button disabled={busy} onClick={() => void retry(selected)}>
                {selected.status === "erro" ? "Tentar novamente" : "Recuperar processamento"}
              </button></p>}
              <details className="support-details">
                <summary>Detalhes para suporte</summary>
                <p>Referência: {selected.correlation_id}</p>
                {selected.status === "erro" && <p>Código: {selected.erro_codigo}</p>}
                {selected.etapa && <p>Etapa: {stageMessages[selected.etapa] ?? selected.etapa}</p>}
                <p>Última atualização: {new Date(selected.atualizado_em).toLocaleString("pt-BR")}</p>
              </details>
            </section>
          )}
        </>
      )}
      <DeleteDocumentDialog document={deleteTarget} busy={deletingId !== null}
        error={deleteError} unsaved={deleteTarget?.id === selectedId && dirty.current}
        onCancel={() => { setDeleteTarget(null); setDeleteError(""); }}
        onConfirm={() => { if (deleteTarget) void deleteDocument(deleteTarget); }}
        onRestoreFocus={() => {
          if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
          else photoInput.current?.focus();
        }} />
    </main>
  );
}
