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
  status: "pendente" | "processando" | "revisao_tipo" | "revisao" | "aprovado" | "erro";
  erro_codigo: string;
  erro_mensagem: string;
  etapa: string;
  proposta: Proposal | Record<string, never>;
  proposta_original: Proposal | Record<string, never>;
  esquema_provisorio: Schema;
  pode_aprovar_tipo: boolean;
  pode_reprocessar: boolean;
  pode_reenviar_ged: boolean;
  versao: number;
  criado_em: string;
  atualizado_em: string;
  ged_status: string;
  ged_erro_codigo: string;
  ged_erro_mensagem: string;
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
  pode_criar_tipo: boolean;
  llm_configurado: boolean;
}
export type ProposalType = "texto" | "numero" | "inteiro" | "data" | "booleano";
export interface ProposedColumn {
  chave: string;
  titulo: string;
  tipo: ProposalType;
}
export interface ProposedField extends ProposedColumn {
  obrigatorio: boolean;
}
export interface ProposedTable {
  chave: string;
  titulo: string;
  colunas: ProposedColumn[];
}
export interface Proposal {
  nome_sugerido: string;
  descricao_reconhecimento: string;
  campos: ProposedField[];
  tabelas: ProposedTable[];
}
export interface DocumentType {
  id: number;
  nome: string;
  descricao: string;
  ativo: boolean;
  esquema: Schema;
}
