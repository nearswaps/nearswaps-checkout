// A local copy of nearswaps checkout with a mocked backend, for hand checks and the browser test. No packages, no network.
//
//   node tools/serve-local.mjs [--port 8787] [--shop-port 8788] [--site <path to Nearswaps\site>] [--no-checkout]
//
//   http://127.0.0.1:8787/pay?to=shop.near&amount=25&asset=usdc   the pay page (web/pay.html)
//   http://127.0.0.1:8788/                                        a merchant page on another origin with the real tag
//
// Served from web/ first. The pay page also loads a few shared nearswaps files (brand.css, fonts, theme.js, coin icons,
// the wallet selector); with --site (or NEARSWAPS_SITE) they are read, read-only, from the nearswaps site folder.
// /api/intents is answered by the mock below (tokens, dry and live "checkout" and "quote" quotes, submit, status), and
// /mock-1click/v0/status stands in for 1Click's own status (the deposit-address check). A deposit moves on by itself:
// waiting for 20 s, then seen, processing, delivered (control it with /__mock?speed=fast|slow|stop and ?checkout=off).
// --no-checkout answers the "checkout" action 400 "unknown action", as the proxy does before the action ships.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(here, "../web");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".webp": "image/webp" };

/* ---------------- the mocked backend ---------------- */
const ONECLICK_FEE_ACCOUNT = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
export const MOCK_TOKENS = {
  tokens: [
    { assetId: "nep141:btc.omft.near", symbol: "BTC", chain: "btc", chainName: "Bitcoin", decimals: 8, price: 100000, contract: null, payIn: true },
    { assetId: "nep141:eth.omft.near", symbol: "ETH", chain: "eth", chainName: "Ethereum", decimals: 18, price: 3500, contract: null, payIn: true },
    { assetId: "nep141:base.omft.near", symbol: "ETH", chain: "base", chainName: "Base", decimals: 18, price: 3500, contract: null, payIn: true },
    { assetId: "nep141:sol.omft.near", symbol: "SOL", chain: "sol", chainName: "Solana", decimals: 9, price: 180, contract: null, payIn: true },
    { assetId: "nep141:zec.omft.near", symbol: "ZEC", chain: "zec", chainName: "Zcash", decimals: 8, price: 40, contract: null, payIn: true },
    { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", symbol: "USDC", chain: "eth", chainName: "Ethereum", decimals: 6, price: 1, contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", payIn: true },
    { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chain: "sol", chainName: "Solana", decimals: 6, price: 1, contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payIn: true },
    { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "base", chainName: "Base", decimals: 6, price: 1, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payIn: true },
    { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chain: "arb", chainName: "Arbitrum", decimals: 6, price: 1, contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", payIn: true },
    { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", symbol: "USDT", chain: "eth", chainName: "Ethereum", decimals: 6, price: 1, contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", payIn: true },
    { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", symbol: "USDT", chain: "tron", chainName: "Tron", decimals: 6, price: 1, contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", payIn: true },
  ],
  origins: {
    "nep141:wrap.near": { decimals: 24, price: 3.2 },
    "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { decimals: 6, price: 1 },
    "nep141:usdt.tether-token.near": { decimals: 6, price: 1 },
  },
  keyed: true, at: 0,
};
const DEST = {
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { decimals: 6, price: 1, chain: "near" },
  "nep141:usdt.tether-token.near": { decimals: 6, price: 1, chain: "near" },
  "nep141:wrap.near": { decimals: 24, price: 3.2, chain: "near" },
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": { decimals: 6, price: 1, chain: "base" },
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": { decimals: 6, price: 1, chain: "sol" },
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near": { decimals: 6, price: 1, chain: "arb" },
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": { decimals: 6, price: 1, chain: "eth" },
};
function origin(assetId) {
  const t = MOCK_TOKENS.tokens.find((x) => x.assetId === assetId);
  if (t) return t;
  const o = MOCK_TOKENS.origins[assetId];
  return o ? { assetId, decimals: o.decimals, price: o.price, chain: "near" } : null;
}
const scale = (n, d) => BigInt(Math.round(n * 1e6)) * 10n ** BigInt(d) / 1000000n;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function depFor(chain, n) {
  const hex = (len) => Array.from({ length: len }, (_, i) => "0123456789abcdef"[(n * 7 + i * 13) % 16]).join("");
  const b58 = (len) => Array.from({ length: len }, (_, i) => B58[(n * 11 + i * 17) % 58]).join("");
  if (chain === "btc") return "bc1q" + Array.from({ length: 38 }, (_, i) => "qpzry9x8gf2tvdw0s3jn54khce6mua7l"[(n * 5 + i * 7) % 32]).join("");
  if (chain === "eth" || chain === "base" || chain === "arb") return "0x" + hex(40);
  if (chain === "sol") return b58(44);
  if (chain === "zec") return "t1" + b58(33);
  if (chain === "tron") return "T" + b58(33);
  return hex(64);
}

export function createMock(opts = {}) {
  const state = { checkout: opts.checkout !== false, speed: "normal", n: 1, deps: new Map() };
  const STEP = () => (state.speed === "fast" ? 2000 : state.speed === "slow" ? 60000 : 10000);
  function quoteFor(b, live) {
    const o = origin(b.originAsset), d = DEST[b.destinationAsset];
    if (!o) return { status: 400, body: { error: "That coin can't pay here" } };
    if (!d) return { status: 400, body: { error: "The merchant can be paid in USDC, USDT or NEAR on NEAR, or USDC on Base, Solana, Arbitrum or Ethereum" } };
    if (o.symbol === "ZEC") return { status: 400, body: { error: "Below the smallest payment for this route: at least 30 USDC", minAmount: "30000000" } };
    if (o.chain === "tron") return { status: 502, body: { error: "No liquidity for this pair right now" } };
    const usd = Number(BigInt(b.amount) * 1000000n / 10n ** BigInt(d.decimals)) / 1e6 * d.price;
    const amountIn = scale((usd / o.price) * 1.006 * (live ? 1.0004 : 1), o.decimals).toString();
    const quote = { amountIn, amountInFormatted: String(Number(amountIn) / 10 ** o.decimals), amountOut: String(b.amount), minAmountOut: String(b.amount),
      amountOutUsd: usd.toFixed(2), amountInUsd: (usd * 1.006).toFixed(2), timeEstimate: o.chain === "btc" ? 900 : 40, deadline: new Date(Date.now() + 30 * 60e3).toISOString() };
    if (live) quote.depositAddress = depFor(o.chain, state.n++);
    return { quote, o, d };
  }
  function handle(method, url, body) {
    const u = new URL(url, "http://x");
    if (u.pathname === "/__mock") {
      if (u.searchParams.get("speed")) state.speed = u.searchParams.get("speed");
      if (u.searchParams.get("checkout")) state.checkout = u.searchParams.get("checkout") !== "off";
      return { status: 200, body: { checkout: state.checkout, speed: state.speed } };
    }
    if (u.pathname.startsWith("/mock-1click/v0/status")) {
      const rec = state.deps.get(u.searchParams.get("depositAddress") || "");
      if (!rec) return { status: 404, body: { message: "deposit address not found" } };
      return { status: 200, body: { status: "PENDING_DEPOSIT", updatedAt: new Date().toISOString(), quoteResponse: { quote: rec.quote, quoteRequest: rec.request } } };
    }
    if (u.pathname !== "/api/intents") return null;
    if (method === "GET") {
      if (u.searchParams.get("tokens")) return { status: 200, body: { ...MOCK_TOKENS, at: Date.now() } };
      const dep = u.searchParams.get("status");
      if (dep) {
        const rec = state.deps.get(dep);
        if (!rec) return { status: 200, body: { status: "PENDING_DEPOSIT", updatedAt: null, swapDetails: {} } };
        if (state.speed !== "stop") {
          const since = Date.now() - rec.at;
          const s = since < 2 * STEP() && !rec.sent ? "PENDING_DEPOSIT" : since < 3 * STEP() ? "KNOWN_DEPOSIT_TX" : since < 4 * STEP() ? "PROCESSING" : "SUCCESS";
          rec.status = s;
        }
        const ok = rec.status === "SUCCESS";
        return { status: 200, body: { status: rec.status, updatedAt: new Date().toISOString(), kind: "checkout", label: rec.request.label || null,
          recipient: rec.request.recipient, destinationAsset: rec.request.destinationAsset, amount: rec.request.amount, swapType: "EXACT_OUTPUT",
          swapDetails: { amountOut: ok ? rec.request.amount : null, amountOutFormatted: ok ? String(Number(rec.request.amount) / 10 ** rec.d.decimals) : null,
            destinationChainTxHashes: ok ? [{ hash: "7Hq2mock" + dep.slice(-8), explorerUrl: "https://nearblocks.io/txns/7Hq2mock" + dep.slice(-8) }] : [], nearTxHashes: [] } } };
      }
      return { status: 400, body: { error: "Ask for tokens, status or wallet" } };
    }
    if (method !== "POST") return { status: 405, body: { error: "Use GET or POST" } };
    const b = body || {};
    if (b.action === "checkout") {
      if (!state.checkout) return { status: 400, body: { error: "unknown action" } };
      const r = quoteFor(b, b.dry === false);
      if (!r.quote) return r;
      const request = { swapType: "EXACT_OUTPUT", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", slippageTolerance: 100,
        originAsset: b.originAsset, destinationAsset: b.destinationAsset, amount: String(b.amount), recipient: b.recipient, refundTo: b.refundTo, label: b.label || null,
        appFees: [{ recipient: "fees.near", fee: 25 }, { recipient: ONECLICK_FEE_ACCOUNT, fee: 25 }] };
      if (b.dry === false) state.deps.set(r.quote.depositAddress, { at: Date.now(), quote: r.quote, request, d: r.d, status: "PENDING_DEPOSIT" });
      return { status: 200, body: { kind: "checkout", dry: b.dry !== false, correlationId: "mock-" + state.n, quote: r.quote, appFeeBps: 50,
        originAsset: b.originAsset, destinationAsset: b.destinationAsset, amount: String(b.amount), recipient: b.recipient, refundTo: b.refundTo, label: b.label || null, deadline: r.quote.deadline } };
    }
    if (b.action === "quote" && b.dir === "in") {
      const o = origin(b.originAsset), d = DEST[b.destinationAsset];
      if (!o || o.chain === "near") return { status: 400, body: { error: "That coin can't be paid in here" } };
      if (!d || d.chain !== "near") return { status: 400, body: { error: "Receive wNEAR, USDC or USDT on NEAR" } };
      if (o.chain === "tron") return { status: 502, body: { error: "No liquidity for this pair right now" } };
      const usd = Number(BigInt(b.amount) * 1000000n / 10n ** BigInt(o.decimals)) / 1e6 * o.price;
      const amountOut = scale((usd / d.price) * 0.994, d.decimals).toString();
      return { status: 200, body: { dry: true, quote: { amountIn: String(b.amount), amountOut, minAmountOut: amountOut, timeEstimate: 40 }, appFeeBps: 50 } };
    }
    if (b.action === "submit") { const rec = state.deps.get(b.depositAddress); if (rec) rec.sent = true; return { status: 200, body: { ok: true, status: "KNOWN_DEPOSIT_TX", submitted: true } }; }
    return { status: 400, body: { error: "unknown action" } };
  }
  return { state, handle };
}

/* ---------------- the merchant page (another origin) ---------------- */
export function shopPage(payOrigin) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test shop</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f6f7f8;color:#0e1114}main{max-width:560px;margin:0 auto}
.p{background:#fff;border:1px solid #e3e5e8;border-radius:16px;padding:20px;margin:0 0 16px}#paid{display:none;padding:12px 16px;border-radius:12px;background:#e6f6f0;color:#00603f;margin:0 0 16px}
pre{white-space:pre-wrap;word-break:break-all;font-size:12px;background:#f1f3f5;padding:10px;border-radius:8px}</style></head><body><main>
<h1>Test shop</h1><p id="paid" role="status"></p>
<div class="p"><h2>Linen shirt</h2><p>25 USDC</p>
<script src="${payOrigin}/checkout.js" data-to="shop.near" data-amount="25" data-asset="usdc" data-label="Order 1042" data-theme="light" data-onpaid="onPaid"></script></div>
<div class="p"><h2>Gift card</h2><p>10 USDC on Base</p>
<script src="${payOrigin}/checkout.js" data-to="0x1111111111111111111111111111111111111111" data-amount="10" data-asset="usdc-base" data-label="Gift card"></script></div>
<pre id="log">events: none yet</pre>
<script src="/shop.js"></script></main></body></html>`;
}
const SHOP_JS = `window.onPaid = function (d) { var p = document.getElementById("paid"); p.style.display = "block"; p.textContent = "Paid: " + d.amount + " " + d.asset + " (" + (d.label || "") + "). Verify: " + d.statusUrl; };
document.addEventListener("nearswaps:paid", function (e) { document.getElementById("log").textContent = "nearswaps:paid " + JSON.stringify(e.detail, null, 1); });`;

/* ---------------- the servers ---------------- */
function sendFile(res, file) {
  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}
function safeJoin(root, p) {
  const f = path.normalize(path.join(root, decodeURIComponent(p)));
  return f.startsWith(root) ? f : null;
}
export function start({ port = 8787, shopPort = 8788, site = process.env.NEARSWAPS_SITE || "", checkout = true, host = "127.0.0.1" } = {}) {
  const mock = createMock({ checkout });
  const payOrigin = `http://${host}:${port}`;
  const pay = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", () => {
      const u = new URL(req.url, payOrigin);
      let json = null; try { json = body ? JSON.parse(body) : null; } catch (e) {}
      const m = mock.handle(req.method, req.url, json);
      if (m) { res.writeHead(m.status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(m.body)); return; }
      // The local copy checks deposit addresses against the mock 1Click (the page allows that on localhost only).
      if (u.pathname === "/pay" && !u.searchParams.get("oneclick")) { u.searchParams.set("oneclick", "/mock-1click"); res.writeHead(302, { Location: u.pathname + "?" + u.searchParams.toString() }); res.end(); return; }
      let p = u.pathname === "/pay" ? "/pay.html" : u.pathname === "/" ? "/pay.html" : u.pathname;
      const local = safeJoin(WEB, p);
      if (local && fs.existsSync(local) && fs.statSync(local).isFile()) return sendFile(res, local);
      if (site) { const s = safeJoin(path.resolve(site), p); if (s && fs.existsSync(s) && fs.statSync(s).isFile()) return sendFile(res, s); }
      res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found");
    });
  });
  const shop = http.createServer((req, res) => {
    if (req.url === "/shop.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(SHOP_JS); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(shopPage(`http://${host}:${pay.address().port}`));
  });
  return new Promise((resolve) => {
    pay.listen(port, host, () => shop.listen(shopPort, host, () => resolve({ pay, shop, mock, payOrigin: `http://${host}:${pay.address().port}`, shopOrigin: `http://${host}:${shop.address().port}`,
      close: () => Promise.all([new Promise((r) => pay.close(r)), new Promise((r) => shop.close(r))]) })));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  start({ port: Number(arg("--port", 8787)), shopPort: Number(arg("--shop-port", 8788)), site: arg("--site", process.env.NEARSWAPS_SITE || ""), checkout: !a.includes("--no-checkout") })
    .then((s) => console.log(`pay page:  ${s.payOrigin}/pay?to=shop.near&amount=25&asset=usdc&label=Order%201042\nshop page: ${s.shopOrigin}/`));
}
