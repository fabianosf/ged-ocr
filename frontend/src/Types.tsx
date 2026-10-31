import { useEffect, useState } from "react";
import { api, message } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Checkbox } from "./components/ui/checkbox";
import { Badge } from "./components/ui/badge";
import { Notice } from "./components/Notice";
import { ArrowLeft, ArrowRight, Layers3, LoaderCircle, Plus, Save } from "lucide-react";
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
      <Badge variant="secondary" className="mb-2"><Layers3 />Modelos configuráveis</Badge>
      <h2>Tipos de documento</h2>
      <p>JSON Schema define campos, tabelas e validações. Sem regras específicas no código.</p>
      <div className="actions">
        <Button variant="outline" disabled={busy} onClick={() => {
          setSelected(null); setName(""); setDescription(""); setActive(true);
          setSchema(example); setError(""); setSaved("");
        }}><Plus />Novo tipo</Button>
        {types?.results.map((type) => (
          <Button variant={selected === type.id ? "secondary" : "outline"}
            disabled={busy} key={type.id} aria-pressed={selected === type.id} onClick={() => {
            setSelected(type.id); setName(type.nome); setDescription(type.descricao);
            setActive(type.ativo); setSchema(JSON.stringify(type.esquema, null, 2));
            setError(""); setSaved("");
          }}>{type.nome}{!type.ativo && " (inativo)"}</Button>
        ))}
        <Button variant="ghost" disabled={busy || !types?.previous}
          onClick={() => setPage(page - 1)}><ArrowLeft />Anterior</Button>
        <Button variant="ghost" disabled={busy || !types?.next}
          onClick={() => setPage(page + 1)}>Próxima<ArrowRight /></Button>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}>
        <legend>{selected ? "Editar tipo" : "Cadastrar tipo"}</legend>
        <label>Nome<Input required maxLength={120} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>Descrição para detecção<Textarea value={description}
          onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="check mb-4"><Checkbox checked={active}
          onCheckedChange={(checked) => setActive(checked === true)} />Ativo</label>
        <label>Esquema JSON<Textarea className="schema-editor bg-muted font-mono text-xs leading-relaxed" required value={schema}
          onChange={(event) => setSchema(event.target.value)} spellCheck={false} /></label>
        <Button disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Save />}
          Salvar configuração
        </Button>
        </fieldset>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">{saved}</Notice>}
    </section>
  );
}
