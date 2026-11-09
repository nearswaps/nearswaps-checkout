// Node tests for the merchant loader (web/checkout.js), run in a vm sandbox with a small fake DOM: the button,
// the pay page's URL, the popup, the origin checks on messages, the nearswaps:paid event and data-onpaid. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../web/checkout.js", import.meta.url), "utf8");

class FakeEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; } }
class FakeEl {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.listeners = {}; this.parentNode = null; this.textContent = ""; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatchEvent(e) { let n = this; e.target = e.target || this; while (n) { for (const fn of n.listeners[e.type] || []) fn.call(n, e); if (!e.bubbles) break; n = n.parentNode; } return true; }
  click() { this.dispatchEvent(new FakeEvent("click")); }
}

/** A page at `pageOrigin` with one checkout.js tag loaded from `scriptSrc` carrying `data`. */
function makePage({ scriptSrc = "https://nearswaps.com/checkout.js", data = { to: "shop.near", amount: "25", asset: "usdc", label: "Order 1042" }, pageOrigin = "https://shop.example", phone = false, extra = {} } = {}) {
  const document = new FakeEl("#document");
  const body = document.appendChild(new FakeEl("body"));
  const script = body.appendChild(new FakeEl("script"));
  script.src = scriptSrc; Object.assign(script.dataset, data);
  document.currentScript = script;
  document.createElement = (t) => new FakeEl(t);
  document.createElementNS = (ns, t) => new FakeEl(t);
  const opened = [];
  const listeners = {};
  const window = {
    document, location: { href: pageOrigin + "/cart", origin: pageOrigin },
    navigator: { userAgent: phone ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile" : "Mozilla/5.0 (Windows NT 10.0)" },
    innerWidth: phone ? 390 : 1440, outerWidth: 1440, outerHeight: 900, screenX: 0, screenY: 0,
    matchMedia: (q) => ({ matches: phone && /coarse/.test(q) }),
    open(url, name, features) { const w = { url, name, features, focus() {}, posted: [], postMessage(m, o) { this.posted.push([m, o]); } }; opened.push(w); return w; },
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    CustomEvent: FakeEvent, URL, URLSearchParams, console: { warn() {}, error() {} },
    ...extra,
  };
  window.window = window;
  const ctx = vm.createContext(window);
  vm.runInContext(SRC, ctx, { filename: "checkout.js" });
  const post = (e) => { for (const fn of listeners.message || []) fn(e); };
  return { window, document, body, script, opened, post, button: script.nextSibling, run: () => vm.runInContext(SRC, ctx) };
}

test("draws one mint pill button after the tag, with the amount, the asset and the mark", () => {
  const p = makePage();
  assert.equal(p.button.tagName, "BUTTON");
  assert.equal(p.button.children[1].textContent, "Pay 25 USDC");
  assert.equal(p.button.children[0].tagName, "SVG");
  assert.equal(p.button.children[0].attrs.width, "16");
  assert.match(p.button.style.cssText, /background:#01FAC0/);
  assert.match(p.button.style.cssText, /border-radius:999px/);
  assert.match(p.button.style.cssText, /min-height:44px/);
  const light = makePage({ data: { to: "shop.near", amount: "10", asset: "usdc-base", theme: "light" } });
  assert.match(light.button.style.cssText, /background:#007A5A/);
  assert.equal(light.button.children[1].textContent, "Pay 10 USDC");
  const none = makePage({ data: { to: "shop.near" } });
  assert.equal(none.button, null, "no amount, no button");
});

test("builds the pay page URL on the script's own origin with the merchant's origin as ref", () => {
  const p = makePage({ scriptSrc: "https://preview--nearswaps.netlify.app/checkout.js" });
  const { payUrl } = p.window.NearswapsCheckout._internals;
  assert.equal(p.window.NearswapsCheckout.origin, "https://preview--nearswaps.netlify.app");
  const u = new URL(payUrl("https://nearswaps.com", { to: "shop.near", amount: "25", asset: "USDC", label: "Order 1042 & co" }, "https://shop.example"));
  assert.equal(u.origin + u.pathname, "https://nearswaps.com/pay");
  assert.equal(u.searchParams.get("to"), "shop.near");
  assert.equal(u.searchParams.get("amount"), "25");
  assert.equal(u.searchParams.get("asset"), "usdc", "lower case");
  assert.equal(u.searchParams.get("label"), "Order 1042 & co");
  assert.equal(u.searchParams.get("ref"), "https://shop.example");
  assert.ok(!payUrl("https://nearswaps.com", { to: "a.near", amount: 1, label: "a b" }, "").includes("+"), "spaces as %20");
  assert.equal(new URL(payUrl("https://nearswaps.com", { to: "a.near", amount: 1 }, "file://x")).searchParams.get("ref"), null);
  assert.equal(new URL(payUrl("https://nearswaps.com", { to: "a.near", amount: 1, theme: "light" }, "")).searchParams.get("theme"), "light");
});

test("a click opens a popup on a computer and a new tab on a phone", () => {
  const p = makePage();
  p.button.click();
  assert.equal(p.opened.length, 1);
  assert.equal(p.opened[0].name, "nearswaps_pay");
  assert.match(p.opened[0].features, /popup=yes,width=460,height=780/);
  const u = new URL(p.opened[0].url);
  assert.equal(u.origin, "https://nearswaps.com");
  assert.equal(u.searchParams.get("ref"), "https://shop.example");
  const phone = makePage({ phone: true });
  phone.button.click();
  assert.equal(phone.opened[0].name, "_blank");
  assert.equal(phone.opened[0].features, undefined);
});

test("answers the pay page's hello only from its own origin and only to a popup it opened", () => {
  const p = makePage();
  p.button.click();
  const win = p.opened[0];
  p.post({ origin: "https://evil.example", source: win, data: { ns: "checkout", type: "hello" } });
  assert.equal(win.posted.length, 0, "wrong origin");
  const stranger = { posted: [], postMessage(m, o) { this.posted.push([m, o]); } };
  p.post({ origin: "https://nearswaps.com", source: stranger, data: { ns: "checkout", type: "hello" } });
  assert.equal(stranger.posted.length, 0, "not a popup this page opened");
  p.post({ origin: "https://nearswaps.com", source: win, data: { ns: "checkout", type: "hello" } });
  assert.equal(JSON.stringify(win.posted), JSON.stringify([[{ ns: "checkout", type: "ready" }, "https://nearswaps.com"]]), "targeted at nearswaps' origin, never *");
});

test("the paid message becomes a nearswaps:paid event on the button and calls data-onpaid, once", () => {
  const calls = [];
  const p = makePage({ data: { to: "shop.near", amount: "25", asset: "usdc", label: "Order 1042", onpaid: "shop.onPaid" }, extra: { shop: { onPaid: (d) => calls.push(d) } } });
  const events = [];
  p.document.addEventListener("nearswaps:paid", (e) => events.push(e));
  p.button.click();
  const win = p.opened[0];
  const msg = { ns: "checkout", status: "paid", depositAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", amount: "25", asset: "usdc", label: "Order 1042", to: "shop.near" };
  p.post({ origin: "https://evil.example", source: win, data: msg });
  assert.equal(events.length, 0, "another origin is ignored");
  p.post({ origin: "https://nearswaps.com", source: win, data: { ...msg, ns: "other" } });
  assert.equal(events.length, 0, "another namespace is ignored");
  p.post({ origin: "https://nearswaps.com", source: win, data: { ...msg, depositAddress: "<img src=x>" } });
  assert.equal(events.length, 0, "a deposit address that is not one is ignored");
  p.post({ origin: "https://nearswaps.com", source: win, data: msg });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.target, p.button, "dispatched on the button, bubbling to document");
  assert.equal(e.detail.depositAddress, msg.depositAddress);
  assert.equal(e.detail.amount, "25");
  assert.equal(e.detail.statusUrl, "https://nearswaps.com/api/intents?status=" + msg.depositAddress);
  assert.equal(calls.length, 1); assert.equal(calls[0].label, "Order 1042");
  p.post({ origin: "https://nearswaps.com", source: win, data: msg });
  assert.equal(events.length, 1, "the same deposit is reported once");
});

test("data-onpaid only resolves to a function on window, never evaluates code", () => {
  let hit = false;
  const p = makePage({ extra: { ok: () => { hit = true; } } });
  const { resolveFn } = p.window.NearswapsCheckout._internals;
  assert.equal(typeof resolveFn("ok"), "function");
  assert.equal(resolveFn("alert(1)"), null);
  assert.equal(resolveFn("constructor.constructor"), null, "only own properties");
  assert.equal(resolveFn("missing"), null);
  assert.equal(resolveFn("location"), null, "not a function");
  resolveFn("ok")(); assert.equal(hit, true);
});

test("NearswapsCheckout.open works without a button and dispatches on document", () => {
  const p = makePage({ data: {} });
  assert.equal(p.button, null);
  assert.throws(() => p.window.NearswapsCheckout.open({ to: "shop.near" }), /needs to and amount/);
  const w = p.window.NearswapsCheckout.open({ to: "shop.near", amount: "5", asset: "near", label: "Tip" });
  assert.equal(new URL(w.url).searchParams.get("asset"), "near");
  const got = [];
  p.document.addEventListener("nearswaps:paid", (e) => got.push(e));
  p.post({ origin: "https://nearswaps.com", source: w, data: { ns: "checkout", status: "paid", depositAddress: "abcdef", amount: "5", asset: "near" } });
  assert.equal(got.length, 1);
  assert.equal(got[0].target, p.document);
});

test("two tags on one page share one listener", () => {
  const p = makePage();
  const before = p.window.NearswapsCheckout;
  p.document.currentScript = p.script;   // the same tag again
  p.run();
  assert.equal(p.window.NearswapsCheckout._opened, before._opened, "one list of popups");
});

test("the loader stays plain: no eval, no iframe, no stylesheet, no '*' target", () => {
  assert.doesNotMatch(SRC, /\beval\(|new Function|innerHTML|<iframe|createElement\("iframe"\)|createElement\("style"\)|createElement\("link"\)/);
  assert.doesNotMatch(SRC, /postMessage\([^)]*["']\*["']\)/);
});
