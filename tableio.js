// tableio.js -- plain table helpers (no screen code): CSV in/out and tidy-up.
// A table is {header: string[], rows: string[][]}. Every cell is text, exactly as written.

export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find(l => l.trim()) || "";
  const counts = { "\t": 0, ",": 0, ";": 0 };
  let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

export function parseDelimited(text, delim) {
  text = text.replace(/^﻿/, "");
  delim = delim || detectDelimiter(text);
  const rows = []; let row = [], cell = "", q = false, i = 0;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (delim && ch === delim) pushCell();
    else if (ch === "\n") pushRow();
    else if (ch === "\r") { /* ignore */ }
    else cell += ch;
    i++;
  }
  if (cell !== "" || row.length) pushRow();
  return rows;
}

// Whitespace-separated text (copied from a bill list or a PDF): split on tabs or runs of 2+ spaces.
export function parseLoose(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => l.trim().split(/\t+|\s{2,}/).map(c => c.trim()));
}

export function fromRows(aoa) {
  const width = Math.max(1, ...aoa.map(r => r.length));
  const rect = aoa.map(r => Array.from({ length: width }, (_, j) => (r[j] === undefined || r[j] === null ? "" : String(r[j]))));
  // drop completely empty rows at the end and empty trailing rows/columns
  while (rect.length && rect[rect.length - 1].every(c => c.trim() === "")) rect.pop();
  if (!rect.length) return { header: ["A"], rows: [] };
  let keep = [];
  for (let j = 0; j < width; j++) if (rect.some(r => r[j].trim() !== "")) keep.push(j);
  const clean = rect.map(r => keep.map(j => r[j]));
  const header = clean[0].map((h, j) => h.trim() || `Column ${j + 1}`);
  return { header, rows: clean.slice(1).filter(r => r.some(c => c.trim() !== "")) };
}

export function toCSV(table) {
  const esc = c => /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
  return [table.header, ...table.rows].map(r => r.map(esc).join(",")).join("\n") + "\n";
}

export function cloneTable(t) { return { header: [...t.header], rows: t.rows.map(r => [...r]) }; }

// Editing operations: each returns a NEW table (so undo is just "keep the old one").
export const ops = {
  deleteRow: (t, i) => { const n = cloneTable(t); n.rows.splice(i, 1); return n; },
  deleteColumn: (t, j) => { const n = cloneTable(t); if (n.header.length <= 1) return n; n.header.splice(j, 1); n.rows.forEach(r => r.splice(j, 1)); return n; },
  addRow: (t, at) => { const n = cloneTable(t); n.rows.splice(at === undefined ? n.rows.length : at, 0, n.header.map(() => "")); return n; },
  addColumn: (t, at, name) => { const n = cloneTable(t); const p = at === undefined ? n.header.length : at; n.header.splice(p, 0, name || `Column ${n.header.length + 1}`); n.rows.forEach(r => r.splice(p, 0, "")); return n; },
  setCell: (t, i, j, v) => { const n = cloneTable(t); n.rows[i][j] = v; return n; },
  setHeader: (t, j, v) => { const n = cloneTable(t); n.header[j] = v; return n; },
  moveRow: (t, i, d) => { const n = cloneTable(t); const k = i + d; if (k < 0 || k >= n.rows.length) return n; [n.rows[i], n.rows[k]] = [n.rows[k], n.rows[i]]; return n; },
};

/** Make every row the same width, trim cells, drop empty rows and empty trailing columns. */
export function normalizeTable(rows) {
  let r = rows.map(row => row.map(c => String(c ?? "").replace(/\s+/g, " ").trim()));
  r = r.filter(row => row.some(c => c !== ""));
  const w = Math.max(0, ...r.map(x => x.length));
  r = r.map(row => row.concat(Array(w - row.length).fill("")));
  while (r.length && w > 0 && r.every(row => row[row.length - 1] === "")) { r.forEach(row => row.pop()); if (!r[0].length) break; }
  return r;
}
