import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSZip, pdfjs, fixture } from "./helpers.mjs";
import { readPdf } from "../readers.js";
import { parseDelimited, fromRows } from "../tableio.js";
import { detectColumns, guessRoles, checkSheet } from "../engine.js";
const csvRows = parseDelimited(readFileSync(new URL("./user_balance_sheet.csv", import.meta.url), "utf8")).filter(r => r.length > 1 || r[0]);
const findings = rows => { const t = fromRows(rows), d = detectColumns(t), roles = guessRoles(t, d.textCols); return checkSheet(t, roles, d.amountCols, d.labelCol).map(f => f.kind + "|" + f.title).sort(); };
const expected = findings(csvRows);
for (const name of ["balance.pdf", "balance_reportlab.pdf", "balance_libreoffice.pdf"]) {
  test(`PDF ${name}: the table comes out right and gives the same findings as the CSV`, async () => {
    const [{ rows }] = await readPdf(fixture(name), pdfjs);
    const hdr = rows.findIndex(r => /Account Name/i.test(r.join(" ")));
    assert.ok(hdr >= 0, "header row not found; first rows: " + JSON.stringify(rows.slice(0, 3)));
    const body = rows.slice(hdr).filter((r, i) => i === 0 || !/Account Name/i.test(r.join(" ")));
    const cells = body.map(r => r.map(c => /^-?[\d,]+(\.\d+)?$/.test(c.trim()) ? c.trim().replace(/,/g, "") : c.trim())).filter((r, i) => i < csvRows.length);
    assert.equal(cells.length, csvRows.length, "row count: " + JSON.stringify(cells));
    assert.deepEqual(cells[0].length, csvRows[0].length, "column count: " + JSON.stringify(cells[0]));
    let wrong = 0; cells.forEach((r, i) => r.forEach((c, j) => { if (c !== csvRows[i][j]) { wrong++; console.log("   cell differs", i, j, JSON.stringify(c), "expected", JSON.stringify(csvRows[i][j])); } }));
    assert.equal(wrong, 0);
    assert.deepEqual(findings(cells), expected);
  });
}
test("scanned PDF (a picture of a table): refused with a clear message, not garbage", async () => {
  await assert.rejects(() => readPdf(fixture("scanned.pdf"), pdfjs), /no text that can be read/);
});
