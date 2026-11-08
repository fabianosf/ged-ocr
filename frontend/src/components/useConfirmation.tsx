import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

type ConfirmOptions = {
  title?: string;
  cancel?: string;
  action?: string;
  destructive?: boolean;
};

const unsaved: Required<ConfirmOptions> = {
  title: "Descartar ajustes não salvos?",
  cancel: "Continuar editando",
  action: "Descartar ajustes",
  destructive: true,
};

export function useConfirmation() {
  const [prompt, setPrompt] = useState<(Required<ConfirmOptions> & { description: string }) | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => () => { pending.current?.(false); }, []);

  function finish(confirmed: boolean) {
    pending.current?.(confirmed);
    pending.current = null;
    setPrompt(null);
  }

  function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    if (pending.current) return Promise.resolve(false);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPrompt({ description: message, ...unsaved, ...options });
    return new Promise((resolve) => { pending.current = resolve; });
  }

  const dialog = (
    <AlertDialog open={prompt !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialogContent onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }}>
        <AlertDialogHeader className="place-items-start text-left">
          <CircleAlert className="mb-2 size-8 text-amber-700" aria-hidden="true" />
          <AlertDialogTitle>{prompt?.title}</AlertDialogTitle>
          <AlertDialogDescription>{prompt?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>{prompt?.cancel}</AlertDialogCancel>
          <AlertDialogAction variant={prompt?.destructive ? "destructive" : "default"}
            onClick={() => finish(true)}>{prompt?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}
