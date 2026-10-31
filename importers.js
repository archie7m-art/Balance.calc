// importers.js -- one entry point: any supported file -> a list of tables (rows of text).
// Excel, Word and PDF readers live in readers.js. Everything runs in the browser; the file never leaves the device.
import { parseDelimited, parseLoose, detectDelimiter, normalizeTable } from "./tableio.js";
import { readXlsx, readDocx, readPdf } from "./readers.js";

export function parsePasted(text) { const d = detectDelimiter(text); return normalizeTable(d ? parseDelimited(text, d) : parseLoose(text)); }

export async function importFile(file, opts = {}) {
  const name = (file.name || "").toLowerCase(), buf = await file.arrayBuffer();
  const JSZip = opts.JSZip || globalThis.JSZip;
  if (/\.xlsx$|\.xlsm$/.test(name)) return { tables: await readXlsx(buf, JSZip), kind: "Excel" };
  if (/\.xls$|\.ods$/.test(name)) throw new Error("Old .xls and .ods files cannot be read. In Excel, choose Save As, pick .xlsx (or .csv), then import that.");
  if (/\.docx$/.test(name)) return { tables: await readDocx(buf, JSZip), kind: "Word" };
  if (/\.doc$/.test(name)) throw new Error("Old .doc files cannot be read. In Word, choose Save As, pick .docx, then import that.");
  if (/\.pdf$/.test(name)) {
    const base = opts.base || import.meta.url;
    const pdfjs = opts.pdfjs || await import(new URL("./vendor/pdf.min.mjs", base).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", base).href;
    return { tables: await readPdf(buf, pdfjs), kind: "PDF" };
  }
  const text = new TextDecoder("utf-8").decode(buf);
  return { tables: [{ name: "Table", rows: parsePasted(text) }], kind: "text" };
}
