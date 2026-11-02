import { useEffect, useState } from "react";
import { api, message } from "../api";
import { Notice } from "./Notice";
import type { AuditEvent, Document as GedDocument } from "../types";

const eventLabels: Record<string, string> = {
  document_uploaded: "Documento recebido",
  processing_started: "Processamento iniciado",
  processing_completed: "Processamento concluído",
  processing_failed: "Falha no processamento",
  type_proposal_updated: "Proposta de tipo ajustada",
  type_assigned_manually: "Tipo cadastrado associado manualmente",
  type_created_from_proposal: "Novo tipo criado a partir da proposta",
  review_saved: "Revisão salva",
  document_approved: "Documento aprovado",
  document_rejected: "Documento rejeitado",
  document_archived: "Documento arquivado",
  processing_requeued: "Processamento reenfileirado manualmente",
  ged_requeued: "Envio ao GED reenfileirado manualmente",
  ged_sending: "Envio ao GED iniciado",
  ged_sent: "Documento enviado ao GED",
  ged_failed: "Falha no envio ao GED",
  queue_failed: "Falha ao enfileirar uma tarefa",
  document_deleted: "Documento excluído",
  task_failed: "Falha inesperada em uma tarefa",
};

export function AuditTrail({ document }: { document: GedDocument }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setEvents(null);
    setError("");
    api<AuditEvent[]>(`documentos/${document.id}/auditoria/`, { signal: controller.signal })
      .then(setEvents)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [document.id, document.versao, document.auditoria_id]);

  return (
    <section className="workspace-panel">
      <h2>Histórico de atividades</h2>
      <p className="text-sm text-muted-foreground">
        Registra ações e estados do documento; valores pessoais extraídos não são copiados para o histórico.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!events && !error && <p role="status">Carregando histórico…</p>}
      {events?.length === 0 && <p>Nenhuma atividade registrada.</p>}
      {events && events.length > 0 && (
        <ol className="space-y-3">
          {events.map((event, index) => (
            <li key={`${event.criado_em}-${index}`} className="border-l-2 border-primary/20 pl-4">
              <strong>{eventLabels[event.evento] ?? event.evento}</strong>
              <p className="mb-0 text-sm text-muted-foreground">
                {new Date(event.criado_em).toLocaleString("pt-BR")}
                {event.ator ? ` · ${event.ator}` : " · sistema"}
                {` · ${event.status} · versão ${event.versao}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
