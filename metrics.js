// metrics.js -- the ready-made measures behind the buttons. Pure functions, no screen code.
// Each measure says which figures it needs, its formula, and a plain-words reading.
// The "readings" are rules of thumb: what is normal depends on the kind of business.
import { parseAmount, fmt } from "./engine.js";

const RE = {
  cash: /\bcash\b|bank balance|cash at bank/i,
  recv: /receivable|debtor/i,
  inv: /inventor|stock in trade|stores and spares|finished goods|raw material/i,
  pay: /payable|creditor/i,
  std: /short[\s-]?term (debt|borrowing|loan)|overdraft|current (portion|maturit)/i,
  ltd: /long[\s-]?term (debt|borrowing|loan)|term loan|debenture|bonds? payable|mortgage/i,
};

export const FIG_NAMES = { TA: "Total assets", TL: "Total liabilities", TE: "Total equity", CA: "Current assets", CL: "Current liabilities", NCA: "Non-current assets", cash: "Cash", recv: "Receivables", inv: "Inventory", pay: "Payables", std: "Short-term debt", ltd: "Long-term debt" };
export const EXTRA_NAMES = { sales: "Sales (revenue)", cogs: "Cost of goods sold", profit: "Net profit", ebit: "Operating profit (EBIT)", interest: "Interest paid" };
const HOW = {
  TA: "a row typed as Total assets, or rows typed as Asset line", TL: "a row typed as Total liabilities, or rows typed as Liability line", TE: "a row typed as Total equity, or rows typed as Equity line (or both totals above)",
  CA: "asset rows with the word Current in their text (or set the row's Type)", CL: "liability rows with the word Current in their text", cash: "an asset row named like Cash", recv: "an asset row named like Receivables or Debtors",
  inv: "an asset row named like Inventory or Stock", pay: "a liability row named like Payables or Creditors", std: "a liability row named like Short-term debt or Overdraft", ltd: "a liability row named like Long-term debt or Term loan",
};

/** The figures of one period, found by row Type and by words in the row names. null = not found. */
export function figures(table, roles, c, labelCol) {
  const val = r => { const p = parseAmount(table.rows[r][c]); return p.kind === "num" ? p.cents : 0; };
  const lab = i => table.rows[i][labelCol] || "";
  const rowsOf = pred => roles.map((x, i) => (pred(x, i) ? i : -1)).filter(i => i >= 0);
  const make = rs => (rs.length ? { v: rs.reduce((s, r) => s + val(r), 0), names: rs.map(lab) } : null);
  const total = (role, lines) => { const t = rowsOf(x => x.role === role)[0]; return t !== undefined ? { v: val(t), names: [lab(t)] } : make(lines); };
  const A = rowsOf(x => x.role === "asset"), L = rowsOf(x => x.role === "liability"), E = rowsOf(x => x.role === "equity");
  const f = {
    TA: total("totalAssets", A), TL: total("totalLiabilities", L), TE: total("totalEquity", E),
    CA: make(rowsOf(x => x.role === "asset" && x.term === "current")), CL: make(rowsOf(x => x.role === "liability" && x.term === "current")),
    NCA: make(rowsOf(x => x.role === "asset" && x.term === "noncurrent")),
    cash: make(rowsOf((x, i) => x.role === "asset" && RE.cash.test(lab(i)))), recv: make(rowsOf((x, i) => x.role === "asset" && RE.recv.test(lab(i)))),
    inv: make(rowsOf((x, i) => x.role === "asset" && RE.inv.test(lab(i)))), pay: make(rowsOf((x, i) => x.role === "liability" && RE.pay.test(lab(i)))),
    std: make(rowsOf((x, i) => x.role === "liability" && RE.std.test(lab(i)))), ltd: make(rowsOf((x, i) => x.role === "liability" && RE.ltd.test(lab(i)))),
  };
  if (!f.TE && f.TA && f.TL) f.TE = { v: f.TA.v - f.TL.v, names: ["Total assets − total liabilities"] };
  return f;
}

const r2 = n => n.toFixed(2), p1 = n => n.toFixed(1) + "%", d0 = n => Math.round(n) + " days";
const money = c => fmt(c);

// need: balance sheet figures needed; opt: figures used if present (otherwise counted as 0); ex: figures typed in by the person
// calc(f, x) -> {value, meaning}  (f = figures in cents, x = typed figures in cents). Return null when a divisor is 0.
export const METRICS = [
  { id: "wc", group: "Short-term safety", name: "Working capital", sub: "short-term assets minus bills", need: ["CA", "CL"], formula: "Current assets − Current liabilities",
    calc: f => { const v = f.CA - f.CL; return { value: money(v), meaning: v >= 0 ? "Short-term assets cover short-term bills." : "Short-term bills are bigger than short-term assets." }; } },
  { id: "cr", group: "Short-term safety", name: "Current ratio", sub: "can I pay this year's bills", need: ["CA", "CL"], formula: "Current assets ÷ Current liabilities",
    calc: f => f.CL === 0 ? null : (v => ({ value: r2(v), meaning: v < 1 ? "Below 1: short-term bills exceed short-term assets." : v < 2 ? "Between 1 and 2: bills are covered." : "Above 2: bills are covered with room to spare." }))(f.CA / f.CL) },
  { id: "qr", group: "Short-term safety", name: "Quick ratio", sub: "without selling stock", need: ["CA", "CL"], opt: ["inv"], formula: "(Current assets − Inventory) ÷ Current liabilities",
    calc: f => f.CL === 0 ? null : (v => ({ value: r2(v), meaning: v < 1 ? "Below 1: without selling stock, bills are not fully covered." : "At least 1: bills are covered even without selling stock." }))((f.CA - f.inv) / f.CL) },
  { id: "cashr", group: "Short-term safety", name: "Cash ratio", sub: "cash against bills", need: ["cash", "CL"], formula: "Cash ÷ Current liabilities",
    calc: f => f.CL === 0 ? null : (v => ({ value: r2(v), meaning: v < 0.2 ? "Under 0.2: cash is thin compared with short-term bills." : v < 1 ? "0.2 to 1: a reasonable cash cushion." : "Above 1: cash alone covers all short-term bills." }))(f.cash / f.CL) },
  { id: "clshare", group: "Short-term safety", name: "Short-term share of debt", sub: "how much falls due soon", need: ["CL", "TL"], formula: "Current liabilities ÷ Total liabilities",
    calc: f => f.TL === 0 ? null : (v => ({ value: p1(v * 100), meaning: v > 0.7 ? "Most of what you owe falls due within a year." : "A good part of what you owe is long-term." }))(f.CL / f.TL) },
  { id: "casa", group: "Short-term safety", name: "Short-term share of assets", sub: "how liquid is what you own", need: ["CA", "TA"], formula: "Current assets ÷ Total assets",
    calc: f => f.TA === 0 ? null : (v => ({ value: p1(v * 100), meaning: "Share of your assets that can turn into cash within a year." }))(f.CA / f.TA) },

  { id: "de", group: "Debt and ownership", name: "Debt-to-equity", sub: "owed vs owner's money", need: ["TL", "TE"], formula: "Total liabilities ÷ Total equity",
    calc: f => f.TE === 0 ? null : (v => ({ value: r2(v), meaning: f.TE < 0 ? "Equity is negative: the business owes more than it owns." : v > 2 ? "Above 2: heavily funded by borrowing (high for most businesses)." : v > 1 ? "Between 1 and 2: more borrowed money than owner's money." : "Below 1: mostly funded by the owners." }))(f.TL / f.TE) },
  { id: "dr", group: "Debt and ownership", name: "Debt ratio", sub: "how much is owed", need: ["TL", "TA"], formula: "Total liabilities ÷ Total assets",
    calc: f => f.TA === 0 ? null : (v => ({ value: p1(v * 100), meaning: v > 0.6 ? "Above 60%: most of the assets are funded by what is owed." : "At most 60% of the assets are funded by what is owed." }))(f.TL / f.TA) },
  { id: "er", group: "Debt and ownership", name: "Equity ratio", sub: "owner's share of assets", need: ["TE", "TA"], formula: "Total equity ÷ Total assets",
    calc: f => f.TA === 0 ? null : (v => ({ value: p1(v * 100), meaning: `Owners fund ${p1(v * 100)} of the assets; the rest is funded by liabilities.` }))(f.TE / f.TA) },
  { id: "em", group: "Debt and ownership", name: "Equity multiplier", sub: "assets per rupee of equity", need: ["TA", "TE"], formula: "Total assets ÷ Total equity",
    calc: f => f.TE === 0 ? null : (v => ({ value: r2(v), meaning: `Every 1 of owner's money supports ${r2(v)} of assets. Higher means more borrowing.` }))(f.TA / f.TE) },
  { id: "td", group: "Debt and ownership", name: "Total debt", sub: "borrowings only", need: [], opt: ["std", "ltd"], needAny: ["std", "ltd"], formula: "Short-term debt + Long-term debt",
    calc: f => ({ value: money(f.std + f.ltd), meaning: "Money borrowed from banks or lenders. It excludes bills owed to suppliers." }) },
  { id: "nd", group: "Debt and ownership", name: "Net debt", sub: "debt minus cash", need: ["cash"], opt: ["std", "ltd"], needAny: ["std", "ltd"], formula: "Short-term debt + Long-term debt − Cash",
    calc: f => { const v = f.std + f.ltd - f.cash; return { value: money(v), meaning: v <= 0 ? "Cash is more than borrowings: no net debt." : "What would still be owed if all cash were used to repay borrowings." }; } },
  { id: "ltde", group: "Debt and ownership", name: "Long-term debt to equity", sub: "long loans vs owner's money", need: ["ltd", "TE"], formula: "Long-term debt ÷ Total equity",
    calc: f => f.TE === 0 ? null : (v => ({ value: r2(v), meaning: v > 1 ? "Above 1: long-term loans are bigger than the owner's money." : "At most 1: long-term loans are smaller than the owner's money." }))(f.ltd / f.TE) },

  { id: "roe", group: "Needs profit or sales", name: "Return on equity", sub: "profit per owner's money", need: ["TE"], ex: ["profit"], formula: "Net profit ÷ Total equity",
    calc: (f, x) => f.TE === 0 ? null : (v => ({ value: p1(v * 100), meaning: "Profit earned for each 100 of owner's money (uses the closing balance, not the average)." }))(x.profit / f.TE) },
  { id: "roa", group: "Needs profit or sales", name: "Return on assets", sub: "profit per asset", need: ["TA"], ex: ["profit"], formula: "Net profit ÷ Total assets",
    calc: (f, x) => f.TA === 0 ? null : (v => ({ value: p1(v * 100), meaning: "Profit earned for each 100 of assets (uses the closing balance, not the average)." }))(x.profit / f.TA) },
  { id: "npm", group: "Needs profit or sales", name: "Net profit margin", sub: "profit per 100 of sales", need: [], ex: ["profit", "sales"], formula: "Net profit ÷ Sales",
    calc: (f, x) => x.sales === 0 ? null : (v => ({ value: p1(v * 100), meaning: `Of every 100 of sales, ${p1(v * 100).replace("%", "")} stays as profit.` }))(x.profit / x.sales) },
  { id: "at", group: "Needs profit or sales", name: "Asset turnover", sub: "sales per asset", need: ["TA"], ex: ["sales"], formula: "Sales ÷ Total assets",
    calc: (f, x) => f.TA === 0 ? null : (v => ({ value: r2(v), meaning: `Every 1 of assets produced ${r2(v)} of sales.` }))(x.sales / f.TA) },
  { id: "it", group: "Needs profit or sales", name: "Inventory turnover", sub: "how often stock sells", need: ["inv"], ex: ["cogs"], formula: "Cost of goods sold ÷ Inventory",
    calc: (f, x) => f.inv === 0 ? null : (v => ({ value: r2(v) + " times", meaning: "How many times the stock was sold and replaced in the period. Higher usually means stock does not sit." }))(x.cogs / f.inv) },
  { id: "id", group: "Needs profit or sales", name: "Days of stock", sub: "how long stock sits", need: ["inv"], ex: ["cogs"], formula: "Inventory ÷ Cost of goods sold × 365",
    calc: (f, x) => x.cogs === 0 ? null : (v => ({ value: d0(v), meaning: "Average days the stock waits before it is sold (assumes the figures cover a full year)." }))(f.inv / x.cogs * 365) },
  { id: "rd", group: "Needs profit or sales", name: "Days to collect", sub: "how long customers take", need: ["recv"], ex: ["sales"], formula: "Receivables ÷ Sales × 365",
    calc: (f, x) => x.sales === 0 ? null : (v => ({ value: d0(v), meaning: "Average days customers take to pay (assumes the figures cover a full year, and all sales on credit)." }))(f.recv / x.sales * 365) },
  { id: "pd", group: "Needs profit or sales", name: "Days to pay", sub: "how long you take to pay", need: ["pay"], ex: ["cogs"], formula: "Payables ÷ Cost of goods sold × 365",
    calc: (f, x) => x.cogs === 0 ? null : (v => ({ value: d0(v), meaning: "Average days you take to pay suppliers (assumes a full year)." }))(f.pay / x.cogs * 365) },
  { id: "ccc", group: "Needs profit or sales", name: "Cash cycle", sub: "days cash is tied up", need: ["inv", "recv", "pay"], ex: ["cogs", "sales"], formula: "Days of stock + Days to collect − Days to pay",
    calc: (f, x) => x.cogs === 0 || x.sales === 0 ? null : (v => ({ value: d0(v), meaning: "Days between paying suppliers and getting paid by customers. Shorter is easier on cash." }))(f.inv / x.cogs * 365 + f.recv / x.sales * 365 - f.pay / x.cogs * 365) },
  { id: "ic", group: "Needs profit or sales", name: "Interest cover", sub: "profit vs interest", need: [], ex: ["ebit", "interest"], formula: "Operating profit ÷ Interest paid",
    calc: (f, x) => x.interest === 0 ? null : (v => ({ value: r2(v) + " times", meaning: v < 1.5 ? "Below 1.5: little room to pay interest if profit falls." : "Operating profit covers interest " + r2(v) + " times." }))(x.ebit / x.interest) },
];

/** Work out one measure for one period. Returns {value, formula, meaning, parts:[[name,text]], notes:[]} or {missing:"..."}. */
export function runMetric(m, table, roles, c, labelCol, extras = {}) {
  const f = figures(table, roles, c, labelCol), notes = [], fv = {}, xv = {}, parts = [];
  for (const k of m.need) { if (!f[k]) return { missing: `I could not find ${FIG_NAMES[k].toLowerCase()}. It needs ${HOW[k]}.` }; fv[k] = f[k].v; parts.push([FIG_NAMES[k], money(f[k].v)]); }
  for (const k of m.opt || []) { fv[k] = f[k] ? f[k].v : 0; if (f[k]) parts.push([FIG_NAMES[k], money(f[k].v)]); else if (!(m.needAny || []).includes(k)) notes.push(`No line like ${FIG_NAMES[k].toLowerCase()} was found, so it is counted as 0.`); }
  if (m.needAny && !m.needAny.some(k => f[k])) return { missing: `I could not find any borrowings. It needs ${m.needAny.map(k => HOW[k]).join(", or ")}.` };
  for (const k of m.ex || []) {
    const p = parseAmount(extras[k]);
    if (p.kind !== "num") return { missing: `Type in ${EXTRA_NAMES[k].toLowerCase()} for ${table.header[c]} in the box above.`, needsInput: true };
    xv[k] = p.cents; parts.push([EXTRA_NAMES[k], money(p.cents)]);
  }
  const r = m.calc(fv, xv);
  if (!r) return { missing: "A figure that this divides by is 0, so it cannot be worked out." };
  return { ...r, formula: m.formula, parts, notes };
}
