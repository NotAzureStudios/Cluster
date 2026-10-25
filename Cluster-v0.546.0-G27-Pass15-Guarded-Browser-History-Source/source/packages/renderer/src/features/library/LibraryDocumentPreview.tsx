import { useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "./library-types";
import { LibraryIcon, itemIconName } from "./LibraryIcons";
import { libraryFileUrl } from "./library-file-url";
import { LibraryZipArchive } from "./LibraryZipReader";
import { ClusterLinkButton } from "../../components/ClusterButton";

const PREVIEW_LIMIT_BYTES = 64 * 1024 * 1024;
const EMBEDDED_IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;
const EMBEDDED_IMAGE_TOTAL_LIMIT_BYTES = 16 * 1024 * 1024;
const TABLE_ROW_LIMIT = 160;
const TABLE_COLUMN_LIMIT = 36;
const SLIDE_LIMIT = 80;
const ARCHIVE_ENTRY_LIMIT = 500;

type PreviewState = { loading: boolean; error: string; html: string; rows: string[][]; entries: string[]; note: string };
const EMPTY_STATE: PreviewState = { loading: true, error: "", html: "", rows: [], entries: [], note: "" };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

const DOCUMENT_PREVIEW_ALLOWED_TAGS = new Set([
  "article", "p", "div", "span", "strong", "em", "u", "s", "br", "pre", "code", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "img",
]);
const DOCUMENT_PREVIEW_BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base", "template", "svg", "math"]);
const SAFE_EMBEDDED_IMAGE_SRC = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i;

function sanitizeHtml(value: string) {
  const documentValue = new DOMParser().parseFromString(value, "text/html");
  for (const element of [...documentValue.body.querySelectorAll("*")]) {
    const tag = element.tagName.toLowerCase();
    if (DOCUMENT_PREVIEW_BLOCKED_TAGS.has(tag)) { element.remove(); continue; }
    if (!DOCUMENT_PREVIEW_ALLOWED_TAGS.has(tag)) { element.replaceWith(...element.childNodes); continue; }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const content = attribute.value.trim();
      const safeImageAttribute = tag === "img" && (
        (name === "src" && content.length <= Math.ceil(EMBEDDED_IMAGE_LIMIT_BYTES * 1.5) && SAFE_EMBEDDED_IMAGE_SRC.test(content))
        || (name === "alt" && content.length <= 300)
      );
      const safeTableSpan = (tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan") && /^(?:[1-9]|1\d|20)$/.test(content);
      const safeGeneratedClass = tag === "div" && name === "class" && content === "library-document-table-wrap-v223";
      if (!safeImageAttribute && !safeTableSpan && !safeGeneratedClass) element.removeAttribute(attribute.name);
    }
    if (tag === "img" && !element.getAttribute("src")) element.remove();
  }
  return documentValue.body.innerHTML;
}

function xmlDocument(text: string) {
  const parsed = new DOMParser().parseFromString(text, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("This document contains invalid XML.");
  return parsed;
}

function localElements(node: ParentNode, localName: string) {
  return [...node.querySelectorAll("*")].filter((entry) => entry.localName === localName);
}

function directElement(node: Element, localName: string) {
  return [...node.children].find((entry) => entry.localName === localName) ?? null;
}

function localAttribute(node: Element, localName: string) {
  return [...node.attributes].find((entry) => entry.localName === localName)?.value ?? "";
}

function xmlText(node: ParentNode) {
  return [...node.querySelectorAll("*")]
    .filter((entry) => entry.localName === "t" || entry.localName === "p")
    .map((entry) => entry.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePackagePath(value: string) {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolvePackagePath(baseFile: string, target: string) {
  if (target.startsWith("/")) return normalizePackagePath(target.slice(1));
  const directory = baseFile.includes("/") ? baseFile.slice(0, baseFile.lastIndexOf("/") + 1) : "";
  return normalizePackagePath(`${directory}${target}`);
}

function extensionMime(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

function bytesToDataUri(bytes: Uint8Array, mime: string) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  return `data:${mime};base64,${btoa(binary)}`;
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < TABLE_ROW_LIMIT; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (!quoted && character === delimiter) { row.push(cell); cell = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row.slice(0, TABLE_COLUMN_LIMIT)); row = []; cell = "";
    } else cell += character;
  }
  if ((cell || row.length) && rows.length < TABLE_ROW_LIMIT) { row.push(cell); rows.push(row.slice(0, TABLE_COLUMN_LIMIT)); }
  return rows;
}

function rtfToText(value: string) {
  return value
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
    .replace(/\\u(-?\d+)\??/g, (_match, number) => String.fromCharCode(Number(number) < 0 ? Number(number) + 65_536 : Number(number)))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchBuffer(item: LibraryItem) {
  const response = await fetch(libraryFileUrl(item), { credentials: "include" });
  if (!response.ok) throw new Error(`Preview request failed (${response.status}).`);
  const length = Number(response.headers.get("content-length") || item.sizeBytes || 0);
  if (length > PREVIEW_LIMIT_BYTES) throw new Error("This file is too large for an inline document preview. Download it to open the complete file.");
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > PREVIEW_LIMIT_BYTES) throw new Error("This file is too large for an inline document preview. Download it to open the complete file.");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > PREVIEW_LIMIT_BYTES) {
        await reader.cancel("preview-size-limit").catch(() => undefined);
        throw new Error("This file is too large for an inline document preview. Download it to open the complete file.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined.buffer;
}

async function renderDocx(buffer: ArrayBuffer) {
  const zip = LibraryZipArchive.load(buffer);
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("Word document content was not found.");
  const relationships = new Map<string, string>();
  const relationshipEntry = zip.file("word/_rels/document.xml.rels");
  if (relationshipEntry) {
    const relationshipXml = xmlDocument(await relationshipEntry.text());
    for (const relation of localElements(relationshipXml, "Relationship")) {
      const id = relation.getAttribute("Id") || "";
      const target = relation.getAttribute("Target") || "";
      if (id && target && relation.getAttribute("TargetMode") !== "External") relationships.set(id, resolvePackagePath("word/document.xml", target));
    }
  }
  const imageCache = new Map<string, string>();
  let embeddedImageBytes = 0;
  async function imageForRelationship(id: string) {
    const target = relationships.get(id);
    if (!target) return "";
    const cached = imageCache.get(target);
    if (cached !== undefined) return cached;
    const entry = zip.file(target);
    if (!entry) return "";
    const mime = extensionMime(target);
    if (!mime.startsWith("image/") || mime === "image/svg+xml") { imageCache.set(target, ""); return ""; }
    const bytes = await entry.bytes();
    if (bytes.byteLength > EMBEDDED_IMAGE_LIMIT_BYTES || embeddedImageBytes + bytes.byteLength > EMBEDDED_IMAGE_TOTAL_LIMIT_BYTES) { imageCache.set(target, ""); return ""; }
    embeddedImageBytes += bytes.byteLength;
    const uri = bytesToDataUri(bytes, mime);
    imageCache.set(target, uri);
    return uri;
  }
  async function renderRun(run: Element) {
    const properties = directElement(run, "rPr");
    const bold = Boolean(properties && directElement(properties, "b"));
    const italic = Boolean(properties && directElement(properties, "i"));
    const underline = Boolean(properties && directElement(properties, "u"));
    const strike = Boolean(properties && directElement(properties, "strike"));
    let value = "";
    for (const child of [...run.children]) {
      if (child.localName === "t") value += escapeHtml(child.textContent || "");
      else if (child.localName === "tab") value += "&emsp;";
      else if (child.localName === "br" || child.localName === "cr") value += "<br>";
    }
    for (const blip of localElements(run, "blip")) {
      const id = localAttribute(blip, "embed");
      const uri = id ? await imageForRelationship(id) : "";
      if (uri) value += `<img src="${uri}" alt="Embedded document image">`;
    }
    if (!value) return "";
    if (bold) value = `<strong>${value}</strong>`;
    if (italic) value = `<em>${value}</em>`;
    if (underline) value = `<u>${value}</u>`;
    if (strike) value = `<s>${value}</s>`;
    return value;
  }
  async function renderParagraph(paragraph: Element) {
    let content = "";
    for (const child of [...paragraph.children]) {
      if (child.localName === "r") content += await renderRun(child);
      else if (child.localName === "hyperlink") for (const run of [...child.children].filter((entry) => entry.localName === "r")) content += await renderRun(run);
    }
    if (!content.trim()) return "<p><br></p>";
    const properties = directElement(paragraph, "pPr");
    const style = properties ? localAttribute(directElement(properties, "pStyle") || properties, "val") : "";
    const headingMatch = style.match(/heading\s*([1-6])/i);
    if (headingMatch) return `<h${headingMatch[1]}>${content}</h${headingMatch[1]}>`;
    if (properties && directElement(properties, "numPr")) return `<ul><li>${content}</li></ul>`;
    return `<p>${content}</p>`;
  }
  async function renderTable(table: Element) {
    const rows: string[] = [];
    for (const row of [...table.children].filter((entry) => entry.localName === "tr").slice(0, TABLE_ROW_LIMIT)) {
      const cells: string[] = [];
      for (const cell of [...row.children].filter((entry) => entry.localName === "tc").slice(0, TABLE_COLUMN_LIMIT)) {
        const paragraphs: string[] = [];
        for (const paragraph of [...cell.children].filter((entry) => entry.localName === "p")) paragraphs.push(await renderParagraph(paragraph));
        cells.push(`<td>${paragraphs.join("")}</td>`);
      }
      rows.push(`<tr>${cells.join("")}</tr>`);
    }
    return `<div class="library-document-table-wrap-v223"><table><tbody>${rows.join("")}</tbody></table></div>`;
  }
  const documentXml = xmlDocument(await documentEntry.text());
  const body = localElements(documentXml, "body")[0];
  if (!body) throw new Error("Word document body was not found.");
  const output: string[] = [];
  for (const child of [...body.children]) {
    if (child.localName === "p") output.push(await renderParagraph(child));
    else if (child.localName === "tbl") output.push(await renderTable(child));
  }
  return sanitizeHtml(`<article>${output.join("")}</article>`);
}

async function parseSpreadsheet(buffer: ArrayBuffer, extension: string) {
  const zip = LibraryZipArchive.load(buffer);
  if (extension === "ods") {
    const content = await zip.file("content.xml")?.text();
    if (!content) throw new Error("Spreadsheet content was not found.");
    const documentValue = xmlDocument(content);
    return localElements(documentValue, "table-row").slice(0, TABLE_ROW_LIMIT).map((row) => localElements(row, "table-cell").slice(0, TABLE_COLUMN_LIMIT).map((cell) => xmlText(cell)));
  }
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  const shared = sharedEntry ? localElements(xmlDocument(await sharedEntry.text()), "si").map((entry) => xmlText(entry)) : [];
  const workbookEntry = zip.file("xl/workbook.xml");
  const relationEntry = zip.file("xl/_rels/workbook.xml.rels");
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (workbookEntry && relationEntry) {
    const workbook = xmlDocument(await workbookEntry.text());
    const firstSheet = localElements(workbook, "sheet")[0];
    const relationId = firstSheet ? localAttribute(firstSheet, "id") : "";
    const relationships = xmlDocument(await relationEntry.text());
    const target = localElements(relationships, "Relationship").find((entry) => entry.getAttribute("Id") === relationId)?.getAttribute("Target");
    if (target) sheetPath = resolvePackagePath("xl/workbook.xml", target);
  }
  const sheetEntry = zip.file(sheetPath) || zip.file("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("Spreadsheet worksheet data was not found.");
  const sheet = xmlDocument(await sheetEntry.text());
  return localElements(sheet, "row").slice(0, TABLE_ROW_LIMIT).map((row) => localElements(row, "c").slice(0, TABLE_COLUMN_LIMIT).map((cell) => {
    const value = localElements(cell, "v")[0]?.textContent || "";
    return cell.getAttribute("t") === "s" ? shared[Number(value)] || value : value;
  }));
}

async function parseSlides(buffer: ArrayBuffer, extension: string) {
  const zip = LibraryZipArchive.load(buffer);
  const files = extension === "odp" ? [zip.file("content.xml")].filter(Boolean) : zip.files(/^ppt\/slides\/slide\d+\.xml$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const slides: string[] = [];
  for (const file of files.slice(0, SLIDE_LIMIT)) {
    if (!file) continue;
    const text = xmlText(xmlDocument(await file.text()));
    if (text) slides.push(text);
  }
  return slides;
}

async function parsePackage(buffer: ArrayBuffer, extension: string) {
  const zip = LibraryZipArchive.load(buffer);
  if (extension === "odt") {
    const content = await zip.file("content.xml")?.text();
    if (!content) throw new Error("Document content was not found.");
    const parsed = xmlDocument(content);
    const paragraphs = [...parsed.querySelectorAll("*")].filter((entry) => entry.localName === "p" || entry.localName === "h").map((entry) => entry.textContent?.trim()).filter(Boolean);
    return { html: `<article>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph || "")}</p>`).join("")}</article>`, entries: [] };
  }
  if (extension === "epub") {
    const container = await zip.file("META-INF/container.xml")?.text();
    if (!container) throw new Error("EPUB package information was not found.");
    const rootFile = localElements(xmlDocument(container), "rootfile")[0];
    const rootPath = rootFile?.getAttribute("full-path");
    if (!rootPath) throw new Error("EPUB content manifest was not found.");
    const opf = await zip.file(rootPath)?.text();
    if (!opf) throw new Error("EPUB content manifest could not be opened.");
    const opfDocument = xmlDocument(opf);
    const firstItemReference = localElements(opfDocument, "itemref")[0];
    const firstId = firstItemReference?.getAttribute("idref");
    const href = localElements(opfDocument, "item").find((entry) => entry.getAttribute("id") === firstId)?.getAttribute("href");
    const chapter = href ? await zip.file(resolvePackagePath(rootPath, href))?.text() : "";
    if (!chapter) throw new Error("The first EPUB chapter could not be opened.");
    return { html: sanitizeHtml(chapter), entries: [] };
  }
  return { html: "", entries: zip.files().filter((entry) => !entry.dir).slice(0, ARCHIVE_ENTRY_LIMIT).map((entry) => entry.name) };
}

export function LibraryDocumentPreview({ item, compact = false }: { item: LibraryItem; compact?: boolean }) {
  const [state, setState] = useState<PreviewState>(EMPTY_STATE);
  const extension = String(item.extension || "").toLowerCase();
  const supported = useMemo(() => new Set(["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "pptx", "pptm", "potx", "potm", "odt", "ods", "odp", "rtf", "csv", "tsv", "epub", "zip"]), []);

  useEffect(() => {
    let cancelled = false;
    if (!item.fileUrl || !supported.has(extension)) { setState({ ...EMPTY_STATE, loading: false, error: "This document format does not have an inline renderer yet." }); return; }
    setState(EMPTY_STATE);
    void (async () => {
      const buffer = await fetchBuffer(item);
      const next: PreviewState = { ...EMPTY_STATE, loading: false };
      if (["docx", "docm", "dotx", "dotm"].includes(extension)) {
        next.html = await renderDocx(buffer);
        next.note = "Word document preview";
      } else if (["xlsx", "xlsm", "xltx", "xltm", "ods"].includes(extension)) {
        next.rows = await parseSpreadsheet(buffer, extension);
        next.note = `Showing the first ${Math.min(TABLE_ROW_LIMIT, next.rows.length)} rows of the first sheet`;
      } else if (["pptx", "pptm", "potx", "potm", "odp"].includes(extension)) {
        next.entries = await parseSlides(buffer, extension);
        next.note = `Showing text from ${next.entries.length} slide${next.entries.length === 1 ? "" : "s"}`;
      } else if (["odt", "epub", "zip"].includes(extension)) {
        const result = await parsePackage(buffer, extension); next.html = result.html; next.entries = result.entries;
        next.note = extension === "zip" ? `Showing ${next.entries.length} archive entries` : `${extension.toUpperCase()} preview`;
      } else {
        const text = new TextDecoder().decode(buffer);
        next.rows = extension === "csv" || extension === "tsv" ? parseDelimited(text, extension === "tsv" ? "\t" : ",") : [];
        next.html = extension === "rtf" ? `<pre>${escapeHtml(rtfToText(text))}</pre>` : "";
        next.note = extension === "rtf" ? "RTF text preview" : `Showing ${next.rows.length} rows`;
      }
      if (!cancelled) setState(next);
    })().catch((error) => { if (!cancelled) setState({ ...EMPTY_STATE, loading: false, error: error instanceof Error ? error.message : "Document preview failed." }); });
    return () => { cancelled = true; };
  }, [extension, item.fileUrl, item.id, item.updatedAt, supported]);

  if (state.loading) return <div className="library-preview-loading-v217"><span />Loading document preview…</div>;
  if (state.error) return <div className="library-preview-empty-v217"><LibraryIcon name={itemIconName(item)} size={42} /><strong>Document preview unavailable</strong><p>{state.error}</p><ClusterLinkButton className="" href={libraryFileUrl(item, true)} variant="secondary">Download file</ClusterLinkButton></div>;
  return <div className={`library-office-preview-v221${compact ? " compact" : ""}`}>
    {state.note && <div className="library-document-note-v221">{state.note}</div>}
    {state.html && <div className="library-document-html-v221" dangerouslySetInnerHTML={{ __html: state.html }} />}
    {state.rows.length > 0 && <div className="library-sheet-scroll-v221" role="region" aria-label="Spreadsheet preview" tabIndex={0}><table><tbody>{state.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex} scope="col">{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {state.entries.length > 0 && <div className={`library-document-entries-v221 ${["pptx", "pptm", "potx", "potm", "odp"].includes(extension) ? "slides" : "archive"}`}>{state.entries.map((entry, index) => <article key={`${index}-${entry.slice(0, 30)}`}><span>{["pptx", "pptm", "potx", "potm", "odp"].includes(extension) ? `Slide ${index + 1}` : `${index + 1}`}</span><p>{entry}</p></article>)}</div>}
  </div>;
}
