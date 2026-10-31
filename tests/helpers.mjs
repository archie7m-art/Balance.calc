import "./node_pdf_stubs.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
// JSZip's browser file registers itself globally when it is not loaded as a CommonJS module.
const req = createRequire(import.meta.url); let m = req("../vendor/jszip.min.js");
export const JSZip = typeof m?.loadAsync === "function" ? m : (m?.default?.loadAsync ? m.default : globalThis.JSZip);
export const pdfjs = await import("../vendor/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(new URL("../vendor/pdf.worker.min.mjs", import.meta.url).pathname).href;
export const fixture = n => fs.readFileSync(new URL("./fixtures/" + n, import.meta.url));
