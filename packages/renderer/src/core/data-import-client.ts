import type { ClusterDataImportColumn, ClusterDataImportFormat, ClusterDataImportSchema, ClusterDataScalar } from "@cluster/shared";

export type ParsedClusterImport = {
  format: ClusterDataImportFormat;
  columns: ClusterDataImportColumn[];
  rows: Record<string, ClusterDataScalar>[];
  workbook?: {
    worksheets: Array<{ name: string; path: string }>;
    selectedWorksheet: string;
    sourceRows: number;
    formulaCells: number;
    truncated: boolean;
  };
};

function scalar(value: unknown): ClusterDataScalar {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as ClusterDataScalar;
  return JSON.stringify(value);
}

export function parseClusterCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim().length));
  const headers = (nonEmpty.shift() || []).map((value, index) => value.trim() || `Column ${index + 1}`);
  return { headers, rows: nonEmpty.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))) };
}

function parseClusterJson(text: string): ParsedClusterImport {
  const parsed = JSON.parse(text);
  const rawRows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null;
  if (!rawRows) throw new Error("JSON imports must contain an array of row objects, or an object with a rows array.");
  const rows = rawRows.slice(0, 1000).map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each JSON import row must be an object.");
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([key, value]) => [key, scalar(value)]));
  });
  const headers: string[] = Array.from(new Set<string>(rows.flatMap((row: Record<string, ClusterDataScalar>) => Object.keys(row))));
  return { format: "json", columns: headers.map((source) => ({ source, fieldId: null })), rows };
}

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress Excel workbooks. Use CSV/JSON or a current Cluster Desktop/Web client.");
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (u32(view, offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new Error("The Excel workbook ZIP directory could not be found.");
  const entryCount = u16(view, eocd + 10);
  let cursor = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error("The Excel workbook directory is malformed.");
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const fileNameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const fileName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength)).replace(/\\/g, "/");
    if (u32(view, localOffset) !== 0x04034b50) throw new Error("The Excel workbook contains an invalid local ZIP entry.");
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (!fileName.endsWith("/")) {
      if (method === 0) entries.set(fileName, new Uint8Array(compressed));
      else if (method === 8) entries.set(fileName, await inflateRaw(compressed));
      else throw new Error(`Excel workbook compression method ${method} is not supported.`);
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlDocument(bytes: Uint8Array | undefined, label: string) {
  if (!bytes) throw new Error(`Excel workbook is missing ${label}.`);
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`Excel workbook ${label} XML is invalid.`);
  return document;
}

function childrenByLocalName(node: ParentNode, name: string) {
  return [...node.querySelectorAll("*")].filter((element) => element.localName === name);
}

function firstChildByLocalName(node: ParentNode, name: string) {
  return childrenByLocalName(node, name)[0] || null;
}

function columnIndex(cellReference: string) {
  const letters = cellReference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function excelSerialDate(serial: number) {
  const milliseconds = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function xlsxDateStyleIndexes(entries: Map<string, Uint8Array>) {
  const bytes = entries.get("xl/styles.xml");
  if (!bytes) return new Set<number>();
  const doc = xmlDocument(bytes, "styles");
  const custom = new Map<number, string>();
  for (const fmt of childrenByLocalName(doc, "numFmt")) {
    const id = Number(fmt.getAttribute("numFmtId"));
    if (Number.isFinite(id)) custom.set(id, fmt.getAttribute("formatCode") || "");
  }
  const builtin = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const dateStyles = new Set<number>();
  const cellXfs = childrenByLocalName(doc, "cellXfs")[0];
  if (!cellXfs) return dateStyles;
  [...cellXfs.children].forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute("numFmtId") || 0);
    const code = custom.get(numFmtId)?.replace(/"[^"]*"|\\./g, "") || "";
    if (builtin.has(numFmtId) || /[ymdhis]/i.test(code)) dateStyles.add(index);
  });
  return dateStyles;
}

function normalizeWorkbookPartPath(target: string) {
  const candidate = target.replace(/\\/g, "/").trim();
  const rooted = candidate.startsWith("/") ? candidate.slice(1) : candidate.startsWith("xl/") ? candidate : `xl/${candidate}`;
  const parts: string[] = [];
  for (const part of rooted.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Excel workbook contains an invalid worksheet relationship path.");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = parts.join("/");
  if (!normalized.startsWith("xl/") || !normalized.toLowerCase().endsWith(".xml")) throw new Error("Excel workbook contains an unsupported worksheet relationship path.");
  return normalized;
}

function workbookSheets(entries: Map<string, Uint8Array>) {
  const workbook = xmlDocument(entries.get("xl/workbook.xml"), "workbook");
  const relationships = xmlDocument(entries.get("xl/_rels/workbook.xml.rels"), "workbook relationships");
  const relationById = new Map(childrenByLocalName(relationships, "Relationship")
    .filter((item) => String(item.getAttribute("TargetMode") || "").toLowerCase() !== "external")
    .map((item) => [item.getAttribute("Id") || "", item.getAttribute("Target") || ""] as const));
  const sheets = childrenByLocalName(workbook, "sheet").map((sheet, index) => {
    const relationId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "";
    const target = relationById.get(relationId);
    if (!target) throw new Error(`Excel worksheet ${index + 1} has no internal workbook relationship.`);
    return { name: String(sheet.getAttribute("name") || `Sheet ${index + 1}`).slice(0, 160), path: normalizeWorkbookPartPath(target) };
  });
  if (!sheets.length) throw new Error("The Excel workbook contains no worksheets.");
  return sheets;
}

function sharedStrings(entries: Map<string, Uint8Array>) {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [] as string[];
  const doc = xmlDocument(bytes, "shared strings");
  return childrenByLocalName(doc, "si").map((item) => childrenByLocalName(item, "t").map((node) => node.textContent || "").join(""));
}

export async function parseClusterXlsx(buffer: ArrayBuffer, worksheetName?: string): Promise<ParsedClusterImport> {
  const entries = await unzipXlsx(buffer);
  const strings = sharedStrings(entries);
  const dateStyles = xlsxDateStyleIndexes(entries);
  const worksheets = workbookSheets(entries);
  const selected = worksheets.find((sheet) => sheet.name === worksheetName) || worksheets[0];
  const sheet = xmlDocument(entries.get(selected.path), `worksheet ${selected.name}`);
  const rowNodes = childrenByLocalName(sheet, "row");
  const matrix: ClusterDataScalar[][] = [];
  let formulaCells = 0;
  for (const row of rowNodes.slice(0, 1001)) {
    const values: ClusterDataScalar[] = [];
    for (const cell of [...row.children].filter((node) => node.localName === "c")) {
      const index = columnIndex(cell.getAttribute("r") || "A1");
      const type = cell.getAttribute("t") || "n";
      const style = Number(cell.getAttribute("s") || -1);
      const valueNode = firstChildByLocalName(cell, "v");
      const inline = firstChildByLocalName(cell, "is");
      if (firstChildByLocalName(cell, "f")) formulaCells += 1;
      const raw = valueNode?.textContent ?? "";
      let value: ClusterDataScalar = null;
      if (type === "s") value = strings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = inline ? childrenByLocalName(inline, "t").map((node) => node.textContent || "").join("") : "";
      else if (type === "b") value = raw === "1";
      else if (type === "str" || type === "e") value = raw;
      else if (raw !== "") {
        const numeric = Number(raw);
        if (Number.isFinite(numeric) && dateStyles.has(style)) value = excelSerialDate(numeric);
        else value = Number.isFinite(numeric) ? numeric : raw;
      }
      values[index] = value;
    }
    if (values.some((value) => value != null && String(value).trim() !== "")) matrix.push(values);
  }
  if (!matrix.length) throw new Error(`Excel worksheet ${selected.name} contains no data rows.`);
  const headerRow = matrix.shift() || [];
  const headers = headerRow.map((value, index) => String(value ?? "").trim() || `Column ${index + 1}`);
  const rows = matrix.slice(0, 1000).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])));
  return {
    format: "xlsx",
    columns: headers.map((source) => ({ source, fieldId: null })),
    rows,
    workbook: { worksheets, selectedWorksheet: selected.name, sourceRows: Math.max(0, rowNodes.length - 1), formulaCells, truncated: Math.max(0, rowNodes.length - 1) > 1000 },
  };
}

export function parseClusterImportText(format: Exclude<ClusterDataImportFormat, "xlsx">, text: string): ParsedClusterImport {
  if (format === "csv") {
    const parsed = parseClusterCsv(text.replace(/^\uFEFF/, ""));
    return { format, columns: parsed.headers.map((source) => ({ source, fieldId: null })), rows: parsed.rows.slice(0, 1000) };
  }
  return parseClusterJson(text);
}

export async function parseClusterImportFile(file: File, worksheetName?: string): Promise<ParsedClusterImport> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseClusterXlsx(await file.arrayBuffer(), worksheetName);
  const format: Exclude<ClusterDataImportFormat, "xlsx"> = lower.endsWith(".json") ? "json" : "csv";
  return parseClusterImportText(format, await file.text());
}

function normalizedName(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }

export function suggestClusterImportColumns(columns: readonly ClusterDataImportColumn[], schema: ClusterDataImportSchema) {
  const used = new Set<string>();
  return columns.map((column) => {
    const needle = normalizedName(column.source);
    const field = schema.fields.find((candidate) => !used.has(candidate.fieldId) && [candidate.fieldId, candidate.label, ...(candidate.aliases || [])].some((alias) => normalizedName(alias) === needle));
    if (field) used.add(field.fieldId);
    return { source: column.source, fieldId: field?.fieldId || null };
  });
}
