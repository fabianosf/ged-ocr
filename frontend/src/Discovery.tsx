import { useState } from "react";
import { api, message } from "./api";
import { DocumentPhoto } from "./DocumentPhoto";
import type {
  BBox, Document, Proposal, ProposedColumn, ProposedField, ProposalType, Result, Schema,
} from "./types";

const dataTypes: ProposalType[] = ["texto", "numero", "inteiro", "data", "booleano"];

function hasProposal(value: Document["proposta"]): value is Proposal {
  return typeof value.nome_sugerido === "string"
    && typeof value.descricao_reconhecimento === "string"
    && Array.isArray(value.campos) && Array.isArray(value.tabelas);
}

function newKey(keys: string[], prefix: string): string {
  let index = 1;
  while (keys.includes(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

function ColumnEditor({ column, disabled, onChange, onRemove }: {
  column: ProposedColumn;
  disabled: boolean;
  onChange: (column: ProposedColumn) => void;
  onRemove: () => void;
}) {
  return (
    <div className="proposal-column">
      <label>Chave (snake_case)
        <input value={column.chave} maxLength={100} disabled={disabled}
          onChange={(event) => onChange({ ...column, chave: event.target.value })} />
      </label>
      <label>Rótulo visível
        <input value={column.titulo} maxLength={120} disabled={disabled}
          onChange={(event) => onChange({ ...column, titulo: event.target.value })} />
      </label>
      <label>Tipo de dado
        <select value={column.tipo} disabled={disabled} onChange={(event) => {
          const type = dataTypes.find((value) => value === event.target.value);
          if (type) onChange({ ...column, tipo: type });
        }}>
          {dataTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <button type="button" disabled={disabled} onClick={onRemove}>Remover</button>
    </div>
  );
}

function Suggestions({ result, schema, onFocus }: {
  result: Result;
  schema: Schema;
  onFocus: (bbox: BBox) => void;
}) {
  return Object.entries(result).map(([key, field]) => {
    const child = schema.properties?.[key];
    if (Array.isArray(field)) {
      return (
        <fieldset key={key}>
          <legend>{child?.title ?? key}</legend>
          {!field.length && <p>Nenhuma linha detectada.</p>}
          {child?.items && field.map((row, index) => (
            <fieldset key={index}>
              <legend>Linha {index + 1}</legend>
              <Suggestions result={row} schema={child.items!} onFocus={onFocus} />
            </fieldset>
          ))}
        </fieldset>
      );
    }
    return (
      <div className="suggestion" key={key}>
        <strong>{child?.title ?? key}</strong>
        <span>{field.valor === null ? "Ilegível / ausente (null)" : String(field.valor)}</span>
        <small>Confiança: {Math.round(field.confianca * 100)}% · Não revisado
          {field.flags.length > 0 && ` · ${field.flags.join(", ")}`}</small>
        <small>bbox: {field.bbox ? field.bbox.join(", ") : "não localizada"}</small>
        <button type="button" disabled={!field.bbox} onClick={() => onFocus(field.bbox)}>
          Localizar na foto
        </button>
      </div>
    );
  });
}

export function Discovery({ document, onUpdated, onDirtyChange }: {
  document: Document;
  onUpdated: (document: Document) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(
    hasProposal(document.proposta) ? document.proposta : null,
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bbox, setBbox] = useState<BBox>(null);

  function update(value: Proposal) {
    setProposal(value); setDirty(true); onDirtyChange(true);
  }

  async function perform(action: "definir-tipo" | "aprovar-tipo") {
    setBusy(true); setError("");
    try {
      const updated = await api<Document>(`documentos/${document.id}/${action}/`, {
        method: "POST",
        body: JSON.stringify({
          versao: document.versao, ...(action === "definir-tipo" ? { proposta: proposal } : {}),
        }),
      });
      onUpdated(updated);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function refresh() {
    if (dirty && !window.confirm("Descartar os ajustes locais e atualizar o job?")) return;
    setBusy(true); setError("");
    try {
      const updated = await api<Document>(`documentos/${document.id}/`);
      setProposal(hasProposal(updated.proposta) ? updated.proposta : null);
      setDirty(false);
      setBbox(null);
      onDirtyChange(false);
      onUpdated(updated);
    }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  if (!proposal) return <p className="error" role="alert">Proposta de descoberta indisponível.</p>;

  const rootKeys = [...proposal.campos, ...proposal.tabelas].map((item) => item.chave);
  return (
    <section>
      <header className="review-header">
        <div><h2>Documento novo</h2><small>Job: {document.id} · versão {document.versao}</small></div>
        <div className="actions">
          <button disabled={busy} onClick={() => void perform("definir-tipo")}>
            Reprocessar com ajustes
          </button>
          <button className="primary" disabled={busy || dirty || !document.pode_aprovar_tipo}
            onClick={() => void perform("aprovar-tipo")}>
            Salvar como novo tipo e continuar revisão
          </button>
        </div>
      </header>
      <p className="notice">Confira a estrutura na foto. Use somente rótulos visíveis, inclusive
        campos vazios. Não cadastre valores pessoais na descrição de reconhecimento.
        Salvar o tipo não aprova os valores: a revisão humana continuará obrigatória.</p>
      {!document.pode_aprovar_tipo && <p className="notice">
        Você pode ajustar a proposta. Para criar o tipo, solicite aprovação à equipe
        ou a permissão de adicionar tipos de documento.
      </p>}
      {dirty && <p className="notice">Ajustes não processados. Reprocesse antes de salvar o tipo.</p>}
      {error && <div className="error" role="alert">
        <p>{error}</p><button disabled={busy} onClick={() => void refresh()}>Atualizar job</button>
      </div>}
      <div className="review-grid">
        <DocumentPhoto jobId={document.id} bbox={bbox} />
        <div>
          <fieldset disabled={busy}>
            <legend>Proposta de estrutura</legend>
            <label>Nome sugerido<input value={proposal.nome_sugerido} maxLength={120}
              onChange={(event) => update({ ...proposal, nome_sugerido: event.target.value })} /></label>
            <label>Descrição de reconhecimento<textarea value={proposal.descricao_reconhecimento}
              maxLength={2000} onChange={(event) => update({
                ...proposal, descricao_reconhecimento: event.target.value,
              })} /></label>
            <h3>Campos · {proposal.campos.length}</h3>
            {proposal.campos.map((field, index) => (
              <fieldset key={index}>
                <legend>Campo {index + 1}</legend>
                <ColumnEditor column={field} disabled={busy}
                  onChange={(column) => update({
                    ...proposal, campos: proposal.campos.map((old, itemIndex) => itemIndex === index
                      ? { ...column, obrigatorio: old.obrigatorio } : old),
                  })}
                  onRemove={() => update({
                    ...proposal, campos: proposal.campos.filter((_, itemIndex) => itemIndex !== index),
                  })} />
                <label className="check"><input type="checkbox" checked={field.obrigatorio}
                  onChange={(event) => {
                    const updated: ProposedField = { ...field, obrigatorio: event.target.checked };
                    update({ ...proposal, campos: proposal.campos.map((old, itemIndex) =>
                      itemIndex === index ? updated : old) });
                  }} />Obrigatório (impede aprovação se null)</label>
              </fieldset>
            ))}
            <button type="button" disabled={rootKeys.length >= 100} onClick={() => update({
              ...proposal, campos: [...proposal.campos, {
                chave: newKey(rootKeys, "campo"), titulo: "", tipo: "texto", obrigatorio: false,
              }],
            })}>Adicionar campo visível</button>
            <h3>Tabelas · {proposal.tabelas.length}</h3>
            {proposal.tabelas.map((table, tableIndex) => (
              <fieldset key={tableIndex}>
                <legend>Tabela {tableIndex + 1}</legend>
                <label>Chave da tabela<input value={table.chave} maxLength={100}
                  onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                    index === tableIndex ? { ...old, chave: event.target.value } : old) })} /></label>
                <label>Rótulo da tabela<input value={table.titulo} maxLength={120}
                  onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                    index === tableIndex ? { ...old, titulo: event.target.value } : old) })} /></label>
                {table.colunas.map((column, columnIndex) => (
                  <fieldset key={columnIndex}>
                    <legend>Coluna {columnIndex + 1}</legend>
                    <ColumnEditor column={column} disabled={busy}
                      onChange={(updated) => update({
                        ...proposal, tabelas: proposal.tabelas.map((old, index) => index === tableIndex
                          ? { ...old, colunas: old.colunas.map((item, colIndex) =>
                            colIndex === columnIndex ? updated : item) } : old),
                      })}
                      onRemove={() => update({
                        ...proposal, tabelas: proposal.tabelas.map((old, index) => index === tableIndex
                          ? { ...old, colunas: old.colunas.filter((_, colIndex) =>
                            colIndex !== columnIndex) } : old),
                      })} />
                  </fieldset>
                ))}
                <div className="actions">
                  <button type="button" disabled={table.colunas.length >= 100} onClick={() => update({
                    ...proposal, tabelas: proposal.tabelas.map((old, index) => index === tableIndex
                      ? { ...old, colunas: [...old.colunas, {
                        chave: newKey(old.colunas.map((item) => item.chave), "coluna"),
                        titulo: "", tipo: "texto",
                      }] } : old),
                  })}>Adicionar coluna visível</button>
                  <button type="button" onClick={() => update({
                    ...proposal, tabelas: proposal.tabelas.filter((_, index) => index !== tableIndex),
                  })}>Remover tabela</button>
                </div>
              </fieldset>
            ))}
            <button type="button" disabled={rootKeys.length >= 100} onClick={() => update({
              ...proposal, tabelas: [...proposal.tabelas, {
                chave: newKey(rootKeys, "tabela"), titulo: "",
                colunas: [{ chave: "coluna_1", titulo: "", tipo: "texto" }],
              }],
            })}>Adicionar tabela visível</button>
          </fieldset>
          <h3>Valores sugeridos da última extração</h3>
          <p className="muted">Os rótulos e valores abaixo pertencem ao esquema já processado,
            não aos ajustes locais. Reprocesse para atualizar. Confiança não garante legibilidade.</p>
          <Suggestions result={document.resultado} schema={document.esquema} onFocus={setBbox} />
        </div>
      </div>
    </section>
  );
}
