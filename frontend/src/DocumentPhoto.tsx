import type { BBox } from "./types";

export function DocumentPhoto({ jobId, bbox }: { jobId: string; bbox: BBox }) {
  return (
    <div className="photo-pane">
      <div className="photo">
        <img src={`/api/documentos/${jobId}/foto/`} alt="Foto do documento para conferência" />
        {bbox && <div className="bbox" style={{
          left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`,
          width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%`,
        }} />}
      </div>
    </div>
  );
}
