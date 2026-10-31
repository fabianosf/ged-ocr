import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

export function useConfirmation() {
  const [description, setDescription] = useState<string | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => () => { pending.current?.(false); }, []);

  function finish(confirmed: boolean) {
    pending.current?.(confirmed);
    pending.current = null;
    setDescription(null);
  }

  function confirm(message: string): Promise<boolean> {
    if (pending.current) return Promise.resolve(false);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDescription(message);
    return new Promise((resolve) => { pending.current = resolve; });
  }

  const dialog = (
    <AlertDialog open={description !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialogContent onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }}>
        <AlertDialogHeader className="place-items-start text-left">
          <CircleAlert className="mb-2 size-8 text-amber-700" aria-hidden="true" />
          <AlertDialogTitle>Descartar ajustes não salvos?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>Continuar editando</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => finish(true)}>Descartar ajustes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}
