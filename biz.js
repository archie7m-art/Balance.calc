// biz.js -- everyday business calculators. Pure functions, no screen code. Money is in rupees (₹), held as whole paise.
//  QUICK tools: a small form (type numbers, get the answer).  TABLE tools: work on columns of the table on screen.
import { parseAmount, fmt } from "./engine.js";

const NF = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const n2 = x => NF.format(x);
export const rs = c => (c < 0 ? "-" : "") + "₹" + fmt(Math.abs(c));
const C = x => Math.round(x * 100);                 // rupees (float) -> paise
const rsx = x => rs(C(x));
const pc = x => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(1) + "%";
const sgn = x => (x > 0 ? "+" : "") + pc(x);
const qty = c => n2(c / 100);


// ======================================================================= QUICK TOOLS
// fields: kind "money" | "percent" | "number"; optional:true means blank is allowed (comes through as null)
// calc(v) -> {rows:[[label, text, strong?]], notes:[]}  or  {missing: "why not"}
export const QUICK = [
  { id: "margin", section: "profit", group: "Price and profit", name: "Margin and markup", sub: "from cost and selling price",
    fields: [{ id: "cost", label: "Cost price", kind: "money" }, { id: "price", label: "Selling price", kind: "money" }],
    calc: v => { if (v.price === 0 || v.cost === 0) return { missing: "Cost and selling price cannot be 0." }; const p = v.price - v.cost;
      return { rows: [["Profit per unit", rsx(p), true], ["Margin (profit ÷ selling price)", pc(p / v.price * 100), true], ["Markup (profit ÷ cost)", pc(p / v.cost * 100)]], notes: ["Margin is a share of the selling price. Markup is a share of the cost. They are different numbers."] }; } },
  { id: "pricemargin", section: "profit", group: "Price and profit", name: "Price for a margin", sub: "cost and the margin you want",
    fields: [{ id: "cost", label: "Cost price", kind: "money" }, { id: "m", label: "Margin wanted", kind: "percent" }],
    calc: v => { if (v.m >= 100) return { missing: "A margin of 100% or more is impossible: it would need a price without limit." }; const price = v.cost / (1 - v.m / 100), p = price - v.cost;
      return { rows: [["Selling price", rsx(price), true], ["Profit per unit", rsx(p)], ["Same thing as a markup of", v.cost === 0 ? "–" : pc(p / v.cost * 100)]], notes: [] }; } },
  { id: "pricemarkup", section: "profit", group: "Price and profit", name: "Price for a markup", sub: "cost and markup on cost",
    fields: [{ id: "cost", label: "Cost price", kind: "money" }, { id: "k", label: "Markup wanted", kind: "percent" }],
    calc: v => { const price = v.cost * (1 + v.k / 100), p = price - v.cost; return { rows: [["Selling price", rsx(price), true], ["Profit per unit", rsx(p)], ["Same thing as a margin of", price === 0 ? "–" : pc(p / price * 100)]], notes: [] }; } },
  { id: "discount", section: "profit", group: "Price and profit", name: "Discount", sub: "final price after one or two discounts",
    fields: [{ id: "price", label: "Original price", kind: "money" }, { id: "d1", label: "Discount", kind: "percent" }, { id: "d2", label: "Second discount (if any)", kind: "percent", optional: true }],
    calc: v => { const a = C(v.price), d2 = v.d2 || 0, fin = Math.round(a * (1 - v.d1 / 100) * (1 - d2 / 100)), saved = a - fin;
      return { rows: [["Final price", rs(fin), true], ["You save", rs(saved), true], ["Together that is a discount of", a === 0 ? "–" : pc(saved / a * 100)]], notes: d2 ? ["Two discounts do not add up: the second one is taken off the already reduced price."] : [] }; } },
  { id: "breakeven", section: "profit", group: "Price and profit", name: "Break-even", sub: "how much must I sell to cover costs",
    fields: [{ id: "fixed", label: "Fixed costs (rent, salaries...)", kind: "money" }, { id: "price", label: "Selling price per unit", kind: "money" }, { id: "vc", label: "Variable cost per unit", kind: "money" }, { id: "units", label: "Units you expect to sell (if you want to see profit)", kind: "number", optional: true }],
    calc: v => { const cu = v.price - v.vc; if (cu <= 0) return { missing: "The selling price must be more than the cost per unit. Otherwise every sale loses money and there is no break-even." };
      const be = Math.ceil(v.fixed / cu - 1e-9), rows = [["Profit per unit before fixed costs", rsx(cu)], ["Break-even units", n2(be), true], ["Break-even sales", rsx(be * v.price), true]];
      if (v.units) { rows.push(["Profit at your expected units", rsx(v.units * cu - v.fixed), true]); rows.push(["Margin of safety", pc((v.units - be) / v.units * 100)]); }
      return { rows, notes: ["Break-even units are rounded up to whole units.", ...(v.units ? ["Margin of safety = how far sales can fall before you start losing money."] : [])] }; } },
  { id: "pct", section: "profit", group: "Price and profit", name: "Percentage helper", sub: "x% of, and change from A to B",
    fields: [{ id: "a", label: "First number (A)", kind: "money" }, { id: "b", label: "Second number (B)", kind: "money" }],
    calc: v => { const rows = []; if (v.b !== 0) rows.push(["A as a percentage of B", pc(v.a / v.b * 100), true]); if (v.a !== 0) rows.push(["Change from A to B", sgn((v.b - v.a) / v.a * 100), true]); rows.push(["Difference (B − A)", rsx(v.b - v.a)]);
      return { rows, notes: [] }; } },
  { id: "reorder", section: "stock", group: "Stock planning", name: "Reorder level", sub: "when to place the next order",
    fields: [{ id: "daily", label: "Units sold per day", kind: "number" }, { id: "lead", label: "Days the supplier takes to deliver", kind: "number" }, { id: "safety", label: "Extra safety days of stock", kind: "number", optional: true }],
    calc: v => { const s = v.safety || 0; return { rows: [["Reorder level (units)", n2(Math.ceil(v.daily * (v.lead + s) - 1e-9)), true], ["Used while waiting for delivery", n2(v.daily * v.lead)], ["Safety stock", n2(v.daily * s)]], notes: ["When your stock falls to the reorder level, place a new order."] }; } },
  { id: "eoq", section: "stock", group: "Stock planning", name: "Best order size", sub: "economic order quantity (EOQ)",
    fields: [{ id: "d", label: "Units needed in a year", kind: "number" }, { id: "s", label: "Cost of placing one order", kind: "money" }, { id: "h", label: "Cost of keeping one unit for a year", kind: "money" }],
    calc: v => { if (v.h <= 0 || v.d <= 0) return { missing: "Units needed and holding cost must be more than 0." }; const q = Math.sqrt(2 * v.d * v.s / v.h);
      return { rows: [["Best order size (units)", n2(Math.round(q)), true], ["Orders per year", n2(v.d / q)], ["Days between orders", n2(Math.round(365 * q / v.d))], ["Yearly ordering + holding cost", rsx(v.d / q * v.s + q / 2 * v.h)]], notes: ["Assumes steady demand through the year."] }; } },
  { id: "turn", section: "stock", group: "Stock planning", name: "Stock turnover", sub: "how fast stock sells",
    fields: [{ id: "cogs", label: "Cost of goods sold in the year", kind: "money" }, { id: "avg", label: "Average stock value", kind: "money" }],
    calc: v => { if (v.avg <= 0 || v.cogs <= 0) return { missing: "Both figures must be more than 0." }; const t = v.cogs / v.avg; return { rows: [["Times stock was sold and replaced", n2(Math.round(t * 100) / 100) + " times", true], ["Days stock sits before selling", n2(Math.round(365 / t)) + " days", true]], notes: ["Assumes the cost covers one full year (365 days)."] }; } },
];

// ======================================================================= TABLE TOOLS
// picks: which columns the tool needs (kind "num" or "text"); params: choices; calc(ctx) -> blocks
// ctx = {t, pk (picked column index per id), pm (param values), amountCols}
// blocks: {type:"kv", title, rows:[[k,v,strong]], cls} | {type:"table", title, head, rows, rowCells} | {type:"note", cls, text}
const cellVal = (t, r, c) => { const p = parseAmount(t.rows[r][c]); return p.kind === "num" ? p.cents : null; };
const text = (t, r, c) => ((c === undefined || c === null ? "" : t.rows[r][c]) || "").trim();
const name = (t, r, c) => text(t, r, c) || `row ${r + 1}`;
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, " ");
function numbers(t, c) { const ok = [], skipped = []; t.rows.forEach((row, r) => { const v = cellVal(t, r, c); if (v === null) { if (row.some(x => String(x).trim() !== "")) skipped.push(r); } else ok.push({ r, v }); }); return { ok, skipped }; }
const skipNote = (t, c, skipped) => skipped.length ? [{ type: "note", cls: "warn", text: `${skipped.length} row${skipped.length > 1 ? "s" : ""} had no readable number in "${t.header[c]}" and ${skipped.length > 1 ? "were" : "was"} left out (row ${skipped.slice(0, 6).map(r => r + 1).join(", ")}${skipped.length > 6 ? "…" : ""}).` }] : [];
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const quart = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const none = msg => [{ type: "note", cls: "warn", text: msg }];

export function parseDate(s, dayFirst = true) {
  s = String(s ?? "").trim(); if (!s) return null;
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], mon = w => MON.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  let m, y, mo, d;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) { const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (dayFirst) { d = a; mo = b; } else { mo = a; d = b; } }
  else if ((m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,.-]+(\d{2,4})$/.exec(s))) { d = +m[1]; mo = mon(m[2]); y = +m[3]; if (y < 100) y += 2000; }
  else if ((m = /^([A-Za-z]{3,9})[\s.,-]+(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(\d{4})$/.exec(s))) { mo = mon(m[1]); d = +m[2]; y = +m[3]; }
  else if ((m = /^([A-Za-z]{3,9})[\s.,'-]+(\d{2,4})$/.exec(s))) { mo = mon(m[1]); d = 1; y = +m[2]; if (y < 100) y += 2000; }
  else return null;
  if (!(mo >= 1 && mo <= 12)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NPAR = { id: "n", label: "How many to show", options: [[5, "5"], [10, "10"], [20, "20"]], def: 5 };

export const TABLE_TOOLS = [
  // ---------------------------------------------------------------- profit and GST on a table
  { id: "profitcol", section: "profit", group: "On your table", name: "Profit per row", sub: "sales column minus cost column", picks: [{ id: "item", label: "Item names", kind: "text" }, { id: "sales", label: "Selling amount", kind: "num" }, { id: "cost", label: "Cost amount", kind: "num" }],
    calc: ({ t, pk }) => {
      const rows = []; let S = 0, K = 0, skipped = 0;
      t.rows.forEach((_, r) => { const s = cellVal(t, r, pk.sales), k = cellVal(t, r, pk.cost); if (s === null || k === null) { if (t.rows[r].some(x => String(x).trim())) skipped++; return; } rows.push({ r, s, k, p: s - k }); S += s; K += k; });
      if (!rows.length) return none("No row has a number in both columns.");
      const loss = rows.filter(x => x.p < 0).sort((a, b) => a.p - b.p);
      return [{ type: "kv", title: "Whole table", cls: "good", rows: [["Total sales", rs(S)], ["Total cost", rs(K)], ["Total profit", rs(S - K), true], ["Overall margin", S === 0 ? "–" : pc((S - K) / S * 100), true], ["Overall markup", K === 0 ? "–" : pc((S - K) / K * 100)]] },
        loss.length ? { type: "table", title: `${loss.length} row${loss.length > 1 ? "s" : ""} sold at a loss`, head: ["Item", "Sales", "Cost", "Loss"], rows: loss.slice(0, 15).map(x => [name(t, x.r, pk.item), rs(x.s), rs(x.k), rs(x.p)]), rowCells: loss.slice(0, 15).map(x => [[x.r, pk.sales], [x.r, pk.cost]]) } : { type: "note", cls: "good", text: "No row is sold below its cost." },
        { type: "table", title: "Most profitable rows", head: ["Item", "Profit", "Margin"], rows: [...rows].sort((a, b) => b.p - a.p).slice(0, 5).map(x => [name(t, x.r, pk.item), rs(x.p), x.s === 0 ? "–" : pc(x.p / x.s * 100)]) },
        ...(skipped ? [{ type: "note", cls: "warn", text: `${skipped} row(s) were left out because one of the two columns had no number.` }] : [])];
    } },
  // ---------------------------------------------------------------- table analysis
  { id: "totals", section: "analysis", group: "Understand a table", name: "Totals and averages", sub: "for every number column", picks: [],
    calc: ({ t, amountCols }) => {
      if (!amountCols.length) return none("No number columns found. Under a column's name choose Numbers.");
      const rows = [], blocks = [];
      for (const c of amountCols) { const { ok, skipped } = numbers(t, c); if (!ok.length) continue; const v = ok.map(x => x.v), sum = v.reduce((a, b) => a + b, 0); rows.push([t.header[c], String(v.length), rs(sum), rs(Math.round(sum / v.length)), rs(Math.min(...v)), rs(Math.max(...v)), rs(median(v))]); if (skipped.length) blocks.push(...skipNote(t, c, skipped)); }
      return [{ type: "table", title: "Number columns", head: ["Column", "Rows", "Total", "Average", "Smallest", "Largest", "Middle"], rows }, { type: "note", cls: "info", text: "Middle = the median: half the rows are above it, half below. It is less affected by one huge value than the average is." }, ...blocks];
    } },
  { id: "topbottom", section: "analysis", group: "Understand a table", name: "Biggest and smallest", sub: "the top and bottom rows", picks: [{ id: "item", label: "Names", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }], params: [NPAR],
    calc: ({ t, pk, pm }) => {
      const { ok, skipped } = numbers(t, pk.amount), n = +pm.n; if (!ok.length) return none("No numbers in that column.");
      const mk = (title, list) => ({ type: "table", title, head: ["#", "Name", "Amount"], rows: list.map((x, i) => [String(i + 1), name(t, x.r, pk.item), rs(x.v)]), rowCells: list.map(x => [[x.r, pk.amount]]) });
      return [mk(`Biggest ${Math.min(n, ok.length)}`, [...ok].sort((a, b) => b.v - a.v).slice(0, n)), mk(`Smallest ${Math.min(n, ok.length)}`, [...ok].sort((a, b) => a.v - b.v).slice(0, n)), ...skipNote(t, pk.amount, skipped)];
    } },
  { id: "share", section: "analysis", group: "Understand a table", name: "Share of total", sub: "each row as % of the whole", picks: [{ id: "item", label: "Names", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }],
    calc: ({ t, pk }) => {
      const { ok, skipped } = numbers(t, pk.amount), tot = ok.reduce((a, x) => a + x.v, 0); if (!ok.length || tot === 0) return none("The column adds up to 0 or has no numbers, so shares cannot be worked out.");
      let run = 0;
      return [{ type: "kv", title: "Total", cls: "info", rows: [[t.header[pk.amount], rs(tot), true]] },
        { type: "table", title: "Biggest first", head: ["Name", "Amount", "Share", "Running"], rows: [...ok].sort((a, b) => b.v - a.v).map(x => { run += x.v; return [name(t, x.r, pk.item), rs(x.v), pc(x.v / tot * 100), pc(run / tot * 100)]; }), rowCells: [...ok].sort((a, b) => b.v - a.v).map(x => [[x.r, pk.amount]]) }, ...skipNote(t, pk.amount, skipped)];
    } },
  { id: "pareto", section: "analysis", group: "Understand a table", name: "80/20 rule", sub: "the few rows that make most of it", picks: [{ id: "item", label: "Names", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }],
    calc: ({ t, pk }) => {
      const { ok } = numbers(t, pk.amount), pos = ok.filter(x => x.v > 0).sort((a, b) => b.v - a.v), tot = pos.reduce((a, x) => a + x.v, 0); if (!pos.length) return none("No positive numbers in that column.");
      let run = 0, k = 0; while (k < pos.length && run < 0.8 * tot - 1e-9) { run += pos[k].v; k++; }
      return [{ type: "kv", title: "Result", cls: "good", rows: [[`Rows that make up 80% of the total`, `${k} of ${pos.length} (${pc(k / pos.length * 100)})`, true], ["Their share of the total", pc(run / tot * 100)]] },
        { type: "table", title: "These rows", head: ["Name", "Amount", "Share"], rows: pos.slice(0, Math.min(k, 25)).map(x => [name(t, x.r, pk.item), rs(x.v), pc(x.v / tot * 100)]), rowCells: pos.slice(0, Math.min(k, 25)).map(x => [[x.r, pk.amount]]) },
        { type: "note", cls: "info", text: "Only positive amounts are counted. In many businesses a small share of customers or items brings most of the money; this shows how true that is for your table." }];
    } },
  { id: "groups", section: "analysis", group: "Understand a table", name: "Totals by group", sub: "e.g. by category, branch, customer", picks: [{ id: "group", label: "Group by", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }],
    calc: ({ t, pk }) => {
      const { ok, skipped } = numbers(t, pk.amount), G = new Map(); let tot = 0;
      for (const { r, v } of ok) { const k = norm(text(t, r, pk.group)) || "(blank)"; const g = G.get(k) || { name: text(t, r, pk.group) || "(blank)", sum: 0, n: 0, rows: [] }; g.sum += v; g.n++; g.rows.push(r); G.set(k, g); tot += v; }
      const list = [...G.values()].sort((a, b) => b.sum - a.sum); if (!list.length) return none("No numbers in that column.");
      return [{ type: "table", title: `${list.length} groups`, head: ["Group", "Rows", "Total", "Average", "Share"], rows: list.map(g => [g.name, String(g.n), rs(g.sum), rs(Math.round(g.sum / g.n)), tot === 0 ? "–" : pc(g.sum / tot * 100)]), rowCells: list.map(g => g.rows.map(r => [r, pk.amount])) },
        { type: "kv", title: "All groups together", cls: "info", rows: [["Total", rs(tot), true]] }, { type: "note", cls: "info", text: "Capital letters and extra spaces are ignored ('Cash' and 'cash ' are one group). Different spellings such as 'Cash sale' are separate groups; fix them in the table if you want them together." }, ...skipNote(t, pk.amount, skipped)];
    } },
  { id: "dups", section: "analysis", group: "Check a table", name: "Find duplicates", sub: "rows that may be entered twice", picks: [{ id: "item", label: "Names", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }],
    calc: ({ t, pk }) => {
      const full = new Map(), part = new Map();
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const k1 = row.map(norm).join("\u0001"); (full.get(k1) || full.set(k1, []).get(k1)).push(r);
        const v = cellVal(t, r, pk.amount), nm = norm(text(t, r, pk.item)); if (v !== null && nm) { const k2 = nm + "\u0001" + v; (part.get(k2) || part.set(k2, []).get(k2)).push(r); } });
      const groups = []; const used = new Set();
      for (const rs_ of full.values()) if (rs_.length > 1) { groups.push({ rows: rs_, why: "Whole row is identical" }); rs_.forEach(r => used.add(r)); }
      for (const rs_ of part.values()) if (rs_.length > 1 && !rs_.every(r => used.has(r))) groups.push({ rows: rs_, why: "Same name and same amount" });
      if (!groups.length) return [{ type: "note", cls: "good", text: "No duplicate rows found." }];
      return [{ type: "table", title: `${groups.length} possible duplicate${groups.length > 1 ? "s" : ""}`, head: ["Rows", "Name", "Amount", "Why"], rows: groups.map(g => [g.rows.map(r => r + 1).join(", "), name(t, g.rows[0], pk.item), text(t, g.rows[0], pk.amount), g.why]), rowCells: groups.map(g => g.rows.map(r => [r, pk.amount])) },
        { type: "note", cls: "info", text: "Two identical sales on one day can be genuine. Check the original bills before deleting a row." }];
    } },
  { id: "odd", section: "analysis", group: "Check a table", name: "Odd values", sub: "blanks, text in numbers, outliers", picks: [],
    calc: ({ t, amountCols }) => {
      if (!amountCols.length) return none("No number columns found. Under a column's name choose Numbers.");
      const bad = [], cells = [];
      for (const c of amountCols) {
        const vals = [];
        t.rows.forEach((row, r) => { const p = parseAmount(row[c]); if (p.kind === "num") vals.push({ r, v: p.cents }); else if (row.some(x => String(x).trim())) { bad.push([r + 1, t.header[c], text(t, r, c) || "(blank)", p.kind === "blank" ? "Blank" : "Not a number"]); cells.push([[r, c]]); } });
        if (vals.length >= 8) { const s = vals.map(x => x.v).sort((a, b) => a - b), q1 = quart(s, .25), q3 = quart(s, .75), iqr = q3 - q1, lo = q1 - 3 * iqr, hi = q3 + 3 * iqr;
          for (const x of vals) if (iqr > 0 && (x.v < lo || x.v > hi)) { bad.push([x.r + 1, t.header[c], text(t, x.r, c), "Far from the others"]); cells.push([[x.r, c]]); } }
        for (const x of vals) if (x.v < 0) { bad.push([x.r + 1, t.header[c], text(t, x.r, c), "Negative"]); cells.push([[x.r, c]]); }
      }
      if (!bad.length) return [{ type: "note", cls: "good", text: "Nothing odd found in the number columns." }];
      return [{ type: "table", title: `${bad.length} cell${bad.length > 1 ? "s" : ""} to look at`, head: ["Row", "Column", "Cell", "Problem"], rows: bad, rowCells: cells }, { type: "note", cls: "info", text: "Odd is not the same as wrong. A negative can be a refund; a far-out number can be a real big order. These are only the cells worth a second look. 'Far from the others' needs at least 8 numbers in the column." }];
    } },

  // ---------------------------------------------------------------- sales and stock
  { id: "stockval", section: "stock", group: "On your table", name: "Stock value", sub: "quantity × cost for every item", picks: [{ id: "item", label: "Item names", kind: "text" }, { id: "qty", label: "Quantity", kind: "num" }, { id: "cost", label: "Cost per unit", kind: "num" }],
    calc: ({ t, pk }) => {
      const rows = []; let skipped = 0;
      t.rows.forEach((row, r) => { const q = cellVal(t, r, pk.qty), c = cellVal(t, r, pk.cost); if (q === null || c === null) { if (row.some(x => String(x).trim())) skipped++; return; } rows.push({ r, q, c, v: Math.round(q * c / 100) }); });
      if (!rows.length) return none("No row has a number in both the quantity and the cost column.");
      const tot = rows.reduce((a, x) => a + x.v, 0), neg = rows.filter(x => x.q < 0).length;
      return [{ type: "kv", title: "Stock on hand", cls: "good", rows: [["Total stock value", rs(tot), true], ["Items counted", String(rows.length)], ["Total units", qty(rows.reduce((a, x) => a + x.q, 0))]] },
        { type: "table", title: "Most money tied up", head: ["Item", "Qty", "Unit cost", "Value", "Share"], rows: [...rows].sort((a, b) => b.v - a.v).slice(0, 10).map(x => [name(t, x.r, pk.item), qty(x.q), rs(x.c), rs(x.v), tot === 0 ? "–" : pc(x.v / tot * 100)]), rowCells: [...rows].sort((a, b) => b.v - a.v).slice(0, 10).map(x => [[x.r, pk.qty], [x.r, pk.cost]]) },
        ...(neg ? [{ type: "note", cls: "warn", text: `${neg} item(s) have a negative quantity. That usually means a mistake in the stock list.` }] : []), ...(skipped ? [{ type: "note", cls: "warn", text: `${skipped} row(s) were left out because quantity or cost was missing.` }] : [])];
    } },
  { id: "lowstock", section: "stock", group: "On your table", name: "Low stock", sub: "items at or below reorder level", picks: [{ id: "item", label: "Item names", kind: "text" }, { id: "qty", label: "Quantity in stock", kind: "num" }, { id: "reorder", label: "Reorder level", kind: "num" }],
    calc: ({ t, pk }) => {
      const low = []; let n = 0;
      t.rows.forEach((_, r) => { const q = cellVal(t, r, pk.qty), lv = cellVal(t, r, pk.reorder); if (q === null || lv === null) return; n++; if (q <= lv) low.push({ r, q, lv }); });
      if (!n) return none("No row has a number in both the quantity and the reorder level column.");
      if (!low.length) return [{ type: "note", cls: "good", text: `All ${n} items are above their reorder level.` }];
      low.sort((a, b) => (a.q - a.lv) - (b.q - b.lv));
      return [{ type: "table", title: `${low.length} of ${n} items need ordering`, head: ["Item", "In stock", "Reorder level", "Short by"], rows: low.map(x => [name(t, x.r, pk.item) + (x.q <= 0 ? " (out of stock)" : ""), qty(x.q), qty(x.lv), qty(x.lv - x.q)]), rowCells: low.map(x => [[x.r, pk.qty], [x.r, pk.reorder]]) }];
    } },
  { id: "topsellers", section: "stock", group: "On your table", name: "Top sellers", sub: "best items, even if listed many times", picks: [{ id: "item", label: "Item names", kind: "text" }, { id: "amount", label: "Sales amount", kind: "num" }], params: [NPAR],
    calc: ({ t, pk, pm }) => {
      const { ok, skipped } = numbers(t, pk.amount), G = new Map(); let tot = 0;
      for (const { r, v } of ok) { const k = norm(text(t, r, pk.item)) || "(blank)"; const g = G.get(k) || { name: text(t, r, pk.item) || "(blank)", sum: 0, n: 0, rows: [] }; g.sum += v; g.n++; g.rows.push(r); G.set(k, g); tot += v; }
      const list = [...G.values()].sort((a, b) => b.sum - a.sum); if (!list.length) return none("No numbers in that column.");
      const top = list.slice(0, +pm.n);
      return [{ type: "table", title: `Top ${top.length} of ${list.length} items`, head: ["#", "Item", "Sales", "Share", "Times"], rows: top.map((g, i) => [String(i + 1), g.name, rs(g.sum), tot === 0 ? "–" : pc(g.sum / tot * 100), String(g.n)]), rowCells: top.map(g => g.rows.map(r => [r, pk.amount])) },
        { type: "kv", title: "All sales", cls: "info", rows: [["Total", rs(tot), true]] }, ...skipNote(t, pk.amount, skipped)];
    } },
  { id: "bymonth", section: "stock", group: "On your table", name: "Sales by month", sub: "totals per month and the trend", picks: [{ id: "date", label: "Date column", kind: "text" }, { id: "amount", label: "Amount", kind: "num" }],
    params: [{ id: "order", label: "Dates are written", options: [["dmy", "Day first (15/01/2026)"], ["mdy", "Month first (01/15/2026)"]], def: "dmy" }],
    calc: ({ t, pk, pm }) => {
      const M = new Map(), badDates = []; let tot = 0, nrows = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const v = cellVal(t, r, pk.amount); if (v === null) return; const d = parseDate(text(t, r, pk.date), pm.order === "dmy"); if (!d) { badDates.push(r + 1); return; }
        const k = d.y * 100 + d.m, g = M.get(k) || { y: d.y, m: d.m, sum: 0, n: 0, rows: [] }; g.sum += v; g.n++; g.rows.push(r); M.set(k, g); tot += v; nrows++; });
      const list = [...M.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]); if (!list.length) return none("I could not read any dates in that column. Try the other date order, or write dates like 2026-01-15.");
      const best = [...list].sort((a, b) => b.sum - a.sum)[0], worst = [...list].sort((a, b) => a.sum - b.sum)[0];
      const out = [{ type: "table", title: `${list.length} month${list.length > 1 ? "s" : ""}`, head: ["Month", "Total", "Change", "Rows"], rows: list.map((g, i) => [MONTHS[g.m - 1] + " " + g.y, rs(g.sum), i === 0 || list[i - 1].sum === 0 ? "–" : sgn((g.sum - list[i - 1].sum) / Math.abs(list[i - 1].sum) * 100), String(g.n)]), rowCells: list.map(g => g.rows.map(r => [r, pk.amount])) },
        { type: "kv", title: "Summary", cls: "good", rows: [["Total", rs(tot), true], ["Best month", `${MONTHS[best.m - 1]} ${best.y}: ${rs(best.sum)}`], ["Weakest month", `${MONTHS[worst.m - 1]} ${worst.y}: ${rs(worst.sum)}`], ["Average per month", rs(Math.round(tot / list.length))]] }];
      if (badDates.length) out.push({ type: "note", cls: "warn", text: `${badDates.length} row(s) have a date I could not read and were left out (row ${badDates.slice(0, 6).join(", ")}${badDates.length > 6 ? "…" : ""}).` });
      out.push({ type: "note", cls: "info", text: `I read dates as ${pm.order === "dmy" ? "day first, so 03/04/2026 is 3 April" : "month first, so 03/04/2026 is April 3"}. Change this above if that is wrong. Months with no rows are not shown.` });
      return out;
    } },
];

export const BIZ = [...QUICK.map(q => ({ ...q, kind: "quick" })), ...TABLE_TOOLS.map(q => ({ ...q, kind: "table" }))];

export { pc, C, rsx, cellVal, text, name, norm, numbers, skipNote, none };
