// Node tests for the merchant docs page (web/docs/accept-payments.html) and the demo shop (demo/shop.html).
// The docs page goes to the site as learn/accept-payments.html, so it is held to the site's learn-page rules
// (Nearswaps/tools/seo-check.mjs, read 9 Nov 2026; restated here, the site folder is not read). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start, demoShopPage } from "../tools/serve-local.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const DOCS = read("web/docs/accept-payments.html");
const SHOP = read("demo/shop.html");
const textOf = (h) => h.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (html, re) => (html.match(re) || [])[1];
const inlineScripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]) && !/application\/ld\+json/.test(m[1]) && m[2].trim());

test("docs page: the site's learn-page rules", () => {
  const O = "https://nearswaps.com", u = "/learn/accept-payments.html";
  assert.equal((DOCS.match(/<h1[\s>]/g) || []).length, 1, "one h1");
  const title = textOf(attr(DOCS, /<title>([^<]*)<\/title>/));
  assert.ok(title.length < 60, `title ${title.length} characters`);
  const desc = attr(DOCS, /<meta name="description" content="([^"]*)"/);
  assert.ok(desc.length >= 120 && desc.length <= 160, `description ${desc.length} characters`);
  assert.equal(attr(DOCS, /<link rel="canonical" href="([^"]+)"/), O + u);
  assert.equal(attr(DOCS, /<meta property="og:url" content="([^"]+)"/), O + u);
  for (const k of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'name="twitter:title"']) assert.ok(DOCS.includes(`<meta ${k} content="`), k);
  assert.ok(DOCS.includes('<script type="module" src="/assets/seo.js"></script>'));
  const answer = textOf(attr(DOCS, /<p class="answer">([\s\S]*?)<\/p>/));
  const words = answer.split(/\s+/).filter(Boolean).length;
  assert.ok(words > 0 && words <= 60, `answer has ${words} words`);
  assert.match(DOCS, /<p class="checked">Last checked <time datetime="\d{4}-\d{2}-\d{2}">/);
  for (const need of ['href="/swap"', 'href="/terminal"', 'href="/check"']) assert.ok(DOCS.includes(need), need);
  const blocks = [...DOCS.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1);
  const graph = JSON.parse(blocks[0])["@graph"];
  const types = graph.map((n) => n["@type"]);
  for (const t of ["Organization", "WebSite", "BreadcrumbList", "FAQPage"]) assert.ok(types.includes(t), t);
  assert.match(graph.find((n) => n["@type"] === "WebSite").potentialAction.target.urlTemplate, /\/terminal\?q=\{search_term_string\}$/);
  const fq = graph.find((n) => n["@type"] === "FAQPage");
  const onPage = [...DOCS.matchAll(/<h3 class="faq-q">([^<]*)<\/h3>/g)].map((m) => textOf(m[1]));
  assert.ok(fq.mainEntity.length >= 4 && fq.mainEntity.length <= 6);
  assert.deepEqual(fq.mainEntity.map((q) => q.name), onPage, "FAQPage questions are the page's");
  assert.ok(!/\b(verified|audited)\b/i.test(textOf(DOCS)));
  const visible = textOf(DOCS.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, ""));
  for (const w of ["safe", "secure", "guaranteed", "instant"]) assert.ok(!new RegExp("\\b" + w + "\\b", "i").test(visible), w);
  assert.ok(!DOCS.includes("[CHECK"));
  assert.deepEqual(inlineScripts(DOCS), [], "no inline script (the site's CSP)");
  assert.ok(DOCS.includes("<!-- source: nearswaps-checkout web/docs/accept-payments.html"), "the sync's source mark");
  // Internal links the page uses, every one a file or rule the site has (or gets from the sync).
  const internal = [...DOCS.matchAll(/\s(?:href|src)="(\/[^"#]*)/g)].map((m) => m[1]).filter((l) => l !== "/");
  const known = /^\/(assets\/|learn\/(index\.html)?$|learn\/[a-z0-9-]+\.html$|compare\/$|tokens\/$|llms\.txt$|demo-shop\.html$|(swap|terminal|bridge|market|points|portfolio|pulse|check)$)/;
  for (const l of internal) assert.match(l, known, "unexpected internal link " + l);
});

test("docs page: covers what a merchant needs, with the backend's real numbers", () => {
  const t = textOf(DOCS);
  for (const opt of ["data-to", "data-amount", "data-asset", "data-label", "data-theme", "data-onpaid"]) assert.ok(DOCS.includes(`<code>${opt}</code>`), opt);
  for (const code of ["usdc", "usdt", "near", "usdc-base", "usdc-sol", "usdc-arb", "usdc-eth"]) assert.ok(DOCS.includes(`<td><code>${code}</code></td>`), code);
  assert.ok(t.includes("nearswaps:paid") && t.includes("NearswapsCheckout.open"));
  assert.match(DOCS, /<strong>The event is a convenience\. The status call is the proof\./);
  assert.ok(t.includes("GET https://nearswaps.com/api/intents?status=<depositAddress>"));
  for (const f of ["status", "recipient", "destinationAsset", "swapDetails.amountOut", "SUCCESS"]) assert.ok(DOCS.includes(`<code>${f}</code>`), f);
  assert.ok(t.includes("node verify-payment.mjs <depositAddress> --to shop.near --amount 25 --asset usdc"));
  assert.ok(t.includes("0.5%") && t.includes("included in the quote"));
  assert.ok(t.includes("5,000 USD") && t.includes("Invoices from 1 USDC") && t.includes("about 7 USDC") && t.includes("6.206565 USDC") && t.includes("0.149983 USDC"));
  for (const no of ["No partial payments", "No fiat", "No webhook", "No merchant accounts"]) assert.ok(t.includes(no), no);
  assert.ok(t.includes("Check the address matches the shop."));
  assert.ok(t.includes("refund address"));
});

test("demo shop: three products with the real tag, tome.near, 1, 2 and 5 USDC, no inline script", () => {
  const tags = [...SHOP.matchAll(/<script src="https:\/\/nearswaps\.com\/checkout\.js"([^>]*)><\/script>/g)].map((m) => m[1]);
  assert.equal(tags.length, 3);
  const opt = (t, k) => (t.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];
  assert.deepEqual(tags.map((t) => opt(t, "to")), ["tome.near", "tome.near", "tome.near"]);
  assert.deepEqual(tags.map((t) => opt(t, "amount")), ["1", "2", "5"]);
  assert.deepEqual(tags.map((t) => opt(t, "asset")), ["usdc", "usdc", "usdc"]);
  assert.deepEqual(tags.map((t) => opt(t, "label")), ["Demo shop: sticker", "Demo shop: coffee", "Demo shop: poster"]);
  assert.deepEqual(inlineScripts(SHOP), [], "no inline script (the site's CSP)");
  assert.ok(SHOP.includes('<script src="assets/demo-shop.js"></script>'));
  assert.ok(SHOP.includes('id="paid"') && SHOP.includes('id="paidDep"') && SHOP.includes('id="paidVerify"'));
  assert.match(SHOP, /<meta name="robots" content="noindex">/);
  assert.ok(/Real money\./.test(SHOP), "says plainly that the live buttons pay for real");
  const js = read("demo/assets/demo-shop.js");
  assert.ok(js.includes('addEventListener("nearswaps:paid"'));
  assert.ok(!/innerHTML/.test(js), "the banner writes text only");
});

test("demo shop, local mode: served with its tags pointed at the local pay page", async () => {
  assert.ok(!demoShopPage("http://127.0.0.1:9").includes('<script src="https://nearswaps.com/checkout.js"'));
  assert.ok(demoShopPage("http://127.0.0.1:9").includes('&lt;script src="https://nearswaps.com/checkout.js"'), "the sample shown as text keeps the live address");
  const srv = await start({ port: 0, shopPort: 0 });
  try {
    const page = await (await fetch(srv.shopOrigin + "/demo-shop")).text();
    assert.equal((page.match(new RegExp(`src="${srv.payOrigin}/checkout\\.js"`, "g")) || []).length, 3);
    assert.ok(!page.includes('<script src="https://nearswaps.com/checkout.js"'));
    const js = await fetch(srv.shopOrigin + "/assets/demo-shop.js");
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /javascript/);
    const docs = await fetch(srv.payOrigin + "/docs/accept-payments.html");
    assert.equal(docs.status, 200);
    assert.ok((await docs.text()).includes("Accept crypto payments with one script tag"));
    assert.equal((await fetch(srv.shopOrigin + "/")).status, 200, "the old test shop is still there");
  } finally { await srv.close(); }
});
