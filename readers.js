// readers.js -- turn Excel, Word and PDF contents into plain tables (arrays of rows of text).
// JSZip is passed in, so the same code runs in the browser and in Node tests.
import { parseXML, kids, kid, find, textOf } from "./xml.js";
import { normalizeTable } from "./tableio.js";

const colIndex = ref => { const L = /^[A-Z]+/i.exec(ref)[0].toUpperCase(); let n = 0; for (const ch of L) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const serialToDate = s => { const d = new Date(Math.round((s - 25569) * 86400000)); return d.toISOString().slice(0, 10); };
const cleanNum = v => { const n = Number(v); return Number.isFinite(n) ? String(parseFloat(n.toPrecision(15))) : v; };

/** Excel (.xlsx) -> [{name, rows}] for every sheet. Cell values are the saved values (formulas are not recalculated). */
export async function readXlsx(buffer, JSZip) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async p => { const f = zip.file(p); return f ? f.async("string") : null; };
  const wbXml = await read("xl/workbook.xml");
  if (!wbXml) throw new Error("This does not look like an .xlsx file. (Old .xls files: open them in Excel and save as .xlsx.)");
  const wb = parseXML(wbXml), rels = parseXML((await read("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const target = {}; for (const r of kids(rels, "Relationship")) target[r.attrs.Id] = r.attrs.Target;
  const sst = [], sstXml = await read("xl/sharedStrings.xml");
  if (sstXml) for (const si of kids(parseXML(sstXml), "si")) sst.push(find(si, "t").map(textOf).join(""));
  const dateStyle = [], pctStyle = [], stXml = await read("xl/styles.xml");
  if (stXml) {
    const st = parseXML(stXml), custom = {};
    for (const nf of find(st, "numFmt")) custom[nf.attrs.numFmtId] = nf.attrs.formatCode;
    const xfs = kid(st, "cellXfs");
    if (xfs) kids(xfs, "xf").forEach((xf, i) => {
      const id = Number(xf.attrs.numFmtId || 0), code = (custom[id] || "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
      dateStyle[i] = DATE_IDS.has(id) || (custom[id] && /[dmyhs]/i.test(code) && !/[#0]/.test(code));
      pctStyle[i] = id === 9 || id === 10 || /%/.test(custom[id] || "");
    });
  }
  const sheets = [];
  for (const sh of find(kid(wb, "sheets") || wb, "sheet")) {
    const t = target[sh.attrs["r:id"]]; if (!t) continue;
    const path = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    const xml = await read(path); if (!xml) continue;
    const grid = []; let nextRow = 0;
    for (const row of find(parseXML(xml), "row")) {
      const r = row.attrs.r ? Number(row.attrs.r) - 1 : nextRow; nextRow = r + 1; grid[r] ||= [];
      let nextCol = 0;
      for (const c of kids(row, "c")) {
        const ci = c.attrs.r ? colIndex(c.attrs.r) : nextCol; nextCol = ci + 1;
        const t = c.attrs.t, v = kid(c, "v"), vt = v ? v.text : "";
        let out = "";
        if (t === "s") out = sst[Number(vt)] ?? "";
        else if (t === "inlineStr") out = find(c, "t").map(textOf).join("");
        else if (t === "str" || t === "e") out = vt;
        else if (t === "b") out = vt === "1" ? "TRUE" : "FALSE";
        else if (vt !== "") {
          const s = Number(c.attrs.s || 0);
          out = dateStyle[s] ? serialToDate(Number(vt)) : pctStyle[s] ? cleanNum(Number(vt) * 100) + "%" : cleanNum(vt);
        }
        grid[r][ci] = out;
      }
    }
    const rows = normalizeTable(Array.from(grid, r => Array.from(r || [], x => x ?? "")));
    sheets.push({ name: sh.attrs.name, rows });
  }
  return sheets.filter(s => s.rows.length);
}

/** Word (.docx) -> [{name, rows}]: each table, or lines of text split on tabs / wide gaps if there are no tables. */
export async function readDocx(buffer, JSZip) {
  const zip = await JSZip.loadAsync(buffer), f = zip.file("word/document.xml");
  if (!f) throw new Error("This does not look like a .docx file. (Old .doc files: open them in Word and save as .docx.)");
  const body = kid(parseXML(await f.async("string")), "w:body");
  const para = p => { let s = ""; (function walk(n) { for (const c of n.children) { if (c.name === "w:t") s += c.text; else if (c.name === "w:tab") s += "\t"; else if (c.name === "w:br") s += " "; else walk(c); } })(p); return s; };
  const tables = [], lines = [];
  for (const el of body.children) {
    if (el.name === "w:tbl") {
      const rows = [];
      for (const tr of kids(el, "w:tr")) {
        const row = [];
        for (const tc of kids(tr, "w:tc")) {
          const pr = kid(tc, "w:tcPr"), span = Number(kid(pr || { children: [] }, "w:gridSpan")?.attrs["w:val"] || 1);
          const vm = kid(pr || { children: [] }, "w:vMerge"), cont = vm && vm.attrs["w:val"] !== "restart";
          row.push(cont ? "" : kids(tc, "w:p").map(para).join(" ").trim());
          for (let i = 1; i < span; i++) row.push("");
        }
        rows.push(row);
      }
      const rt = normalizeTable(rows); if (rt.length) tables.push({ name: `Table ${tables.length + 1}`, rows: rt });
    } else if (el.name === "w:p") { const t = para(el); if (t.trim()) lines.push(t); }
  }
  if (!tables.length && lines.length) {
    const rows = normalizeTable(lines.map(l => l.trim().split(/\t+|\s{2,}/)));
    if (rows.some(r => r.length > 1)) tables.push({ name: "Text lines", rows });
  }
  return tables;
}

/** PDF text pieces -> rows. pages: [[{str, x, y, w, h}]]. Pieces on one line are grouped into cells by gaps;
 *  cells are lined up into columns by where they sit across the whole document. */
export function pdfItemsToRows(pages) {
  const lines = [], hs = [];
  for (const items of pages) {
    const its = items.filter(i => i.str.trim() !== "");
    its.forEach(i => hs.push(i.h || 10));
    const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x), page = [];
    for (const it of sorted) {
      const tol = 0.5 * (it.h || 10), line = page.find(l => Math.abs(l.y - it.y) <= tol);
      if (line) line.items.push(it); else page.push({ y: it.y, items: [it] });
    }
    page.sort((a, b) => b.y - a.y); lines.push(...page);
  }
  if (!lines.length) return [];
  hs.sort((a, b) => a - b); const H = hs[Math.floor(hs.length / 2)] || 10;
  const built = lines.map(l => {
    const its = l.items.sort((a, b) => a.x - b.x), cells = [];
    for (const it of its) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.x1 <= 0.35 * H) { last.text += (it.x - last.x1 > 0.12 * H ? " " : "") + it.str.trim(); last.x1 = Math.max(last.x1, it.x + it.w); }
      else cells.push({ text: it.str.trim(), x0: it.x, x1: it.x + it.w });
    }
    return cells;
  });
  // Some PDF makers glue neighbouring cells into one piece ("480,000 Active"). If a later word in such a piece starts
  // exactly where other lines have a cell starting, cut it there.
  const starts = built.filter(c => c.length >= 2).flatMap(c => c.map(x => x.x0));
  const anchors = starts;
  for (const cells of built) {
    if (cells.length < 2) continue;
    for (let n = 0; n < cells.length; n++) {
      const c = cells[n], re = /\s+/g; let m, cut = -1;
      while ((m = re.exec(c.text))) {
        const est = c.x0 + (c.x1 - c.x0) * (m.index + m[0].length) / c.text.length;
        if (est > c.x0 + 0.5 * H && /^[-(]?[\d,.]+%?\)?$/.test(c.text.slice(0, m.index)) && anchors.some(a => Math.abs(a - est) <= 0.4 * H)) { cut = m.index; const at = est; c._at = at; break; }
      }
      if (cut > 0) { const right = { text: c.text.slice(cut).trim(), x0: c._at, x1: c.x1 }; const w0 = c.x1 - c.x0; c.text = c.text.slice(0, cut).trim(); c.x1 = c.x0 + w0 * cut / (cut + right.text.length + 1); cells.splice(n + 1, 0, right); }
    }
  }
  const iv = built.filter(c => c.length >= 2).flat().map(c => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]);
  const bands = [];
  for (const [a, b] of iv) { const last = bands[bands.length - 1]; if (last && a <= last[1] + 0.05 * H) last[1] = Math.max(last[1], b); else bands.push([a, b]); }
  const rows = built.map(cells => {
    if (cells.length < 2 || !bands.length) return [cells.map(c => c.text).join(" ")];
    const row = Array(bands.length).fill("");
    for (const c of cells) {
      const mid = (c.x0 + c.x1) / 2; let k = bands.findIndex(b => mid >= b[0] - 0.05 * H && mid <= b[1] + 0.05 * H);
      if (k < 0) k = bands.reduce((best, b, i) => Math.abs((b[0] + b[1]) / 2 - mid) < Math.abs((bands[best][0] + bands[best][1]) / 2 - mid) ? i : best, 0);
      row[k] = row[k] ? row[k] + " " + c.text : c.text;
    }
    return row;
  });
  return normalizeTable(rows);
}

/** PDF -> [{name, rows}] using pdf.js (passed in). PDFs that are only pictures of text have no text to read. */
export async function readPdf(buffer, pdfjs) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = []; let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.filter(i => "str" in i).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.hypot(i.transform[2], i.transform[3]) || i.height }));
    chars += items.reduce((s, i) => s + i.str.trim().length, 0); pages.push(items);
  }
  if (chars < 5) throw new Error("This PDF has no text that can be read: it looks like a scan or a photo. Use a scanner app that can copy the text, or type the numbers in.");
  const rows = pdfItemsToRows(pages);
  return rows.length ? [{ name: `PDF text (${doc.numPages} page${doc.numPages > 1 ? "s" : ""})`, rows }] : [];
}
