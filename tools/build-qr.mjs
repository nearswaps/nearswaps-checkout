// Builds web/assets/vendor/qr.js: the MIT "qrcode" package's encoder core (lib/core, unchanged) and "dijkstrajs"
// (its one dependency, unchanged), wrapped as one ES module with no imports, for the pay page.
// Usage: node tools/build-qr.mjs <path to node_modules/qrcode> <path to node_modules/dijkstrajs>
// The licences of both go to web/assets/vendor/qr-LICENSE.txt. Only lib/core is used: no canvas, PNG or terminal renderer.
import fs from "node:fs";
import path from "node:path";

const [qrDir, dijDir] = process.argv.slice(2);
if (!qrDir || !dijDir) { console.error("usage: node tools/build-qr.mjs <qrcode dir> <dijkstrajs dir>"); process.exit(1); }
const qrPkg = JSON.parse(fs.readFileSync(path.join(qrDir, "package.json"), "utf8"));
const dijPkg = JSON.parse(fs.readFileSync(path.join(dijDir, "package.json"), "utf8"));
const core = path.join(qrDir, "lib", "core");
const mods = {};
for (const f of fs.readdirSync(core).filter((f) => f.endsWith(".js")).sort()) mods["core/" + f.slice(0, -3)] = fs.readFileSync(path.join(core, f), "utf8");
mods["dijkstrajs"] = fs.readFileSync(path.join(dijDir, "dijkstra.js"), "utf8");

const body = Object.entries(mods).map(([name, src]) =>
  `// ---- ${name === "dijkstrajs" ? "dijkstrajs/dijkstra.js" : "qrcode/lib/" + name + ".js"} ----\n` +
  `defs[${JSON.stringify(name)}] = function (module, exports, require) {\n${src.replace(/\r\n/g, "\n").trimEnd()}\n};`).join("\n\n");

const out = `/* QR encoder for the nearswaps pay page.
   Bundled by tools/build-qr.mjs from two MIT-licensed npm packages, their code unchanged:
     qrcode ${qrPkg.version} (lib/core only), Copyright (c) 2012 Ryan Day, https://github.com/soldair/node-qrcode
     dijkstrajs ${dijPkg.version}, Copyright (C) 2008 Wyatt Baldwin, https://github.com/tcort/dijkstrajs
   Licences: qr-LICENSE.txt next to this file.
   API: qrMatrix(text, level = "M") -> { size, get(row, col) } (true = dark module). */
const defs = {};

${body}

const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const module = { exports: {} };
  cache[name] = module;
  const require = (spec) => load(spec === "dijkstrajs" ? "dijkstrajs" : "core/" + spec.split("/").pop().split(".js")[0]);
  defs[name](module, module.exports, require);
  return module.exports;
}

/** The QR symbol for \`text\` (byte, alphanumeric or numeric segments chosen by the encoder), error correction L, M, Q or H. */
export function qrMatrix(text, level = "M") {
  const q = load("core/qrcode").create(String(text), { errorCorrectionLevel: level });
  const m = q.modules;
  return { size: m.size, version: q.version, get: (r, c) => !!m.get(r, c) };
}
`;
fs.writeFileSync(new URL("../web/assets/vendor/qr.js", import.meta.url), out);
const lic = `This folder's qr.js bundles two packages, unchanged, under their MIT licences.

== qrcode ${qrPkg.version} (https://github.com/soldair/node-qrcode) ==

${fs.readFileSync(path.join(qrDir, "license"), "utf8").trim()}

== dijkstrajs ${dijPkg.version} (https://github.com/tcort/dijkstrajs) ==

${fs.readFileSync(path.join(dijDir, "LICENSE.md"), "utf8").trim()}
`;
fs.writeFileSync(new URL("../web/assets/vendor/qr-LICENSE.txt", import.meta.url), lic);
console.log("wrote web/assets/vendor/qr.js (" + out.length + " bytes) and qr-LICENSE.txt");
