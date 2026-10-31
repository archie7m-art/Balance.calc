// Browser test at phone size. Run: python3 -m http.server 8123 (in this folder), then node tests/e2e.cjs
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const URL = "http://localhost:8123/", FX = p => path.join(__dirname, "fixtures", p), CSV = path.join(__dirname, "user_balance_sheet.csv");
const out = process.env.SHOTS || "/tmp/shots"; fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  p.on("dialog", d => d.accept());
  await p.goto(URL); await p.waitForTimeout(300);
  ok(await p.locator("#tableCard").isHidden(), "table hidden before import");
  // 1. CSV
  await p.setInputFiles("#fileInput", CSV); await p.waitForSelector("table.grid");
  const rows = await p.locator("table.grid tbody tr").count(); const cols = await p.locator("table.grid thead th").count();
  ok(rows === 13 && cols === 7, `CSV imported: ${rows} rows, ${cols} header cells (expect 13 rows; 5 columns plus # and Type)`);
  await p.screenshot({ path: out + "/01_imported.png", fullPage: true });
  // Check
  await p.click('[data-tool="check"]'); const t1 = await p.locator("#results").innerText();
  console.log("---CHECK---\n" + t1.slice(0, 2500));
  ok(/Imbalance Check/i.test(t1), "check mentions the imbalance row");
  ok(/does not balance/.test(t1), "check finds totals not matching");
  ok(/Accounts Receivable|Retained Earnings/.test(t1), "check finds a blank/unreadable cell");
  ok(/Intangible Assets/.test(t1) && /negative/.test(t1), "check flags the negative Intangible Assets");
  await p.screenshot({ path: out + "/02_check.png", fullPage: true });
  await p.click('[data-tool="why"]'); const t2 = await p.locator("#results").innerText(); console.log("---WHY---\n" + t2.slice(0, 1800));
  await p.click('[data-tool="missing"]'); const t3 = await p.locator("#results").innerText(); console.log("---MISSING---\n" + t3.slice(0, 1500));
  await p.click('[data-tool="compare"]'); const t4 = await p.locator("#results").innerText(); console.log("---COMPARE---\n" + t4.slice(0, 1500));
  await p.screenshot({ path: out + "/03_compare.png", fullPage: true });
  await p.click('[data-tool="ratios"]'); const t5 = await p.locator("#results").innerText(); console.log("---RATIOS---\n" + t5.slice(0, 1200));
  // manual why
  await p.click('[data-tool="why"]'); await p.fill("#mNums", "120 450 85 300 240"); await p.fill("#mTot", "1175"); await p.click("#mGo");
  const m = await p.locator("#mOut").innerText(); console.log("---MANUAL---\n" + m);
  ok(/swapped|missing|twice|wrong|flipped/i.test(m), "manual why-mismatch gives an explanation");
  // 2. edit by hand, delete, undo
  await p.click('[data-tool="check"]');
  const first = p.locator('input[data-i="2"][data-j="2"]'); const before = await first.inputValue();
  await first.fill("151000"); await first.press("Tab"); await p.waitForTimeout(100);
  ok((await p.evaluate(() => window.__app.state.table.rows[2][2])) === "151000", "cell edit by hand stored (was " + before + ")");
  await p.click("#undoBtn"); ok((await p.evaluate(() => window.__app.state.table.rows[2][2])) === before, "undo restores the cell");
  await p.click("#redoBtn"); ok((await p.evaluate(() => window.__app.state.table.rows[2][2])) === "151000", "redo re-applies it");
  await p.click("#undoBtn");
  await p.click('button[data-dr="12"]'); ok((await p.locator("table.grid tbody tr").count()) === 12, "row deleted");
  await p.click("#undoBtn"); ok((await p.locator("table.grid tbody tr").count()) === 13, "row delete undone");
  const nCols = await p.evaluate(() => window.__app.state.table.header.length);
  await p.click('button[data-dc="4"]'); ok((await p.evaluate(() => window.__app.state.table.header.length)) === nCols - 1, "column deleted");
  await p.click("#undoBtn"); ok((await p.evaluate(() => window.__app.state.table.header.length)) === nCols, "column delete undone");
  await p.click("#addRowBtn"); await p.click("#addColBtn"); ok((await p.locator("table.grid tbody tr").count()) === 14, "row added");
  await p.click("#undoBtn"); await p.click("#undoBtn");
  const dl = p.waitForEvent("download"); await p.click("#csvBtn"); const d = await dl; ok(d.suggestedFilename() === "balance-sheet.csv", "CSV download");
  // apply a fix
  await p.click('[data-tool="check"]'); const fixBtns = await p.locator("[data-fix]").count(); ok(fixBtns > 0, "fix buttons are offered (" + fixBtns + ")");
  // 3. other file types
  for (const f of ["balance.xlsx", "balance.docx", "balance.pdf", "balance_libreoffice.pdf", "balance_reportlab.pdf"]) {
    await p.setInputFiles("#fileInput", FX(f)); await p.waitForTimeout(1500);
    const msg = await p.locator("#importMsg").innerText(); await p.click('[data-tool="check"]');
    const r = await p.locator("#results").innerText(); const n = await p.locator("table.grid tbody tr").count();
    ok(/Opened/.test(msg) && n >= 13, `${f}: ${msg.slice(0, 60)}… rows=${n}`);
    ok(/does not balance/.test(r) && /Intangible Assets/.test(r) && /Retained Earnings/.test(r), `${f}: same problems found`);
  }
  await p.screenshot({ path: out + "/04_pdf.png", fullPage: true });
  // old format refused plainly
  await p.setInputFiles("#fileInput", FX("old.xls")); await p.waitForTimeout(300);
  ok(/Old \.xls/.test(await p.locator("#importMsg").innerText()), "old .xls refused with a plain message");
  await p.setInputFiles("#fileInput", FX("scanned.pdf")); await p.waitForTimeout(1200);
  ok(/scan or a photo/.test(await p.locator("#importMsg").innerText()), "scanned PDF refused with a plain message");
  // paste + demo
  await p.click("#demoBtn"); await p.click('[data-tool="check"]'); ok(/Equity|balance/i.test(await p.locator("#results").innerText()), "demo runs");
  await p.screenshot({ path: out + "/05_demo.png", fullPage: true });
  // layout: no sideways page scroll
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll at 390px");
  ok(errs.length === 0, "no console errors " + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
