// Node tests for tools/sync-to-site.mjs (against a throwaway site folder, never the real one) and for the wording
// rules of everything in web/ and the README. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sync, withPayRule, problems, PAY_RULE, DEMO_RULE, ALLOWED } from "../tools/sync-to-site.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
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
  assert.deepEqual(r.written.sort(), ["_redirects", "assets/demo-shop.js", "assets/pay-qr-LICENSE.txt", "assets/pay-qr.js", "assets/pay.css", "assets/pay.js", "checkout.js", "demo-shop.html", "learn/accept-payments.html", "pay.html"]);
  for (const f of r.written) assert.ok(ALLOWED.has(f));
  assert.deepEqual(list(d), ["_redirects", "assets/demo-shop.js", "assets/pay-qr-LICENSE.txt", "assets/pay-qr.js", "assets/pay.css", "assets/pay.js", "assets/swap.js", "checkout.js", "demo-shop.html", "learn/accept-payments.html", "pay.html"]);
  assert.equal(fs.readFileSync(path.join(d, "assets/swap.js"), "utf8"), "core", "other files untouched");
  const pay = fs.readFileSync(path.join(d, "assets/pay.js"), "utf8");
  assert.ok(pay.includes('import("./pay-qr.js")') && !pay.includes("./vendor/qr.js"));
  assert.ok(fs.readFileSync(path.join(d, "pay.html"), "utf8").includes('href="/learn/accept-payments.html"'), "the docs link holds: the docs page is synced with it");
  assert.equal(fs.readFileSync(path.join(d, "learn/accept-payments.html"), "utf8"), fs.readFileSync(path.join(ROOT, "web/docs/accept-payments.html"), "utf8"));
  assert.equal(fs.readFileSync(path.join(d, "demo-shop.html"), "utf8"), fs.readFileSync(path.join(ROOT, "demo/shop.html"), "utf8"));
  assert.ok(fs.readFileSync(path.join(d, "demo-shop.html"), "utf8").includes('<script src="assets/demo-shop.js"></script>'), "the shop's script resolves next to it in the site");
  const red = fs.readFileSync(path.join(d, "_redirects"), "utf8").split("\n");
  assert.equal(red[red.indexOf("/bridge         /bridge.html               200") + 1], PAY_RULE);
  assert.equal(red[red.indexOf("/bridge         /bridge.html               200") + 2], DEMO_RULE);
  const again = sync({ site: d, log: () => {} });
  assert.deepEqual(again.written, [], "a second run changes nothing");
});

test("never writes into the core vendor folder", () => {
  const d = fakeSite();
  const r = sync({ site: d, log: () => {} });
  assert.ok(!r.written.some((f) => f.startsWith("assets/vendor/")));
  assert.ok(![...ALLOWED].some((f) => f.startsWith("assets/vendor/")));
  assert.deepEqual(fs.readdirSync(path.join(d, "assets", "vendor")), []);
});

test("the docs page: an older copy from this repo is updated, a page the site makes itself is kept", () => {
  const ours = fakeSite({ "learn/accept-payments.html": "<!doctype html>\n<!-- source: nearswaps-checkout web/docs/accept-payments.html (old) -->\n<p>old</p>" });
  assert.ok(sync({ site: ours, log: () => {} }).written.includes("learn/accept-payments.html"));
  const theirs = fakeSite({ "learn/accept-payments.html": "<!doctype html><title>made by seo-build</title>" });
  const r = sync({ site: theirs, log: () => {} });
  assert.deepEqual(r.kept, ["learn/accept-payments.html"]);
  assert.equal(fs.readFileSync(path.join(theirs, "learn/accept-payments.html"), "utf8"), "<!doctype html><title>made by seo-build</title>");
});

test("refuses text the site must not get: an inline script (the CSP), an em dash, NEKO", () => {
  assert.deepEqual(problems("x.html", '<script src="/a.js"></script><script type="application/ld+json">{"a":1}</script>'), []);
  assert.match(problems("x.html", "<script>alert(1)</script>").join(), /inline <script>/);
  assert.match(problems("x.html", "<script type=\"module\">import x from '/y.js'</script>").join(), /inline <script>/);
  assert.deepEqual(problems("x.js", "<script>not html</script>"), []);
  assert.match(problems("x.html", "a " + String.fromCharCode(0x2014) + " b").join(), /em dash/);
  for (const f of ["web/pay.html", "web/docs/accept-payments.html", "demo/shop.html"]) assert.deepEqual(problems(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], f);
});

test("dry run writes nothing; a folder that is not the site is refused", () => {
  const d = fakeSite();
  const r = sync({ site: d, dryRun: true, log: () => {} });
  assert.ok(r.written.length > 0);
  assert.deepEqual(list(d), ["_redirects", "assets/swap.js"]);
  assert.equal(fs.readFileSync(path.join(d, "_redirects"), "utf8"), REDIRECTS);
  assert.throws(() => sync({ site: fs.mkdtempSync(path.join(os.tmpdir(), "ns-empty-")), log: () => {} }), /not a nearswaps site folder/);
});

test("the /pay and /demo-shop rules: after /bridge, once each, and never before the /api/* proxy rule", () => {
  const once = withPayRule(REDIRECTS);
  assert.equal(withPayRule(once), once);
  assert.ok(once.trim().split("\n").find((l) => !l.startsWith("#") && l.trim()).startsWith("/api/*"));
  assert.equal(once.split(PAY_RULE).length - 1, 1);
  assert.equal(once.split(DEMO_RULE).length - 1, 1);
  const withPay = REDIRECTS + PAY_RULE + "\n";
  const both = withPayRule(withPay);
  assert.equal(both.split(PAY_RULE).length - 1, 1, "a /pay line already there is not repeated");
  assert.equal(both.split("\n")[both.split("\n").indexOf(PAY_RULE) + 1], DEMO_RULE, "the /demo-shop line goes right after /pay");
  const tail = withPayRule("/api/*  x  200\n");
  assert.ok(tail.includes(PAY_RULE) && tail.includes(DEMO_RULE), "appended when there is no /bridge line");
  assert.throws(() => withPayRule("/swap /swap.html 200\n"), /must start with the \/api\/\* rule/);
  assert.ok(withPayRule(REDIRECTS.replace(/\n/g, "\r\n")).includes(PAY_RULE + "\r\n"), "keeps CRLF");
});

/* ---------- wording ---------- */
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
  const files = ["web/pay.html", "web/assets/pay.js", "web/checkout.js", "README.md", "web/docs/accept-payments.html", "demo/shop.html", "demo/assets/demo-shop.js", "verify-payment.mjs"].map((f) => path.join(ROOT, f));
  for (const f of files) assert.ok(fs.existsSync(f), "missing " + f);
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8").replace(/https?:\/\/\S+/g, "");
    for (const w of ["safe", "secure", "verified", "audited", "guaranteed", "instant", "emoji"]) assert.ok(!new RegExp("\\b" + w + "\\b", "i").test(t), `"${w}" in ${f}`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t), "emoji in " + f);
  }
  for (const f of ["web/pay.html", "web/docs/accept-payments.html", "demo/shop.html"]) assert.ok(fs.readFileSync(path.join(ROOT, f), "utf8").includes("included in the quote"), f);
});
