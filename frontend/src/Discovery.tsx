import { useState } from "react";
import { api, message } from "./api";
import { DocumentPhoto } from "./DocumentPhoto";
import { suggestedField, suggestedRows } from "./discoverySuggestions";
import type {
  BBox, Document, Field, Proposal, ProposedColumn, ProposedField, ProposalType,
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

function Suggestion({ field, onFocus }: {
  field: Field | null;
  onFocus: (bbox: BBox) => void;
}) {
  if (!field) return <p className="muted">Sem sugestão para esta configuração.
    Reprocesse os ajustes para extrair este campo.</p>;
  return (
      <div className="suggestion">
        <strong>Valor identificado na foto</strong>
        <span>{field.valor === null ? "Ilegível / ausente (null)" : String(field.valor)}</span>
        <small>Confiança: {Math.round(field.confianca * 100)}% · Não revisado
          {field.flags.length > 0 && ` · ${field.flags.join(", ")}`}</small>
        <button type="button" disabled={!field.bbox} onClick={() => onFocus(field.bbox)}>
          Localizar na foto
        </button>
        <details><summary>Coordenadas na foto</summary>
          <small>{field.bbox ? field.bbox.join(", ") : "Não localizada"}</small>
        </details>
      </div>
    );
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
  const processed = hasProposal(document.proposta) ? document.proposta : null;

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
            <label>Descrição de reconhecimento<textarea className="recognition-description"
              value={proposal.descricao_reconhecimento}
              maxLength={2000} onChange={(event) => update({
                ...proposal, descricao_reconhecimento: event.target.value,
              })} /></label>
            <h3>Campos · {proposal.campos.length}</h3>
            <p className="muted">Os campos e valores abaixo foram montados automaticamente.
              Confira cada rótulo e sua sugestão na foto. Ajustes de chave ou tipo
              precisam ser reprocessados; a revisão dos valores vem depois de salvar o tipo.</p>
            {proposal.campos.map((field, index) => (
              <fieldset key={index}>
                <legend>{field.titulo || `Campo ${index + 1}`}</legend>
                <Suggestion field={processed ? suggestedField(
                  field, [...proposal.campos, ...proposal.tabelas],
                  processed.campos, document.resultado,
                ) : null} onFocus={setBbox} />
                <details className="field-configuration">
                  <summary>Ajustar nome e tipo do campo</summary>
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
                </details>
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
                <legend>{table.titulo || `Tabela ${tableIndex + 1}`}</legend>
                <label>Chave da tabela<input value={table.chave} maxLength={100}
                  onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                    index === tableIndex ? { ...old, chave: event.target.value } : old) })} /></label>
                <label>Rótulo da tabela<input value={table.titulo} maxLength={120}
                  onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                    index === tableIndex ? { ...old, titulo: event.target.value } : old) })} /></label>
                {table.colunas.map((column, columnIndex) => (
                  <fieldset key={columnIndex}>
                    <legend>{column.titulo || `Coluna ${columnIndex + 1}`}</legend>
                    {(() => {
                      const rows = processed
                        ? suggestedRows(table.chave, proposal, processed, document.resultado) : null;
                      const processedColumns = processed?.tabelas
                        .find((item) => item.chave === table.chave)?.colunas ?? [];
                      if (!rows) return <Suggestion field={null} onFocus={setBbox} />;
                      if (!rows.length) return <p className="muted">Nenhuma linha identificada nesta tabela.</p>;
                      return rows.map((row, index) => (
                        <div key={index}>
                          <small>Linha {index + 1}</small>
                          <Suggestion field={suggestedField(
                            column, table.colunas, processedColumns, row,
                          )} onFocus={setBbox} />
                        </div>
                      ));
                    })()}
                    <details className="field-configuration">
                      <summary>Ajustar nome e tipo da coluna</summary>
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
                    </details>
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
        </div>
      </div>
    </section>
  );
}
