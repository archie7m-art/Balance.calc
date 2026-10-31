// xml.js -- a very small XML reader (enough for Excel and Word files). Returns {name, attrs, children, text}.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

export function parseXML(src) {
  const root = { name: "#root", attrs: {}, children: [], text: "" }, stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {}, ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
      while ((a = ar.exec(m[4]))) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node = { name: m[3], attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return root.children[0] || root;
}
export const kids = (n, name) => n.children.filter(c => c.name === name);
export const kid = (n, name) => n.children.find(c => c.name === name);
export function find(n, name, out = []) { if (n.name === name) out.push(n); n.children.forEach(c => find(c, name, out)); return out; }
export const textOf = n => n.text + n.children.map(textOf).join("");
