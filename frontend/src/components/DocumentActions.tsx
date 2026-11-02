import { useEffect, useState } from "react";
import { api, message } from "../api";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Notice } from "./Notice";
import type { Document, DocumentTypeOption } from "../types";
import { Archive, LoaderCircle, RotateCw, XCircle } from "lucide-react";

export function DocumentActions({ document, onUpdated, disabled = false, beforeAction }: {
  document: Document;
  onUpdated: (document: Document) => void;
  disabled?: boolean;
  beforeAction?: () => Promise<boolean>;
}) {
  const [types, setTypes] = useState<DocumentTypeOption[]>([]);
  const [typeId, setTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (document.status !== "revisao_tipo") return;
    const controller = new AbortController();
    api<DocumentTypeOption[]>("tipos/ativos/", { signal: controller.signal })
      .then(setTypes)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [document.status]);

  async function perform(action: "atribuir-tipo" | "rejeitar" | "arquivar") {
    if (action === "atribuir-tipo" && !typeId) return;
    if (beforeAction && !await beforeAction()) return;
    const confirmMessage = action === "rejeitar"
      ? "Rejeitar este documento? Ele deixará de estar disponível para revisão."
      : action === "arquivar"
        ? "Arquivar este documento? Ele permanecerá armazenado, mas sairá do fluxo ativo."
        : "";
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Document>(`documentos/${document.id}/${action}/`, {
        method: "POST",
        body: JSON.stringify({
          versao: document.versao,
          ...(action === "atribuir-tipo" ? { tipo_id: Number(typeId) } : {}),
        }),
      });
      onUpdated(updated);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const locked = busy || disabled;
  const canReject = document.status === "revisao" || document.status === "revisao_tipo";
  const canArchive = ["revisao", "revisao_tipo", "aprovado", "rejeitado", "erro"].includes(document.status)
    && document.ged_status !== "pendente" && document.ged_status !== "enviando";
  if (!canReject && !canArchive && document.status !== "revisao_tipo") return null;

  return (
    <section className="workspace-panel">
      <h2>Ações do documento</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {document.status === "revisao_tipo" && (
        <div className="actions">
          <label className="min-w-56 flex-1">Associar a um tipo cadastrado
            <NativeSelect value={typeId} disabled={locked || types.length === 0}
              onChange={(event) => setTypeId(event.target.value)}>
              <NativeSelectOption value="">Selecione um tipo</NativeSelectOption>
              {types.map((type) => <NativeSelectOption key={type.id} value={type.id}>
                {type.nome}
              </NativeSelectOption>)}
            </NativeSelect>
          </label>
          <Button variant="outline" disabled={locked || !typeId}
            onClick={() => void perform("atribuir-tipo")}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RotateCw />}
            Reextrair com este tipo
          </Button>
          {types.length === 0 && <p className="mb-0 text-sm text-muted-foreground">
            Nenhum tipo ativo disponível. Cadastre um tipo na configuração ou mantenha a descoberta.
          </p>}
        </div>
      )}
      <div className="actions">
        {canReject && <Button variant="outline" disabled={locked}
          onClick={() => void perform("rejeitar")}><XCircle />Rejeitar</Button>}
        {canArchive && <Button variant="outline" disabled={locked}
          onClick={() => void perform("arquivar")}><Archive />Arquivar</Button>}
      </div>
    </section>
  );
}
