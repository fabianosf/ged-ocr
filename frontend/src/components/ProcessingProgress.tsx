import { BrainCircuit, CircleAlert, Clock3, FileScan, LoaderCircle, UserCheck } from "lucide-react";
import type { Document } from "../types";

export const stageMessages: Record<string, string> = {
  preparacao: "Preparando sua foto para leitura.",
  leitura: "Lendo os textos da foto. No primeiro uso, o serviço precisa carregar os modelos.",
  classificacao: "Identificando o tipo de documento com o serviço de inteligência artificial.",
  descoberta: "Identificando os rótulos e tabelas de um documento novo.",
  extracao: "Extraindo os valores dos campos. Aguardando a resposta do serviço de inteligência artificial.",
};

const stages: Record<string, string> = {
  preparacao: "Preparando a foto",
  leitura: "Lendo o documento",
  classificacao: "Identificando o tipo com IA",
  descoberta: "Descobrindo campos com IA",
  extracao: "Extraindo valores com IA",
};

export function ProcessingProgress({ document, compact = false }: {
  document: Pick<Document, "status" | "etapa" | "pode_reprocessar">;
  compact?: boolean;
}) {
  if (document.status !== "pendente" && document.status !== "processando") return null;
  const paused = document.pode_reprocessar;
  const queued = document.status === "pendente";
  const ai = !queued && ["classificacao", "descoberta", "extracao"].includes(document.etapa);
  const label = paused ? "Processamento precisa ser retomado"
    : queued ? "Aguardando na fila" : stages[document.etapa] ?? "Iniciando processamento";
  const Icon = paused ? CircleAlert : queued ? Clock3 : ai ? BrainCircuit : FileScan;
  const phase = queued ? -1 : ai ? 1 : 0;
  return (
    <div className={compact ? "w-full space-y-2" : "rounded-xl border border-primary/20 bg-card p-5"}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className={`size-4 shrink-0 ${paused ? "text-amber-700" : "text-primary"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">{label}</span>
        {!paused && !queued && <LoaderCircle className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />}
      </div>
      <div className={`processing-track ${compact ? "mt-2" : "mt-4"} ${paused ? "paused" : ""}`}
        role="progressbar" aria-label="Processamento do documento"
        aria-valuetext={paused ? label : `${label}. Progresso indeterminado.`}>
        <div className="processing-indicator" />
      </div>
      {!compact && <>
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 mb-0 text-sm text-muted-foreground">
          {paused ? "Sem atualização recente. Use Recuperar processamento para tentar novamente."
            : queued ? "A leitura começará automaticamente quando o worker estiver disponível."
            : stageMessages[document.etapa] ?? "O worker está iniciando a leitura da foto."}
        </p>
        <ol aria-label="Fluxo do documento" className="mt-5 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
          {[
            { label: "Foto e leitura", icon: FileScan },
            { label: "Análise pela IA", icon: BrainCircuit },
            { label: "Revisão humana", icon: UserCheck },
          ].map((item, index) => (
            <li key={item.label} aria-current={phase === index ? "step" : undefined}
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                phase === index ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground"
              }`}>
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <div><span className="font-medium">{item.label}</span>
                <span className="mt-1 block">{index === phase ? paused ? "Interrompido" : "Em andamento"
                  : index === 2 ? "Obrigatória após a extração"
                  : index < phase ? "Etapa anterior" : "A seguir"}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          Atualização automática. A barra indica atividade, não uma porcentagem ou prazo da IA.
          Nenhum valor é aprovado automaticamente.
        </p>
      </>}
    </div>
  );
}
