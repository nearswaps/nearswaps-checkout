// Node tests for tools/sync-to-site.mjs (against a throwaway site folder, never the real one) and for the wording
// rules of everything in web/ and the README. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sync, withPayRule, PAY_RULE, ALLOWED } from "../tools/sync-to-site.mjs";

const REDIRECTS = "# comment\n/api/*          https://nekoonnear.com/api/:splat   200\n\n/swap           /swap.html                 200\n/bridge         /bridge.html               200\n/points         /points.html               200\n";
function fakeSite(extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ns-site-"));
  fs.writeFileSync(path.join(d, "_redirects"), REDIRECTS);
  fs.mkdirSync(path.join(d, "assets", "vendor"), { recursive: true });
  fs.writeFileSync(path.join(d, "assets", "swap.js"), "core");
  for (const [f, t] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
}
const list = (d) => { const out = []; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(d, f).split(path.sep).join("/")); } }; walk(d); return out.sort(); };

test("writes exactly the allowed files and the /pay rule, QR outside the core vendor folder by default", () => {
  const d = fakeSite();
  const r = sync({ site: d, log: () => {} });
  assert.deepEqual(r.written.sort(), ["_redirects", "assets/pay-qr-LICENSE.txt", "assets/pay-qr.js", "assets/pay.css", "assets/pay.js", "checkout.js", "pay.html"]);
  for (const f of r.written) assert.ok(ALLOWED.has(f));
  assert.deepEqual(list(d), ["_redirects", "assets/pay-qr-LICENSE.txt", "assets/pay-qr.js", "assets/pay.css", "assets/pay.js", "assets/swap.js", "checkout.js", "pay.html"]);
  assert.equal(fs.readFileSync(path.join(d, "assets/swap.js"), "utf8"), "core", "other files untouched");
  const pay = fs.readFileSync(path.join(d, "assets/pay.js"), "utf8");
  assert.ok(pay.includes('import("./pay-qr.js")') && !pay.includes("./vendor/qr.js"));
  assert.ok(fs.readFileSync(path.join(d, "pay.html"), "utf8").includes('href="/learn/"'), "docs link waits for the docs page");
  const red = fs.readFileSync(path.join(d, "_redirects"), "utf8").split("\n");
  assert.equal(red[red.indexOf("/bridge         /bridge.html               200") + 1], PAY_RULE);
  const again = sync({ site: d, log: () => {} });
  assert.deepEqual(again.written, [], "a second run changes nothing");
});

test("never writes into the core vendor folder; the docs link stays once the docs page exists", () => {
  const d = fakeSite({ "learn/accept-payments.html": "<!doctype html>" });
  const r = sync({ site: d, log: () => {} });
  assert.ok(!r.written.some((f) => f.startsWith("assets/vendor/")));
  assert.ok(![...ALLOWED].some((f) => f.startsWith("assets/vendor/")));
  assert.deepEqual(fs.readdirSync(path.join(d, "assets", "vendor")), []);
  assert.ok(fs.readFileSync(path.join(d, "pay.html"), "utf8").includes('href="/learn/accept-payments.html"'));
});

test("dry run writes nothing; a folder that is not the site is refused", () => {
  const d = fakeSite();
  const r = sync({ site: d, dryRun: true, log: () => {} });
  assert.ok(r.written.length > 0);
  assert.deepEqual(list(d), ["_redirects", "assets/swap.js"]);
  assert.equal(fs.readFileSync(path.join(d, "_redirects"), "utf8"), REDIRECTS);
  assert.throws(() => sync({ site: fs.mkdtempSync(path.join(os.tmpdir(), "ns-empty-")), log: () => {} }), /not a nearswaps site folder/);
});

test("the /pay rule: after /bridge, once, and never before the /api/* proxy rule", () => {
  const once = withPayRule(REDIRECTS);
  assert.equal(withPayRule(once), once);
  assert.ok(once.trim().split("\n").find((l) => !l.startsWith("#") && l.trim()).startsWith("/api/*"));
  assert.ok(withPayRule("/api/*  x  200\n").includes(PAY_RULE), "appended when there is no /bridge line");
  assert.throws(() => withPayRule("/swap /swap.html 200\n"), /must start with the \/api\/\* rule/);
  assert.ok(withPayRule(REDIRECTS.replace(/\n/g, "\r\n")).includes(PAY_RULE + "\r\n"), "keeps CRLF");
});

/* ---------- wording ---------- */
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const textFiles = (dir) => { const out = []; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) { if (!["node_modules", ".git"].includes(e.name)) walk(f); } else if (/\.(html|js|mjs|css|md|txt|json)$/.test(e.name)) out.push(f); } }; walk(dir); return out; };
test("no em dashes and nothing NEKO anywhere in the repo's own files", () => {
  for (const f of textFiles(ROOT)) {
    if (f.endsWith("sync.test.mjs") || f.endsWith("sync-to-site.mjs") || f.endsWith("package-lock.json")) continue;
    const t = fs.readFileSync(f, "utf8");
    assert.ok(!t.includes("—"), "em dash in " + f);
    if (!/[\\/](tests|tools)[\\/]/.test(f)) assert.ok(!/neko/i.test(t), "NEKO in " + f);
  }
});
test("the pay page, the loader and the README avoid the words the brand rules out", () => {
  const files = [path.join(ROOT, "web/pay.html"), path.join(ROOT, "web/assets/pay.js"), path.join(ROOT, "web/checkout.js"), path.join(ROOT, "README.md")].filter((f) => fs.existsSync(f));
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8").replace(/https?:\/\/\S+/g, "");
    for (const w of ["safe", "secure", "verified", "audited", "guaranteed", "instant", "emoji"]) assert.ok(!new RegExp("\\b" + w + "\\b", "i").test(t), `"${w}" in ${f}`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t), "emoji in " + f);
  }
  assert.ok(fs.readFileSync(path.join(ROOT, "web/pay.html"), "utf8").includes("included in the quote"));
});
