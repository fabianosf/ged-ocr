import { useEffect, useRef } from "react";
import type { BBox } from "./types";
import { ScanLine } from "lucide-react";

export function DocumentPhoto({ jobId, bbox }: { jobId: string; bbox: BBox }) {
  const highlight = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight.current && pane.current) {
      pane.current.scrollTo({
        top: Math.max(0, highlight.current.offsetTop + (highlight.current.parentElement?.offsetTop ?? 0)
          - pane.current.clientHeight / 2),
      });
    }
  }, [bbox]);
  return (
    <div ref={pane} className="photo-pane">
      <div className="photo-toolbar"><ScanLine className="size-4" aria-hidden="true" />
        <span>Documento original</span>
        <span className="ml-auto">{bbox ? "Campo localizado" : "Selecione um campo"}</span>
      </div>
      <div className="photo">
        <img src={`/api/documentos/${jobId}/foto/`} alt="Foto do documento para conferência" />
        {bbox && <div ref={highlight} className="bbox" role="img" aria-label="Área do campo selecionado"
          style={{
          left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`,
          width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%`,
        }} />}
      </div>
    </div>
  );
}
