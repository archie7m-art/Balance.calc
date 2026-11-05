// gst.js -- tools for an Indian shopkeeper's GST work. Pure functions, no screen code. Money in rupees (₹), held as whole paise.
// RULES USED (checked against 2026 web sources; the government changes them often, so every result says "confirm on gst.gov.in"):
//  - Rate slabs since 22 Sep 2025: 0, 5, 18, 40 (plus 3 for gold/jewellery, 0.25 rough diamonds). 12% and 28% were removed; older bills may still show them.
//  - Late fee (s.47): GSTR-1 / GSTR-3B Rs 50 a day (25 CGST + 25 SGST), nil return Rs 20 (nil cap Rs 500); cap Rs 2,000 / 5,000 / 10,000 for yearly turnover up to 1.5 cr / 1.5-5 cr / above 5 cr.
//  - Interest on late tax payment (s.50): 18% a year on the net cash tax; 24% on wrongly claimed credit.
//  - Due dates: GSTR-1 11th, GSTR-3B 20th (monthly); QRMP: GSTR-1 13th, GSTR-3B 22nd or 24th by state group, PMT-06 25th, IFF 13th; composition CMP-08 18th after each quarter.
//  - Composition: limit Rs 1.5 cr (75 lakh in 8 hill/NE states; services Rs 50 lakh); rates 1% trader/manufacturer, 5% restaurant, 6% service; no tax on bills, no input credit.
//  - Set-off of credit: Rule 88A (IGST credit first against IGST; CGST credit against CGST then IGST; SGST credit against SGST then IGST; leftover IGST credit against CGST and SGST).
import { parseAmount } from "./engine.js";
import { rs, n2, pc, parseDate, cellVal, text, name, norm, numbers, skipNote, none, C, rsx } from "./biz.js";

export const RATE_CHIPS = [5, 18, 40, 3, 0];
const VALID_RATES = [0, 0.25, 1.5, 3, 5, 12, 18, 28, 40], OLD_RATES = [12, 28];
const CONFIRM = "Rules and dates change and the government often extends due dates. Confirm on gst.gov.in or with your accountant before you file.";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNum = ({ y, m, d }) => Date.UTC(y, m - 1, d) / 86400000;

export const STATES = { "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction" };

// ------------------------------------------------------------------ pure helpers
const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinCheckChar(g) { let s = 0; for (let i = 0; i < 14; i++) { const p = CH.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2); s += Math.floor(p / 36) + (p % 36); } return CH[(36 - (s % 36)) % 36]; }
/** returns {ok:true,state} or {ok:false, problem} */
export function checkGstin(raw) {
  const g = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!g) return { ok: false, problem: "Blank" };
  if (g.length !== 15) return { ok: false, problem: `${g.length} characters (a GSTIN has 15)` };
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, problem: "Wrong pattern (2 digits, 5 letters, 4 digits, letter, then 1-9/A-Z, Z, check character)" };
  if (!STATES[g.slice(0, 2)]) return { ok: false, problem: `Unknown state code ${g.slice(0, 2)}` };
  if (gstinCheckChar(g) !== g[14]) return { ok: false, problem: `Last character should be ${gstinCheckChar(g)}: probably a typing mistake` };
  return { ok: true, state: STATES[g.slice(0, 2)], pan: g.slice(2, 12) };
}

/** Set off input tax credit against output tax in the order of Rule 88A. All numbers in paise. */
export function setOff(out, itc) {
  let { i: oI, c: oC, s: oS } = out, { i: cI, c: cC, s: cS } = itc, x;
  x = Math.min(cI, oI); oI -= x; cI -= x;
  x = Math.min(cC, oC); oC -= x; cC -= x;
  x = Math.min(cS, oS); oS -= x; cS -= x;
  x = Math.min(cC, oI); oI -= x; cC -= x;
  x = Math.min(cS, oI); oI -= x; cS -= x;
  x = Math.min(cI, oC); oC -= x; cI -= x;
  x = Math.min(cI, oS); oS -= x; cI -= x;
  return { cash: { i: oI, c: oC, s: oS }, carry: { i: cI, c: cC, s: cS } };
}

const addM = (y, m, k) => { const t = y * 12 + (m - 1) + k; return [Math.floor(t / 12), (t % 12) + 1]; };
const label = (y, m, d) => `${d} ${MON[m - 1]} ${y}`;
/** upcoming due dates from `today` (a Date). scheme: monthly | qrmp | comp. group: g1 | g2 (QRMP GSTR-3B 22nd or 24th) */
export function upcomingDues(scheme, group, today, count = 8) {
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()), ev = [], y0 = today.getFullYear(), m0 = today.getMonth() + 1;
  const push = (y, m, d, what, forWhat) => ev.push({ t: Date.UTC(y, m - 1, d), date: label(y, m, d), what, forWhat });
  const period = (y, m) => `${MON[m - 1]} ${y}`;
  for (let k = -5; k <= 10; k++) {
    const [y, m] = addM(y0, m0, k), [ny, nm] = addM(y, m, 1);
    if (scheme === "monthly") { push(ny, nm, 11, "GSTR-1 (sales details)", "for " + period(y, m)); push(ny, nm, 20, "GSTR-3B (summary and tax payment)", "for " + period(y, m)); }
    else if (scheme === "qrmp") {
      const q = [3, 6, 9, 12].includes(m);
      const mo = ((m - 1) % 3) + 1; // 1,2,3 within the quarter (Apr-Jun, Jul-Sep, ...) because quarters start at Jan/Apr/Jul/Oct
      if (mo === 1 || mo === 2) { push(ny, nm, 13, "IFF (optional invoice upload)", "for " + period(y, m)); push(ny, nm, 25, "PMT-06 (monthly tax payment)", "for " + period(y, m)); }
      if (q) { const qs = addM(y, m, -2); push(ny, nm, 13, "GSTR-1 (quarterly)", `for ${MON[qs[1] - 1]}–${MON[m - 1]} ${y}`); push(ny, nm, group === "g1" ? 22 : 24, "GSTR-3B (quarterly)", `for ${MON[qs[1] - 1]}–${MON[m - 1]} ${y}`); }
    } else {
      if ([3, 6, 9, 12].includes(m)) { const qs = addM(y, m, -2); push(ny, nm, 18, "CMP-08 (quarterly tax payment)", `for ${MON[qs[1] - 1]}–${MON[m - 1]} ${y}`); }
      if (m === 3) push(y, 6, 30, "GSTR-4 (yearly return; confirm date on portal)", `for FY ${y - 1}-${String(y).slice(2)}`);
    }
  }
  return ev.filter(e => e.t >= t0).sort((a, b) => a.t - b.t).slice(0, count);
}

// ------------------------------------------------------------------ QUICK tools
export const GST_QUICK = [
  { id: "gstadd", section: "gst", group: "Bill calculators", name: "Add GST", sub: "price before GST → bill total",
    fields: [{ id: "amount", label: "Amount before GST", kind: "money" }, { id: "rate", label: "GST rate", kind: "percent", chips: RATE_CHIPS }],
    calc: v => { const a = C(v.amount), g = Math.round(a * v.rate / 100), h = Math.floor(g / 2);
      return { rows: [["Amount before GST", rs(a)], [`GST at ${v.rate}%`, rs(g), true], ["  CGST (half)", rs(h)], ["  SGST (other half)", rs(g - h)], ["Bill total", rs(a + g), true]], notes: ["Sale to another state: the whole GST is IGST.", "Bills before 22 Sep 2025 may use 12% or 28%: type those rates in the box."] }; } },
  { id: "gstremove", section: "gst", group: "Bill calculators", name: "Remove GST", sub: "bill total → price and GST inside",
    fields: [{ id: "total", label: "Bill total (GST included)", kind: "money" }, { id: "rate", label: "GST rate", kind: "percent", chips: RATE_CHIPS }],
    calc: v => { const t = C(v.total), base = Math.round(t * 100 / (100 + v.rate)), g = t - base, h = Math.floor(g / 2);
      return { rows: [["Bill total", rs(t)], ["Price before GST", rs(base), true], [`GST at ${v.rate}%`, rs(g), true], ["  CGST (half)", rs(h)], ["  SGST (other half)", rs(g - h)]], notes: [] }; } },
  { id: "gstpay", section: "gst", group: "Monthly return (GSTR-3B)", name: "GST to pay this month", sub: "tax on sales minus credit on purchases",
    fields: [{ id: "oc", label: "Tax on sales: CGST", kind: "money", optional: true }, { id: "os", label: "Tax on sales: SGST", kind: "money", optional: true }, { id: "oi", label: "Tax on sales: IGST", kind: "money", optional: true },
      { id: "cc", label: "Credit on purchases: CGST", kind: "money", optional: true }, { id: "cs", label: "Credit on purchases: SGST", kind: "money", optional: true }, { id: "ci", label: "Credit on purchases: IGST", kind: "money", optional: true }],
    calc: v => {
      if (["oc", "os", "oi", "cc", "cs", "ci"].every(k => v[k] === null || v[k] === undefined)) return { missing: "Type at least one amount. Tip: run 'Sales summary' and 'Purchase credit' on your lists first; they fill these boxes for you." };
      const g = k => C(v[k] || 0), r = setOff({ i: g("oi"), c: g("oc"), s: g("os") }, { i: g("ci"), c: g("cc"), s: g("cs") }), tot = r.cash.i + r.cash.c + r.cash.s, car = r.carry.i + r.carry.c + r.carry.s;
      return { rows: [["Cash to pay: CGST", rs(r.cash.c)], ["Cash to pay: SGST", rs(r.cash.s)], ["Cash to pay: IGST", rs(r.cash.i)], ["Total GST to pay in cash", rs(tot), true], ["Credit left to carry forward", rs(car), car > 0], ...(car > 0 ? [["  CGST / SGST / IGST left", `${rs(r.carry.c)} / ${rs(r.carry.s)} / ${rs(r.carry.i)}`]] : [])],
        notes: ["Credit is used in this order: IGST credit against IGST; CGST credit against CGST then IGST; SGST credit against SGST then IGST; any IGST credit left against CGST and SGST. CGST credit can never pay SGST, and the other way round.", "Pay by the 20th of next month (monthly filers). " + CONFIRM] }; } },
  { id: "gstcomp", section: "gst", group: "Composition scheme", name: "Composition tax", sub: "quarter's tax if you are in the scheme",
    fields: [{ id: "type", label: "Your business", kind: "choice", def: "t", options: [["t", "Trader (shop, wholesale), 1%"], ["m", "Manufacturer, 1%"], ["r", "Restaurant without alcohol, 5%"], ["s", "Service provider, 6%"]] },
      { id: "turn", label: "Turnover of this quarter", kind: "money" }, { id: "fy", label: "Turnover of the whole financial year so far (to check the limit)", kind: "money", optional: true },
      { id: "hill", label: "Is your state Arunachal, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura or Uttarakhand?", kind: "choice", def: "n", options: [["n", "No"], ["y", "Yes"]] }],
    calc: v => {
      const rate = { t: 1, m: 1, r: 5, s: 6 }[v.type], tax = Math.round(C(v.turn) * rate / 100), h = Math.floor(tax / 2), limit = v.type === "s" ? 5000000 : v.hill === "y" ? 7500000 : 15000000, rows = [["Rate", rate + "%"], ["Tax to pay (CMP-08)", rs(tax), true], ["  CGST (half)", rs(h)], ["  SGST (other half)", rs(tax - h)]];
      if (v.fy) rows.push(["Turnover limit for you", rs(limit * 100)], ["Used so far", pc(v.fy / limit * 100), v.fy > limit]);
      return { rows, notes: [...(v.fy && v.fy > limit ? ["Your turnover is over the limit: you cannot stay in the composition scheme. Talk to your accountant now."] : []), "Composition dealers pay this percentage on turnover, cannot charge GST on bills (issue a Bill of Supply), and cannot claim credit on purchases.", "Pay by the 18th of the month after the quarter (CMP-08). Not allowed in the scheme: sales to other states, sellers on e-commerce sites that collect tax, and makers of ice cream, pan masala, tobacco, aerated water. " + CONFIRM] }; } },
  { id: "gstlate", section: "gst", group: "Late filing", name: "Late fee and interest", sub: "what a late return will cost",
    fields: [{ id: "ret", label: "Return", kind: "choice", def: "3b", options: [["3b", "GSTR-3B"], ["1", "GSTR-1"], ["4", "GSTR-4 (composition, yearly)"], ["cmp", "CMP-08 (composition, quarterly)"]] },
      { id: "nil", label: "Was there tax to pay?", kind: "choice", def: "tax", options: [["tax", "Yes, tax or sales to report"], ["nil", "Nil return (no sales, no tax)"]] },
      { id: "turn", label: "Your turnover last year", kind: "choice", def: "a", options: [["a", "Up to ₹1.5 crore"], ["b", "₹1.5 crore to ₹5 crore"], ["c", "Above ₹5 crore"]] },
      { id: "due", label: "Due date (DD/MM/YYYY)", kind: "date" }, { id: "filed", label: "Date you file or filed (DD/MM/YYYY)", kind: "date" }, { id: "tax", label: "Tax paid late (cash tax after credit)", kind: "money", optional: true }],
    calc: v => {
      const days = v.filed - v.due; if (days <= 0) return { rows: [["Days late", "0", true], ["Late fee", rs(0)]], notes: ["Filed on or before the due date: no late fee and no interest."] };
      const nil = v.nil === "nil", per = nil ? 20 : 50, cap = nil ? 500 : (v.ret === "3b" || v.ret === "1") ? { a: 2000, b: 5000, c: 10000 }[v.turn] : 2000, fee = Math.min(days * per, cap) * 100, h = Math.floor(fee / 2);
      const rows = [["Days late", String(days)], ["Late fee", rs(fee), true], ["  CGST (half)", rs(h)], ["  SGST (other half)", rs(fee - h)]];
      let total = fee;
      if (v.tax && v.ret !== "1") { const int = Math.round(C(v.tax) * 0.18 * days / 365); rows.push(["Interest at 18% a year", rs(int), true]); total += int; }
      rows.push(["Total extra cost", rs(total), true]);
      return { rows, notes: [`Late fee is ₹${per} a day (half CGST, half SGST), capped at ₹${n2(cap)} for this return. Interest is 18% a year on the tax paid late, counted from the day after the due date. GSTR-1 has no tax to pay, so no interest.`, ...(v.ret === "4" || v.ret === "cmp" ? ["The late-fee rate for GSTR-4 and CMP-08 comes from one source: check it on the portal."] : []), "The portal may show less interest: since January 2026 it works out interest after taking off the cash balance you held in your ledger. Waiver schemes appear from time to time. " + CONFIRM] }; } },
  { id: "gstdue", section: "gst", group: "Late filing", name: "Due dates", sub: "your next filing dates",
    fields: [{ id: "scheme", label: "How do you file?", kind: "choice", def: "monthly", options: [["monthly", "Regular, every month (GSTR-1 and GSTR-3B)"], ["qrmp", "Regular, quarterly (QRMP scheme)"], ["comp", "Composition scheme"]] },
      { id: "group", label: "Your state (matters for quarterly GSTR-3B)", kind: "choice", def: "g2", options: [["g1", "Chhattisgarh, MP, Gujarat, Maharashtra, Karnataka, Goa, Kerala, Tamil Nadu, Telangana, Andhra, Puducherry, Andaman, Lakshadweep, Daman & Diu, Dadra & NH"], ["g2", "Any other state or territory"]] }],
    calc: (v, env) => { const ev = upcomingDues(v.scheme, v.group, env.today); return { rows: ev.map((e, i) => [`${e.what} ${e.forWhat}`, e.date, i === 0]), notes: ["These are the normal due dates. If a date falls on a holiday or the government extends it, the portal shows the new one. " + CONFIRM] }; } },
];

// ------------------------------------------------------------------ "check yourself" quick tools
const todayNum = env => Math.floor(Date.UTC(env.today.getFullYear(), env.today.getMonth(), env.today.getDate()) / 86400000);
const dFmt = n => { const d = new Date(n * 86400000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
GST_QUICK.push(
  { id: "regcheck", section: "gst", group: "Check yourself", name: "Do I need GST registration?", sub: "turnover limits and must-register cases",
    fields: [{ id: "supply", label: "What do you sell?", kind: "choice", def: "g", options: [["g", "Only goods (a shop, wholesale)"], ["s", "Services, or goods and services both"]] },
      { id: "special", label: "Is your state a special-category state? (most North-Eastern states and a few hill states; ask your accountant if unsure)", kind: "choice", def: "n", options: [["n", "No"], ["y", "Yes"]] },
      { id: "turn", label: "Yearly turnover, all India, all businesses on your PAN (sales, exempt, export, without GST)", kind: "money" },
      { id: "case", label: "Does any of these apply to you?", kind: "choice", def: "none", options: [["none", "None of these"], ["inter", "I sell goods to other states"], ["ecom", "I sell through an e-commerce site (Amazon, Flipkart...)"], ["rcm", "I must pay tax under reverse charge"], ["casual", "Casual or non-resident dealer"], ["tds", "I must deduct TDS or TCS under GST"]] }],
    calc: v => {
      const limit = (v.supply === "g" ? 4000000 : 2000000) / (v.special === "y" ? 2 : 1), rows = [];
      if (v.case !== "none") return { rows: [["Registration needed?", "Yes, from day one", true], ["Why", { inter: "Selling goods to other states", ecom: "Selling through an e-commerce site", rcm: "Liable to pay tax under reverse charge", casual: "Casual or non-resident dealer", tds: "Required to deduct TDS or TCS" }[v.case]]], notes: ["These cases need registration whatever your turnover (per the sources read). Apply within 30 days of becoming liable. Registering late can bring a penalty of 10% of the tax due, at least ₹10,000. " + CONFIRM] };
      const over = C(v.turn) > limit * 100;
      rows.push(["Registration needed?", over ? "Yes, you crossed the limit" : "Not by turnover", true], ["Limit for you", rs(limit * 100)], ["Your turnover", rs(C(v.turn))], ["Used", pc(v.turn / limit * 100), over]);
      return { rows, notes: [over ? "Apply within 30 days of crossing the limit. Registration is free on the portal. Registering late can bring a penalty of 10% of the tax due, at least ₹10,000." : "You can still register voluntarily: it lets you claim credit on purchases and look more credible to business customers, but you must then file returns every month or quarter.",
        "Limits used: goods ₹40 lakh and services ₹20 lakh; half of that in special-category states. If you sell both goods and services, the services limit shown here is the safe one; ask your accountant. " + CONFIRM] }; } },
  { id: "einvcheck", section: "gst", group: "Check yourself", name: "E-invoice and e-way bill", sub: "do I need them for this sale?",
    fields: [{ id: "big", label: "Has your turnover been above ₹5 crore in any year since 2017-18?", kind: "choice", def: "n", options: [["n", "No"], ["y", "Yes"]] },
      { id: "buyer", label: "Who is the buyer?", kind: "choice", def: "b2c", options: [["b2c", "An ordinary customer (no GSTIN)"], ["b2b", "A business with a GSTIN"], ["exp", "An export"]] },
      { id: "value", label: "Value of the goods in one consignment (with GST)", kind: "money", optional: true },
      { id: "move", label: "Where are the goods going?", kind: "choice", def: "inter", options: [["inter", "To another state"], ["intra", "Within my state"]] },
      { id: "km", label: "Distance in km (to see how many days the e-way bill lasts)", kind: "number", optional: true }],
    calc: v => {
      const ei = v.big === "y" && v.buyer !== "b2c", rows = [["E-invoice (IRN) needed?", ei ? "Yes, for this bill" : v.big === "y" ? "No: sales to ordinary customers are not covered" : "No: turnover never above ₹5 crore", true]];
      if (v.value) { const need = v.value > 50000; rows.push(["E-way bill needed?", need ? (v.move === "inter" ? "Yes: goods worth more than ₹50,000 going to another state" : "Usually yes above ₹50,000; some states allow up to ₹1 lakh inside the state: check yours") : "Not by the ₹50,000 central limit (check your state's rules inside the state)", true]);
        if (need && v.km) rows.push(["E-way bill validity", `${Math.ceil(v.km / 200)} day${Math.ceil(v.km / 200) > 1 ? "s" : ""} (1 day for every 200 km)`]); }
      return { rows, notes: ["E-invoicing covers business-to-business, export and SEZ bills. Banks, insurers, goods transport agencies, passenger transport, cinemas, SEZ units and government bodies are exempt. A bill without the required e-invoice number is treated as no invoice: the buyer loses the credit and the penalty can be ₹10,000 or the tax due, whichever is more.", "Goods moved without a needed e-way bill can be detained and a penalty charged. The e-way bill is made on the e-way bill portal with two-factor login. " + CONFIRM] }; } },
  { id: "itcclaim", section: "gst", group: "Check yourself", name: "Can I claim this credit?", sub: "tax on a purchase: yes, no or not yet",
    fields: [{ id: "what", label: "What did you buy?", kind: "choice", def: "biz", options: [["biz", "Something for my business (stock, shop rent, packing, repairs)"], ["food", "Food, drinks or outdoor catering"], ["car", "A car or other motor vehicle"], ["club", "Club, gym or health-centre membership"], ["personal", "Something for personal use"], ["lost", "Goods lost, stolen, destroyed or given away free"], ["build", "Building work on my own shop or property"], ["comp", "Goods from a composition dealer"], ["ins", "Life or health insurance"], ["cab", "Rent-a-cab"]] },
      { id: "doc", label: "Do you hold a proper tax invoice?", kind: "choice", def: "y", options: [["y", "Yes, a tax invoice"], ["n", "No: only a bill of supply, estimate or receipt"]] },
      { id: "got", label: "Have you received the goods or service?", kind: "choice", def: "y", options: [["y", "Yes"], ["n", "No"]] },
      { id: "b2", label: "Does it show in your GSTR-2B?", kind: "choice", def: "y", options: [["y", "Yes"], ["n", "No"]] },
      { id: "paid", label: "Has the supplier paid the tax to the government?", kind: "choice", def: "y", options: [["y", "Yes, or it shows in GSTR-2B"], ["u", "I do not know"]] }],
    calc: v => {
      const blocked = { food: "Food, drinks and outdoor catering are blocked (exception: if that is what you sell, or the law requires you to give it to staff).", car: "Motor vehicles are blocked (exception: if you run a transport or driving-training business, or deal in vehicles).", club: "Club and health or fitness memberships are blocked.", personal: "Credit is never allowed for personal use.", lost: "Credit is blocked on goods lost, stolen, destroyed or given away free.", build: "Building work on your own property is blocked (plant and machinery is an exception).", comp: "No credit on purchases from a composition dealer: they do not charge GST.", ins: "Life and health insurance are blocked (exception: if the law requires it for staff, or it is your own outward service).", cab: "Rent-a-cab is blocked unless the same service is what you sell." };
      if (blocked[v.what]) return { rows: [["Can you claim?", "No", true], ["Why", blocked[v.what]]], notes: ["This is the list of blocked credits as I read it. There are exceptions: check with your accountant. " + CONFIRM] };
      const why = []; if (v.doc === "n") why.push("A bill of supply, estimate or receipt gives no credit: you need a tax invoice."); if (v.got === "n") why.push("You must receive the goods or service first."); if (v.b2 === "n") why.push("It must show in your GSTR-2B (generated about the 14th of each month). Ask the supplier to file their GSTR-1."); if (v.paid === "u") why.push("The supplier must have paid the tax. Check with them if it does not show in GSTR-2B.");
      const hard = v.doc === "n";
      return { rows: why.length ? [["Can you claim?", hard ? "No" : "Not yet", true], ...why.map((w, i) => [i ? "" : "Why", w])] : [["Can you claim?", "Yes", true], ["Why", "Business purchase with a tax invoice, received, shown in GSTR-2B and the tax is paid."]], notes: ["Claim by 30 November after the end of the financial year, or the date you file the annual return, whichever is earlier. Credit in GSTR-3B cannot be more than what GSTR-2B shows. " + CONFIRM] }; } },
  { id: "itcrev", section: "gst", group: "Check yourself", name: "Credit to reverse (180 days)", sub: "supplier not paid within 180 days",
    fields: [{ id: "date", label: "Date of the purchase invoice (DD/MM/YYYY)", kind: "date" }, { id: "total", label: "Invoice total (with GST)", kind: "money" }, { id: "gst", label: "GST in the invoice", kind: "money" }, { id: "paid", label: "Amount you have paid the supplier so far", kind: "money" }],
    calc: (v, env) => {
      if (v.total <= 0) return { missing: "The invoice total must be more than 0." }; const unpaid = Math.max(0, v.total - v.paid), days = todayNum(env) - v.date, last = v.date + 180;
      if (unpaid <= 0) return { rows: [["Reverse credit?", "No: fully paid", true]], notes: ["Paid in full: no reversal. " + CONFIRM] };
      if (days <= 180) return { rows: [["Reverse credit?", "Not yet", true], ["Pay before", dFmt(last)], ["Days left", String(180 - days)], ["Unpaid now", rsx(unpaid)]], notes: ["If you have not paid the supplier in full within 180 days of the invoice date, you must reverse the credit on the unpaid part. " + CONFIRM] };
      const rev = Math.round(C(v.gst) * unpaid / v.total);
      return { rows: [["Reverse credit?", "Yes", true], ["Days since invoice", String(days)], ["Unpaid part of the invoice", rsx(unpaid)], ["Credit to reverse", rs(rev), true]], notes: ["Credit to reverse = GST in the invoice × unpaid part ÷ invoice total. Interest at 18% a year applies from the date you first claimed the credit. When you pay, you can claim the credit again in the GSTR-3B of that month; interest already paid is not refunded. Not for reverse-charge or import purchases. " + CONFIRM] }; } },
);

// ------------------------------------------------------------------ TABLE tools
const rateOf = (t, r, c) => { if (c === undefined || c < 0) return null; const s = String(t.rows[r][c] ?? "").replace(/%/g, "").trim(); if (!s) return null; const p = parseAmount(s); return p.kind === "num" ? p.cents / 100 : null; };
const has = (c) => c !== undefined && c >= 0;
const PICKS_RATE = [{ id: "inv", label: "Bill number or party name (optional)", kind: "text", optional: true }, { id: "amount", label: "Amount", kind: "num" }, { id: "rate", label: "GST rate % column", kind: "num" }];
const PARAMS_RATE = [{ id: "inc", label: "The amounts are", options: [["ex", "Before GST (taxable value)"], ["in", "Already with GST (bill total)"]], def: "ex" }, { id: "place", label: "These are", options: [["intra", "Within my state (CGST + SGST)"], ["inter", "To or from other states (IGST)"]], def: "intra" }];

function rateSummary(kind) {
  return ({ t, pk, pm }) => {
    const G = new Map(), skipped = [], flags = [], flagCells = []; let bills = 0;
    t.rows.forEach((row, r) => {
      if (!row.some(x => String(x).trim())) return;
      const v = cellVal(t, r, pk.amount), rt = rateOf(t, r, pk.rate); if (v === null || rt === null) { skipped.push(r); return; }
      let base, tax; if (pm.inc === "ex") { base = v; tax = Math.round(v * rt / 100); } else { base = Math.round(v * 100 / (100 + rt)); tax = v - base; }
      const g = G.get(rt) || { rate: rt, n: 0, base: 0, tax: 0, rows: [] }; g.n++; g.base += base; g.tax += tax; g.rows.push(r); G.set(rt, g); bills++;
      if (!VALID_RATES.some(x => Math.abs(x - rt) < 1e-9)) { flags.push([String(r + 1), name(t, r, pk.inv), String(rt) + "%", "Not a GST rate"]); flagCells.push([[r, pk.rate]]); }
      else if (OLD_RATES.some(x => x === rt)) { flags.push([String(r + 1), name(t, r, pk.inv), rt + "%", "Old rate: only for bills before 22 Sep 2025 (and a few items)"]); flagCells.push([[r, pk.rate]]); }
    });
    if (!G.size) return none("No row has both an amount and a GST rate. Check the two columns chosen above.");
    const list = [...G.values()].sort((a, b) => a.rate - b.rate); let tb = 0, tc = 0, ts = 0, ti = 0;
    const rows = list.map(g => { const c = pm.place === "inter" ? 0 : Math.floor(g.tax / 2), s = pm.place === "inter" ? 0 : g.tax - c, i = pm.place === "inter" ? g.tax : 0; tb += g.base; tc += c; ts += s; ti += i; return [g.rate + "%", String(g.n), rs(g.base), rs(c), rs(s), rs(i), rs(g.tax), rs(g.base + g.tax)]; });
    const total = tc + ts + ti; rows.push(["Total", String(bills), rs(tb), rs(tc), rs(ts), rs(ti), rs(total), rs(tb + total)]);
    const out = [{ type: "table", title: kind === "sales" ? "GST on your sales, rate by rate (for GSTR-1 and GSTR-3B)" : "GST paid on your purchases, rate by rate (credit you may claim)", head: ["Rate", "Rows", "Taxable value", "CGST", "SGST", "IGST", "Total GST", "Bill value"], rows, rowCells: list.map(g => g.rows.slice(0, 200).map(r => [r, pk.amount])).concat([[]]) },
      { type: "kv", title: kind === "sales" ? "Tax you collected" : "Credit you can claim", cls: "good", rows: [["CGST", rs(tc)], ["SGST", rs(ts)], ["IGST", rs(ti)], ["Total GST", rs(total), true]] }];
    if (flags.length) out.push({ type: "table", title: "Rows to look at", head: ["Row", "Bill / party", "Rate", "Problem"], rows: flags.slice(0, 30), rowCells: flagCells.slice(0, 30) });
    if (skipped.length) out.push({ type: "note", cls: "warn", text: `${skipped.length} row(s) were left out because the amount or the GST rate is missing or not a number (row ${skipped.slice(0, 8).map(r => r + 1).join(", ")}${skipped.length > 8 ? "…" : ""}).` });
    out.push({ type: "note", cls: "info", text: kind === "sales"
      ? "These totals are now filled into 'GST to pay this month'. GST is worked out row by row, so it can differ by a few rupees from your bill printer. Sales with 0% or without GST also go in GSTR-1; this tool only adds the GST."
      : "Credit is allowed only if the supplier is registered and has filed, the bill shows in your GSTR-2B, and the purchase is for business. Not allowed, for example: food and drink for staff, personal use, most cars. Composition dealers cannot claim credit at all. These totals are now filled into 'GST to pay this month'." });
    out.stash = kind === "sales" ? { oc: tc / 100, os: ts / 100, oi: ti / 100 } : { cc: tc / 100, cs: ts / 100, ci: ti / 100 };
    return out;
  };
}

export const GST_TABLE = [
  { id: "gstsales", section: "gst", group: "From your lists", name: "Sales summary", sub: "tax collected, rate by rate", picks: PICKS_RATE, params: PARAMS_RATE, calc: rateSummary("sales") },
  { id: "gstpurch", section: "gst", group: "From your lists", name: "Purchase credit", sub: "tax paid on purchases (ITC)", picks: PICKS_RATE, params: PARAMS_RATE, calc: rateSummary("purchases") },
  { id: "invcheck", section: "gst", group: "From your lists", name: "Check GST on bills", sub: "bills with wrong GST amount", picks: [{ id: "inv", label: "Bill number (optional)", kind: "text", optional: true }, { id: "taxable", label: "Price before GST", kind: "num" }, { id: "rate", label: "GST rate % column", kind: "num" }, { id: "gst", label: "GST charged on the bill", kind: "num" }],
    calc: ({ t, pk }) => {
      const bad = [], cells = []; let n = 0, skipped = 0, diff = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const b = cellVal(t, r, pk.taxable), g = cellVal(t, r, pk.gst), rt = rateOf(t, r, pk.rate); if (b === null || g === null || rt === null) { skipped++; return; } n++;
        const exp = Math.round(b * rt / 100), d = g - exp; if (Math.abs(d) > 100) { bad.push([String(r + 1), name(t, r, pk.inv), rs(b), rt + "%", rs(g), rs(exp), (d > 0 ? "+" : "") + rs(d)]); cells.push([[r, pk.gst], [r, pk.rate]]); diff += d; } });
      if (!n) return none("No row has a price, a GST rate and a GST amount. Check the columns chosen above.");
      const out = bad.length ? [{ type: "kv", title: `${bad.length} of ${n} bills have a different GST amount`, cls: "error", rows: [["Net difference (charged − correct)", (diff > 0 ? "+" : "") + rs(diff), true]] }, { type: "table", title: "Bills to fix", head: ["Row", "Bill", "Price", "Rate", "GST charged", "GST should be", "Difference"], rows: bad.slice(0, 50), rowCells: cells.slice(0, 50) }] : [{ type: "note", cls: "good", text: `All ${n} bills have the right GST amount for their rate.` }];
      if (skipped) out.push({ type: "note", cls: "warn", text: `${skipped} row(s) were left out because one of the three columns had no number.` });
      out.push({ type: "note", cls: "info", text: "Differences up to ₹1 per bill (rounding) are ignored. A different amount can also mean the wrong rate was typed: look at both." }); return out;
    } },
  { id: "hsn", section: "gst", group: "From your lists", name: "HSN summary", sub: "GSTR-1 HSN table, with checks", picks: [{ id: "hsn", label: "HSN code", kind: "text" }, { id: "desc", label: "Item name (optional)", kind: "text", optional: true }, { id: "qty", label: "Quantity (optional)", kind: "num", optional: true }, { id: "taxable", label: "Price before GST", kind: "num" }, { id: "rate", label: "GST rate % column", kind: "num" }],
    params: [{ id: "turn", label: "Your turnover last year", options: [["le5", "Up to ₹5 crore (4-digit HSN needed)"], ["gt5", "Above ₹5 crore (6-digit HSN needed)"]], def: "le5" }],
    calc: ({ t, pk, pm }) => {
      const need = pm.turn === "gt5" ? 6 : 4, G = new Map(), bad = [], cells = []; let skipped = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const code = String(row[pk.hsn] ?? "").replace(/\s+/g, ""), b = cellVal(t, r, pk.taxable), rt = rateOf(t, r, pk.rate); if (b === null || rt === null) { skipped++; return; }
        if (!/^\d+$/.test(code)) { bad.push([String(r + 1), name(t, r, pk.desc), code || "(blank)", "HSN must be digits only"]); cells.push([[r, pk.hsn]]); }
        else if (![4, 6, 8].includes(code.length)) { bad.push([String(r + 1), name(t, r, pk.desc), code, `${code.length} digits: HSN has 4, 6 or 8`]); cells.push([[r, pk.hsn]]); }
        else if (code.length < need) { bad.push([String(r + 1), name(t, r, pk.desc), code, `Needs at least ${need} digits at your turnover`]); cells.push([[r, pk.hsn]]); }
        const k = code + "|" + rt, g = G.get(k) || { code, desc: has(pk.desc) ? text(t, r, pk.desc) : "", rate: rt, qty: 0, base: 0, tax: 0, rows: [] }; g.base += b; g.tax += Math.round(b * rt / 100); if (has(pk.qty)) g.qty += cellVal(t, r, pk.qty) || 0; g.rows.push(r); G.set(k, g); });
      const list = [...G.values()].sort((a, b) => a.code.localeCompare(b.code) || a.rate - b.rate); if (!list.length) return none("No row has a price and a GST rate.");
      const out = [{ type: "table", title: `${list.length} HSN lines (same code and rate are added together)`, head: ["HSN", "Item", "Rate", "Qty", "Taxable value", "GST"], rows: list.map(g => [g.code || "(blank)", g.desc, g.rate + "%", has(pk.qty) ? n2(g.qty / 100) : "–", rs(g.base), rs(g.tax)]), rowCells: list.map(g => g.rows.slice(0, 200).map(r => [r, pk.hsn])) }];
      if (bad.length) out.push({ type: "table", title: `${bad.length} HSN code${bad.length > 1 ? "s" : ""} to fix`, head: ["Row", "Item", "HSN", "Problem"], rows: bad.slice(0, 40), rowCells: cells.slice(0, 40) }); else out.push({ type: "note", cls: "good", text: "All HSN codes have a valid length." });
      if (skipped) out.push({ type: "note", cls: "warn", text: `${skipped} row(s) were left out because the price or rate was missing.` });
      out.push({ type: "note", cls: "info", text: "Prices should be before GST. Use the same unit for quantity within one HSN code. This only checks the shape of the code, not whether it is the right code for the product." }); return out;
    } },
  { id: "gstin", section: "gst", group: "From your lists", name: "Check GSTIN numbers", sub: "wrong or mistyped customer GSTIN", picks: [{ id: "gstin", label: "GSTIN column", kind: "text" }, { id: "name", label: "Party name (optional)", kind: "text", optional: true }],
    calc: ({ t, pk }) => {
      const bad = [], cells = [], states = new Map(), seen = new Map(); let ok = 0, n = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const raw = String(row[pk.gstin] ?? ""); if (!raw.trim()) return; n++; const c = checkGstin(raw);
        if (c.ok) { ok++; states.set(c.state, (states.get(c.state) || 0) + 1); const k = raw.trim().toUpperCase(); (seen.get(k) || seen.set(k, []).get(k)).push(r); }
        else { bad.push([String(r + 1), name(t, r, pk.name), raw.trim(), c.problem]); cells.push([[r, pk.gstin]]); } });
      if (!n) return none("The chosen column is empty.");
      const out = [{ type: "kv", title: "Result", cls: bad.length ? "warn" : "good", rows: [["GSTINs checked", String(n)], ["Look correct", String(ok), true], ["Need fixing", String(bad.length), bad.length > 0]] }];
      if (bad.length) out.push({ type: "table", title: "GSTINs to fix", head: ["Row", "Party", "GSTIN", "Problem"], rows: bad.slice(0, 60), rowCells: cells.slice(0, 60) });
      if (states.size) out.push({ type: "table", title: "State of the correct GSTINs (the first 2 digits)", head: ["State", "Parties"], rows: [...states.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => [s, String(c)] ) });
      out.push({ type: "note", cls: "info", text: "A GSTIN that passes these checks has the right shape and check character, but it may still be cancelled or belong to someone else. Verify important customers on the GST portal (Search Taxpayer). A different state from yours means IGST, not CGST + SGST." }); return out;
    } },
  { id: "invseries", section: "gst", group: "From your lists", name: "Check bill numbers", sub: "duplicates, gaps, wrong format", picks: [{ id: "inv", label: "Bill number column", kind: "text" }],
    calc: ({ t, pk }) => {
      const probs = [], cells = [], seen = new Map(), series = new Map(); let n = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const b = String(row[pk.inv] ?? "").trim(); if (!b) { probs.push([String(r + 1), "(blank)", "No bill number"]); cells.push([[r, pk.inv]]); return; } n++;
        const key = b.toUpperCase(); (seen.get(key) || seen.set(key, []).get(key)).push(r);
        if (b.length > 16) { probs.push([String(r + 1), b, `${b.length} characters (maximum 16)`]); cells.push([[r, pk.inv]]); }
        if (!/^[A-Za-z0-9/-]+$/.test(b)) { probs.push([String(r + 1), b, "Only letters, numbers, / and - are allowed"]); cells.push([[r, pk.inv]]); }
        const m = /^(.*?)(\d+)$/.exec(b); if (m) { const p = m[1].toUpperCase(), g = series.get(p) || { p: m[1], nums: new Set() }; g.nums.add(+m[2]); series.set(p, g); } });
      for (const [k, rows] of seen) if (rows.length > 1) { probs.push([rows.map(r => r + 1).join(", "), t.rows[rows[0]][pk.inv].trim(), `Used ${rows.length} times`]); cells.push(rows.map(r => [r, pk.inv])); }
      const ser = [...series.values()].map(g => { const a = [...g.nums].sort((x, y) => x - y), lo = a[0], hi = a[a.length - 1], miss = []; if (hi - lo <= 20000) for (let i = lo; i <= hi && miss.length < 40; i++) if (!g.nums.has(i)) miss.push(i); return [g.p || "(numbers only)", String(lo), String(hi), String(a.length), miss.length ? miss.join(", ") + (miss.length >= 40 ? "…" : "") : "None"]; });
      if (!n && !probs.length) return none("The chosen column is empty.");
      const out = [];
      if (ser.length) out.push({ type: "table", title: "Bill series", head: ["Prefix", "First", "Last", "Bills", "Missing numbers"], rows: ser });
      out.push(probs.length ? { type: "table", title: `${probs.length} problem${probs.length > 1 ? "s" : ""}`, head: ["Row", "Bill no.", "Problem"], rows: probs.slice(0, 60), rowCells: cells.slice(0, 60) } : { type: "note", cls: "good", text: "No duplicate, blank or badly written bill numbers." });
      out.push({ type: "note", cls: "info", text: "GST bills must have a unique, running number of at most 16 characters (letters, numbers, / and -). A missing number is fine only if you can show that bill was cancelled." }); return out;
    } },
  { id: "compq", section: "gst", group: "Composition scheme", name: "Composition tax by quarter", sub: "CMP-08 amounts from a sales list", picks: [{ id: "date", label: "Date column", kind: "text" }, { id: "amount", label: "Sale amount", kind: "num" }],
    params: [{ id: "type", label: "Your business", options: [["t", "Trader, 1%"], ["m", "Manufacturer, 1%"], ["r", "Restaurant without alcohol, 5%"], ["s", "Service provider, 6%"]], def: "t" }, { id: "order", label: "Dates are written", options: [["dmy", "Day first (15/01/2026)"], ["mdy", "Month first (01/15/2026)"]], def: "dmy" }],
    calc: ({ t, pk, pm }) => {
      const rate = { t: 1, m: 1, r: 5, s: 6 }[pm.type], Q = new Map(), bad = []; let tot = 0;
      t.rows.forEach((row, r) => { if (!row.some(x => String(x).trim())) return; const v = cellVal(t, r, pk.amount); if (v === null) return; const d = parseDate(text(t, r, pk.date), pm.order === "dmy"); if (!d) { bad.push(r + 1); return; }
        const fy = d.m >= 4 ? d.y : d.y - 1, q = d.m >= 4 && d.m <= 6 ? 1 : d.m >= 7 && d.m <= 9 ? 2 : d.m >= 10 ? 3 : 4, k = fy * 10 + q, g = Q.get(k) || { fy, q, sum: 0, rows: [] }; g.sum += v; g.rows.push(r); Q.set(k, g); tot += v; });
      const list = [...Q.values()].sort((a, b) => (a.fy - b.fy) || (a.q - b.q)); if (!list.length) return none("I could not read any dates. Try the other date order, or write dates like 2026-01-15.");
      const QN = ["", "Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"], due = g => g.q === 1 ? `18 Jul ${g.fy}` : g.q === 2 ? `18 Oct ${g.fy}` : g.q === 3 ? `18 Jan ${g.fy + 1}` : `18 Apr ${g.fy + 1}`;
      let taxAll = 0; const rows = list.map(g => { const tax = Math.round(g.sum * rate / 100); taxAll += tax; return [`${QN[g.q]} ${g.q === 4 ? g.fy + 1 : g.fy} (FY ${g.fy}-${String(g.fy + 1).slice(2)})`, rs(g.sum), rs(tax), due(g)]; });
      const out = [{ type: "table", title: `Composition tax at ${rate}% (${list.length} quarter${list.length > 1 ? "s" : ""})`, head: ["Quarter", "Turnover", "Tax to pay", "Pay by"], rows, rowCells: list.map(g => g.rows.slice(0, 200).map(r => [r, pk.amount])) }, { type: "kv", title: "All quarters", cls: "good", rows: [["Total turnover", rs(tot)], ["Total tax", rs(taxAll), true]] }];
      if (bad.length) out.push({ type: "note", cls: "warn", text: `${bad.length} row(s) have a date I could not read and were left out (row ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? "…" : ""}).` });
      const limit = pm.type === "s" ? "₹50 lakh" : "₹1.5 crore (₹75 lakh in Arunachal, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura, Uttarakhand)";
      out.push({ type: "note", cls: "info", text: `Tax is the percentage of all sales in the quarter, with no GST shown on bills. Yearly turnover limit for the scheme: ${limit}. ${CONFIRM}` }); return out;
    } },
];

// ------------------------------------------------------------------ INFO tools (no table needed)
export const GST_INFO = [
  { id: "gstrates", section: "gst", group: "Guides", name: "GST rates guide", sub: "slabs since 22 Sep 2025",
    calc: () => [{ type: "table", title: "GST slabs (from 22 September 2025)", head: ["Rate", "Examples"], rows: [
      ["0%", "Fresh vegetables and fruit, fresh milk, loose (unbranded) atta, rice and wheat, bread, eggs, fresh meat and fish, notebooks, pencils, many life-saving medicines, individual health and life insurance"],
      ["5%", "Edible oils, butter, ghee, sugar, biscuits, namkeen, chocolates, ice cream, most medicines, clothes and footwear up to ₹2,500 a piece, most restaurant services"],
      ["18%", "Mobile phones, ACs, TVs above 32 inch, cement, paints, detergents, cosmetics, watches, IT and banking services, clothes and footwear above ₹2,500 a piece"],
      ["40%", "Aerated and caffeinated drinks, large cars, motorcycles above 350 cc, casinos and betting"],
      ["3%", "Gold, silver, jewellery"], ["0.25%", "Rough diamonds"]] },
      { type: "note", cls: "info", text: "Before 22 September 2025 there were also 12% and 28% slabs. Most 12% items moved to 5% (a few to 18%) and most 28% items to 18% or 40%. Bills dated before that day may still correctly show 12% or 28%. Pan masala and tobacco were still at 28% plus cess in the sources I read." },
      { type: "note", cls: "warn", text: "The rate depends on the exact product (its HSN code), not on the name alone. This list gives examples from 2026 summaries. Check the HSN on cbic.gov.in or with your accountant before you change a bill. " + CONFIRM }] },
  { id: "gstcompguide", section: "gst", group: "Guides", name: "Composition scheme guide", sub: "should I choose it?",
    calc: () => [{ type: "table", title: "Composition scheme in short", head: ["Point", "Rule"], rows: [
      ["Who can join", "Small traders, manufacturers and restaurants (without alcohol) up to ₹1.5 crore yearly turnover; ₹75 lakh in Arunachal, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura, Uttarakhand. Service providers up to ₹50 lakh."],
      ["Tax you pay", "Traders 1% of turnover. Manufacturers 1%. Restaurants (no alcohol) 5%. Service providers 6%."],
      ["Returns", "CMP-08 every quarter (pay by the 18th of the month after). GSTR-4 once a year."],
      ["On your bills", "You cannot charge GST. You issue a Bill of Supply that says 'composition taxable person, not eligible to collect tax on supplies'."],
      ["Credit on purchases", "You cannot claim any input tax credit."],
      ["Cannot join", "Anyone selling to other states, selling through e-commerce sites that collect tax, making ice cream, pan masala, tobacco or aerated water, casual or non-resident dealers."],
      ["Good for", "A small local shop that sells to ordinary customers and has few purchases with GST to claim."],
      ["Not good for", "Anyone who sells to other businesses who want GST credit, or sells to other states."]] },
      { type: "note", cls: "warn", text: "Whether to switch is a decision for you and your accountant: the saving depends on your purchases and customers. " + CONFIRM }] },
  { id: "gstchecklist", section: "gst", group: "Guides", name: "Monthly checklist", sub: "steps before you file",
    calc: () => [{ type: "table", title: "Every month (regular dealers)", head: ["Step", "What to do"], rows: [
      ["1", "Check all sales bills are numbered in a running series (button: Check bill numbers)."],
      ["2", "Check GSTIN of business customers and the GST amount on each bill (buttons: Check GSTIN numbers, Check GST on bills)."],
      ["3", "Make the sales summary rate by rate (button: Sales summary). File GSTR-1 by the 11th."],
      ["4", "Make the purchase credit summary and match it with your GSTR-2B on the portal (button: Purchase credit)."],
      ["5", "Work out the tax to pay (button: GST to pay this month). Pay and file GSTR-3B by the 20th."],
      ["6", "Keep copies of bills and returns. The rule is generally six years, so ask your accountant."]] },
      { type: "note", cls: "info", text: "Composition dealers: pay CMP-08 each quarter by the 18th, and file GSTR-4 once a year. " + CONFIRM }] },
];

// ------------------------------------------------------------------ GST HELP: questions and answers (plain language; from 2026 web sources and the CBIC invoice-rules page)
export const GST_HELP = [
  { q: "What are CGST, SGST and IGST?", tags: "basics tax state", a: ["GST is one tax with three parts. When you sell inside your own state, the GST is split in half: CGST goes to the central government and SGST to the state. When you sell to another state, the whole amount is charged as IGST.", "So the first two digits of a customer's GSTIN (their state code) tell you which one to charge: same state as yours means CGST + SGST, a different state means IGST."], tool: "gstadd" },
  { q: "Do I need to register for GST?", tags: "registration limit turnover", a: ["By turnover: ₹40 lakh a year if you only sell goods, ₹20 lakh for services (or goods and services together). In special-category states (most North-Eastern states and a few hill states) the limits are half of that. Turnover means all sales, exempt sales and exports across India under one PAN, without GST.", "Some people must register from the first rupee: anyone selling goods to other states, sellers on e-commerce sites, people who must pay tax under reverse charge, casual and non-resident dealers, and those who must deduct TDS or TCS under GST.", "Apply within 30 days of crossing the limit. Registration is free on the portal. Registering late can cost a penalty of 10% of the tax due, at least ₹10,000. Registering voluntarily below the limit is allowed: you can then claim credit on purchases, but you must file returns."], tool: "regcheck" },
  { q: "What is the difference between regular and composition scheme?", tags: "composition regular scheme", a: ["Regular: you charge GST on every bill, claim credit on your purchases, and file GSTR-1 and GSTR-3B (monthly, or quarterly under QRMP).", "Composition: a small trader, manufacturer or restaurant pays a small fixed percentage of turnover (1%, 1% and 5%; 6% for service providers), but cannot charge GST on bills, cannot claim credit, and cannot sell to other states. It files CMP-08 each quarter and GSTR-4 each year.", "Composition suits a small local shop selling to ordinary customers. It is a poor fit if your customers are businesses that want GST credit."], tool: "gstcompguide" },
  { q: "Which returns do I have to file?", tags: "returns gstr-1 gstr-3b gstr-4 cmp-08 monthly quarterly qrmp", a: ["Regular dealers: GSTR-1 (your sales) by the 11th and GSTR-3B (summary and payment) by the 20th of the next month. Small dealers can choose the quarterly QRMP scheme: pay tax monthly, file returns every quarter. Composition dealers: CMP-08 every quarter and GSTR-4 once a year.", "Even with no sales you usually still have to file a nil return. A nil GSTR-3B filed late costs ₹20 a day (maximum ₹500)."], tool: "gstdue" },
  { q: "What are GSTR-1, GSTR-3B and GSTR-2B?", tags: "gstr-1 gstr-3b gstr-2b returns", a: ["GSTR-1: the list of your sales bills for the month. GSTR-3B: a summary of your sales tax, your credit on purchases and the tax you pay. GSTR-2B: a statement the portal makes for you (around the 14th of each month) of the purchases your suppliers reported in their GSTR-1: the credit you are allowed to claim comes from here.", "Since 2026 the portal fills your GSTR-3B tax figures from your GSTR-1 data, so a mistake in GSTR-1 flows into GSTR-3B."], tool: "gstsales" },
  { q: "What is input tax credit (ITC)?", tags: "itc credit input purchases", a: ["The GST you paid on things bought for your business can be subtracted from the GST you collected on sales. You pay only the difference. To claim credit, all four must be true: you hold a tax invoice, you received the goods or service, it shows in your GSTR-2B, and the supplier has paid the tax.", "A bill of supply, estimate, receipt or quotation gives no credit."], tool: "itcclaim" },
  { q: "Which purchases give no credit?", tags: "blocked credit itc 17(5) food car", a: ["Blocked credits include: cars and other motor vehicles, food and drinks and outdoor catering, club and gym memberships, health and life insurance, rent-a-cab, building work on your own property, anything for personal use, goods lost, stolen or given away free, and purchases from composition dealers.", "There are exceptions, for example when that same thing is what your business sells. Ask your accountant about borderline cases."], tool: "itcclaim" },
  { q: "Until when can I claim credit on a purchase?", tags: "itc time limit deadline", a: ["You must claim by 30 November following the end of that financial year, or the date you file the annual return, whichever is earlier. After that the credit is lost.", "Also, the credit you claim in GSTR-3B cannot be more than what shows in GSTR-2B."] },
  { q: "What if I have not paid my supplier?", tags: "180 days reverse itc unpaid", a: ["If you do not pay the supplier the full invoice value (with GST) within 180 days of the invoice date, you must reverse the credit on the unpaid part and pay 18% interest on it. When you pay later, you can claim it again.", "This does not apply to reverse-charge or import purchases."], tool: "itcrev" },
  { q: "What must a GST tax invoice show?", tags: "invoice bill details fields", a: ["Your name, address and GSTIN; a running serial number and date; the buyer's name, address and GSTIN (if registered); description of the goods, HSN code, quantity and unit; value after discount; the GST rate and the CGST, SGST or IGST amount; place of supply for sales to other states; whether reverse charge applies; and your signature.", "If the buyer is not registered and the invoice value is ₹50,000 or more, also write the buyer's name, address, delivery address and state."], tool: "invseries" },
  { q: "What is a bill of supply?", tags: "bill of supply composition exempt", a: ["A bill of supply has no tax amount on it. Composition dealers and sellers of exempt goods use it. Composition dealers must write on it that they are a composition taxable person and not eligible to collect tax. The buyer gets no credit from a bill of supply."] },
  { q: "Bill numbers, copies and daily bills", tags: "serial number copies consolidated invoice", a: ["Invoice numbers must run in order, be unique in the financial year, and can use letters, numbers, hyphens and slashes (up to 16 characters in all).", "For goods, three copies: original for the buyer, duplicate for the transporter, triplicate for you. For services, two copies.", "For sales to unregistered customers who do not ask for a tax invoice, you can make one consolidated invoice at the end of each day."], tool: "invseries" },
  { q: "When must I give the invoice?", tags: "invoice time services goods", a: ["Services: within 30 days of the service (45 days for banks, insurers and NBFCs). Goods: at the time the goods are removed or delivered. If goods move on a delivery challan, the invoice is issued after delivery."] },
  { q: "What is an HSN code and how many digits?", tags: "hsn sac digits", a: ["HSN is the product code that decides the GST rate. On your sales return you need it with 4 digits if your yearly turnover is up to ₹5 crore and 6 digits above that (the number of digits is set by government notification and can change). Services have a similar SAC code.", "The code, not the product name, fixes the rate, so check it before changing a bill."], tool: "hsn" },
  { q: "What is e-invoicing?", tags: "e-invoice irn 5 crore", a: ["If your turnover has been above ₹5 crore in any year since 2017-18, your business-to-business, export and SEZ bills must be registered on the government e-invoice portal to get a number (IRN). Bills to ordinary customers are not covered.", "Banks, insurers, goods transport agencies, passenger transport, cinemas, SEZ units and government bodies are exempt. A bill without a required IRN is treated as no invoice: the buyer loses credit, and the penalty is ₹10,000 or the tax due, whichever is higher."], tool: "einvcheck" },
  { q: "What is an e-way bill?", tags: "e-way bill transport goods 50000", a: ["A document you make online before moving goods worth more than ₹50,000 (the central limit; inside a state the state may set its own, often up to ₹1 lakh). It is valid 1 day for every 200 km. Goods without a needed e-way bill can be detained and fined."], tool: "einvcheck" },
  { q: "What if I file late?", tags: "late fee interest penalty", a: ["Late fee: ₹50 a day (half CGST, half SGST) on GSTR-1 and GSTR-3B, or ₹20 a day for a nil return, with limits by turnover (₹2,000, ₹5,000, ₹10,000; nil: ₹500).", "Interest: 18% a year on tax paid late, counted from the day after the due date. Wrongly claimed credit carries 24%. The government sometimes announces waivers or extends dates: look at the portal."], tool: "gstlate" },
  { q: "What is reverse charge?", tags: "reverse charge rcm", a: ["In some cases the buyer, not the seller, pays the GST to the government. If you are liable to pay tax this way you must register, whatever your turnover. Your accountant can tell you whether any of your purchases fall under it."] },
  { q: "Common mistakes shopkeepers make", tags: "mistakes errors tips", a: ["Wrong GST rate (the old 12% and 28% slabs are gone; check the HSN). Mistyped customer GSTIN. Skipping or repeating bill numbers. Claiming credit that is not in GSTR-2B, or blocked credit such as food or a car. Giving a bill of supply when a tax invoice was needed. Filing late and paying the fee and interest. Forgetting the nil return in a month with no sales."], tool: "invcheck" },
  { q: "How can this app help me?", tags: "app help tools", a: ["Make your sales and purchase lists into a table here (open a CSV, Excel, Word or PDF file, or paste). Then: Sales summary and Purchase credit give the tax figures; Check GST on bills, Check GSTIN numbers and Check bill numbers find mistakes before you file; GST to pay works out the cash you owe; Due dates and Late fee tell you when and what a delay costs. Everything stays on your device.", "It prepares the numbers. It does not file on the GST portal: you or your accountant do that."] },
  { q: "Where can I check the official rules?", tags: "official portal cbic sources", a: ["gst.gov.in (the GST portal, returns and registration) and cbic-gst.gov.in (the tax board, notifications and rules). When this app and the portal disagree, the portal is right. This help is a plain-language summary of 2026 web articles (Vyapar, PKC India, Busy, IncorpX, CalcGuru, TAXAJ) and the CBIC invoice-rules page, not legal advice."] },
];

export const GST_TOOLS = [...GST_QUICK.map(q => ({ ...q, kind: "quick" })), ...GST_TABLE.map(q => ({ ...q, kind: "table" })), ...GST_INFO.map(q => ({ ...q, kind: "info" })), { id: "gsthelp", section: "gst", group: "Guides", name: "GST help", sub: "questions and answers", kind: "help", topics: GST_HELP }];
