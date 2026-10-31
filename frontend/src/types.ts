export type Scalar = string | number | boolean | null;
export type BBox = [number, number, number, number] | null;
export interface Field {
  valor: Scalar;
  confianca: number;
  bbox: BBox;
  revisado: boolean;
  flags: string[];
}
export interface Result {
  [key: string]: Field | Result[];
}
export interface Schema {
  type: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: Scalar[];
  required?: string[];
  maxItems?: number;
}
export interface Document {
  id: string;
  correlation_id: string;
  tipo_nome: string | null;
  esquema: Schema;
  resultado: Result;
  erros_validacao: { campo: string; regra: string; mensagem: string }[];
  status: "pendente" | "processando" | "revisao" | "aprovado" | "erro";
  erro_codigo: string;
  versao: number;
  criado_em: string;
  ged_status: string;
  ged_erro_codigo: string;
}
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
export interface Session {
  autenticado: boolean;
  admin: boolean;
  csrfToken: string;
}
export interface DocumentType {
  id: number;
  nome: string;
  descricao: string;
  ativo: boolean;
  esquema: Schema;
}
