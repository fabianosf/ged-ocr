import { useState } from "react";
import { api, message } from "./api";
import { DocumentPhoto } from "./DocumentPhoto";
import type { BBox, Document, Field, Result, Schema, Scalar } from "./types";

function fieldType(schema: Schema): string {
  return Array.isArray(schema.type) ? schema.type.find((type) => type !== "null")! : schema.type;
}

function FieldEditor({ label, schema, field, disabled, onChange, onFocus }: {
  label: string;
  schema: Schema;
  field: Field;
  disabled: boolean;
  onChange: (field: Field) => void;
  onFocus: (bbox: BBox) => void;
}) {
  const type = fieldType(schema);
  const update = (valor: Scalar) => onChange({ ...field, valor, revisado: true });
  return (
    <div className={`field ${field.revisado ? "reviewed" : ""}`}>
      <label>
        <strong>{label}</strong>
        {schema.description && <small>{schema.description}</small>}
        {type === "boolean" ? (
          <select aria-label={label} value={String(field.valor)} disabled={disabled}
            onFocus={() => onFocus(field.bbox)}
            onChange={(event) => update(event.target.value === "null" ? null : event.target.value === "true")}>
            <option value="null">Ilegível / ausente</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        ) : schema.enum ? (
          <select aria-label={label} value={String(schema.enum.indexOf(field.valor))}
            disabled={disabled} onFocus={() => onFocus(field.bbox)}
            onChange={(event) => {
              const option = schema.enum?.[Number(event.target.value)];
              update(option ?? null);
            }}>
            <option value={schema.enum.indexOf(null)}>Ilegível / ausente</option>
            {schema.enum.map((value, index) => value === null ? null : (
              <option key={index} value={index}>{String(value)}</option>
            ))}
          </select>
        ) : (
          <input aria-label={label} type={type === "string" ? "text" : "number"}
            step={type === "integer" ? "1" : "any"} disabled={disabled || field.valor === null}
            value={field.valor === null ? "" : String(field.valor)}
            onFocus={() => onFocus(field.bbox)}
            onChange={(event) => update(type === "string" ? event.target.value
              : event.target.value === "" ? null : Number(event.target.value))} />
        )}
      </label>
      <div className="field-meta">
        <label className="check">
          <input type="checkbox" checked={field.valor === null} disabled={disabled}
            onChange={(event) => update(event.target.checked ? null : (
              type === "string" ? "" : type === "boolean" ? false : 0
            ))} />
          Ilegível / ausente
        </label>
        <label className="check">
          <input type="checkbox" checked={field.revisado} disabled={disabled}
            onChange={(event) => onChange({ ...field, revisado: event.target.checked })} />
          Revisado
        </label>
        <small>Confiança OCR/LLM: {Math.round(field.confianca * 100)}%
          {field.flags.length > 0 && ` · ${field.flags.join(", ")}`}</small>
      </div>
    </div>
  );
}

function emptyRow(schema: Schema): Result {
  return Object.fromEntries(Object.keys(schema.properties ?? {}).map((key) => [key, {
    valor: null, confianca: 0, bbox: null, revisado: false,
    flags: ["preenchido_manual", "ilegivel"],
  }]));
}

function Fields({ schema, result, disabled, onChange, onFocus, onRowsChanged }: {
  schema: Schema;
  result: Result;
  disabled: boolean;
  onChange: (result: Result) => void;
  onFocus: (bbox: BBox) => void;
  onRowsChanged?: (key: string, removedIndex: number | null) => void;
}) {
  return Object.entries(schema.properties ?? {}).map(([key, child]) => {
    const field = result[key];
    const label = child.title ?? key;
    if (Array.isArray(field)) {
      return (
        <fieldset key={key}>
          <legend>{label} · {field.length} linha(s)</legend>
          {field.length === 0 && <p>Nenhuma linha detectada.</p>}
          {child.items && field.map((row, index) => (
            <fieldset key={index}>
              <legend>Linha {index + 1}</legend>
              {!disabled && <button type="button" onClick={() => {
                onChange({ ...result, [key]: field.filter((_, rowIndex) => rowIndex !== index) });
                onRowsChanged?.(key, index);
              }}>Remover linha</button>}
              <Fields schema={child.items!} result={row} disabled={disabled} onFocus={onFocus}
                onChange={(updated) => onChange({
                  ...result, [key]: field.map((item, rowIndex) => rowIndex === index ? updated : item),
                })} />
            </fieldset>
          ))}
          {!disabled && child.items && <button type="button"
            disabled={field.length >= (child.maxItems ?? 200)} onClick={() => {
              onChange({ ...result, [key]: [...field, emptyRow(child.items!)] });
              onRowsChanged?.(key, null);
            }}>Adicionar linha manual</button>}
        </fieldset>
      );
    }
    return <FieldEditor key={key} label={label} schema={child} field={field}
      disabled={disabled} onFocus={onFocus}
      onChange={(updated) => onChange({ ...result, [key]: updated })} />;
  });
}

export function Review({ document, onUpdated, onDirtyChange }: {
  document: Document;
  onUpdated: (document: Document) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [result, setResult] = useState(document.resultado);
  const [rowSources, setRowSources] = useState<Record<string, (number | null)[]>>(
    Object.fromEntries(Object.entries(document.resultado)
      .filter((entry): entry is [string, Result[]] => Array.isArray(entry[1]))
      .map(([key, rows]) => [key, rows.map((_, index) => index)])),
  );
  const [bbox, setBbox] = useState<BBox>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = document.status === "revisao";

  async function perform(action: "revisao" | "aprovar") {
    setBusy(true);
    setError("");
    try {
      const updated = await api<Document>(`documentos/${document.id}/${action}/`, {
        method: action === "revisao" ? "PATCH" : "POST",
        body: JSON.stringify({
          versao: document.versao,
          ...(action === "revisao" ? { resultado: result, linhas: rowSources } : {}),
        }),
      });
      onUpdated(updated);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="review-header">
        <div>
          <h2>{document.tipo_nome ?? "Documento"}</h2>
          <small>Job: {document.id} · {document.status}</small>
        </div>
        {editable && <div className="actions">
          <button disabled={busy || !dirty} onClick={() => void perform("revisao")}>Salvar revisão</button>
          <button className="primary" disabled={busy || dirty}
            onClick={() => void perform("aprovar")}>Aprovar documento</button>
        </div>}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {dirty && <p className="notice">Alterações locais: salve antes de aprovar ou trocar de documento.</p>}
      {document.erros_validacao.length > 0 && (
        <div className="notice" role="status">
          <strong>Validações pendentes (recalculadas ao salvar)</strong>
          <ul>{document.erros_validacao.map((item, index) => (
            <li key={index}>{item.campo || "Documento"}: {item.regra} · {item.mensagem}</li>
          ))}</ul>
        </div>
      )}
      <p className="muted">Confira cada campo na foto. A confiança é uma estimativa, não uma garantia.</p>
      <div className="review-grid">
        <DocumentPhoto jobId={document.id} bbox={bbox} />
        <div>
          <Fields schema={document.esquema} result={result} disabled={busy || !editable}
            onRowsChanged={(key, removedIndex) => setRowSources((current) => ({
              ...current, [key]: removedIndex === null ? [...current[key], null]
                : current[key].filter((_, index) => index !== removedIndex),
            }))}
            onFocus={setBbox} onChange={(updated) => {
              setResult(updated); setDirty(true); onDirtyChange(true);
            }} />
        </div>
      </div>
      {document.status === "aprovado" && (
        <div className={document.ged_status === "erro" ? "error" : "notice"}>
          <strong>{document.ged_status === "enviado" ? "Documento enviado ao GED"
            : document.ged_status === "erro" ? "O envio ao GED precisa de atenção"
            : document.ged_status === "nao_configurado" ? "Documento aprovado e salvo"
            : "Envio ao GED em andamento"}</strong>
          <p>{document.ged_erro_mensagem || (document.ged_status === "nao_configurado"
            ? "Configure a integração para enviar este documento ao GED."
            : document.ged_status === "enviado" ? "O GED confirmou o recebimento."
            : "O documento já está salvo no aplicativo. Aguarde a confirmação do envio.")}</p>
          {document.ged_erro_codigo && <details className="support-details">
            <summary>Detalhes para suporte</summary>
            <p>Referência: {document.correlation_id}</p>
            <p>Código: {document.ged_erro_codigo}</p>
          </details>}
        </div>
      )}
    </section>
  );
}
