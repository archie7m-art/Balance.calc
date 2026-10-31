import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDelimited, fromRows, toCSV, ops } from "../tableio.js";
import { parseAmount, fmt, detectColumns, guessRoles, checkSheet, missingFigures, comparePeriods, ratios, whyMismatch } from "../engine.js";

const load = p => fromRows(parseDelimited(readFileSync(new URL(p, import.meta.url), "utf8")));
function prep(table) { const d = detectColumns(table); return { d, roles: guessRoles(table, d.textCols) }; }

test("reading amounts", () => {
  const c = s => parseAmount(s).cents;
  assert.equal(c("1,20,000"), 12000000); assert.equal(c("(1,200.50)"), -120050); assert.equal(c("₹ 4,500"), 450000);
  assert.equal(c("-50000"), -5000000); assert.equal(c("1200-"), -120000); assert.equal(c("$ 12.5"), 1250); assert.equal(c("USD 99"), 9900);
  assert.equal(parseAmount("N/A").kind, "na"); assert.equal(parseAmount("").kind, "blank"); assert.equal(parseAmount("abc").kind, "text"); assert.equal(parseAmount("50%").kind, "text");
});

test("csv reading handles quotes, commas inside quotes, tabs and blank lines", () => {
  const t = parseDelimited('a,b\n"x, y",2\n\n"he said ""hi""",3\n');
  assert.deepEqual(t[1], ["x, y", "2"]); assert.deepEqual(t[3], ['he said "hi"', "3"]);
  assert.deepEqual(parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
});

test("editing operations: delete/add row and column, edit a cell, undo by keeping the old table", () => {
  const t0 = fromRows([["Name", "Q1", "Q2"], ["a", "1", "2"], ["b", "3", "4"]]);
  const t1 = ops.deleteRow(t0, 0); assert.equal(t1.rows.length, 1); assert.equal(t0.rows.length, 2);       // original untouched = undo works
  const t2 = ops.deleteColumn(t0, 1); assert.deepEqual(t2.header, ["Name", "Q2"]); assert.deepEqual(t2.rows[0], ["a", "2"]);
  const t3 = ops.addColumn(t0, 1, "Mid"); assert.deepEqual(t3.rows[1], ["b", "", "3", "4"]);
  const t4 = ops.addRow(t0); assert.equal(t4.rows.length, 3); assert.deepEqual(t4.rows[2], ["", "", ""]);
  const t5 = ops.setCell(t0, 1, 2, "99"); assert.equal(t5.rows[1][2], "99"); assert.equal(t0.rows[1][2], "4");
  assert.equal(ops.deleteColumn(fromRows([["only"], ["x"]]), 0).header.length, 1);                          // never deletes the last column
  assert.equal(toCSV(fromRows([["a", "b"], ['x,"y"', "2"]])), 'a,b\n"x,""y""",2\n');
});

test("USER FILE: balance_sheet_with_errors.csv -> every problem found by the built-in rules", () => {
  const t = load("user_balance_sheet.csv"); const { d, roles } = prep(t);
  assert.deepEqual(d.amountCols, [2, 3]); assert.equal(d.labelCol, 1);
  const rl = i => roles[i].role;
  assert.deepEqual([rl(0), rl(1), rl(6), rl(11), rl(12)], ["totalAssets", "asset", "totalLiabilities", "equity", "check"]);
  const f = checkSheet(t, roles, d.amountCols, d.labelCol);
  const text = f.map(x => `${x.kind}|${x.title}`);
  const has = (re) => assert.ok(text.some(s => re.test(s)), "missing finding: " + re + "\n" + text.join("\n"));
  has(/error\|.*Q1.*does not balance.*Assets 5,00,000.*Liabilities 3,00,000 \+ Equity 2,20,000 = 5,20,000/);   // 1. Q1 gap 20,000
  has(/error\|.*Q1.*Imbalance Check says 50,000, but the real gap is 20,000/);                                  // 2. the sheet's own check is wrong
  has(/warn\|.*Q1.*Intangible Assets is negative \(-50,000\)/);                                                 // 3. negative intangible
  has(/warn\|.*Q2.*Accounts Receivable is blank/);                                                               // 4. blank receivables
  has(/warn\|.*Q2.*Retained Earnings says "N\/A"/);                                                              // 5. N/A retained earnings
  has(/error\|.*Q2.*does not balance/);
  const q1 = f.find(x => /Q1.*does not balance/.test(x.title)).fixes.map(x => `${t.rows[x.row][1]}:${x.from / 100}->${x.to / 100}`).sort();
  assert.deepEqual(q1, ["Common Stock:100000->80000", "Retained Earnings:120000->100000"]);                      // exact single-cell fixes
  const q2 = f.find(x => /Q2.*does not balance/.test(x.title)).fixes.map(x => `${t.rows[x.row][1]}:${x.from / 100}->${x.to / 100}`);
  assert.deepEqual(q2, ["Retained Earnings:0->90000", "Common Stock:100000->190000"]);   // the unreadable cell first
  assert.ok(!text.some(s => /Total Assets .* does not equal|Total Liabilities .* does not equal/.test(s)), "totals that are right must not be flagged");
});

test("USER FILE: missing figures, comparison and ratios", () => {
  const t = load("user_balance_sheet.csv"); const { d, roles } = prep(t);
  const m = missingFigures(t, roles, d.amountCols, d.labelCol);
  const ar = m.find(x => x.label === "Accounts Receivable"), re = m.find(x => x.label === "Retained Earnings");
  assert.equal(ar.implied[0].value, 0); assert.equal(re.implied[0].value, 9000000); assert.equal(re.agree, true);
  const c = comparePeriods(t, roles, 2, 3, d.labelCol);
  const intang = c.lines.find(l => l.label === "Intangible Assets"); assert.equal(intang.change, 9000000); assert.ok(intang.flags.includes("changed sign"));
  assert.ok(c.incomplete); assert.equal(c.reconcile.find(r => /asset lines/.test(r.title)).ok, false);
  const r = ratios(t, roles, d.amountCols, d.labelCol)[0].ratios;
  assert.equal(r.find(x => x.name === "Current ratio").value, "2.33"); assert.equal(r.find(x => x.name === "Quick ratio (without inventory)").value, "1.53");
  assert.equal(r.find(x => x.name === "Working capital").value, "2,00,000"); assert.equal(r.find(x => x.name === "Debt-to-equity").value, "1.36");
});

// a clean, balanced sheet must produce no findings; then plant mistakes and require them to be found
const CLEAN = [["Category", "Account", "Y1", "Y2"], ["Assets", "Total Assets", "1000", "1200"], ["Current Assets", "Cash", "400", "500"], ["Current Assets", "Stock", "100", "150"], ["Non-Current Assets", "Machinery", "500", "550"],
  ["Liabilities", "Total Liabilities", "600", "700"], ["Current Liabilities", "Creditors", "200", "250"], ["Non-Current Liabilities", "Loan", "400", "450"], ["Equity", "Capital", "300", "300"], ["Equity", "Reserves", "100", "200"]];
test("a clean balanced sheet raises nothing", () => {
  const t = fromRows(CLEAN); const { d, roles } = prep(t);
  assert.deepEqual(checkSheet(t, roles, d.amountCols, d.labelCol), []);
});
test("planted mistakes on a clean sheet are found with the exact fix", () => {
  const trials = [["Machinery", "Y1", "500", "5000", /Total Assets/], ["Machinery", "Y2", "550", "505", /Total Assets/], ["Creditors", "Y1", "200", "20", /Total Liabilities/], ["Capital", "Y2", "300", "3000", /balance/]];
  for (const [acct, per, ok, bad, re] of trials) {
    const rows = CLEAN.map(r => [...r]); const ri = rows.findIndex(r => r[1] === acct), ci = rows[0].indexOf(per); rows[ri][ci] = bad;
    const t = fromRows(rows); const { d, roles } = prep(t); const f = checkSheet(t, roles, d.amountCols, d.labelCol);
    assert.ok(f.some(x => x.kind === "error" && re.test(x.title)), `${acct} ${bad}: not flagged`);
    const fixes = f.flatMap(x => x.fixes).filter(x => t.rows[x.row][1] === acct);
    assert.ok(fixes.some(x => x.to / 100 === Number(ok)), `${acct}: right fix ${ok} not offered; got ${JSON.stringify(fixes)}`);
  }
});
test("why-mismatch examples", () => {
  const r = whyMismatch(["120", "450", "58", "300", "240"], "1195").hypotheses.filter(h => h.kind !== "an entry is missing from the list");
  assert.equal(r.length, 1); assert.equal(r[0].kind, "digits swapped");
  assert.equal(whyMismatch(["10", "20"], "30").hypotheses.length, 0);
  assert.throws(() => whyMismatch(["abc"], "5"));
});
