// Copies the pay page, the loader, the merchant docs and the demo shop into the nearswaps site folder, and adds the
// /pay and /demo-shop lines to _redirects. It only ever writes these, and refuses anything else:
//   pay.html, assets/pay.js, assets/pay.css, the QR encoder with its licence, checkout.js,
//   learn/accept-payments.html (from web/docs/), demo-shop.html and assets/demo-shop.js (from demo/), two lines in _redirects.
//
//   node tools/sync-to-site.mjs [--site <path to Nearswaps\site>] [--dry-run]
//
// The QR encoder has two paths, on purpose:
//   repo  web/assets/vendor/qr.js   + web/assets/vendor/qr-LICENSE.txt
//   site  assets/pay-qr.js          + assets/pay-qr-LICENSE.txt
// In the site, assets/vendor/** is a core folder that must stay byte-identical to the core it is copied from
// (Nearswaps\tools\check-core.mjs fails on any extra file there, and the preview and publish scripts refuse to run),
// so nothing from this repo ever lands in assets/vendor/. The synced pay.js has its one import("./vendor/qr.js")
// rewritten to import("./pay-qr.js"); the copy in the repo is unchanged.
// The docs page: pay.html links to /learn/accept-payments.html. Since 11 Nov 2026 the site makes that page itself
// (an entry in Nearswaps/tools/seo-content-learn.mjs, rendered by seo-build.mjs, which also removes any learn/*.html it
// did not generate), so this script leaves learn/accept-payments.html alone whenever the file there is not this repo's
// copy (it no longer starts with this repo's source comment). web/docs/accept-payments.html stays the readable copy for
// the README and the local server; a change to the guide goes into the site's content file first, then here.
// The demo shop's script is a file because the site's Content-Security-Policy runs no inline script.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
export const DEFAULT_SITE = "C:\\Users\\slpto\\OneDrive\\Desktop\\NEKO WEBSITE\\Nearswaps\\site";
export const PAY_RULE = "/pay            /pay.html                  200";
export const DEMO_RULE = "/demo-shop      /demo-shop.html            200";
export const DOCS_SOURCE_MARK = "<!-- source: nearswaps-checkout web/docs/accept-payments.html";

/** The files to write: [{ from (in this repo), to (in the site), transform?, onlyIfOurs? }]. */
export function plan() {
  return [
    { from: "web/pay.html", to: "pay.html" },
    { from: "web/assets/pay.js", to: "assets/pay.js", transform: (s) => replaceOnce(s, 'import("./vendor/qr.js")', 'import("./pay-qr.js")') },
    { from: "web/assets/pay.css", to: "assets/pay.css" },
    { from: "web/assets/vendor/qr.js", to: "assets/pay-qr.js" },
    { from: "web/assets/vendor/qr-LICENSE.txt", to: "assets/pay-qr-LICENSE.txt" },
    { from: "web/checkout.js", to: "checkout.js" },
    { from: "web/docs/accept-payments.html", to: "learn/accept-payments.html", onlyIfOurs: DOCS_SOURCE_MARK },
    { from: "demo/shop.html", to: "demo-shop.html" },
    { from: "demo/assets/demo-shop.js", to: "assets/demo-shop.js" },
  ];
}
export const ALLOWED = new Set(["pay.html", "assets/pay.js", "assets/pay.css", "assets/pay-qr.js", "assets/pay-qr-LICENSE.txt", "checkout.js",
  "learn/accept-payments.html", "demo-shop.html", "assets/demo-shop.js", "_redirects"]);

function replaceOnce(s, a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`expected exactly one ${a} (found ${n})`);
  return s.replace(a, b);
}
/** _redirects with the /pay rule after /bridge and the /demo-shop rule after /pay (or both at the end), each once,
 * the /api/* proxy rule still first. */
export function withPayRule(text) {
  const lines = text.split(/\r?\n/);
  const rules = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!rules.length || !/^\/api\/\*\s/.test(rules[0])) throw new Error("_redirects must start with the /api/* rule; not touching it");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;
  const add = (rule, after) => {
    const from = rule.split(/\s+/)[0];
    if (lines.some((l) => l.trim().startsWith(from + " ") || l.trim().startsWith(from + "\t"))) return;
    const at = lines.findIndex((l) => after.test(l.trim()));
    if (at >= 0) lines.splice(at + 1, 0, rule);
    else { while (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push(rule, ""); }
    changed = true;
  };
  add(PAY_RULE, /^\/bridge\s/);
  add(DEMO_RULE, /^\/pay\s/);
  return changed ? lines.join(eol) : text;
}
/** Text the site must never get from here. */
export function problems(name, text) {
  const out = [];
  if (text.includes("\u2014")) out.push(`${name}: em dash`);
  if (/neko/i.test(text)) out.push(`${name}: NEKO`);
  // The site's Content-Security-Policy runs only its own script files (and two hashed inline scripts): no inline script.
  if (name.endsWith(".html")) for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1]) && m[2].trim()) out.push(`${name}: inline <script> (the site's CSP blocks it; use a file)`);
  }
  return out;
}

export function sync({ site = DEFAULT_SITE, dryRun = false, log = console.log } = {}) {
  site = path.resolve(site);
  if (!fs.existsSync(path.join(site, "_redirects"))) throw new Error("not a nearswaps site folder (no _redirects): " + site);
  const written = [], same = [], kept = [];
  const jobs = plan().map((j) => {
    let text = fs.readFileSync(path.join(REPO, j.from), "utf8");
    if (j.transform) text = j.transform(text);
    return { ...j, text };
  });
  const bad = jobs.flatMap((j) => problems(j.from, j.text));
  if (bad.length) throw new Error("refusing to sync:\n  " + bad.join("\n  "));
  const redirectsPath = path.join(site, "_redirects");
  const before = fs.readFileSync(redirectsPath, "utf8");
  jobs.push({ to: "_redirects", text: withPayRule(before) });
  for (const j of jobs) {
    if (!ALLOWED.has(j.to) || j.to.startsWith("assets/vendor/")) throw new Error("not on the list of files this script may write: " + j.to);
    const dest = path.join(site, j.to);
    const old = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
    if (old === j.text) { same.push(j.to); continue; }
    if (j.onlyIfOurs && old !== null && !old.includes(j.onlyIfOurs)) { kept.push(j.to); log(`kept       ${j.to}  (the site makes this page itself now; not overwritten)`); continue; }
    if (!dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, j.text); }
    written.push(j.to);
    log(`${dryRun ? "would write" : "wrote"}  ${j.to}${j.note ? "  (" + j.note + ")" : ""}`);
  }
  for (const f of same) log(`unchanged  ${f}`);
  return { written, same, kept };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), i = a.indexOf("--site");
  try {
    const r = sync({ site: i >= 0 ? a[i + 1] : process.env.NEARSWAPS_SITE || DEFAULT_SITE, dryRun: a.includes("--dry-run") });
    console.log(`\nsync-to-site: ${r.written.length} written, ${r.same.length} unchanged.`);
  } catch (e) { console.error("sync-to-site: " + e.message); process.exit(1); }
}
