// Copies the pay page and the loader from web/ into the nearswaps site folder, and adds the /pay line to _redirects.
// It only ever writes these, and refuses anything else:
//   pay.html, assets/pay.js, assets/pay.css, the QR encoder with its licence, checkout.js, and one line in _redirects.
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
// The docs link: pay.html links to /learn/accept-payments.html (session 2 writes that page). Until the site has it,
// the synced pay.html links to /learn/ so the site's link check stays green; the script says so when it does that.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "../web");
export const DEFAULT_SITE = "C:\\Users\\slpto\\OneDrive\\Desktop\\NEKO WEBSITE\\Nearswaps\\site";
export const PAY_RULE = "/pay            /pay.html                  200";
const DOCS = "/learn/accept-payments.html";

/** The files to write: [{ from (in web/), to (in the site), transform? }]. */
export function plan({ site } = {}) {
  const docsInSite = !!site && fs.existsSync(path.join(site, DOCS.slice(1)));
  return [
    { from: "pay.html", to: "pay.html", transform: (s) => (docsInSite ? s : replaceOnce(s, `href="${DOCS}"`, 'href="/learn/"')), note: docsInSite ? "" : `docs link points at /learn/ until ${DOCS} is in the site` },
    { from: "assets/pay.js", to: "assets/pay.js", transform: (s) => replaceOnce(s, 'import("./vendor/qr.js")', 'import("./pay-qr.js")') },
    { from: "assets/pay.css", to: "assets/pay.css" },
    { from: "assets/vendor/qr.js", to: "assets/pay-qr.js" },
    { from: "assets/vendor/qr-LICENSE.txt", to: "assets/pay-qr-LICENSE.txt" },
    { from: "checkout.js", to: "checkout.js" },
  ];
}
export const ALLOWED = new Set(["pay.html", "assets/pay.js", "assets/pay.css", "assets/pay-qr.js", "assets/pay-qr-LICENSE.txt", "checkout.js", "_redirects"]);

function replaceOnce(s, a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`expected exactly one ${a} (found ${n})`);
  return s.replace(a, b);
}
/** _redirects with the /pay rule after /bridge (or at the end), the /api/* proxy rule still first. */
export function withPayRule(text) {
  const lines = text.split(/\r?\n/);
  const rules = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!rules.length || !/^\/api\/\*\s/.test(rules[0])) throw new Error("_redirects must start with the /api/* rule; not touching it");
  if (rules.some((l) => /^\/pay\s/.test(l))) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const at = lines.findIndex((l) => /^\/bridge\s/.test(l.trim()));
  if (at >= 0) lines.splice(at + 1, 0, PAY_RULE);
  else { while (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push(PAY_RULE, ""); }
  return lines.join(eol);
}
/** Text the site must never get from here. */
export function problems(name, text) {
  const out = [];
  if (text.includes("\u2014")) out.push(`${name}: em dash`);
  if (/neko/i.test(text)) out.push(`${name}: NEKO`);
  return out;
}

export function sync({ site = DEFAULT_SITE, dryRun = false, log = console.log } = {}) {
  site = path.resolve(site);
  if (!fs.existsSync(path.join(site, "_redirects"))) throw new Error("not a nearswaps site folder (no _redirects): " + site);
  const written = [], same = [];
  const jobs = plan({ site }).map((j) => {
    let text = fs.readFileSync(path.join(WEB, j.from), "utf8");
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
    if (!dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, j.text); }
    written.push(j.to);
    log(`${dryRun ? "would write" : "wrote"}  ${j.to}${j.note ? "  (" + j.note + ")" : ""}`);
  }
  for (const f of same) log(`unchanged  ${f}`);
  return { written, same };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), i = a.indexOf("--site");
  try {
    const r = sync({ site: i >= 0 ? a[i + 1] : process.env.NEARSWAPS_SITE || DEFAULT_SITE, dryRun: a.includes("--dry-run") });
    console.log(`\nsync-to-site: ${r.written.length} written, ${r.same.length} unchanged.`);
  } catch (e) { console.error("sync-to-site: " + e.message); process.exit(1); }
}
