import type { Field, Proposal, ProposedColumn, Result } from "./types.ts";

export function suggestedField(
  column: ProposedColumn,
  columns: { chave: string }[],
  processedColumns: ProposedColumn[],
  result: Result,
): Field | null {
  if (columns.filter((item) => item.chave === column.chave).length !== 1) return null;
  const processed = processedColumns.find((item) => item.chave === column.chave);
  const field = result[column.chave];
  if (!processed || processed.tipo !== column.tipo || !field || Array.isArray(field)) return null;
  return field;
}

export function suggestedRows(
  tableKey: string, proposal: Proposal, processed: Proposal, result: Result,
): Result[] | null {
  const keys = [...proposal.campos, ...proposal.tabelas].filter((item) => item.chave === tableKey);
  const rows = result[tableKey];
  if (keys.length !== 1 || !processed.tabelas.some((item) => item.chave === tableKey)
      || !Array.isArray(rows)) return null;
  return rows;
}
