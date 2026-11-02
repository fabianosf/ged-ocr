import { AlertTriangle, FileText, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import type { DocumentSummary } from "../types";

export function DeleteDocumentDialog({
  document, busy, error, unsaved, onCancel, onConfirm, onRestoreFocus,
}: {
  document: DocumentSummary | null;
  busy: boolean;
  error: string;
  unsaved: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <AlertDialog open={document !== null} onOpenChange={(open) => {
      if (!open && !busy) onCancel();
    }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card p-0"
        aria-busy={busy} onCloseAutoFocus={(event) => {
          event.preventDefault(); onRestoreFocus();
        }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
        <div className="space-y-5 px-6 pt-6">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Trash2 className="size-6" aria-hidden="true" />
          </div>
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle className="text-xl">Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-relaxed">
              A foto e os dados desta tentativa serão removidos definitivamente.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold">
                {document?.tipo_nome ?? "Tentativa de processamento"}
              </p>
              <span className="text-xs text-muted-foreground">Referência {document?.id.slice(0, 8)}</span>
            </div>
          </div>
          <p className="flex gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Tipos cadastrados e cópias já enviadas ao GED serão mantidos.
          </p>
          {unsaved && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Os ajustes não salvos deste documento também serão perdidos.
          </p>}
          {error && <div role="alert" className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>}
        </div>
        <AlertDialogFooter className="border-t border-border bg-muted/40 px-6 py-4">
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => {
            event.preventDefault(); onConfirm();
          }}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Trash2 aria-hidden="true" />}
            {busy ? "Excluindo…" : "Excluir definitivamente"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
