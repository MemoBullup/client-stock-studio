// Archivos CSV (UTF-8) y XLSX para informes e importación. Funciona en el navegador.

export type CellValue = string | number | boolean | Date | null | undefined;
export interface TableData {
  headers: string[];
  rows: CellValue[][];
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** CSV UTF-8 con BOM (Excel lo abre con acentos correctos), separador coma y comillas RFC 4180. */
export function toCsv(table: TableData): string {
  const esc = (v: CellValue) => {
    const t = cellText(v);
    return /[",\n\r;]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [table.headers.map(esc).join(","), ...table.rows.map((r) => r.map(esc).join(","))];
  return "\uFEFF" + lines.join("\r\n");
}

/** Lee CSV con coma, punto y coma o tabulador (se detecta en la primera línea). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return trimTrailingBlank(rows);
}

/** Quita filas vacías al final, pero conserva las intermedias para que el número de fila coincida con el archivo. */
function trimTrailingBlank(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.every((c) => c.trim() === "")) end--;
  return rows.slice(0, end);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(table: TableData, fileName: string) {
  downloadBlob(new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" }), fileName);
}

export interface XlsxSheet extends TableData {
  name: string;
  widths?: number[];
}

/** XLSX con encabezados en negritas y la primera fila fija. */
export async function downloadXlsx(sheets: XlsxSheet[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const toCell = (v: CellValue) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return { value: v, type: Number };
    if (typeof v === "boolean") return { value: v ? "Sí" : "No", type: String };
    if (v instanceof Date) return { value: v, type: Date, format: "dd/mm/yyyy hh:mm" };
    return { value: String(v), type: String };
  };
  const built = sheets.map((s) => ({
    sheet: s.name.slice(0, 31),
    stickyRowsCount: 1,
    columns: s.headers.map((h, i) => ({
      width: s.widths?.[i] ?? Math.min(48, Math.max(10, h.length + 2)),
    })),
    data: [
      s.headers.map((h) => ({ value: h, type: String, fontWeight: "bold" as const })),
      ...s.rows.map((r) => r.map(toCell)),
    ],
  }));
  // La biblioteca acepta varias hojas; los tipos de celda se validan en tiempo de ejecución.
  await writeXlsxFile(built as never).toFile(fileName);
}

/** Lee la primera hoja de un XLSX o un CSV como matriz de texto. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  if (!name.endsWith(".xlsx")) throw new Error("Usa un archivo .xlsx (Excel) o .csv");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const first = sheets[0];
  if (!first) return [];
  const matrix = first.data.map((r) =>
    r.map((c) => {
      if (c === null || c === undefined) return "";
      if (c instanceof Date) return c.toISOString().slice(0, 10);
      return String(c);
    }),
  );
  return trimTrailingBlank(matrix);
}

/** Fecha corta para nombres de archivo: 2026-11-04 */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
