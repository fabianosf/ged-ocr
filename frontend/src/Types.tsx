import { useEffect, useState } from "react";
import { api, message } from "./api";
import type { DocumentType, Page } from "./types";

const example = JSON.stringify({
  type: "object", additionalProperties: false, required: ["campo"],
  properties: { campo: { type: ["string", "null"], title: "Campo" } },
}, null, 2);

export function Types() {
  const [types, setTypes] = useState<Page<DocumentType> | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [schema, setSchema] = useState(example);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<Page<DocumentType>>(`tipos/?page=${page}`, { signal: controller.signal })
      .then(setTypes).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [page]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved("");
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(schema);
      const type = await api<DocumentType>(selected ? `tipos/${selected}/` : "tipos/", {
        method: selected ? "PATCH" : "POST",
        body: JSON.stringify({ nome: name, descricao: description, ativo: active, esquema: parsed }),
      });
      setSelected(type.id);
      setTypes(await api<Page<DocumentType>>(`tipos/?page=${page}`));
      setSaved("Configuração salva. Jobs já processados mantêm seu esquema original.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="config">
      <h2>Tipos de documento</h2>
      <p>JSON Schema define campos, tabelas e validações. Sem regras específicas no código.</p>
      <div className="actions">
        <button onClick={() => {
          setSelected(null); setName(""); setDescription(""); setActive(true);
          setSchema(example); setError(""); setSaved("");
        }}>Novo tipo</button>
        {types?.results.map((type) => (
          <button key={type.id} onClick={() => {
            setSelected(type.id); setName(type.nome); setDescription(type.descricao);
            setActive(type.ativo); setSchema(JSON.stringify(type.esquema, null, 2));
            setError(""); setSaved("");
          }}>{type.nome}{!type.ativo && " (inativo)"}</button>
        ))}
        <button disabled={!types?.previous} onClick={() => setPage(page - 1)}>Anterior</button>
        <button disabled={!types?.next} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <label>Nome<input required maxLength={120} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>Descrição para detecção<textarea value={description}
          onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={active}
          onChange={(event) => setActive(event.target.checked)} />Ativo</label>
        <label>Esquema JSON<textarea className="schema-editor" required value={schema}
          onChange={(event) => setSchema(event.target.value)} spellCheck={false} /></label>
        <button className="primary" disabled={busy}>Salvar configuração</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="notice" role="status">{saved}</p>}
    </section>
  );
}
