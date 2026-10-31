// app.js -- the screen. All work happens in this browser; nothing is uploaded.
import { fromRows, toCSV, ops } from "./tableio.js";
import { importFile, parsePasted } from "./importers.js";
import { parseAmount, fmt, detectColumns, ROLES, ROLE_NAMES, guessRoles, buildIdentities, checkSheet, missingFigures, comparePeriods, ratios, whyMismatch } from "./engine.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KINDS = { names: "Names", numbers: "Numbers", other: "Other" };

// ------------------------------------------------------------------ state
// table = {header, rows}; over[i] = a role the person chose for row i (or null = my guess); kind[j] = chosen kind of column j (or null = my guess)
let S = { table: null, over: [], kind: [] };
let undoStack = [], redoStack = [], pendingTables = [], lastTool = null, highlight = new Set();

const snap = () => JSON.stringify(S);
const restore = s => { S = JSON.parse(s); };
function commit(next) { undoStack.push(snap()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; S = next; save(); }
function load(table, note) {
  S = { table, over: table.rows.map(() => null), kind: table.header.map(() => null) };
  undoStack = []; redoStack = []; highlight = new Set(); lastTool = null; save(); renderAll(); showResults(null);
  if (note) say(note, "ok");
}
function save() { try { localStorage.setItem("bsc.table", JSON.stringify(S)); } catch (e) { /* private window: fine */ } }

// ------------------------------------------------------------------ what the engine needs
function view() {
  const t = S.table, auto = detectColumns(t);
  const kindOf = j => S.kind[j] || (auto.amountCols.includes(j) ? "numbers" : "names");
  const amountCols = t.header.map((_, j) => j).filter(j => kindOf(j) === "numbers");
    const named = t.header.map((_, j) => j).filter(j => kindOf(j) === "names");
  const labelCol = named.includes(auto.labelCol) ? auto.labelCol : (named[0] ?? 0);
  const guess = guessRoles(t, named);
  const roles = guess.map((g, i) => ({ role: S.over[i] || g.role, term: g.term, guessed: !S.over[i] }));
  return { t, kindOf, amountCols, labelCol, roles, auto };
}

// ------------------------------------------------------------------ messages
function say(text, cls = "") { const m = $("importMsg"); m.textContent = text; m.className = "msg " + cls; }

// ------------------------------------------------------------------ import
async function handleFile(file) {
  say("Reading " + file.name + "…");
  try {
    const { tables, kind } = await importFile(file);
    const usable = tables.filter(t => t.rows && t.rows.length >= 1);
    if (!usable.length) throw new Error("I could not find a table in this file. Try another file, or paste the numbers as text.");
    pendingTables = usable;
    const sel = $("tableSelect"); sel.innerHTML = usable.map((t, i) => `<option value="${i}">${esc(t.name)} (${t.rows.length} rows)</option>`).join("");
    $("tablePick").hidden = usable.length < 2;
    useTable(0, file.name, kind);
  } catch (e) { say(String(e.message || e), "err"); }
}
function useTable(i, fileName, kind) {
  const t = fromRows(pendingTables[i].rows);
  const extra = kind === "PDF" || kind === "Word" ? " Tables read from " + kind + " files are a best guess, so look at every row." : "";
  load(t, `Opened ${fileName ? '"' + fileName + '": ' : ""}${t.rows.length} rows × ${t.header.length} columns.${extra} Please look it over; you can fix any cell.`);
}
$("fileInput").addEventListener("change", e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; });
$("tableSelect").addEventListener("change", e => useTable(+e.target.value, "", ""));
$("pasteToggle").addEventListener("click", () => { const b = $("pasteBox"); b.hidden = !b.hidden; if (!b.hidden) $("pasteText").focus(); });
$("pasteGo").addEventListener("click", () => {
  const rows = parsePasted($("pasteText").value);
  if (rows.length < 1) return say("There is nothing to read yet. Paste a table first.", "err");
  pendingTables = [{ name: "Pasted", rows }]; $("tablePick").hidden = true; useTable(0, "", "text");
});
$("demoBtn").addEventListener("click", () => {
  const demo = `Section,Item,2024,2025
Assets,Total Assets,"90,000","95,000"
Current Assets,Cash,"30,000","35,000"
Current Assets,Receivables,"20,000","22,000"
Non-Current Assets,Equipment,"40,000","38,000"
Liabilities,Total Liabilities,"50,000","52,000"
Current Liabilities,Payables,"20,000","22,000"
Non-Current Liabilities,Bank loan,"30,000","30,000"
Equity,Total Equity,"40,000","43,000"
Equity,Owner capital,"25,000","25,000"
Equity,Retained earnings,"15,000","18,000"`;
  pendingTables = [{ name: "Example", rows: parsePasted(demo) }]; $("tablePick").hidden = true;
  useTable(0, "example", "text");
  say("Example opened. The 2025 Equity lines were typed wrongly on purpose: press Check, then Why?", "ok");
});
for (const ev of ["dragover", "drop"]) $("importCard").addEventListener(ev, e => { e.preventDefault(); if (ev === "drop" && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

// ------------------------------------------------------------------ the table
function renderAll() { const has = !!S.table; $("tableCard").hidden = !has; $("keyCard").hidden = !has; if (has) { renderTable(); updateButtons(); } }

function renderTable() {
  const { t, kindOf, amountCols, roles } = view();
  let h = `<table class="grid"><thead><tr><th class="rn">#</th>`;
  t.header.forEach((name, j) => {
    h += `<th><input class="hname" data-h="${j}" value="${esc(name)}" aria-label="Column ${j + 1} name">` +
      `<div class="colbar"><select data-k="${j}" aria-label="What is column ${j + 1}">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${kindOf(j) === k ? "selected" : ""}>${v}${S.kind[j] ? "" : (k === kindOf(j) ? " (guess)" : "")}</option>`).join("")}</select>` +
      `<button class="x" data-dc="${j}" aria-label="Delete column ${esc(name || j + 1)}" title="Delete this column">✕</button></div></th>`;
  });
  h += `<th>Type of row</th></tr></thead><tbody>`;
  t.rows.forEach((r, i) => {
    h += `<tr><td class="rn"><div>${i + 1}</div><button class="x" data-dr="${i}" aria-label="Delete row ${i + 1}" title="Delete this row">✕</button></td>`;
    r.forEach((c, j) => { h += `<td class="${amountCols.includes(j) ? "num" : ""}${highlight.has(i + ":" + j) ? " hl" : ""}" data-cell="${i}:${j}"><input data-i="${i}" data-j="${j}" value="${esc(c)}" aria-label="Row ${i + 1}, ${esc(t.header[j])}" ${amountCols.includes(j) ? 'inputmode="decimal"' : ""}></td>`; });
    h += `<td class="rolecell ${roles[i].guessed ? "guess" : ""}"><select data-r="${i}" aria-label="Type of row ${i + 1}">${ROLES.map(k => `<option value="${k}" ${roles[i].role === k ? "selected" : ""}>${ROLE_NAMES[k]}${roles[i].guessed && roles[i].role === k ? " (guess)" : ""}</option>`).join("")}</select></td></tr>`;
  });
  $("tableWrap").innerHTML = h + "</tbody></table>";
}

$("tableWrap").addEventListener("change", e => {
  const el = e.target; if (!S.table) return;
  if (el.dataset.i !== undefined) { const i = +el.dataset.i, j = +el.dataset.j; if (S.table.rows[i][j] === el.value) return; commit({ ...S, table: ops.setCell(S.table, i, j, el.value) }); refreshAfterCell(); }
  else if (el.dataset.h !== undefined) { const j = +el.dataset.h; commit({ ...S, table: ops.setHeader(S.table, j, el.value) }); updateButtons(); }
  else if (el.dataset.k !== undefined) { const j = +el.dataset.k, k = [...S.kind]; k[j] = el.value; commit({ ...S, kind: k }); renderTable(); }
  else if (el.dataset.r !== undefined) { const i = +el.dataset.r, o = [...S.over]; o[i] = el.value; commit({ ...S, over: o }); renderTable(); }
  updateButtons(); rerunTool();
});
// after a cell edit only the guessed row types can change; refresh those dropdowns without stealing focus
function refreshAfterCell() {
  const { roles } = view();
  document.querySelectorAll("select[data-r]").forEach(s => { const i = +s.dataset.r; s.value = roles[i].role; s.parentElement.classList.toggle("guess", roles[i].guessed); });
}
$("tableWrap").addEventListener("click", e => {
  const b = e.target.closest("button.x"); if (!b) return;
  const t = S.table;
  if (b.dataset.dr !== undefined) { const i = +b.dataset.dr, o = [...S.over]; o.splice(i, 1); commit({ ...S, table: ops.deleteRow(t, i), over: o }); }
  else if (b.dataset.dc !== undefined) {
    if (t.header.length <= 1) return say("A table needs at least one column.", "err");
    const j = +b.dataset.dc, k = [...S.kind]; k.splice(j, 1); commit({ ...S, table: ops.deleteColumn(t, j), kind: k });
  }
  highlight = new Set(); renderTable(); updateButtons(); rerunTool();
});
$("addRowBtn").addEventListener("click", () => { commit({ ...S, table: ops.addRow(S.table), over: [...S.over, null] }); renderTable(); updateButtons(); const w = $("tableWrap"); w.scrollTop = w.scrollHeight; });
$("addColBtn").addEventListener("click", () => { commit({ ...S, table: ops.addColumn(S.table), kind: [...S.kind, null] }); renderTable(); updateButtons(); });
$("undoBtn").addEventListener("click", () => { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); save(); highlight = new Set(); renderAll(); rerunTool(); });
$("redoBtn").addEventListener("click", () => { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); save(); highlight = new Set(); renderAll(); rerunTool(); });
$("csvBtn").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([toCSV(S.table)], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "balance-sheet.csv" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$("clearBtn").addEventListener("click", () => {
  if (!confirm("Remove the table from the screen? (You can press Undo right after.)")) return;
  commit({ table: { header: ["Name", "Amount"], rows: [["", ""]] }, over: [null], kind: [null, null] }); renderAll(); showResults(null);
});
function updateButtons() { $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length; }

// ------------------------------------------------------------------ tools
const centsStr = c => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));
const plainNum = c => fmt(c).replace(/,/g, "");
const colName = j => S.table.header[j] || `column ${j + 1}`;
const cellVal = (r, c) => { const p = parseAmount(S.table.rows[r][c]); return p.kind === "num" ? p.cents : 0; };

function screen(title) { $("screenTitle").textContent = title; }
function showResults(tool) {
  lastTool = tool;
  document.querySelectorAll(".key").forEach(k => k.classList.toggle("on", k.dataset.tool === tool));
  if (!tool) { screen("Pick a tool above"); $("results").innerHTML = ""; }
}
function rerunTool() { if (lastTool && S.table) runTool(lastTool, true); }
document.querySelector(".keypad").addEventListener("click", e => { const k = e.target.closest(".key"); if (k) runTool(k.dataset.tool); });

function card(cls, title, body = "", actions = "") { return `<div class="res ${cls}"><h3>${title}</h3>${body}${actions ? `<div class="actions">${actions}</div>` : ""}</div>`; }
const showBtn = cells => `<button class="btn sm" data-show='${JSON.stringify(cells)}'>Show in table</button>`;
const fixBtn = f => `<button class="btn sm primary" data-fix='${JSON.stringify(f)}'>Set row ${f.row + 1} to ${esc(plainNum(f.to))}</button>`;

function runTool(tool, quiet) {
  showResults(tool); if (!quiet) highlight = new Set();
  const V = view(), out = $("results");
  if (!V.amountCols.length && tool !== "why") { screen("No number columns"); out.innerHTML = card("info", "I could not find a column of numbers", "<p>Under a column's name, choose <b>Numbers</b> for each column that holds amounts.</p>"); return; }
  try {
    if (tool === "check") toolCheck(V, out);
    else if (tool === "why") toolWhy(V, out);
    else if (tool === "missing") toolMissing(V, out);
    else if (tool === "compare") toolCompare(V, out);
    else if (tool === "ratios") toolRatios(V, out);
  } catch (e) { out.innerHTML = card("error", "Something went wrong", `<p>${esc(e.message)}</p>`); }
}

function toolCheck(V, out) {
  const f = checkSheet(V.t, V.roles, V.amountCols, V.labelCol);
  const problems = f.filter(x => x.kind !== "info").length;
  screen(problems ? `${problems} thing${problems > 1 ? "s" : ""} to look at` : "Everything adds up");
  let h = "";
  if (!f.length) h = card("good", "All checks passed", `<p>For ${V.amountCols.map(colName).map(esc).join(", ")}: every total equals its lines, and Assets = Liabilities + Equity.</p>`);
  for (const x of f) {
    let body = `<p>${esc(x.detail)}</p>`;
    if (x.fixes.length) {
      body += `<p><b>${x.fixes.length === 1 ? "One single change" : "Any one of these single changes"} would make this period balance:</b></p><ul>` +
        x.fixes.slice(0, 5).map(z => `<li>${esc(V.t.rows[z.row][V.labelCol] || "row " + (z.row + 1))}: ${esc(V.t.rows[z.row][z.col] || "(blank)")} → <b>${esc(fmt(z.to))}</b></li>`).join("") + `</ul>` +
        (x.fixes.length > 1 ? `<p>Several cells fit, so this is arithmetic only. Look at the original document to see which one is really wrong.</p>` : "");
    }
    h += card(x.kind, `<span class="tag ${x.kind}">${x.kind === "error" ? "Wrong" : x.kind === "warn" ? "Look" : "Note"}</span>${esc(x.title)}`, body,
      (x.cells.length ? showBtn(x.cells) : "") + x.fixes.slice(0, 3).map(fixBtn).join(""));
  }
  out.innerHTML = h;
}

function toolWhy(V, out) {
  screen("Why doesn't it match?");
  let h = "", any = false;
  const rowLabel = r => V.t.rows[r][V.labelCol] || "row " + (r + 1);
  if (V.amountCols.length) for (const c of V.amountCols) {
    for (const id of buildIdentities(V.t, V.roles, c)) {
      let entryRows, totalVal, totalTitle;
      if (id.kind === "sum") { entryRows = id.lines; totalVal = cellVal(id.head, c); totalTitle = `${rowLabel(id.head)} (${colName(c)})`; }
      else if (id.kind === "balance") { entryRows = [...id.lSide, ...id.eSide]; totalVal = id.aSide.reduce((s, r) => s + cellVal(r, c), 0); totalTitle = `Total assets (${colName(c)})`; }
      else continue;
      const sum = entryRows.reduce((s, r) => s + cellVal(r, c), 0);
      if (sum === totalVal) continue;
      any = true;
      const res = whyMismatch(entryRows.map(r => centsStr(cellVal(r, c))), centsStr(totalVal));
      const hyp = res.hypotheses.filter(x => x.kind !== "an entry is missing from the list" || res.hypotheses.length === 1);
      const dText = esc(fmt(Math.abs(totalVal - sum)));
      const words = t => esc(t.replace(/entry (\d+) \(([^)]*)\)/g, (m, n, v) => `"${rowLabel(entryRows[+n - 1])}" (${v})`));
      const body = `<p>${id.kind === "balance" ? "Liabilities + Equity" : "The lines"} add to ${esc(fmt(sum))}, but ${esc(totalTitle)} says ${esc(fmt(totalVal))}. The gap is <b>${dText}</b>.</p>` +
        `<p><b>${hyp.length === 1 ? "One mistake would explain it exactly:" : "These single mistakes would each explain it exactly (several fit, so check the original):"}</b></p><ul>${hyp.slice(0, 6).map(x => `<li>${words(x.text)} <span class="tag">${esc(x.kind)}</span></li>`).join("")}</ul>`;
      h += card("error", `${esc(totalTitle)}: why is it off by ${dText}?`, body, showBtn([...entryRows.map(r => [r, c]), ...(id.head !== undefined ? [[id.head, c]] : [])]));
    }
  }
  if (!any) h += card("good", "Nothing to explain in the table", "<p>Every total matches its lines. You can still try your own list below.</p>");
  h += `<div class="res info"><h3>Try your own list</h3><div class="manual"><label for="mNums">Numbers that should add up (spaces, commas or new lines between them)</label><textarea id="mNums" rows="3" placeholder="120 450 85 300 240"></textarea><label for="mTot">The total they are supposed to make</label><input type="text" id="mTot" inputmode="decimal" placeholder="1175"><button class="btn primary" id="mGo" type="button">Find the mistake</button><div id="mOut"></div></div></div>`;
  out.innerHTML = h;
  $("mGo").onclick = () => {
    const nums = $("mNums").value.replace(/,(?=\d{3}\b)/g, "").split(/[\s,;]+/).filter(Boolean), tot = $("mTot").value.replace(/,/g, "").trim();
    const m = $("mOut");
    if (!nums.length || !tot) { m.innerHTML = card("warn", "Fill in both boxes", ""); return; }
    try {
      const r = whyMismatch(nums, tot);
      if (r.hypotheses.length === 0) m.innerHTML = card("good", "They add up exactly", "");
      else m.innerHTML = card("info", `Gap: ${esc(String(r.D))} (scaled)`, `<ul>${r.hypotheses.slice(0, 8).map(x => `<li>${esc(x.text)} <span class="tag">${esc(x.kind)}</span></li>`).join("")}</ul>` + (r.hypotheses.length > 1 ? "<p>Several fit; check the original.</p>" : ""));
    } catch (e) { m.innerHTML = card("error", "I could not read one of the numbers", `<p>Use plain numbers like 1200 or 45.50.</p>`); }
  };
}

function toolMissing(V, out) {
  const f = missingFigures(V.t, V.roles, V.amountCols, V.labelCol);
  screen(f.length ? `${f.length} blank or unreadable cell${f.length > 1 ? "s" : ""}` : "No missing figures");
  if (!f.length) { out.innerHTML = card("good", "Nothing is missing", "<p>Every line you marked as an asset, liability, equity or total has a number.</p>"); return; }
  out.innerHTML = f.map(x => {
    let body, act = "";
    if (!x.implied.length) body = `<p>${esc(colName(x.period))}: the cell is ${x.current ? `"${esc(x.current)}"` : "blank"}, and the other figures are not enough to work out what it should be (another cell is also missing).</p>`;
    else {
      body = `<p>${esc(colName(x.period))}: the cell is ${x.current ? `"${esc(x.current)}"` : "blank"}.</p><ul>${x.implied.map(i => `<li>${esc(i.identity)} → <b>${esc(fmt(i.value))}</b></li>`).join("")}</ul>` +
        (x.agree ? "" : "<p><b>The rules give different answers</b>, so another figure in this period is probably wrong too. Run Check.</p>");
      if (x.agree) act = fixBtn({ row: x.row, col: x.period, to: x.implied[0].value });
    }
    return card(x.implied.length && x.agree ? "warn" : "info", `${esc(x.label)}`, body, showBtn([[x.row, x.period]]) + act);
  }).join("");
}

let cmp = { a: null, b: null };
function toolCompare(V, out) {
  if (V.amountCols.length < 2) { screen("Need two number columns"); out.innerHTML = card("info", "Two columns of numbers are needed", "<p>Mark two columns as <b>Numbers</b> (for example last year and this year).</p>"); return; }
  if (!V.amountCols.includes(cmp.a)) cmp.a = V.amountCols[0];
  if (!V.amountCols.includes(cmp.b) || cmp.b === cmp.a) cmp.b = V.amountCols.find(c => c !== cmp.a);
  const r = comparePeriods(V.t, V.roles, cmp.a, cmp.b, V.labelCol);
  screen(`${colName(cmp.a)} → ${colName(cmp.b)}`);
  const opts = sel => V.amountCols.map(c => `<option value="${c}" ${c === sel ? "selected" : ""}>${esc(colName(c))}</option>`).join("");
  let h = `<div class="res info"><div class="row"><label>From <select id="cmpA">${opts(cmp.a)}</select></label><label>to <select id="cmpB">${opts(cmp.b)}</select></label></div></div>`;
  h += `<div class="res info mini-wrap"><table class="mini"><thead><tr><th>Line</th><th>${esc(colName(cmp.a))}</th><th>${esc(colName(cmp.b))}</th><th>Change</th><th>%</th></tr></thead><tbody>` +
    r.lines.map(l => `<tr><td>${esc(l.label)}${l.flags.length ? `<div class="flags">${esc(l.flags.join("; "))}</div>` : ""}</td><td>${l.from === null ? "–" : esc(fmt(l.from))}</td><td>${l.to === null ? "–" : esc(fmt(l.to))}</td><td>${l.change === null ? "–" : esc(fmt(l.change))}</td><td>${l.pct === null ? "–" : l.pct.toFixed(1) + "%"}</td></tr>`).join("") + `</tbody></table></div>`;
  for (const x of r.reconcile) h += card(x.ok ? "good" : "error", `${x.ok ? "✓" : "✗"} ${esc(x.title)}`, `<p>${esc(fmt(x.total))} vs ${esc(fmt(x.parts))}${x.ok ? "" : ": they should be equal, so some figure in one of the two periods is wrong."}</p>`);
  if (r.incomplete) h += card("warn", "Some lines have no number in one of the periods", "<p>The totals above may not reconcile for that reason.</p>");
  out.innerHTML = h;
  $("cmpA").onchange = e => { cmp.a = +e.target.value; runTool("compare", true); };
  $("cmpB").onchange = e => { cmp.b = +e.target.value; runTool("compare", true); };
}

function toolRatios(V, out) {
  const r = ratios(V.t, V.roles, V.amountCols, V.labelCol);
  screen("Ratios");
  out.innerHTML = r.map(p => card("info", esc(colName(p.period)),
    (p.ratios.length ? `<ul>${p.ratios.map(x => `<li><b>${esc(x.name)}: ${esc(x.value)}</b><br><span class="small">${esc(x.meaning)}</span></li>`).join("")}</ul>` : "<p>No ratio could be worked out.</p>") +
    (p.needs ? `<p>${esc(p.needs)}</p>` : "") + (p.note ? `<p><b>${esc(p.note)}</b></p>` : ""))).join("");
}

// buttons inside results
$("results").addEventListener("click", e => {
  const s = e.target.closest("[data-show]"), f = e.target.closest("[data-fix]");
  if (s) { highlight = new Set(JSON.parse(s.dataset.show).map(([r, c]) => r + ":" + c)); renderTable(); const first = document.querySelector("td.hl"); if (first) first.scrollIntoView({ block: "center", inline: "center" }); }
  if (f) { const z = JSON.parse(f.dataset.fix); commit({ ...S, table: ops.setCell(S.table, z.row, z.col, plainNum(z.to)) }); highlight = new Set([z.row + ":" + z.col]); renderTable(); updateButtons(); runTool(lastTool, true); }
});

// ------------------------------------------------------------------ start: restore the last table, register the offline worker
try { const s = JSON.parse(localStorage.getItem("bsc.table") || "null"); if (s && s.table && s.table.header) { S = s; renderAll(); say("Your last table was restored from this device.", "ok"); } } catch (e) { /* nothing saved */ }
$("net").textContent = "Works offline once opened.";
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { $("net").textContent = ""; });
window.__app = { get state() { return S; } };
