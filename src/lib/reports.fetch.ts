// Descarga completa de informes: pide todas las páginas al servidor (no solo la visible).
import { supabase } from "@/integrations/supabase/client";
import { fetchCatalogPage, type CatalogFilters } from "@/lib/catalog";
import { downloadCsv, downloadXlsx, fileStamp } from "@/lib/files";
import { buildReportTable, type ExportRow, type ReportKind, type ReportPage } from "@/lib/reports";

const PAGE = 500;

export async function fetchReport(
  kind: ReportKind,
  includeCosts: boolean,
  ids?: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ rows: ExportRow[]; attributeNames: string[] }> {
  const rows: ExportRow[] = [];
  let attributeNames: string[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const { data, error } = await supabase.rpc("export_report", {
      _kind: kind,
      ...(ids ? { _ids: ids } : {}),
      _include_costs: includeCosts,
      _offset: offset,
      _limit: PAGE,
    });
    if (error) throw error;
    const page = data as unknown as ReportPage;
    total = page.total;
    if (page.attribute_names) attributeNames = page.attribute_names;
    rows.push(...page.rows);
    offset += PAGE;
    onProgress?.(Math.min(rows.length, total), total);
    if (page.rows.length === 0) break;
  }
  return { rows, attributeNames };
}

/** Todos los id que cumplen los filtros del inventario (en páginas de 100, varias a la vez). */
export async function fetchFilteredIds(
  filters: CatalogFilters,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const pageSize = 100;
  const run = (pagina: number) => fetchCatalogPage({ ...filters, pagina }, pageSize);
  const first = await run(1);
  const pages = Math.ceil(first.total / pageSize);
  const out: string[][] = [first.rows.map((r) => r.id)];
  onProgress?.(first.rows.length, first.total);
  let done = first.rows.length;
  for (let p = 2; p <= pages; p += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - p + 1) }, (_, i) => run(p + i)),
    );
    for (const b of batch) {
      out.push(b.rows.map((r) => r.id));
      done += b.rows.length;
    }
    onProgress?.(done, first.total);
  }
  return Array.from(new Set(out.flat()));
}

export async function exportReport(opts: {
  kind: ReportKind;
  format: "csv" | "xlsx";
  includeCosts: boolean;
  fileBase: string;
  title: string;
  qrUrlFor: (id: string) => string;
  ids?: string[];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const { rows, attributeNames } = await fetchReport(
    opts.kind,
    opts.includeCosts,
    opts.ids,
    opts.onProgress,
  );
  const table = buildReportTable(rows, {
    kind: opts.kind,
    includeCosts: opts.includeCosts,
    attributeNames,
    qrUrlFor: opts.qrUrlFor,
  });
  const name = `aly-${opts.fileBase}${opts.includeCosts ? "-con-costos" : ""}-${fileStamp()}`;
  if (opts.format === "csv") downloadCsv(table, `${name}.csv`);
  else await downloadXlsx([{ name: opts.title, ...table }], `${name}.xlsx`);
  return rows.length;
}
