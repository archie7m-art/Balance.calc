import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { importFile, parsePasted } from "../importers.js";
import { readXlsx, readDocx, pdfItemsToRows } from "../readers.js";
import { parseDelimited, fromRows } from "../tableio.js";
import { detectColumns, guessRoles, checkSheet } from "../engine.js";
const JSZip = (() => { const m = { exports: {} }; new Function("module", "exports", readFileSync(new URL("../vendor/jszip.min.js", import.meta.url), "utf8")).call(globalThis, m, m.exports); return m.exports; })();
const fx = n => readFileSync(new URL("./fixtures/" + n, import.meta.url));
const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const csvRows = parseDelimited(readFileSync(new URL("./user_balance_sheet.csv", import.meta.url), "utf8")).filter(r => r.length > 1 || r[0]);
const norm = rows => rows.map(r => r.map(c => String(c).trim()));
const findings = rows => { const t = fromRows(rows), d = detectColumns(t), roles = guessRoles(t, d.textCols); return checkSheet(t, roles, d.amountCols, d.labelCol).map(f => f.kind + "|" + f.title).sort(); };
const expected = findings(csvRows);

test("Excel .xlsx: same table as the CSV, sheet names with symbols, blanks stay blank, & is decoded", async () => {
  const tabs = await readXlsx(ab(fx("balance.xlsx")), JSZip);
  assert.equal(tabs.length, 2); assert.equal(tabs[0].name, "Balance & Sheet");
  const rows = norm(tabs[0].rows);
  assert.equal(rows.length, csvRows.length);
  assert.deepEqual(rows[5], csvRows[5]); assert.equal(rows[3][3], ""); assert.equal(rows[12][3], "N/A");
  assert.ok(rows.some(r => r.includes("Property, Plant & Equipment")));
  assert.deepEqual(findings(rows), expected);
});
test("Word .docx: table is read cell by cell and gives the same findings as the CSV", async () => {
  const tabs = await readDocx(ab(fx("balance.docx")), JSZip);
  assert.equal(tabs.length, 1); assert.deepEqual(norm(tabs[0].rows), csvRows); assert.deepEqual(findings(tabs[0].rows), expected);
});
test("Word .docx without a table: tab-separated lines become rows; merged cells keep columns aligned", async () => {
  const lines = await readDocx(ab(fx("lines.docx")), JSZip); assert.deepEqual(norm(lines[0].rows), [["Rice", "120"], ["Oil", "450"], ["Total", "570"]]);
  const merged = await readDocx(ab(fx("merged.docx")), JSZip); assert.deepEqual(norm(merged[0].rows), [["Heading", "", "X"], ["a", "b", "c"], ["1", "2", "3"]]);
});
test("plain text and pasted text, and clear refusals for formats that cannot be read", async () => {
  const f = n => ({ name: n, arrayBuffer: async () => ab(fx(n)) });
  assert.deepEqual((await importFile(f("plain.txt"))).tables[0].rows, [["Rice", "120"], ["Oil", "450"], ["Sugar", "85"], ["Total", "655"]]);
  assert.deepEqual(parsePasted("a,b\n1,2"), [["a", "b"], ["1", "2"]]); assert.deepEqual(parsePasted("Rice\t120\nOil\t450"), [["Rice", "120"], ["Oil", "450"]]);
  await assert.rejects(() => importFile(f("old.xls")), /Save As/);
  await assert.rejects(() => importFile({ name: "bad.xlsx", arrayBuffer: async () => new TextEncoder().encode("not a zip").buffer }, {}), /./);
});
test("PDF layout: columns and rows are rebuilt from positions (synthetic text, two pages)", () => {
  const page = (data, y0) => { const items = []; const colX = [50, 250, 350]; data.forEach((r, i) => r.forEach((c, j) => items.push({ str: c, x: j ? colX[j] + 40 - c.length * 5 : colX[j], y: y0 - 20 * i, w: c.length * 5, h: 10 }))); return items; };
  const p1 = page([["Item", "Q1", "Q2"], ["Rice bags", "120", "1,200"]], 700), p2 = page([["Oil", "45", "50"]], 700);
  p1.push({ str: "Quarterly report", x: 50, y: 760, w: 80, h: 14 });
  const rows = pdfItemsToRows([p1, p2]);
  assert.deepEqual(rows.slice(1), [["Item", "Q1", "Q2"], ["Rice bags", "120", "1,200"], ["Oil", "45", "50"]]);
});
