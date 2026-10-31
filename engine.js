// engine.js -- all the calculations. No screen code. Money is held as whole cents so sums are exact.

// ---------------------------------------------------------------- reading numbers
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return { kind: "blank" };
  let s = String(raw).trim();
  if (s === "") return { kind: "blank" };
  if (/^(n\/?a|na|null|none|nil|tbd|\?|-+|[–—]+|#n\/a|#ref!|#value!|#div\/0!|error)$/i.test(s)) return { kind: "na", text: s };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/[−–—]/g, "-");
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/^(usd|inr|rs\.?|eur|gbp|us\$)\s*/i, "").replace(/\s*(usd|inr|eur|gbp)$/i, "").replace(/[$€£₹¥]/g, "").trim();
  if (!/^(\d[\d,\s']*(\.\d+)?|\.\d+)$/.test(s)) return { kind: "text", text: String(raw) };
  const v = parseFloat(s.replace(/[,\s']/g, ""));
  if (!isFinite(v)) return { kind: "text", text: String(raw) };
  return { kind: "num", cents: Math.round((neg ? -v : v) * 100) };
}

export function fmt(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const frac = cents % 100 !== 0;
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
}
const absC = c => Math.abs(c);

// ---------------------------------------------------------------- understanding the table
export function detectColumns(table) {
  const amountCols = [], textCols = [];
  table.header.forEach((_, j) => {
    let num = 0, other = 0;
    table.rows.forEach(r => { const p = parseAmount(r[j]); if (p.kind === "num") num++; else if (p.kind === "text") other++; });
    (num > 0 && num >= other ? amountCols : textCols).push(j);
  });
  // the label column = the text column with the most different values (names repeat less than categories)
  let labelCol = textCols[0] ?? 0, best = -1;
  textCols.forEach(j => { const u = new Set(table.rows.map(r => (r[j] || "").trim().toLowerCase()).filter(Boolean)).size; if (u > best) { best = u; labelCol = j; } });
  return { amountCols, textCols, labelCol };
}

export const ROLES = ["asset", "liability", "equity", "totalAssets", "totalLiabilities", "totalEquity", "totalLE", "check", "other"];
export const ROLE_NAMES = { asset: "Asset line", liability: "Liability line", equity: "Equity line", totalAssets: "Total assets", totalLiabilities: "Total liabilities", totalEquity: "Total equity", totalLE: "Total liabilities + equity", check: "Imbalance check", other: "Ignore" };

export function guessRoles(table, textCols) {
  return table.rows.map(r => {
    const text = textCols.map(j => r[j] || "").join(" | ").toLowerCase();
    const has = re => re.test(text);
    let role = "other";
    if (has(/imbalance|check total|out of balance|difference|variance/)) role = "check";
    else if (has(/total/) && has(/liabilit/) && has(/equity|capital/)) role = "totalLE";
    else if (has(/total/) && has(/asset/)) role = "totalAssets";
    else if (has(/total/) && has(/liabilit/)) role = "totalLiabilities";
    else if (has(/total/) && has(/equity|capital|shareholder/)) role = "totalEquity";
    else if (has(/asset/)) role = "asset";
    else if (has(/liabilit/)) role = "liability";
    else if (has(/equity|capital|retained|stock|reserve|shareholder/)) role = "equity";
    const term = has(/non[\s-]?current|long[\s-]?term/) ? "noncurrent" : has(/current|short[\s-]?term/) ? "current" : "";
    return { role, term };
  });
}

// ---------------------------------------------------------------- the laws of a balance sheet, as exact identities
// Each identity is a list of {row, coef}: the cells, times their coefficients, must add to exactly 0.
function cell(table, r, c) { return parseAmount(table.rows[r][c]); }
function value(table, r, c) { const p = cell(table, r, c); return p.kind === "num" ? p.cents : 0; }

export function buildIdentities(table, roles, c) {
  const rows = idx => roles.map((x, i) => (idx.includes(x.role) ? i : -1)).filter(i => i >= 0);
  const TA = rows(["totalAssets"])[0], TL = rows(["totalLiabilities"])[0], TE = rows(["totalEquity"])[0], TLE = rows(["totalLE"])[0];
  const A = rows(["asset"]), L = rows(["liability"]), E = rows(["equity"]);
  const ids = [];
  const sumTerms = (head, lines, sign) => [...(head !== undefined ? [{ row: head, coef: sign }] : []), ...lines.map(r => ({ row: r, coef: -sign }))];
  if (TA !== undefined && A.length) ids.push({ id: "TA", title: "Total assets = the sum of the asset lines", terms: sumTerms(TA, A, 1), kind: "sum", head: TA, lines: A });
  if (TL !== undefined && L.length) ids.push({ id: "TL", title: "Total liabilities = the sum of the liability lines", terms: sumTerms(TL, L, 1), kind: "sum", head: TL, lines: L });
  if (TE !== undefined && E.length) ids.push({ id: "TE", title: "Total equity = the sum of the equity lines", terms: sumTerms(TE, E, 1), kind: "sum", head: TE, lines: E });
  const side = (head, lines) => (head !== undefined ? [head] : lines);
  const aSide = side(TA, A), lSide = side(TL, L), eSide = side(TE, E);
  if (aSide.length && (lSide.length || eSide.length)) {
    const terms = [...aSide.map(r => ({ row: r, coef: 1 })), ...lSide.map(r => ({ row: r, coef: -1 })), ...eSide.map(r => ({ row: r, coef: -1 }))];
    ids.push({ id: "BAL", title: "Assets = Liabilities + Equity", terms, kind: "balance", aSide, lSide, eSide });
  }
  if (TLE !== undefined && (lSide.length || eSide.length)) ids.push({ id: "TLE", title: "Total liabilities + equity = Liabilities + Equity", terms: [{ row: TLE, coef: 1 }, ...lSide.map(r => ({ row: r, coef: -1 })), ...eSide.map(r => ({ row: r, coef: -1 }))], kind: "sum2" });
  return ids;
}
const residual = (table, id, c, over = {}) => id.terms.reduce((s, t) => s + t.coef * (over[t.row] !== undefined ? over[t.row] : value(table, t.row, c)), 0);

export function label(table, labelCol, r) { return (table.rows[r][labelCol] || "").trim() || `row ${r + 1}`; }

// ---------------------------------------------------------------- tool 1: check the balance sheet
export function checkSheet(table, roles, amountCols, labelCol) {
  const out = [];
  const L = r => label(table, labelCol, r);
  for (const c of amountCols) {
    const P = table.header[c];
    const ids = buildIdentities(table, roles, c);
    if (!ids.length) { out.push({ kind: "info", period: c, title: `${P}: I could not find totals or lines to check`, detail: "Set each row's role (asset, liability, equity, totals) in the table, then run this again.", cells: [], fixes: [] }); continue; }
    // blanks and unreadable cells in rows that matter
    roles.forEach((x, r) => {
      if (x.role === "other" || x.role === "check") return;
      const p = cell(table, r, c);
      if (p.kind !== "num") {
        const what = p.kind === "blank" ? "is blank" : `says "${table.rows[r][c]}", which is not a number`;
        const sums = ids.filter(id => id.terms.some(t => t.row === r)).map(id => id.title);
        out.push({ kind: "warn", period: c, title: `${P}: ${L(r)} ${what}`, detail: `It is counted as 0 in the checks.${sums.length ? " It is part of: " + sums.join("; ") + "." : ""}`, cells: [[r, c]], fixes: [] });
      }
    });
    // negative lines
    roles.forEach((x, r) => {
      if (!["asset", "liability"].includes(x.role)) return;
      const p = cell(table, r, c);
      if (p.kind === "num" && p.cents < 0) out.push({ kind: "warn", period: c, title: `${P}: ${L(r)} is negative (${fmt(p.cents)})`, detail: "A negative asset or liability is unusual. It is normal only for special accounts such as accumulated depreciation. Check the sign.", cells: [[r, c]], fixes: [] });
    });
    // violated identities
    const violated = ids.filter(id => residual(table, id, c) !== 0);
    const fixes = singleCellFixes(table, ids, c);
    for (const id of violated) {
      const res = residual(table, id, c);
      let title, detail;
      if (id.kind === "sum") { const head = value(table, id.head, c), sum = id.lines.reduce((s, r) => s + value(table, r, c), 0); title = `${P}: ${L(id.head)} (${fmt(head)}) does not equal the sum of its lines (${fmt(sum)})`; detail = `Off by ${fmt(absC(res))}.`; }
      else if (id.kind === "balance") { const a = id.aSide.reduce((s, r) => s + value(table, r, c), 0), l = id.lSide.reduce((s, r) => s + value(table, r, c), 0), e = id.eSide.reduce((s, r) => s + value(table, r, c), 0); title = `${P}: the sheet does not balance. Assets ${fmt(a)} but Liabilities ${fmt(l)} + Equity ${fmt(e)} = ${fmt(l + e)}`; detail = `The gap is ${fmt(absC(res))}.`; }
      else { title = `${P}: ${id.title} does not hold`; detail = `Off by ${fmt(absC(res))}.`; }
      const cells = id.terms.map(t => [t.row, c]);
      out.push({ kind: "error", period: c, title, detail, cells, fixes: id.kind === "balance" ? fixes : fixes.filter(f => id.terms.some(t => t.row === f.row)) });
    }
    // the sheet's own "imbalance check" row
    const bal = ids.find(i => i.kind === "balance");
    roles.forEach((x, r) => {
      if (x.role !== "check" || !bal) return;
      const p = cell(table, r, c); if (p.kind !== "num") return;
      const actual = absC(residual(table, bal, c));
      if (absC(p.cents) !== actual) out.push({ kind: "error", period: c, title: `${P}: ${L(r)} says ${fmt(p.cents)}, but the real gap is ${fmt(actual)}`, detail: "The check row does not agree with the numbers above it.", cells: [[r, c]], fixes: [{ row: r, col: c, from: p.cents, to: actual }] });
    });
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.period - b.period);
}

// the exact value of ONE cell that would make every identity of the period hold at once
export function singleCellFixes(table, ids, c) {
  const violated = ids.filter(id => residual(table, id, c) !== 0);
  if (!violated.length) return [];
  const fixes = [], seen = new Set();
  const cand = new Set(ids.flatMap(id => id.terms.map(t => t.row)));
  for (const r of cand) {
    for (const id of violated) {
      const t = id.terms.find(t => t.row === r); if (!t) continue;
      const cur = value(table, r, c), to = cur - residual(table, id, c) / t.coef;
      if (!Number.isInteger(to) || to === cur) continue;
      if (ids.every(i => residual(table, i, c, { [r]: to }) === 0)) { const k = r + ":" + to; if (!seen.has(k)) { seen.add(k); fixes.push({ row: r, col: c, from: cur, to }); } }
    }
  }
  // a cell that is already blank or unreadable is the most likely culprit, so its fix comes first
  fixes.sort((a, b) => (cell(table, a.row, c).kind === "num") - (cell(table, b.row, c).kind === "num"));
  return fixes;
}

// ---------------------------------------------------------------- tool 3: find the missing figure
export function missingFigures(table, roles, amountCols, labelCol) {
  const out = [];
  for (const c of amountCols) {
    const ids = buildIdentities(table, roles, c);
    const unknown = new Set();
    roles.forEach((x, r) => { if (x.role !== "other" && x.role !== "check" && cell(table, r, c).kind !== "num") unknown.add(r); });
    if (!unknown.size) continue;
    const known = {}; const solved = {};
    for (let pass = 0; pass < 4; pass++) {
      for (const id of ids) {
        const unk = id.terms.filter(t => unknown.has(t.row) && known[t.row] === undefined);
        if (unk.length !== 1) continue;
        const t = unk[0];
        const rest = id.terms.reduce((s, u) => s + (u.row === t.row ? 0 : u.coef * (known[u.row] !== undefined ? known[u.row] : value(table, u.row, c))), 0);
        const v = -rest / t.coef;
        (solved[t.row] ||= []).push({ identity: id.title, value: v });
        if (pass === 0 || true) known[t.row] = known[t.row] === undefined ? v : known[t.row];
      }
    }
    for (const r of unknown) {
      const found = solved[r] || [];
      out.push({ period: c, row: r, label: label(table, labelCol, r), current: table.rows[r][c], implied: found,
        agree: found.length ? found.every(f => f.value === found[0].value) : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- tool 4: compare two periods
export function comparePeriods(table, roles, c1, c2, labelCol) {
  const lines = [];
  table.rows.forEach((r, i) => {
    if (roles[i].role === "check") return;
    const a = cell(table, i, c1), b = cell(table, i, c2);
    const A = a.kind === "num" ? a.cents : null, B = b.kind === "num" ? b.cents : null;
    const change = A !== null && B !== null ? B - A : null;
    const pct = change !== null && A !== 0 ? (change / absC(A)) * 100 : null;
    const flags = [];
    if (A === null) flags.push(`${table.header[c1]} is ${a.kind === "blank" ? "blank" : "not a number"}`);
    if (B === null) flags.push(`${table.header[c2]} is ${b.kind === "blank" ? "blank" : "not a number"}`);
    if (A !== null && B !== null && A < 0 !== B < 0 && A !== 0 && B !== 0) flags.push("changed sign");
    lines.push({ row: i, label: label(table, labelCol, i), role: roles[i].role, from: A, to: B, change, pct, flags });
  });
  const totalAbs = Math.max(1, ...lines.filter(l => l.role === "totalAssets" && l.from !== null).map(l => absC(l.from)));
  lines.forEach(l => { if (l.change !== null && absC(l.change) >= 0.05 * totalAbs && l.pct !== null && absC(l.pct) >= 50) l.flags.push("large swing"); });
  const reconcile = [];
  const sumChange = rowsIdx => rowsIdx.reduce((s, i) => { const l = lines.find(x => x.row === i); return s + (l && l.change !== null ? l.change : 0); }, 0);
  const idx = role => roles.map((x, i) => (x.role === role ? i : -1)).filter(i => i >= 0);
  const chg = i => lines.find(x => x.row === i)?.change ?? null;
  const TA = idx("totalAssets")[0], TL = idx("totalLiabilities")[0], TE = idx("totalEquity")[0];
  const any = idx("asset").some(i => chg(i) === null) || idx("liability").some(i => chg(i) === null);
  if (TA !== undefined && idx("asset").length && chg(TA) !== null) reconcile.push({ title: "Change in total assets vs the changes in the asset lines", total: chg(TA), parts: sumChange(idx("asset")), ok: chg(TA) === sumChange(idx("asset")) });
  if (TL !== undefined && idx("liability").length && chg(TL) !== null) reconcile.push({ title: "Change in total liabilities vs the changes in the liability lines", total: chg(TL), parts: sumChange(idx("liability")), ok: chg(TL) === sumChange(idx("liability")) });
  if (TA !== undefined && TL !== undefined && chg(TA) !== null && chg(TL) !== null) {
    const eq = TE !== undefined ? chg(TE) : (idx("equity").every(i => chg(i) !== null) ? sumChange(idx("equity")) : null);
    if (eq !== null) reconcile.push({ title: "Change in assets vs change in liabilities + equity", total: chg(TA), parts: chg(TL) + eq, ok: chg(TA) === chg(TL) + eq });
  }
  return { lines, reconcile, incomplete: any };
}

// ---------------------------------------------------------------- tool 5: ratios
export function ratios(table, roles, amountCols, labelCol) {
  const out = [];
  for (const c of amountCols) {
    const v = r => value(table, r, c);
    const sumRows = pred => roles.map((x, i) => (pred(x, i) ? i : -1)).filter(i => i >= 0).reduce((s, i) => s + v(i), 0);
    const have = pred => roles.some((x, i) => pred(x, i));
    const CA = sumRows(x => x.role === "asset" && x.term === "current"), CL = sumRows(x => x.role === "liability" && x.term === "current");
    const inv = sumRows((x, i) => x.role === "asset" && x.term === "current" && /inventor|stock in trade|stores/i.test(table.rows[i][labelCol] || ""));
    const TAi = roles.findIndex(x => x.role === "totalAssets"), TLi = roles.findIndex(x => x.role === "totalLiabilities"), TEi = roles.findIndex(x => x.role === "totalEquity");
    const TA = TAi >= 0 ? v(TAi) : sumRows(x => x.role === "asset"), TL = TLi >= 0 ? v(TLi) : sumRows(x => x.role === "liability"), TE = TEi >= 0 ? v(TEi) : sumRows(x => x.role === "equity");
    const r = [];
    const hasCurrent = have(x => x.role === "asset" && x.term === "current") && have(x => x.role === "liability" && x.term === "current");
    if (hasCurrent) {
      r.push({ name: "Working capital", value: fmt(CA - CL), meaning: CA - CL >= 0 ? "Short-term assets cover short-term bills." : "Short-term bills are larger than short-term assets." });
      if (CL !== 0) {
        const cr = CA / CL; r.push({ name: "Current ratio", value: cr.toFixed(2), meaning: cr < 1 ? "Below 1: short-term bills exceed short-term assets." : cr < 2 ? "Between 1 and 2: short-term bills are covered." : "Above 2: short-term bills are covered with room to spare." });
        const qr = (CA - inv) / CL; r.push({ name: "Quick ratio (without inventory)", value: qr.toFixed(2), meaning: qr < 1 ? "Below 1: without selling stock, short-term bills are not fully covered." : "At least 1: short-term bills are covered even without selling stock." });
      }
    }
    if (TE !== 0) { const de = TL / TE; r.push({ name: "Debt-to-equity", value: de.toFixed(2), meaning: `Liabilities are ${de.toFixed(2)} times the owners' equity.` }); }
    if (TA !== 0) { const er = (TE / TA) * 100; r.push({ name: "Equity share of assets", value: er.toFixed(1) + "%", meaning: `Owners fund ${er.toFixed(1)}% of the assets; the rest is funded by liabilities.` }); }
    const missing = [];
    roles.forEach((x, i) => { if (x.role !== "other" && x.role !== "check" && cell(table, i, c).kind !== "num") missing.push(label(table, labelCol, i)); });
    out.push({ period: c, ratios: r, note: missing.length ? `Not a number, counted as 0: ${missing.join(", ")}. The ratios may be wrong until these are filled in.` : "", needs: hasCurrent ? "" : "To get working capital and the current ratio, mark which lines are current (put 'Current' in the category text or set the Term column)." });
  }
  return out;
}

// ---------------------------------------------------------------- tool 2: which single mistake explains the gap?
export const MISTAKES = ["digits swapped", "decimal point slipped", "entry counted twice", "sign flipped", "one digit wrong", "digit missing or extra", "an entry is missing from the list"];
const DIG = "0123456789";

function toScaled(str, K) {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(str.trim());
  if (!m || (m[2] === "" && !(m[3] || ""))) return null;
  const frac = m[3] || ""; if (frac.length > K) return null;
  const v = BigInt((m[2] || "0") + frac.padEnd(K, "0"));
  return m[1] ? -v : v;
}
function digitEdits(txt) {
  const neg = txt.startsWith("-"), body = neg ? txt.slice(1) : txt, sg = neg ? "-" : "", out = [];
  const pos = [...body].map((c, i) => (/\d/.test(c) ? i : -1)).filter(i => i >= 0);
  for (let k = 0; k + 1 < pos.length; k++) { const a = pos[k], b = pos[k + 1]; if (b === a + 1 && body[a] !== body[b]) out.push(["digits swapped", sg + body.slice(0, a) + body[b] + body[a] + body.slice(b + 1)]); }
  for (const i of pos) for (const d of DIG) if (d !== body[i]) out.push(["one digit wrong", sg + body.slice(0, i) + d + body.slice(i + 1)]);
  for (const i of pos) { const t = body.slice(0, i) + body.slice(i + 1); if (/\d/.test(t)) out.push(["digit missing or extra", sg + t]); }
  for (let i = 0; i <= body.length; i++) for (const d of DIG) out.push(["digit missing or extra", sg + body.slice(0, i) + d + body.slice(i)]);
  return out;
}
function show(v, K) { const neg = v < 0n; let s = (neg ? -v : v).toString().padStart(K + 1, "0"); const int = s.slice(0, s.length - K), fr = s.slice(s.length - K).replace(/0+$/, ""); return (neg ? "-" : "") + int + (fr ? "." + fr : ""); }

export function whyMismatch(entries, total) {
  const maxDec = Math.max(0, ...[...entries, total].map(s => ((/\.(\d+)/.exec(String(s).trim()) || [])[1] || "").length));
  const K = Math.min(8, maxDec + 1);
  const vals = entries.map(e => toScaled(String(e), K)), T = toScaled(String(total), K);
  if (T === null || vals.some(v => v === null)) throw new Error("unreadable number");
  const D = T - vals.reduce((a, b) => a + b, 0n);
  if (D === 0n) return { D, hypotheses: [], K };
  const found = new Map();
  const add = (kind, text, fixed) => {
    const key = fixed.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(String).join(",");
    const r = MISTAKES.indexOf(kind); if (!found.has(key) || r < found.get(key).rank) found.set(key, { rank: r, kind, text, fixed });
  };
  entries.forEach((e, i) => {
    const v = vals[i], rest = vals.filter((_, k) => k !== i);
    for (const [kind, t] of digitEdits(String(e).trim())) { const w = toScaled(t, K); if (w !== null && w !== v && w - v === D) add(kind, `entry ${i + 1} (${e}) should be ${t}`, [...rest, w]); }
    for (const w of [v * 10n, v / 10n]) if (w !== v && w - v === D) add("decimal point slipped", `entry ${i + 1} (${e}) should be ${show(w, K)}`, [...rest, w]);
    if (D === -v && v !== 0n) add("entry counted twice", `entry ${i + 1} (${e}) is in the list twice; remove one`, rest);
    if (D === -2n * v && v !== 0n) add("sign flipped", `entry ${i + 1} (${e}) should have the opposite sign`, [...rest, -v]);
  });
  add("an entry is missing from the list", `an entry of ${show(D, K)} is missing`, [...vals, D]);
  return { D, K, hypotheses: [...found.values()].sort((a, b) => a.rank - b.rank) };
}
