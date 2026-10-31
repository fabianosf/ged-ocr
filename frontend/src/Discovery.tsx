import { useState } from "react";
import { api, message } from "./api";
import { DocumentPhoto } from "./DocumentPhoto";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { NativeSelect } from "./components/ui/native-select";
import { Checkbox } from "./components/ui/checkbox";
import { Badge } from "./components/ui/badge";
import { Notice } from "./components/Notice";
import { useConfirmation } from "./components/useConfirmation";
import { FilePlus2, Plus, RotateCw, Save, Trash2 } from "lucide-react";
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
        <Input value={column.chave} maxLength={100} disabled={disabled}
          onChange={(event) => onChange({ ...column, chave: event.target.value })} />
      </label>
      <label>Rótulo visível
        <Input value={column.titulo} maxLength={120} disabled={disabled}
          onChange={(event) => onChange({ ...column, titulo: event.target.value })} />
      </label>
      <label>Tipo de dado
        <NativeSelect value={column.tipo} disabled={disabled} onChange={(event) => {
          const type = dataTypes.find((value) => value === event.target.value);
          if (type) onChange({ ...column, tipo: type });
        }}>
          {dataTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </NativeSelect>
      </label>
      <Button variant="ghost" className="text-destructive" type="button" disabled={disabled}
        onClick={onRemove}><Trash2 />Remover</Button>
    </div>
  );
}

function Suggestion({ field, onFocus, compact = false, selected }: {
  field: Field | null;
  onFocus: (bbox: BBox) => void;
  compact?: boolean;
  selected: BBox;
}) {
  if (!field) return <p className="muted">Sem sugestão para esta configuração.
    Reprocesse os ajustes para extrair este campo.</p>;
  return (
    <div className={`suggestion ${compact ? "compact" : ""} ${
      field.bbox && selected === field.bbox ? "selected-field" : ""
    }`}>
      {!compact && <strong>Valor identificado na foto</strong>}
      <Button variant="outline" className="suggested-value h-auto min-h-9 justify-start whitespace-normal"
        type="button" disabled={!field.bbox}
        aria-label={`Localizar na foto: ${field.valor === null ? "Ilegível / ausente" : String(field.valor)}`}
        aria-pressed={!!field.bbox && selected === field.bbox}
        onFocus={() => onFocus(field.bbox)} onClick={() => onFocus(field.bbox)}>
        {field.valor === null ? "Ilegível / ausente (null)" : String(field.valor)}
      </Button>
      <small>Confiança: {Math.round(field.confianca * 100)}% · Não revisado
        {field.flags.length > 0 && ` · ${field.flags.join(", ")}`}</small>
      {!field.bbox && <small>Sem localização na foto.</small>}
      {!compact && <details><summary>Coordenadas na foto</summary>
        <small>{field.bbox ? field.bbox.join(", ") : "Não localizada"}</small>
      </details>}
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
  const confirmation = useConfirmation();

  function update(value: Proposal) {
    setProposal(value); setBbox(null); setDirty(true); onDirtyChange(true);
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
    if (dirty && !await confirmation.confirm("Os ajustes locais serão descartados ao atualizar o documento.")) return;
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
    <section className="workspace-panel">
      <header className="review-header">
        <div><Badge variant="secondary" className="mb-2"><FilePlus2 />Descoberta de documento</Badge>
          <h2>Documento novo</h2><small>Job: {document.id} · versão {document.versao}</small></div>
        <div className="actions">
          <Button variant="outline" className="h-auto whitespace-normal" disabled={busy}
            onClick={() => void perform("definir-tipo")}>
            <RotateCw />Reprocessar com ajustes
          </Button>
          <Button className="h-auto whitespace-normal" disabled={busy || dirty || !document.pode_aprovar_tipo}
            onClick={() => void perform("aprovar-tipo")}>
            <Save />Salvar como novo tipo e continuar revisão
          </Button>
        </div>
      </header>
      <Notice>Confira a estrutura na foto. Use somente rótulos visíveis, inclusive
        campos vazios. Não cadastre valores pessoais na descrição de reconhecimento.
        Salvar o tipo não aprova os valores: a revisão humana continuará obrigatória.</Notice>
      {!document.pode_aprovar_tipo && <Notice tone="warning">
        Você pode ajustar a proposta. Para criar o tipo, solicite aprovação à equipe
        ou a permissão de adicionar tipos de documento.
      </Notice>}
      {dirty && <Notice tone="warning">Ajustes não processados. Reprocesse antes de salvar o tipo.</Notice>}
      {error && <Notice tone="error">
        <p>{error}</p><Button variant="outline" disabled={busy}
          onClick={() => void refresh()}><RotateCw />Atualizar job</Button>
      </Notice>}
      <div className="review-grid">
        <DocumentPhoto jobId={document.id} bbox={bbox} />
        <div>
          <fieldset disabled={busy}>
            <legend>Proposta de estrutura</legend>
            <label>Nome sugerido<Input value={proposal.nome_sugerido} maxLength={120}
              onChange={(event) => update({ ...proposal, nome_sugerido: event.target.value })} /></label>
            <label>Descrição de reconhecimento<Textarea className="recognition-description"
              value={proposal.descricao_reconhecimento}
              maxLength={2000} onChange={(event) => update({
                ...proposal, descricao_reconhecimento: event.target.value,
              })} /></label>
            <h3>Campos · {proposal.campos.length}</h3>
            <p className="muted">Os campos e valores abaixo foram montados automaticamente.
              Clique em um valor para destacar sua posição na foto. Ajustes de chave ou tipo
              precisam ser reprocessados; a revisão dos valores vem depois de salvar o tipo.</p>
            {proposal.campos.map((field, index) => (
              <fieldset key={index}>
                <legend>{field.titulo || `Campo ${index + 1}`}</legend>
                <Suggestion field={processed ? suggestedField(
                  field, [...proposal.campos, ...proposal.tabelas],
                  processed.campos, document.resultado,
                ) : null} onFocus={setBbox} selected={bbox} />
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
                <label className="check"><Checkbox checked={field.obrigatorio}
                  onCheckedChange={(checked) => {
                    const updated: ProposedField = { ...field, obrigatorio: checked === true };
                    update({ ...proposal, campos: proposal.campos.map((old, itemIndex) =>
                      itemIndex === index ? updated : old) });
                  }} />Obrigatório (impede aprovação se null)</label>
                </details>
              </fieldset>
            ))}
            <Button variant="outline" type="button" disabled={rootKeys.length >= 100} onClick={() => update({
              ...proposal, campos: [...proposal.campos, {
                chave: newKey(rootKeys, "campo"), titulo: "", tipo: "texto", obrigatorio: false,
              }],
            })}><Plus />Adicionar campo visível</Button>
            <h3>Tabelas · {proposal.tabelas.length}</h3>
            {proposal.tabelas.map((table, tableIndex) => {
              const rows = processed
                ? suggestedRows(table.chave, proposal, processed, document.resultado) : null;
              const processedColumns = processed?.tabelas
                .find((item) => item.chave === table.chave)?.colunas ?? [];
              return (
              <fieldset key={tableIndex}>
                <legend>{table.titulo || `Tabela ${tableIndex + 1}`}</legend>
                <details className="field-configuration">
                  <summary>Ajustar nome da tabela</summary>
                  <label>Chave da tabela<Input value={table.chave} maxLength={100}
                    onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                      index === tableIndex ? { ...old, chave: event.target.value } : old) })} /></label>
                  <label>Rótulo da tabela<Input value={table.titulo} maxLength={120}
                    onChange={(event) => update({ ...proposal, tabelas: proposal.tabelas.map((old, index) =>
                      index === tableIndex ? { ...old, titulo: event.target.value } : old) })} /></label>
                </details>
                <div className="table-scroll" role="region" aria-label={`Tabela: ${table.titulo}`}
                  tabIndex={0}>
                  <table className="document-table">
                    <caption>{table.titulo || `Tabela ${tableIndex + 1}`} · {rows?.length ?? 0} linha(s).
                      Role para os lados para conferir todas as colunas.</caption>
                    <thead><tr><th scope="col">Linha</th>
                      {table.colunas.map((column, columnIndex) => (
                        <th scope="col" key={columnIndex}>
                          {column.titulo || `Coluna ${columnIndex + 1}`}
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
                        </th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {rows?.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <th scope="row">{rowIndex + 1}</th>
                          {table.colunas.map((column, columnIndex) => (
                            <td key={columnIndex}><Suggestion compact selected={bbox}
                              field={suggestedField(column, table.colunas, processedColumns, row)}
                              onFocus={setBbox} /></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows && <p className="muted">Sem sugestões para esta tabela.
                  Reprocesse os ajustes para extrair as linhas.</p>}
                {rows?.length === 0 && <p className="muted">Nenhuma linha identificada nesta tabela.</p>}
                <div className="actions">
                  <Button variant="outline" type="button" disabled={table.colunas.length >= 100} onClick={() => update({
                    ...proposal, tabelas: proposal.tabelas.map((old, index) => index === tableIndex
                      ? { ...old, colunas: [...old.colunas, {
                        chave: newKey(old.colunas.map((item) => item.chave), "coluna"),
                        titulo: "", tipo: "texto",
                      }] } : old),
                  })}><Plus />Adicionar coluna visível</Button>
                  <Button variant="ghost" className="text-destructive" type="button" onClick={() => update({
                    ...proposal, tabelas: proposal.tabelas.filter((_, index) => index !== tableIndex),
                  })}><Trash2 />Remover tabela</Button>
                </div>
              </fieldset>
              );
            })}
            <Button variant="outline" type="button" disabled={rootKeys.length >= 100} onClick={() => update({
              ...proposal, tabelas: [...proposal.tabelas, {
                chave: newKey(rootKeys, "tabela"), titulo: "",
                colunas: [{ chave: "coluna_1", titulo: "", tipo: "texto" }],
              }],
            })}><Plus />Adicionar tabela visível</Button>
          </fieldset>
        </div>
      </div>
      {confirmation.dialog}
    </section>
  );
}
