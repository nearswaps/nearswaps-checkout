// Node tests for the pay page's pure parts (web/assets/pay.js): address patterns, amounts, the invoice link,
// deep links, the status state machine, reload survival and the quote checks. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as P from "../web/assets/pay.js";

/* ---------- address patterns (the proxy's) ---------- */
test("address patterns are the proxy's, copied verbatim from netlify/shared/intents.mjs", () => {
  const src = "C:/Users/slpto/OneDrive/Desktop/NEKO WEBSITE/netlify/shared/intents.mjs";
  if (!fs.existsSync(src)) return;   // only on the PC that has the backend
  const text = fs.readFileSync(src, "utf8");
  for (const [chain, re] of Object.entries(P.ADDRESS)) {
    if (chain === "near") { assert.ok(text.includes("const NEAR_ACCOUNT = " + P.NEAR_ACCOUNT.toString() + ";"), "NEAR_ACCOUNT"); continue; }
    assert.ok(text.includes(re.toString()), chain + " pattern matches the proxy's");
  }
});
test("addressOk accepts each chain's own addresses and refuses the others", () => {
  const good = {
    near: ["shop.near", "a1.tg", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
    btc: ["bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"],
    eth: ["0x742d35Cc6634C0532925a3b844Bc454e4438f44e"], base: ["0x742d35Cc6634C0532925a3b844Bc454e4438f44e"], arb: ["0x742d35Cc6634C0532925a3b844Bc454e4438f44e"],
    sol: ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
    zec: ["t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs"],
    tron: ["TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"],
  };
  for (const [chain, list] of Object.entries(good)) for (const a of list) assert.equal(P.addressOk(chain, a), true, chain + " " + a);
  assert.equal(P.addressOk("near", "Shop.near"), false, "upper case is not a NEAR account");
  assert.equal(P.addressOk("near", "x"), false);
  assert.equal(P.addressOk("eth", "0x742d35Cc6634C0532925a3b844Bc454e4438f44"), false, "39 hex");
  assert.equal(P.addressOk("btc", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"), false, "EVM address on Bitcoin");
  assert.equal(P.addressOk("sol", "0OIl" + "1".repeat(40)), false, "not base58");
  assert.equal(P.addressOk("doge", "D8xxx"), false, "unknown chain");
  assert.equal(P.addressOk("eth", null), false);
  for (const [chain, a] of Object.entries(P.DRY_REFUND)) assert.equal(P.addressOk(chain, a), true, "dry refund " + chain);
});

/* ---------- amounts ---------- */
test("toRaw and fromRaw round-trip exact decimals", () => {
  assert.equal(P.toRaw("25", 6), "25000000");
  assert.equal(P.toRaw("12.5", 6), "12500000");
  assert.equal(P.toRaw("0.000001", 6), "1");
  assert.equal(P.toRaw("1", 24), "1" + "0".repeat(24));
  assert.equal(P.toRaw("0.0000001", 6), null, "too many decimals");
  assert.equal(P.toRaw("0", 6), null, "zero");
  assert.equal(P.toRaw("-1", 6), null);
  assert.equal(P.toRaw("1e3", 6), null);
  assert.equal(P.toRaw("1,000", 6), null);
  assert.equal(P.fromRaw("12500000", 6), "12.5");
  assert.equal(P.fromRaw("1", 8), "0.00000001");
  assert.equal(P.fromRaw("100000000", 8), "1");
  assert.equal(P.fromRaw("0042", 0), "42");
  assert.equal(P.fromRaw("abc", 6), "0");
});
test("fmtAmount rounds up to the shown decimals and groups thousands", () => {
  assert.equal(P.fmtAmount("7100000000000001", 18, 6), "0.007101", "rounded up, never down");
  assert.equal(P.fmtAmount("7100000000000000", 18, 6), "0.0071");
  assert.equal(P.fmtAmount("1234567890000", 6, 2), "1,234,567.89");
  assert.equal(P.fmtAmount("25000000", 6, 6), "25");
  assert.equal(P.fmtAmount("", 6), "0");
});
test("mulDivCeil and estimateInRaw", () => {
  assert.equal(P.mulDivCeil("10", "3", "4").toString(), "8");
  assert.equal(P.mulDivCeil(10n, 4n, 4n).toString(), "10");
  assert.throws(() => P.mulDivCeil(1, 1, 0));
  const est = P.estimateInRaw("25000000", 6, 1, 18, 3500, 0);
  assert.ok(Math.abs(Number(est) / 1e18 - 25 / 3500) < 1e-9);
  assert.equal(P.estimateInRaw("25000000", 6, 0, 18, 3500), null, "no price, no guess");
});

/* ---------- the invoice link ---------- */
test("parseInvoice reads a good link", () => {
  const r = P.parseInvoice("?to=shop.near&amount=25&asset=usdc&label=Order%201042&ref=https%3A%2F%2Fshop.example");
  assert.equal(r.ok, true);
  assert.equal(r.invoice.to, "shop.near");
  assert.equal(r.invoice.amountRaw, "25000000");
  assert.equal(r.invoice.asset.symbol, "USDC");
  assert.equal(r.invoice.label, "Order 1042");
  assert.equal(r.invoice.ref, "https://shop.example");
  assert.equal(r.invoice.mode, "exact");
  assert.equal(P.parseInvoice("?to=shop.near&amount=1&mode=dry").invoice.mode, "about");
  assert.equal(P.parseInvoice("?to=shop.near&amount=1").invoice.asset.assetId, P.INVOICE_ASSETS.usdc.assetId, "USDC on NEAR by default");
});
test("parseInvoice refuses bad links with reasons", () => {
  assert.equal(P.parseInvoice("?amount=25").ok, false);
  assert.equal(P.parseInvoice("?to=shop.near").ok, false);
  assert.equal(P.parseInvoice("?to=shop.near&amount=25&asset=doge").ok, false);
  const wrongChain = P.parseInvoice("?to=shop.near&amount=25&asset=usdc-base");
  assert.equal(wrongChain.ok, false, "a NEAR account can't receive USDC on Base");
  assert.match(wrongChain.errors.join(" "), /Base address/);
  assert.equal(P.parseInvoice("?to=0x742d35Cc6634C0532925a3b844Bc454e4438f44e&amount=25&asset=usdc-base").ok, true);
  assert.equal(P.parseInvoice("?to=shop.near&amount=1.0000001").ok, false, "more decimals than USDC has");
  assert.equal(P.parseInvoice("?to=shop.near&amount=1&label=" + "x".repeat(81)).ok, false);
  assert.equal(P.parseInvoice("?to=shop.near&amount=1&label=a%0Ab").ok, false, "control characters");
});
test("refOrigin keeps only http(s) origins", () => {
  assert.equal(P.refOrigin("https://shop.example"), "https://shop.example");
  assert.equal(P.refOrigin("https://shop.example/cart?x=1"), "https://shop.example");
  assert.equal(P.refOrigin("http://localhost:8788"), "http://localhost:8788");
  assert.equal(P.refOrigin("http://shop.example"), null, "plain http only for localhost");
  assert.equal(P.refOrigin("javascript:alert(1)"), null);
  assert.equal(P.refOrigin("https://user:pw@shop.example"), null);
  assert.equal(P.refOrigin("null"), null);
  assert.equal(P.refOrigin(""), null);
});
test("a deposit address in the link is kept only when it is an address", () => {
  assert.equal(P.parseInvoice("?to=shop.near&amount=1&dep=0x742d35Cc6634C0532925a3b844Bc454e4438f44e").invoice.dep, "0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
  assert.equal(P.parseInvoice("?to=shop.near&amount=1&dep=%3Cscript%3E").invoice.dep, "");
});

/* ---------- deep links ---------- */
test("deep links for bitcoin:, ethereum: and solana:, none elsewhere", () => {
  assert.equal(P.deepLink({ chain: "btc", decimals: 8 }, "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "123456"), "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.00123456");
  assert.equal(P.deepLink({ chain: "eth", decimals: 18 }, "0xabc", "7100000000000000"), "ethereum:0xabc@1?value=7100000000000000");
  assert.equal(P.deepLink({ chain: "base", decimals: 18 }, "0xabc", "1"), "ethereum:0xabc@8453?value=1");
  assert.equal(P.deepLink({ chain: "arb", decimals: 6, contract: "0xaf88" }, "0xdep", "25150000"), "ethereum:0xaf88@42161/transfer?address=0xdep&uint256=25150000");
  assert.equal(P.deepLink({ chain: "sol", decimals: 9 }, "So1Dep", "1500000000"), "solana:So1Dep?amount=1.5");
  assert.equal(P.deepLink({ chain: "sol", decimals: 6, contract: "EPjF" }, "So1Dep", "25150000"), "solana:So1Dep?amount=25.15&spl-token=EPjF");
  assert.equal(P.deepLink({ chain: "zec", decimals: 8 }, "t1x", "1"), null);
  assert.equal(P.deepLink({ chain: "tron", decimals: 6, contract: "TR7" }, "Tx", "1"), null);
  assert.equal(P.deepLink({ chain: "near", decimals: 24 }, "abc", "1"), null);
  assert.equal(P.deepLink({ chain: "btc", decimals: 8 }, "bc1q", "1.5"), null, "base units only");
});

/* ---------- the state machine ---------- */
const base = () => ({ dep: "d", createdAt: 1_000_000, status: "PENDING_DEPOSIT", deadline: new Date(1_000_000 + 30 * 60e3).toISOString(), timeEstimate: 60 });
test("phaseOf maps 1Click statuses to the five steps", () => {
  assert.deepEqual(P.phaseOf("PENDING_DEPOSIT"), { step: 1, phase: "waiting", final: false });
  assert.deepEqual(P.phaseOf("KNOWN_DEPOSIT_TX"), { step: 2, phase: "seen", final: false });
  assert.deepEqual(P.phaseOf("INCOMPLETE_DEPOSIT"), { step: 2, phase: "incomplete", final: false });
  assert.deepEqual(P.phaseOf("PROCESSING"), { step: 3, phase: "processing", final: false });
  assert.deepEqual(P.phaseOf("SUCCESS"), { step: 4, phase: "delivered", final: true });
  assert.deepEqual(P.phaseOf("REFUNDED"), { step: 4, phase: "refunded", final: true });
  assert.deepEqual(P.phaseOf("FAILED"), { step: 4, phase: "failed", final: true });
  assert.deepEqual(P.phaseOf("SOMETHING_NEW"), { step: 1, phase: "waiting", final: false });
  assert.equal(P.STEPS.length, 5);
});
test("nextTrack moves forward, records times and payout, and never leaves a final status", () => {
  let t = base();
  t = P.nextTrack(t, { status: "KNOWN_DEPOSIT_TX" }, 1_010_000);
  assert.equal(t.status, "KNOWN_DEPOSIT_TX"); assert.equal(t.seenAt, 1_010_000);
  t = P.nextTrack(t, { status: "PROCESSING" }, 1_020_000);
  assert.equal(t.seenAt, 1_010_000, "seenAt kept");
  t = P.nextTrack(t, { status: "SUCCESS", swapDetails: { amountOut: "25000000", amountOutFormatted: "25", destinationChainTxHashes: [{ hash: "Abc", explorerUrl: "https://nearblocks.io/txns/Abc" }, { hash: "x", explorerUrl: "javascript:alert(1)" }] } }, 1_030_000);
  assert.equal(t.status, "SUCCESS"); assert.equal(t.finalAt, 1_030_000); assert.equal(t.deliveredRaw, "25000000");
  assert.equal(t.outTxs[0].explorerUrl, "https://nearblocks.io/txns/Abc");
  assert.equal(t.outTxs[1].explorerUrl, "", "only https explorer links");
  const after = P.nextTrack(t, { status: "PENDING_DEPOSIT" }, 1_040_000);
  assert.equal(after, t, "final stays final");
  const b = base();
  assert.equal(P.nextTrack(b, null), b, "no answer, no change");
  assert.equal(P.nextTrack(b, { status: "BOGUS" }), b, "unknown status, no change");
  const r = P.nextTrack(base(), { status: "REFUNDED", swapDetails: { refundReason: "deadline passed", refundedAmountFormatted: "0.0071" } }, 2);
  assert.equal(r.refundReason, "deadline passed"); assert.equal(r.refunded, "0.0071");
});
test("trackView: countdown, expiry, late and when to stop asking", () => {
  const t = base();
  let v = P.trackView(t, 1_000_000 + 60e3);
  assert.equal(v.secondsLeft, 29 * 60); assert.equal(v.expired, false); assert.equal(v.poll, true);
  v = P.trackView(t, 1_000_000 + 31 * 60e3);
  assert.equal(v.expired, true); assert.equal(v.poll, true, "keeps asking for 30 minutes after the deadline");
  v = P.trackView(t, 1_000_000 + 61 * 60e3);
  assert.equal(v.poll, false, "an address never paid is let go");
  const seen = { ...t, status: "PROCESSING", seenAt: 1_100_000 };
  assert.equal(P.trackView(seen, 1_100_000 + 59e3).late, false);
  assert.equal(P.trackView(seen, 1_100_000 + 61e3).late, true, "amber after the estimate");
  assert.equal(P.trackView(seen, 1_000_000 + 2 * 3600e3).expired, false, "a seen deposit does not expire");
  assert.equal(P.trackView({ ...t, status: "SUCCESS" }, 1_000_100).poll, false);
  assert.equal(P.trackView({ ...seen }, 1_000_000 + 25 * 3600e3).poll, false, "24 h at most");
});

/* ---------- reload survival ---------- */
function memStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
test("tracks are kept by deposit address for 24 h", () => {
  const s = memStorage();
  const t = { ...base(), dep: "0xabc", createdAt: 5_000 };
  assert.equal(P.saveTrack(s, t), true);
  assert.ok(s._m.has(P.TRACK_PREFIX + "0xabc"));
  assert.deepEqual(P.loadTrack(s, "0xabc", 6_000), t);
  assert.equal(P.loadTrack(s, "0xabc", 5_000 + P.TRACK_TTL_MS + 1), null, "older than 24 h");
  assert.equal(P.loadTrack(s, "other", 6_000), null);
  s.setItem(P.TRACK_PREFIX + "bad", "{not json");
  s.setItem("unrelated", "keep me");
  P.saveTrack(s, { ...t, dep: "new", createdAt: 5_000 + P.TRACK_TTL_MS });
  assert.equal(P.pruneTracks(s, 5_000 + P.TRACK_TTL_MS + 10), 2, "the old one and the unreadable one");
  assert.equal(s.getItem("unrelated"), "keep me");
  assert.ok(P.loadTrack(s, "new", 5_000 + P.TRACK_TTL_MS + 10));
  assert.equal(P.saveTrack(null, t), false);
  assert.equal(P.saveTrack({ setItem() { throw new Error("full"); } }, t), false, "a full storage is not an error");
});

/* ---------- quote checks ---------- */
const want = { amountRaw: "25000000", originChain: "eth" };
const live = () => ({ dry: false, quote: { amountIn: "7150000000000000", amountOut: "25000000", depositAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", deadline: "2026-11-09T12:30:00.000Z" } });
test("checkLiveQuote refuses a quote that is not what was asked", () => {
  assert.equal(P.checkLiveQuote(live(), want), "");
  const a = live(); a.quote.amountOut = "24000000"; assert.match(P.checkLiveQuote(a, want), /amount for the merchant/);
  const b = live(); b.quote.depositAddress = "shop.near"; assert.match(P.checkLiveQuote(b, want), /deposit address/);
  const c = live(); c.quote.depositMemo = "1"; assert.match(P.checkLiveQuote(c, want), /memo/);
  const d = live(); d.dry = true; assert.match(P.checkLiveQuote(d, want), /dry/);
  assert.equal(P.checkLiveQuote(null, want), "no quote");
});
test("confirmCheck compares 1Click's own answer with the quote (EXACT_OUTPUT)", () => {
  const q = live().quote;
  const w = { dep: q.depositAddress, amountRaw: "25000000", originAsset: "nep141:eth.omft.near", destinationAsset: P.INVOICE_ASSETS.usdc.assetId, recipient: "shop.near", refundTo: "0x1111111111111111111111111111111111111111" };
  const st = () => ({ status: "PENDING_DEPOSIT", quoteResponse: { quote: { ...q, depositAddress: q.depositAddress.toLowerCase() }, quoteRequest: { originAsset: w.originAsset, destinationAsset: w.destinationAsset, recipient: "shop.near", refundTo: w.refundTo,
    swapType: "EXACT_OUTPUT", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", appFees: [{ recipient: "fees.near", fee: 25 }, { recipient: P.ONECLICK_FEE_ACCOUNT, fee: 25 }] } } });
  assert.equal(P.confirmCheck(st(), q, w), "", "EVM address case does not matter");
  const s1 = st(); s1.status = "SUCCESS"; assert.match(P.confirmCheck(s1, q, w), /status/);
  const s2 = st(); s2.quoteResponse.quoteRequest.recipient = "thief.near"; assert.match(P.confirmCheck(s2, q, w), /recipient/);
  const s3 = st(); s3.quoteResponse.quoteRequest.swapType = "EXACT_INPUT"; assert.match(P.confirmCheck(s3, q, w), /kind of swap/);
  const s4 = st(); s4.quoteResponse.quote.amountOut = "1"; assert.match(P.confirmCheck(s4, q, w), /merchant/);
  const s5 = st(); s5.quoteResponse.quoteRequest.appFees.push({ recipient: "x.near", fee: 60 }); assert.match(P.confirmCheck(s5, q, w), /fees/);
  const s6 = st(); s6.quoteResponse.quoteRequest.refundTo = "0x2222222222222222222222222222222222222222"; assert.match(P.confirmCheck(s6, q, w), /refund/);
  const s7 = st(); s7.quoteResponse.quote.depositAddress = "0x9999999999999999999999999999999999999999"; assert.match(P.confirmCheck(s7, q, w), /deposit address/);
  assert.equal(P.confirmCheck(null, q, w), "no answer");
});
test("a 400 that names the action means the checkout action is not live", () => {
  assert.equal(P.isMissingAction(400, "unknown action"), true);
  assert.equal(P.isMissingAction(400, "That coin can't pay here"), false);
  assert.equal(P.isMissingAction(502, "unknown action"), false);
  assert.match(P.quoteWhy("No liquidity for this pair"), /No quote right now/);
  assert.equal(P.quoteWhy(""), "No quote right now.");
});
test("payOptions: other chains in a fixed order, then NEAR, USDC and USDT on NEAR", () => {
  const view = { tokens: [
    { assetId: "nep141:sol.omft.near", symbol: "SOL", chain: "sol", decimals: 9, price: 180, payIn: true },
    { assetId: "nep141:btc.omft.near", symbol: "BTC", chain: "btc", decimals: 8, price: 1e5, payIn: true },
    { assetId: "1cs_v1:near:nep141:qtc.omft.near", symbol: "QTC", chain: "near", decimals: 8, price: 1, payIn: false },
    { assetId: "nep141:base.omft.near", symbol: "ETH", chain: "base", decimals: 18, price: 3500, payIn: true },
    { assetId: "nep141:eth.omft.near", symbol: "ETH", chain: "eth", decimals: 18, price: 3500, payIn: true },
  ], origins: { "nep141:wrap.near": { decimals: 24, price: 3.2 } } };
  const o = P.payOptions(view);
  assert.deepEqual(o.map((x) => x.symbol + ":" + x.chain), ["BTC:btc", "ETH:eth", "ETH:base", "SOL:sol", "NEAR:near", "USDC:near", "USDT:near"]);
  assert.equal(o.find((x) => x.symbol === "NEAR").price, 3.2);
  assert.equal(P.payOptions(null).length, 3, "NEAR-side coins even without the list");
});

test("quoteOrder: the likely picks are quoted first, the rest keep their list order", () => {
  const rows = [{ symbol: "BTC", chain: "btc" }, { symbol: "ETH", chain: "eth" }, { symbol: "ETH", chain: "base" }, { symbol: "ZEC", chain: "zec" }, { symbol: "USDT", chain: "tron" }, { symbol: "USDC", chain: "sol" }, { symbol: "SOL", chain: "sol" }, { symbol: "NEAR", chain: "near" }];
  const out = P.quoteOrder(rows).map((r) => r.symbol + "/" + r.chain);
  assert.deepEqual(out, ["USDC/sol", "SOL/sol", "ETH/base", "ETH/eth", "NEAR/near", "BTC/btc", "ZEC/zec", "USDT/tron"]);
  assert.deepEqual(rows.map((r) => r.symbol + "/" + r.chain)[0], "BTC/btc", "the input is not reordered");
});

test("pollDelay: every 2 s for two minutes after a deposit sent from this page, else every 5 s", () => {
  const now = 1_700_000_000_000;
  assert.equal(P.pollDelay({ status: "KNOWN_DEPOSIT_TX", seenAt: now - 30e3, txHash: "abc" }, now), P.POLL_FAST_MS);
  assert.equal(P.pollDelay({ status: "PROCESSING", seenAt: now - 119e3, txHash: "abc" }, now), P.POLL_FAST_MS);
  assert.equal(P.pollDelay({ status: "PROCESSING", seenAt: now - 121e3, txHash: "abc" }, now), P.POLL_MS, "two minutes are up");
  assert.equal(P.pollDelay({ status: "PENDING_DEPOSIT" }, now), P.POLL_MS, "paid by hand: no transaction known");
  assert.equal(P.pollDelay({ status: "SUCCESS", seenAt: now - 10e3, txHash: "abc" }, now), P.POLL_MS, "final");
  assert.equal(P.pollDelay(null, now), P.POLL_MS);
});
