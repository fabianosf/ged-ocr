import { useEffect, useRef, useState } from "react";
import { ApiError, api, message, setCsrfToken } from "./api";
import { Discovery } from "./Discovery";
import { Review } from "./Review";
import { DocumentTypes } from "./DocumentTypes";
import { DeleteDocumentDialog } from "./components/DeleteDocumentDialog";
import { DocumentActions } from "./components/DocumentActions";
import { AuditTrail } from "./components/AuditTrail";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { ProcessingProgress, stageMessages } from "./components/ProcessingProgress";
import { Input } from "./components/ui/input";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { ShineBorder } from "./components/ui/shine-border";
import { GridPattern } from "./components/ui/grid-pattern";
import { Notice } from "./components/Notice";
import { useConfirmation } from "./components/useConfirmation";
import {
  ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, FileScan, Files,
  LoaderCircle, LogOut, RotateCw, Settings2, Trash2, UploadCloud, X,
} from "lucide-react";
import type { Document, DocumentSummary, Page, Session } from "./types";

const labels: Record<Document["status"], string> = {
  pendente: "Na fila", processando: "Processando", revisao: "Revisão",
  revisao_tipo: "Documento novo",
  aprovado: "Aprovado", rejeitado: "Rejeitado", arquivado: "Arquivado",
  erro: "Precisa de atenção",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const [documents, setDocuments] = useState<Page<DocumentSummary> | null>(null);
  const [selected, setSelected] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [config, setConfig] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DocumentSummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [success, setSuccess] = useState("");
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const confirmation = useConfirmation();

  const mayLeave = async () => {
    if (dirty.current && !await confirmation.confirm(
      "A revisão ainda não foi salva. Ao continuar, seus ajustes locais serão perdidos.",
    )) return false;
    return true;
  };
  const openConfig = async () => {
    if (await mayLeave()) { dirty.current = false; setConfig(true); }
  };
  const onUpdated = (document: Document) => {
    dirty.current = false;
    setSelected(document);
  };
  const beforeDocumentAction = async () => {
    if (!await mayLeave()) return false;
    return true;
  };

  const updateSession = (value: Session) => {
    setCsrfToken(value.csrfToken);
    setSession(value);
  };
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    const expire = () => setSessionExpired(true);
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
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
    if (!authenticated || deletingId || sessionExpired || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let active = false;
      try {
        const list = await api<Page<DocumentSummary>>(`documentos/?page=${page}&resumo=1`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setDocuments(list);
        active = list.results.some((item) => ["pendente", "processando"].includes(item.status)
          || ["pendente", "enviando"].includes(item.ged_status));
        if (selectedId) {
          const document = await api<Document>(`documentos/${selectedId}/`, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          active ||= ["pendente", "processando"].includes(document.status)
            || ["pendente", "enviando"].includes(document.ged_status);
          setSelected((current) => dirty.current ? current : current?.id === document.id
            && current.versao === document.versao && current.status === document.status
            && current.ged_status === document.ged_status
            && current.etapa === document.etapa
            && current.auditoria_id === document.auditoria_id
            && current.pode_reprocessar === document.pode_reprocessar
            && current.pode_reenviar_ged === document.pode_reenviar_ged ? current : document);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(message(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), active ? 2500 : 15000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authenticated, page, selectedId, deletingId, listVersion, sessionExpired, visible]);

  async function deleteDocument(document: DocumentSummary) {
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
      setSessionExpired(false);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!await mayLeave()) return;
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
    const data = new FormData(event.currentTarget);
    if (!await mayLeave()) return;
    setBusy(true); setError("");
    try {
      const job = await api<{ job_id: string }>("documentos/upload/", {
        method: "POST", body: data,
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
    <main className="app-shell">
      <header className="topbar">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <FileScan className="size-6" aria-hidden="true" />
          </div>
          <div><h1>GED <span>OCR</span></h1>
            <p className="mb-0 text-xs tracking-wide text-muted-foreground">INTELIGÊNCIA DOCUMENTAL</p></div>
        </div>
        {session?.autenticado && <nav className="actions">
          <Button variant={config ? "ghost" : "secondary"} disabled={busy}
            aria-current={!config ? "page" : undefined}
            onClick={async () => {
              if (config && await mayLeave()) { dirty.current = false; setConfig(false); }
            }}><Files />Documentos</Button>
          <Button variant={config ? "secondary" : "ghost"} disabled={busy}
            aria-current={config ? "page" : undefined} onClick={() => void openConfig()}><Settings2 />Configuração</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void signOut()}><LogOut />Sair</Button>
        </nav>}
      </header>
      {error && <Notice tone="error">
        <div className="flex items-start justify-between gap-3">
          <p className="mb-0">{error}</p>
          <Button variant="ghost" size="icon-sm" aria-label="Fechar mensagem"
            onClick={() => setError("")}><X /></Button>
        </div>
      </Notice>}
      {success && <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" /><span className="flex-1">{success}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar confirmação"
          onClick={() => setSuccess("")}><X /></Button>
      </div>}
      {sessionExpired && <section className="workspace-panel" role="alert">
        <h2>Sessão expirada</h2>
        <p>Entre novamente para continuar. Seus ajustes foram mantidos.</p>
        <form onSubmit={(event) => void signIn(event)}>
          <label>Usuário<Input name="username" autoComplete="username" required /></label>
          <label>Senha<Input name="password" type="password" autoComplete="current-password" required /></label>
          <Button disabled={busy}>Entrar</Button>
        </form>
      </section>}
      <div hidden={sessionExpired}>
      {!session ? <div role="status" className="flex items-center gap-2 py-12 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />Conectando…
      </div> : !session.autenticado ? (
        <div className="login-layout">
          <div className="login-story relative overflow-hidden">
            <GridPattern className="stroke-white/10 [mask-image:linear-gradient(to_bottom,white,transparent)]" />
            <div className="relative">
            <Badge variant="outline" className="mb-5 border-white/25 text-white">GED OCR · Workspace</Badge>
            <h2>Da foto ao dado.<br />Com você no controle.</h2>
            <p>Transforme documentos em informações estruturadas.
              Inteligência artificial para extrair, revisão humana para conferir.</p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <span><FileScan className="size-4" />Leitura inteligente</span>
              <span><CheckCircle2 className="size-4" />Revisão obrigatória</span>
            </div>
            </div>
          </div>
          <Card className="login relative">
            <ShineBorder shineColor={["#0f5260", "#57a7a0", "#b7dbd5"]} aria-hidden="true" />
            <CardHeader><h2 className="mb-0 text-2xl">Acesse seu workspace</h2>
              <p className="mb-0 text-sm text-muted-foreground">Entre para enviar e revisar documentos.</p></CardHeader>
            <CardContent>
              <form onSubmit={(event) => void signIn(event)}>
                <fieldset disabled={busy} className="border-0 p-0">
                  <label>Usuário<Input name="username" autoComplete="username" required /></label>
                  <label>Senha<Input name="password" type="password" autoComplete="current-password" required /></label>
                  <Button className="mt-2 w-full" disabled={busy}>
                    {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Entrar
                  </Button>
                </fieldset>
              </form>
              <p className="mb-0 mt-5 text-xs text-muted-foreground">A conferência humana é parte de cada processamento.</p>
            </CardContent>
          </Card>
        </div>
      ) : config ? (
        <>
          <section id="configuracao">
            <Badge variant="secondary" className="mb-2"><Settings2 />Ambiente e integração</Badge>
            <h2>Configuração de processamento</h2>
            <Notice tone={session.llm_configurado ? "success" : "error"}>
              {session.llm_configurado ? "LLM configurado no servidor."
                : "LLM não configurado. Não é possível descobrir ou extrair documentos ainda."}
            </Notice>
            <p>O administrador do servidor deve configurar <code>LLM_BASE_URL</code>,{" "}
              <code>LLM_API_KEY</code> e <code>LLM_MODEL</code> no ambiente e recriar backend e worker.
              Não informe chaves em campos de documento.</p>
            <p>Configure <code>TYPE_MIN_CONFIDENCE</code> para o limiar de classificação (0 a 1).
              Fotos/OCR são enviados ao provedor configurado; confirme autorização e retenção.</p>
            {!session.admin && <p>O cadastro e edição global de tipos é reservado à equipe.</p>}
          </section>
          {session.admin && <DocumentTypes beforeNavigate={mayLeave}
            onDirtyChange={(value) => { dirty.current = value; }} />}
        </>
      ) : (
        <>
          <div className="workspace-intro">
            <div><Badge variant="secondary" className="mb-2">Workspace documental</Badge>
              <h2>Documentos organizados.<br className="sm:hidden" /> Dados conferidos.</h2>
              <p>Envie, acompanhe a extração e valide cada informação em um só lugar.</p></div>
            <div className="workspace-seal"><CheckCircle2 className="size-5" aria-hidden="true" />
              <span>IA para extrair<br /><strong>Você para validar</strong></span></div>
          </div>
          <form className="upload" onSubmit={(event) => void upload(event)}>
            <ShineBorder shineColor={["#0f5260", "#57a7a0"]} duration={20} aria-hidden="true" />
            <div className="flex w-full items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><UploadCloud className="size-5" aria-hidden="true" /></div>
              <div><h2 className="mb-1">Novo documento</h2>
                <p className="mb-0 text-sm text-muted-foreground">Envie uma foto nítida e confira os dados extraídos.</p></div>
            </div>
            <label>Foto do documento
              <Input ref={photoInput} type="file" name="foto" accept="image/jpeg,image/png,image/webp" required disabled={busy} />
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
              <Button variant="ghost" disabled={busy}
                className="job-open grid h-auto w-full items-start justify-stretch justify-items-start gap-2.5 whitespace-normal rounded-none p-4 text-left"
                aria-pressed={selectedId === document.id}
                onClick={async () => {
                  if (selectedId !== document.id && await mayLeave()) {
                    setBusy(true); setError("");
                    try {
                      const detail = await api<Document>(`documentos/${document.id}/`);
                      dirty.current = false; setSelected(detail);
                    } catch (cause) { setError(message(cause)); }
                    finally { setBusy(false); }
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
              </Button>
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
            <>
              <Discovery key={`${selected.id}:${selected.versao}`} document={selected}
                onDirtyChange={(value) => { dirty.current = value; }} onUpdated={onUpdated} />
              <DocumentActions document={selected} onUpdated={onUpdated} disabled={busy}
                beforeAction={beforeDocumentAction} />
            </>
          ) : selected && (selected.status === "revisao" || selected.status === "aprovado") ? (
            <>
              <Review key={`${selected.id}:${selected.versao}`} document={selected}
                onDirtyChange={(value) => { dirty.current = value; }}
                onUpdated={onUpdated} />
              <DocumentActions document={selected} onUpdated={onUpdated} disabled={busy}
                beforeAction={beforeDocumentAction} />
              {selected.pode_reenviar_ged && (
                <Button variant="outline" disabled={busy}
                  onClick={() => void retry(selected, true)}><RotateCw />Reenviar ao GED</Button>
              )}
            </>
          ) : selected && (
            <section className={selected.status === "erro" ? "error" : "processing"}
              role={selected.status === "erro" ? "alert" : undefined}>
              <h2>{selected.status === "arquivado" ? "Documento arquivado"
                : selected.status === "rejeitado" ? "Documento rejeitado"
                : selected.status === "erro" ? "Não foi possível concluir esta tentativa"
                : selected.pode_reprocessar ? "O processamento precisa ser retomado"
                : selected.status === "pendente" ? "Documento recebido"
                : "Estamos lendo seu documento"}</h2>
              {selected.status === "arquivado" || selected.status === "rejeitado" ? null
                : selected.status === "erro" ? <p>{selected.erro_mensagem}</p>
                : <ProcessingProgress document={selected} />}
              {selected.erro_codigo === "llm_nao_configurado" && (
                <p><a href="#configuracao" onClick={(event) => {
                  event.preventDefault(); void openConfig();
                }}>Abrir Configuração</a></p>
              )}
              <DocumentActions document={selected} onUpdated={onUpdated} disabled={busy}
                beforeAction={beforeDocumentAction} />
              {selected.pode_reprocessar && (
                selected.erro_codigo !== "llm_nao_configurado" || session.llm_configurado
              ) && <p><Button variant="outline" disabled={busy} onClick={() => void retry(selected)}>
                {selected.status === "erro" ? "Tentar novamente" : "Recuperar processamento"}
              </Button></p>}
              <details className="support-details">
                <summary>Detalhes para suporte</summary>
                <p>Referência: {selected.correlation_id}</p>
                {selected.status === "erro" && <p>Código: {selected.erro_codigo}</p>}
                {selected.etapa && <p>Etapa: {stageMessages[selected.etapa] ?? selected.etapa}</p>}
                <p>Última atualização: {new Date(selected.atualizado_em).toLocaleString("pt-BR")}</p>
              </details>
            </section>
          )}
          {selected && <AuditTrail key={`${selected.id}:${selected.versao}`} document={selected} />}
          <footer className="app-footer">
            <span>GED OCR · Inteligência documental</span><span>Extração assistida. Decisão humana.</span>
          </footer>
        </>
      )}
      </div>
      {confirmation.dialog}
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
