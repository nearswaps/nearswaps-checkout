/* nearswaps checkout: the pay page (pay.html, served at /pay).
   A merchant's button (checkout.js) opens /pay?to=&amount=&asset=&label=&ref= in a popup. The buyer picks the coin
   and chain they hold, gets a deposit address from NEAR Intents (1Click) through the site's proxy (/api/intents,
   action "checkout": EXACT_OUTPUT, so the merchant receives exactly the invoiced amount), sends, and this page follows
   the deposit until it is delivered, then tells the opener with postMessage targeted at the merchant's origin.

   Two modes:
     exact  the default: dry and live quotes from action "checkout".
     about  ?mode=dry, or when the proxy answers 400 naming the action (the checkout action is not live there yet):
            dry quotes only, from the existing action "quote" with dir "in" (EXACT_INPUT), so every amount is "about".
            No deposit address is offered in this mode.

   The top half of this file is pure (no DOM) and exported for the Node tests (tests/pay.test.mjs). The page itself
   starts only in a browser, on a page that has #payApp. */

/* ======================================================================= pure parts */

export const API = "/api/intents";
export const ONECLICK = "https://1click.chaindefuser.com";
// 1Click's own fee account: 1Click splits the site's app fee and adds its share under this account (bridge notes, 1 Nov 2026).
export const ONECLICK_FEE_ACCOUNT = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
export const POLL_MS = 5000;
export const TRACK_PREFIX = "nearswaps-pay:";
export const TRACK_TTL_MS = 24 * 3600e3;
export const LIVE_MAX_AGE_MS = 60e3;          // a NEAR-side live quote is sent within 60 s or asked again (as the bridge)
export const LABEL_MAX = 80;
export const FEE_CAP_BPS = 100;               // 1Click's cap on all app fees together (1%)
export const MEMO = "nearswaps:checkout:v1";  // on the NEAR-side deposit transfer

export const CHAIN_NAMES = { near: "NEAR", btc: "Bitcoin", eth: "Ethereum", sol: "Solana", zec: "Zcash", base: "Base", arb: "Arbitrum", tron: "Tron" };
export const EVM_CHAIN_IDS = { eth: 1, base: 8453, arb: 42161 };
const NATIVE_DECIMALS = { btc: 8, sol: 9, eth: 18, base: 18, arb: 18 };

// Address patterns: the same as the proxy's (netlify/shared/intents.mjs ADDRESS and NEAR_ACCOUNT, copied 9 Nov 2026).
// Loose shape checks: a typo is caught, a wrong-chain address is refused. The proxy checks them again.
export const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const ADDRESS = {
  near: NEAR_ACCOUNT,
  btc: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  eth: /^0x[0-9a-fA-F]{40}$/, base: /^0x[0-9a-fA-F]{40}$/, arb: /^0x[0-9a-fA-F]{40}$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  zec: /^(t1|t3)[1-9A-HJ-NP-Za-km-z]{33}$|^u1[02-9ac-hj-np-z]{50,300}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
};
/** true when `a` is an address on `chain`: a NEAR account or 64-hex implicit account on NEAR, the patterns above elsewhere. */
export function addressOk(chain, a) {
  if (typeof a !== "string" || !Object.hasOwn(ADDRESS, chain)) return false;
  if (chain === "near") return NEAR_ACCOUNT.test(a) || /^[0-9a-f]{64}$/.test(a);
  return ADDRESS[chain].test(a);
}

// What an invoice can ask for (the proxy's CHECKOUT_DEST list). The code is data-asset / ?asset=.
export const INVOICE_ASSETS = {
  usdc: { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", chain: "near", decimals: 6 },
  usdt: { assetId: "nep141:usdt.tether-token.near", symbol: "USDT", chain: "near", decimals: 6 },
  near: { assetId: "nep141:wrap.near", symbol: "NEAR", chain: "near", decimals: 24 },
  "usdc-base": { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "base", decimals: 6 },
  "usdc-sol": { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chain: "sol", decimals: 6 },
  "usdc-arb": { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chain: "arb", decimals: 6 },
  "usdc-eth": { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", symbol: "USDC", chain: "eth", decimals: 6 },
};

// Paying from NEAR: one transfer from the buyer's NEAR wallet (NEAR is wrapped in the same transaction).
export const NEAR_PAY = [
  { assetId: "nep141:wrap.near", symbol: "NEAR", chain: "near", chainName: "NEAR", decimals: 24, token: "wrap.near", native: true },
  { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", chain: "near", chainName: "NEAR", decimals: 6, token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
  { assetId: "nep141:usdt.tether-token.near", symbol: "USDT", chain: "near", chainName: "NEAR", decimals: 6, token: "usdt.tether-token.near" },
];

// A refund address for dry quotes only (the proxy wants one of the right shape; nothing is ever sent to it).
// The same addresses the bridge uses for its dry quotes.
export const DRY_REFUND = {
  near: "nearswaps.near",
  btc: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  eth: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", base: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", arb: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  sol: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  tron: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
  zec: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs",
};

/* ---------- amounts ---------- */
/** "1.5" with `decimals` -> "1500000" (base units), or null when it is not a plain positive decimal that fits. */
export function toRaw(text, decimals) {
  const s = String(text == null ? "" : text).trim();
  const m = /^(\d{1,20})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] || "";
  if (frac.length > decimals) return null;
  const raw = (m[1] + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return /^0+$/.test(raw) ? null : raw;
}
/** base units -> the exact decimal ("1500000", 6 -> "1.5"). */
export function fromRaw(raw, decimals) {
  const s0 = String(raw == null ? "" : raw);
  if (!/^\d+$/.test(s0)) return "0";
  const s = s0.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals), f = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return f ? i + "." + f : i;
}
/** base units -> at most `maxFrac` decimals for display, rounded UP (a quote shown short never asks for less than it needs),
 *  with thousands separators in the whole part. */
export function fmtAmount(raw, decimals, maxFrac = 6) {
  if (!/^\d+$/.test(String(raw == null ? "" : raw))) return "0";
  let v = BigInt(raw);
  const cut = Math.max(0, decimals - maxFrac);
  if (cut > 0) { const step = 10n ** BigInt(cut); v = ((v + step - 1n) / step) * step; }
  const exact = fromRaw(v.toString(), decimals);
  const [i, f] = exact.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f.slice(0, maxFrac) : "");
}
/** ceil(a * b / c) for base-unit strings or BigInts. */
export function mulDivCeil(a, b, c) {
  const A = BigInt(a), B = BigInt(b), C = BigInt(c);
  if (C <= 0n) throw new Error("division by zero");
  return (A * B + C - 1n) / C;
}
/** About-mode: a first guess of what to send (base units of the paying coin) from 1Click's USD prices, padded by `padBps`. */
export function estimateInRaw(targetRaw, destDecimals, destPrice, originDecimals, originPrice, padBps = 200) {
  if (!(destPrice > 0) || !(originPrice > 0)) return null;
  const usd = Number(fromRaw(targetRaw, destDecimals)) * destPrice;
  const coins = (usd / originPrice) * (1 + padBps / 10000);
  if (!(coins > 0) || !isFinite(coins)) return null;
  const raw = toRaw(coins.toFixed(Math.min(originDecimals, 12)), originDecimals);
  return raw;
}

/* ---------- the invoice (URL) ---------- */
/** The origin a ?ref= names ("https://shop.example"), or null. Only http(s); http only for localhost. */
export function refOrigin(ref) {
  if (typeof ref !== "string" || !ref || ref.length > 300) return null;
  let u;
  try { u = new URL(ref); } catch (e) { return null; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) return null;
  if (u.username || u.password) return null;
  return u.origin;
}
/** A label of at most 80 characters of printable text: the label, null for none, or false. */
export function cleanLabel(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || [...v].length > LABEL_MAX || /\p{C}/u.test(v)) return false;
  return v;
}
/** Reads the invoice from the query string. { ok, errors[], invoice }. */
export function parseInvoice(search) {
  const q = new URLSearchParams(search || "");
  const errors = [];
  const code = (q.get("asset") || "usdc").toLowerCase();
  const asset = Object.hasOwn(INVOICE_ASSETS, code) ? INVOICE_ASSETS[code] : null;
  if (!asset) errors.push("The payment link asks for a coin this page can't receive (" + code.slice(0, 20) + ").");
  const to = (q.get("to") || "").trim();
  if (!to) errors.push("The payment link names no one to pay.");
  else if (asset && !addressOk(asset.chain, to)) errors.push(`"${to.slice(0, 80)}" is not a ${CHAIN_NAMES[asset.chain]} address.`);
  const amount = (q.get("amount") || "").trim();
  const amountRaw = asset ? toRaw(amount, asset.decimals) : null;
  if (!amount) errors.push("The payment link has no amount.");
  else if (asset && !amountRaw) errors.push(`"${amount.slice(0, 30)}" is not an amount of ${asset.symbol}.`);
  const label = cleanLabel(q.get("label"));
  if (label === false) errors.push(`The label must be at most ${LABEL_MAX} characters of plain text.`);
  const dep = q.get("dep") || "";
  return {
    ok: errors.length === 0, errors,
    invoice: { to, code, asset, amount: amountRaw && asset ? fromRaw(amountRaw, asset.decimals) : amount, amountRaw, label: label || null,
      ref: refOrigin(q.get("ref")), theme: q.get("theme") === "light" ? "light" : null, mode: q.get("mode") === "dry" ? "about" : "exact",
      dep: dep.length <= 120 && Object.keys(ADDRESS).some((c) => addressOk(c, dep)) ? dep : "" },
  };
}

/* ---------- deep links ---------- */
/** An "Open in wallet" link for paying `amountRaw` of `coin` ({ chain, contract, decimals }) to `address`, or null where the
 *  chain has no common URI scheme. bitcoin: (BIP 21), ethereum: (EIP 681, with chain id; ERC-20 as a transfer call),
 *  solana: (Solana Pay, spl-token for a token). */
export function deepLink(coin, address, amountRaw) {
  if (!coin || !address || !/^\d+$/.test(String(amountRaw || ""))) return null;
  const { chain, contract, decimals } = coin;
  if (chain === "btc") return `bitcoin:${address}?amount=${fromRaw(amountRaw, 8)}`;
  if (Object.hasOwn(EVM_CHAIN_IDS, chain)) {
    const id = EVM_CHAIN_IDS[chain];
    if (contract) return `ethereum:${contract}@${id}/transfer?address=${address}&uint256=${amountRaw}`;
    return `ethereum:${address}@${id}?value=${amountRaw}`;
  }
  if (chain === "sol") {
    const amt = fromRaw(amountRaw, contract ? decimals : NATIVE_DECIMALS.sol);
    return `solana:${address}?amount=${amt}` + (contract ? `&spl-token=${contract}` : "");
  }
  return null;
}

/* ---------- the deposit's status: a small state machine ---------- */
export const STEPS = ["Deposit address ready", "Waiting for your deposit", "Deposit seen", "Processing", "Delivered"];
const PHASES = {
  PENDING_DEPOSIT: { step: 1, phase: "waiting" },
  KNOWN_DEPOSIT_TX: { step: 2, phase: "seen" },
  INCOMPLETE_DEPOSIT: { step: 2, phase: "incomplete" },
  PROCESSING: { step: 3, phase: "processing" },
  SUCCESS: { step: 4, phase: "delivered", final: true },
  REFUNDED: { step: 4, phase: "refunded", final: true },
  FAILED: { step: 4, phase: "failed", final: true },
};
export const isFinal = (status) => !!(PHASES[status] && PHASES[status].final);
/** { step (0..4), phase, final } for a 1Click status. Unknown statuses read as waiting. */
export function phaseOf(status) {
  const p = PHASES[status] || PHASES.PENDING_DEPOSIT;
  return { step: p.step, phase: p.phase, final: !!p.final };
}
/** The track after a status answer `st` (/api/intents?status=). Never leaves a final status; ignores answers without one. */
export function nextTrack(track, st, now = Date.now()) {
  if (!track || !st || typeof st !== "object" || typeof st.status !== "string" || !PHASES[st.status]) return track;
  if (isFinal(track.status)) return track;
  const t = { ...track, status: st.status, checkedAt: now };
  const step = PHASES[st.status].step;
  if (step >= 2 && !t.seenAt) t.seenAt = now;
  if (PHASES[st.status].final) t.finalAt = now;
  const d = st.swapDetails || {};
  if (d.amountOutFormatted) t.delivered = String(d.amountOutFormatted).slice(0, 40);
  if (/^\d+$/.test(String(d.amountOut || ""))) t.deliveredRaw = String(d.amountOut);
  if (Array.isArray(d.destinationChainTxHashes)) {
    const out = d.destinationChainTxHashes.slice(0, 2).map((x) => ({ hash: String((x && x.hash) || "").slice(0, 120), explorerUrl: /^https:\/\//.test(String((x && x.explorerUrl) || "")) ? String(x.explorerUrl).slice(0, 300) : "" })).filter((x) => x.hash);
    if (out.length) t.outTxs = out;
  }
  if (d.refundReason) t.refundReason = String(d.refundReason).slice(0, 160);
  if (d.refundedAmountFormatted) t.refunded = String(d.refundedAmountFormatted).slice(0, 40);
  return t;
}
/** What the timeline shows now: the step, the phase, whether the address expired, whether the estimate has passed,
 *  and whether to keep asking for the status. */
export function trackView(track, now = Date.now()) {
  const p = phaseOf(track && track.status);
  const deadline = Date.parse((track && track.deadline) || "") || 0;
  const expired = p.phase === "waiting" && deadline > 0 && now > deadline;
  const est = Number(track && track.timeEstimate) || 0;
  const late = !p.final && !!(track && track.seenAt) && est > 0 && now > track.seenAt + est * 1000;
  const age = now - (Number(track && track.createdAt) || now);
  const poll = !p.final && age < TRACK_TTL_MS && !(p.phase === "waiting" && deadline > 0 && now > deadline + 30 * 60e3);
  return { ...p, expired, late, poll, secondsLeft: deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : null };
}

/* ---------- reload survival: localStorage by deposit address, 24 h ---------- */
export function saveTrack(storage, t) {
  if (!storage || !t || !t.dep) return false;
  try { storage.setItem(TRACK_PREFIX + t.dep, JSON.stringify(t)); return true; } catch (e) { return false; }
}
export function loadTrack(storage, dep, now = Date.now()) {
  if (!storage || !dep) return null;
  try {
    const t = JSON.parse(storage.getItem(TRACK_PREFIX + dep) || "null");
    if (!t || t.dep !== dep || !(now - Number(t.createdAt) < TRACK_TTL_MS)) return null;
    return t;
  } catch (e) { return null; }
}
/** Deletes this page's records older than 24 h (and unreadable ones). Returns how many went. */
export function pruneTracks(storage, now = Date.now()) {
  if (!storage) return 0;
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(TRACK_PREFIX)) keys.push(k); }
    for (const k of keys) {
      let t = null;
      try { t = JSON.parse(storage.getItem(k)); } catch (e) {}
      if (!t || !(now - Number(t.createdAt) < TRACK_TTL_MS)) { storage.removeItem(k); n++; }
    }
  } catch (e) {}
  return n;
}

/* ---------- checking quotes ---------- */
/** The proxy's live checkout answer against what was asked. "" when it fits, else what is wrong. */
export function checkLiveQuote(resp, want) {
  const q = resp && resp.quote;
  if (!q) return "no quote";
  if (resp.dry !== false && resp.dry !== undefined) return "a dry quote";
  if (String(q.amountOut) !== String(want.amountRaw)) return "another amount for the merchant";
  if (!/^\d{1,40}$/.test(String(q.amountIn || "")) || BigInt(q.amountIn) <= 0n) return "no amount to send";
  if (!addressOk(want.originChain, String(q.depositAddress || "")) || String(q.depositAddress).length > 120) return "an unexpected deposit address";
  if (q.depositMemo) return "a deposit memo";
  return "";
}
/** 1Click's own status answer for a fresh deposit address (asked straight from this browser, not through the proxy),
 *  against the proxy's quote and what this page asked for. "" when they agree, else what differs. The same idea as the
 *  bridge's check (security audit 1 Nov 2026, D-2), for EXACT_OUTPUT: the merchant's amount is the fixed side. */
export function confirmCheck(st, quote, want) {
  if (!st || typeof st !== "object") return "no answer";
  if (st.status !== "PENDING_DEPOSIT") return "its status is " + String(st.status || "unknown").slice(0, 40);
  const qr = st.quoteResponse || {}, sq = qr.quote || {}, rq = qr.quoteRequest || {};
  const same = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
  const sameAddr = (a, b) => (/^0x[0-9a-fA-F]{40}$/.test(String(a)) ? String(a).toLowerCase() === String(b).toLowerCase() : same(a, b));
  if (!quote || !same(quote.depositAddress, want.dep) || (sq.depositAddress !== undefined && !sameAddr(sq.depositAddress, want.dep))) return "another deposit address";
  if (sq.depositMemo || quote.depositMemo) return "a deposit memo";
  if (!same(sq.amountIn, quote.amountIn)) return "another amount to send";
  if (!same(sq.amountOut, want.amountRaw) || !same(quote.amountOut, want.amountRaw)) return "another amount for the merchant";
  if (sq.deadline && quote.deadline && !same(sq.deadline, quote.deadline)) return "another deadline";
  if (!same(rq.originAsset, want.originAsset) || !same(rq.destinationAsset, want.destinationAsset)) return "other coins";
  if (!sameAddr(rq.recipient, want.recipient)) return "another recipient";
  if (!sameAddr(rq.refundTo, want.refundTo)) return "another refund address";
  if (rq.swapType !== "EXACT_OUTPUT" || rq.depositType !== "ORIGIN_CHAIN" || rq.recipientType !== "DESTINATION_CHAIN" || rq.refundType !== "ORIGIN_CHAIN") return "another kind of swap";
  if (rq.appFees != null && !Array.isArray(rq.appFees)) return "unexpected app fees";
  const fees = rq.appFees || [];
  const feeOk = (f) => !!f && typeof f === "object" && !Array.isArray(f) && NEAR_ACCOUNT.test(String(f.recipient || "")) && Number.isFinite(f.fee) && f.fee >= 0 && f.fee <= FEE_CAP_BPS;
  if (fees.length > 3 || !fees.every(feeOk) || fees.reduce((a, f) => a + f.fee, 0) > FEE_CAP_BPS) return "unexpected app fees";
  return "";
}
/** A 400 from the proxy that names the action: the checkout action isn't deployed there yet. */
export const isMissingAction = (status, message) => status === 400 && /\baction\b/i.test(String(message || ""));
/** The words for a quote that could not be had. */
export function quoteWhy(message) {
  const m = String(message || "").replace(/\s+/g, " ").trim();
  if (!m) return "No quote right now.";
  if (/no liquidity|no quote/i.test(m)) return "No quote right now: no solver is taking this coin at the moment.";
  return m.slice(0, 160);
}
/** The coins to offer: the proxy's off-NEAR list (payIn) in a fixed order, then NEAR, USDC and USDT on NEAR. */
const ORDER = ["BTC", "ETH", "SOL", "USDC", "USDT", "ZEC"];
const CHAIN_ORDER = ["btc", "eth", "base", "arb", "sol", "tron", "zec"];
export function payOptions(tokensView) {
  const list = (tokensView && Array.isArray(tokensView.tokens) ? tokensView.tokens : [])
    .filter((t) => t && t.payIn !== false && t.chain !== "near" && Object.hasOwn(CHAIN_NAMES, t.chain) && typeof t.assetId === "string" && /^nep141:/.test(t.assetId))
    .map((t) => ({ assetId: t.assetId, symbol: String(t.symbol), chain: t.chain, chainName: CHAIN_NAMES[t.chain], decimals: Number(t.decimals), price: Number(t.price) || 0, contract: t.contract || null }))
    .filter((t) => Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 30);
  const rank = (t) => (ORDER.includes(t.symbol) ? ORDER.indexOf(t.symbol) : 99) * 100 + (CHAIN_ORDER.includes(t.chain) ? CHAIN_ORDER.indexOf(t.chain) : 50);
  list.sort((a, b) => rank(a) - rank(b));
  const origins = (tokensView && tokensView.origins) || {};
  const near = NEAR_PAY.map((t) => ({ ...t, price: Number(origins[t.assetId] && origins[t.assetId].price) || 0 }));
  return list.concat(near);
}

/* ======================================================================= the page */

if (typeof document !== "undefined" && document.getElementById("payApp")) boot();

function boot() {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const parsed = parseInvoice(location.search);
  const inv = parsed.invoice;
  if (inv.theme) document.documentElement.setAttribute("data-theme", inv.theme);
  const localHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // On a local copy only, 1Click's direct status (the deposit-address check) can point at a mock.
  const oneclick = (() => { const o = new URLSearchParams(location.search).get("oneclick"); return localHost && o && /^\/[a-z0-9/_-]*$/i.test(o) ? o : ONECLICK; })();

  let mode = inv.mode;
  let tokens = null, rows = [], selected = null, feeBps = null;
  let track = null, pollTimer = 0, tickTimer = 0, notified = false;
  let wallet = null;            // { kit, selector, modal, account }
  let nearLive = null;          // { at, resp, txs, row } a NEAR-side live quote waiting for Send
  let busy = false;

  pruneTracks(store);

  /* ----- the invoice card ----- */
  if (!parsed.ok) {
    $("invoice").hidden = true;
    const box = $("invErr");
    box.hidden = false;
    for (const m of parsed.errors) box.appendChild(el("p", null, m));
    $("payWith").hidden = true;
    return;
  }
  document.title = `Pay ${inv.to} · nearswaps`;
  $("invTo").textContent = inv.to;
  $("invAmt").textContent = fmtAmount(inv.amountRaw, inv.asset.decimals, inv.asset.decimals) + " " + inv.asset.symbol;
  $("invChain").textContent = "on " + CHAIN_NAMES[inv.asset.chain];
  if (inv.label) { $("invLabel").textContent = inv.label; $("invLabel").hidden = false; }
  paintMode();

  // The opener's origin: shown in full only when the browser itself vouches for it, by a reply from the opener
  // (checkout.js answers "hello") or by the referrer. The link's ref alone could say anything.
  let shownOrigin = null;
  const refMatchesReferrer = (() => { try { return !!inv.ref && !!document.referrer && new URL(document.referrer).origin === inv.ref; } catch (e) { return false; } })();
  function paintOrigin(state) {
    const o = $("invOrigin");
    o.textContent = "";
    if (state === "confirmed") { o.appendChild(document.createTextNode("requested by ")); o.appendChild(el("span", "mono ink", shownOrigin)); }
    else if (state === "checking") o.textContent = "requested by " + inv.ref + " (checking)";
    else if (state === "unconfirmed") o.textContent = "requested by a page that did not confirm its origin (the link names " + inv.ref + ")";
    else o.textContent = "requested by a page with no origin";
    $("backBtn").textContent = shownOrigin ? "Back to " + shownOrigin.replace(/^https?:\/\//, "") : "Close";
  }
  let hasOpener = false;
  try { hasOpener = !!window.opener; } catch (e) {}
  if (hasOpener && inv.ref) {
    window.addEventListener("message", (e) => {
      if (e.source !== window.opener || e.origin !== inv.ref || !e.data || e.data.ns !== "checkout" || e.data.type !== "ready") return;
      shownOrigin = e.origin; paintOrigin("confirmed");
    });
    if (refMatchesReferrer) { shownOrigin = inv.ref; paintOrigin("confirmed"); }
    else paintOrigin("checking");
    try { window.opener.postMessage({ ns: "checkout", type: "hello" }, inv.ref); } catch (e) {}
    setTimeout(() => { if (!shownOrigin) paintOrigin("unconfirmed"); }, 3000);
  } else if (refMatchesReferrer) { shownOrigin = inv.ref; paintOrigin("confirmed"); }
  else paintOrigin("none");

  function paintMode() {
    $("modeNote").hidden = mode !== "about";
    $("invAbout").hidden = mode !== "about";
  }

  /* ----- talking to the proxy ----- */
  async function api(body) {
    let r;
    try { r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "omit" }); }
    catch (e) { throw new Error("No quote right now: the quote service did not answer. Check your connection."); }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error((j && j.error) || "The quote service answered " + r.status), { status: r.status, minAmount: j && j.minAmount });
    return j;
  }
  async function getJson(url, opts = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), opts.timeout || 12000);
    try {
      const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: ctl.signal });
      let j = null; try { j = await r.json(); } catch (e) {}
      return { ok: r.ok, status: r.status, json: j };
    } finally { clearTimeout(t); }
  }

  /* ----- the pay-with list ----- */
  async function loadList() {
    const list = $("coins");
    list.textContent = "";
    for (let i = 0; i < 6; i++) list.appendChild(el("li", "row skel", ""));
    let view = null;
    try { const r = await getJson(API + "?tokens=1"); if (r.ok) view = r.json; } catch (e) {}
    tokens = view;
    rows = payOptions(view).map((t) => ({ ...t, state: "loading", quoteIn: null, why: "" }));
    if (!view) $("listNote").textContent = "The list of coins from other chains could not be loaded just now. Paying from NEAR still works.";
    renderList();
    await quoteAll();
  }
  function renderList() {
    const list = $("coins");
    list.textContent = "";
    for (const r of rows) list.appendChild(rowEl(r));
  }
  const ICONS = new Set(["BTC", "ETH", "SOL", "ZEC", "USDC", "USDT"]);
  function rowEl(r) {
    const li = el("li");
    const b = el("button", "row");
    b.type = "button";
    b.dataset.asset = r.assetId;
    b.setAttribute("aria-pressed", String(selected === r));
    b.disabled = r.state === "none";
    const ic = el("span", "ico");
    const img = document.createElement("img");
    img.alt = ""; img.width = 28; img.height = 28; img.decoding = "async";
    img.src = r.chain === "near" && r.symbol === "NEAR" ? "/assets/xc/chain-near.svg" : ICONS.has(r.symbol) ? `/assets/xc/${r.symbol.toLowerCase()}.svg` : "";
    img.addEventListener("error", () => { img.remove(); ic.textContent = r.symbol.slice(0, 1); });
    if (img.src) ic.appendChild(img); else ic.textContent = r.symbol.slice(0, 1);
    const name = el("span", "nm");
    name.appendChild(el("b", null, r.symbol));
    name.appendChild(el("small", null, r.chainName));
    const q = el("span", "q");
    if (r.state === "loading") q.appendChild(el("i", "skel-line", ""));
    else if (r.state === "ok") {
      q.appendChild(el("b", "mono", (mode === "about" ? "about " : "") + fmtAmount(r.quoteIn, r.decimals, 6) + " " + r.symbol));
      q.appendChild(el("small", null, mode === "about" ? "estimate" : "dry quote"));
    } else q.appendChild(el("small", "why", r.why || "No quote right now."));
    b.append(ic, name, q);
    b.addEventListener("click", () => pick(r));
    li.appendChild(b);
    return li;
  }
  async function quoteAll() {
    const queue = rows.slice();
    const worker = async () => { while (queue.length) { const r = queue.shift(); await quoteRow(r); updateRow(r); } };
    await Promise.all([worker(), worker(), worker()]);
  }
  function updateRow(r) {
    const i = rows.indexOf(r), list = $("coins");
    if (i < 0 || !list.children[i]) return;
    list.replaceChild(rowEl(r), list.children[i]);
    if (selected === r) renderNext();
  }
  async function quoteRow(r) {
    r.state = "loading"; r.why = "";
    if (mode === "exact") {
      try {
        const resp = await api({ action: "checkout", dry: true, originAsset: r.assetId, destinationAsset: inv.asset.assetId, amount: inv.amountRaw,
          recipient: inv.to, refundTo: DRY_REFUND[r.chain], ...(inv.label ? { label: inv.label } : {}) });
        const q = resp && resp.quote;
        if (!q || !/^\d+$/.test(String(q.amountIn || ""))) throw new Error("No quote right now.");
        r.quoteIn = String(q.amountIn); r.timeEstimate = Number(q.timeEstimate) || 0; r.state = "ok";
        if (Number.isFinite(resp.appFeeBps)) { feeBps = resp.appFeeBps; paintFee(); }
        return;
      } catch (e) {
        if (isMissingAction(e.status, e.message)) { switchToAbout(); return quoteRow(r); }
        r.state = "none"; r.why = quoteWhy(e.message); return;
      }
    }
    // about mode: the existing inbound quote (EXACT_INPUT) for display only.
    if (r.chain === "near") { r.state = "none"; r.why = "Paying from NEAR opens with exact-amount checkout."; return; }
    if (inv.asset.chain !== "near") { r.state = "none"; r.why = `Estimates for ${inv.asset.symbol} on ${CHAIN_NAMES[inv.asset.chain]} open with exact-amount checkout.`; return; }
    const destPrice = Number(tokens && tokens.origins && tokens.origins[inv.asset.assetId] && tokens.origins[inv.asset.assetId].price) || 0;
    const guess = estimateInRaw(inv.amountRaw, inv.asset.decimals, destPrice, r.decimals, r.price);
    if (!guess) { r.state = "none"; r.why = "No price for this coin right now."; return; }
    try {
      const resp = await api({ action: "quote", dir: "in", dry: true, originAsset: r.assetId, destinationAsset: inv.asset.assetId, amount: guess,
        slippageTolerance: 100, recipient: inv.to, refundTo: DRY_REFUND[r.chain] });
      const q = resp && resp.quote;
      if (!q || !/^\d+$/.test(String(q.amountOut || "")) || BigInt(q.amountOut) <= 0n) throw new Error("No quote right now.");
      r.quoteIn = mulDivCeil(guess, inv.amountRaw, q.amountOut).toString();
      r.timeEstimate = Number(q.timeEstimate) || 0; r.state = "ok";
      if (Number.isFinite(resp.appFeeBps)) { feeBps = resp.appFeeBps; paintFee(); }
    } catch (e) { r.state = "none"; r.why = quoteWhy(e.message); }
  }
  function switchToAbout() {
    if (mode === "about") return;
    mode = "about";
    paintMode();
    renderList();
  }

  /* ----- after a pick: the refund address, or Connect wallet for NEAR ----- */
  function pick(r) {
    if (r.state === "none" || track) return;
    selected = r;
    nearLive = null;
    for (const b of document.querySelectorAll("#coins .row")) b.setAttribute("aria-pressed", String(b.dataset.asset === r.assetId));
    renderNext();
    const next = $("next");
    if (next.scrollIntoView) next.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function renderNext() {
    const r = selected, next = $("next");
    if (!r) { next.hidden = true; return; }
    next.hidden = false;
    $("nextTitle").textContent = `Pay with ${r.symbol} on ${r.chainName}`;
    $("nextQuote").textContent = r.state === "ok" ? `Send ${mode === "about" ? "about " : ""}${fmtAmount(r.quoteIn, r.decimals, 8)} ${r.symbol} (${r.chainName}). ${mode === "about" ? "An estimate: the merchant would receive about the invoiced amount." : "The final amount is fixed when you get the address."}` : r.why || "";
    const isNear = r.chain === "near";
    $("refundBox").hidden = isNear;
    $("nearBox").hidden = !isNear;
    $("refundLbl").textContent = `Your ${r.chainName} address for refunds`;
    $("refundIn").placeholder = r.chainName + " address";
    checkRefund(false);
    paintNearBox();
    const go = $("getBtn");
    go.disabled = mode === "about" || busy || r.state !== "ok";
    $("aboutNote").hidden = mode !== "about";
  }
  function checkRefund(show) {
    const r = selected, v = $("refundIn").value.trim(), err = $("refundErr");
    const ok = !!r && addressOk(r.chain, v);
    err.textContent = show && !ok ? (v ? `That doesn't look like a ${r.chainName} address.` : `Enter your ${r.chainName} address first.`) : "";
    $("refundIn").setAttribute("aria-invalid", String(show && !ok));
    return ok ? v : null;
  }
  $("refundIn").addEventListener("input", () => checkRefund(false));
  $("refundIn").addEventListener("blur", () => { if ($("refundIn").value.trim()) checkRefund(true); });
  $("getBtn").addEventListener("click", () => getAddress());

  function setMsg(id, text, kind) { const m = $(id); m.textContent = text || ""; m.className = "msg" + (kind ? " " + kind : ""); m.hidden = !text; }

  /** A live quote from the proxy, its fit with what was asked, and 1Click's own word on the deposit address. */
  async function liveQuote(r, refundTo) {
    const resp = await api({ action: "checkout", dry: false, originAsset: r.assetId, destinationAsset: inv.asset.assetId, amount: inv.amountRaw,
      recipient: inv.to, refundTo, ...(inv.label ? { label: inv.label } : {}) });
    const why = checkLiveQuote(resp, { amountRaw: inv.amountRaw, originChain: r.chain });
    if (why) throw new Error(`The quote came back with ${why}, so it was not used. Try again.`);
    const q = resp.quote;
    const want = { dep: String(q.depositAddress), amountRaw: inv.amountRaw, originAsset: r.assetId, destinationAsset: inv.asset.assetId, recipient: inv.to, refundTo };
    let v = "NEAR Intents didn't confirm it just now";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((res) => setTimeout(res, 1500));
      let res = null;
      try { res = await getJson(oneclick + "/v0/status?depositAddress=" + encodeURIComponent(want.dep), { timeout: 8000 }); } catch (e) {}
      if (res && res.ok) { const w = confirmCheck(res.json, q, want); v = w ? "NEAR Intents holds that address for " + w : ""; break; }
      if (!(res && res.status === 404)) break;
    }
    if (v) throw new Error(`The deposit address could not be checked with NEAR Intents (${v}), so it is not shown. Try again.`);
    return resp;
  }
  function newTrack(r, resp, extra = {}) {
    const q = resp.quote;
    return { v: 1, dep: String(q.depositAddress), createdAt: Date.now(), status: "PENDING_DEPOSIT",
      invoice: { to: inv.to, code: inv.code, amountRaw: inv.amountRaw, label: inv.label, ref: inv.ref },
      pay: { assetId: r.assetId, symbol: r.symbol, chain: r.chain, chainName: r.chainName, decimals: r.decimals, contract: r.contract || null, amountInRaw: String(q.amountIn) },
      dryInRaw: r.quoteIn || null, deadline: String(resp.deadline || q.deadline || ""), timeEstimate: Number(q.timeEstimate) || 0,
      feeBps: Number.isFinite(resp.appFeeBps) ? resp.appFeeBps : null, correlationId: resp.correlationId || null, ...extra };
  }
  async function getAddress() {
    const r = selected;
    if (!r || busy || mode === "about" || r.chain === "near") return;
    const refundTo = checkRefund(true);
    if (!refundTo) { $("refundIn").focus(); return; }
    busy = true; $("getBtn").disabled = true; $("getBtn").textContent = "Getting the address…";
    setMsg("nextMsg", "Asking NEAR Intents for the deposit address…");
    try {
      const resp = await liveQuote(r, refundTo);
      startTrack(newTrack(r, resp, { refundTo }));
      setMsg("nextMsg", "");
    } catch (e) {
      if (isMissingAction(e.status, e.message)) { switchToAbout(); setMsg("nextMsg", "Exact-amount checkout is not open on this site yet. The list shows estimates.", "warn"); }
      else setMsg("nextMsg", quoteWhy(e.message), "error");
    } finally { busy = false; $("getBtn").textContent = "Get the address"; if (!track) renderNext(); }
  }

  /* ----- paying from NEAR: the shared wallet selector, one transaction, as the bridge does ----- */
  function paintNearBox() {
    const btn = $("nearBtn");
    const acct = wallet && wallet.account;
    $("nearAcct").textContent = acct ? "Paying from " + acct + "." : "";
    if (mode === "about") { btn.disabled = true; btn.textContent = "Connect wallet"; return; }
    if (!acct) { btn.disabled = busy; btn.textContent = busy ? "Loading the wallet…" : "Connect wallet"; return; }
    const r = selected;
    if (nearLive && Date.now() - nearLive.at < LIVE_MAX_AGE_MS && nearLive.row === r) {
      btn.disabled = busy; btn.textContent = `Send ${fmtAmount(nearLive.resp.quote.amountIn, r.decimals, 8)} ${r.symbol}`;
    } else { btn.disabled = busy || !r || r.state !== "ok"; btn.textContent = "Get the final quote"; }
  }
  async function ensureWallet() {
    if (wallet) return wallet;
    const mod = await import("/assets/nav-wallet.js");
    const kit = await mod.loadWalletKit();
    const selector = await kit.setupWalletSelector({ network: "mainnet", fallbackRpcUrls: ["https://free.rpc.fastnear.com", "https://near.drpc.org"], modules: kit.walletModules() });
    const modal = kit.setupModal(selector, {});
    wallet = { kit, selector, modal, account: null };
    const sync = (accounts) => { const a = (accounts || []).find((x) => x.active); const id = a ? a.accountId : null; if (id !== wallet.account) { wallet.account = id; nearLive = null; } paintNearBox(); };
    sync(selector.store.getState().accounts);
    selector.store.observable.subscribe((s) => sync(s.accounts));
    return wallet;
  }
  $("nearBtn").addEventListener("click", async () => {
    if (busy || mode === "about") return;
    setMsg("nearMsg", "");
    if (!wallet || !wallet.account) {
      busy = true; paintNearBox();
      try { const w = await ensureWallet(); if (!w.account) w.modal.show(); }
      catch (e) { setMsg("nearMsg", "Couldn't load the wallet options. Check your connection and try again.", "error"); }
      finally { busy = false; paintNearBox(); }
      return;
    }
    const r = selected;
    if (nearLive && nearLive.row === r && Date.now() - nearLive.at < LIVE_MAX_AGE_MS) return nearSend();
    busy = true; paintNearBox();
    setMsg("nearMsg", "Asking NEAR Intents for the final quote…");
    try {
      const resp = await liveQuote(r, wallet.account);
      const txs = await nearDepositTxs(r, wallet.account, String(resp.quote.depositAddress), BigInt(resp.quote.amountIn));
      nearLive = { at: Date.now(), resp, txs, row: r };
      const changed = r.quoteIn && r.quoteIn !== String(resp.quote.amountIn);
      setMsg("nearMsg", `Final quote: send ${fmtAmount(resp.quote.amountIn, r.decimals, r.decimals)} ${r.symbol} to the deposit address ${resp.quote.depositAddress} (checked with NEAR Intents).${changed ? " The amount changed since the first quote." : ""} Press Send within 60 seconds to approve it in your wallet.`, changed ? "error" : "");
      setTimeout(() => { if (nearLive && Date.now() - nearLive.at >= LIVE_MAX_AGE_MS) { nearLive = null; paintNearBox(); setMsg("nearMsg", "That quote is more than 60 seconds old. Get the final quote again."); } }, LIVE_MAX_AGE_MS + 200);
    } catch (e) {
      if (isMissingAction(e.status, e.message)) { switchToAbout(); setMsg("nearMsg", "Exact-amount checkout is not open on this site yet.", "warn"); }
      else setMsg("nearMsg", quoteWhy(e.message), "error");
    } finally { busy = false; paintNearBox(); }
  });
  async function nearSend() {
    const live = nearLive, r = live.row, q = live.resp.quote;
    nearLive = null;                                  // a live quote is sent at most once
    const deadline = Date.parse(live.resp.deadline || q.deadline || "");
    if (deadline && deadline <= Date.now() + 5000) { setMsg("nearMsg", "That quote is past its deadline. Get the final quote again.", "error"); paintNearBox(); return; }
    busy = true; paintNearBox();
    setMsg("nearMsg", "Confirm in your wallet…");
    try {
      const w = await wallet.selector.wallet();
      const outcome = await w.signAndSendTransactions({ transactions: live.txs.map((t) => ({ receiverId: t.receiverId, actions: t.actions.map((a) => wallet.kit.internalActionToNaj(a)) })) });
      const list = (Array.isArray(outcome) ? outcome : [outcome]).filter(Boolean);
      const last = list[list.length - 1] || {};
      const hash = (last.transaction && last.transaction.hash) || (last.transaction_outcome && last.transaction_outcome.id) || "";
      const failed = list.some((o) => o.status && o.status.Failure) || (last.receipts_outcome || []).some((x) => x.outcome && x.outcome.status && x.outcome.status.Failure);
      if (failed) { setMsg("nearMsg", "The transaction failed, so nothing was sent. Your coins are still in your wallet.", "error"); return; }
      const t = newTrack(r, live.resp, { refundTo: wallet.account, sentFrom: wallet.account, txHash: hash, status: "KNOWN_DEPOSIT_TX", seenAt: Date.now() });
      if (hash) api({ action: "submit", depositAddress: t.dep, txHash: hash, wallet: wallet.account }).catch(() => {});
      setMsg("nearMsg", "");
      startTrack(t);
    } catch (e) {
      const m = String((e && e.message) || e);
      setMsg("nearMsg", /reject|cancel|denied|closed/i.test(m) ? "You cancelled in the wallet. Nothing was sent." : "The wallet didn't send it: " + m.slice(0, 140), "error");
    } finally { busy = false; paintNearBox(); }
  }
  // NEAR RPC reads for the token registrations the transfer needs.
  const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org"];
  async function view(contract, method, args) {
    let last = null;
    for (const u of RPCS) {
      try {
        const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
          body: JSON.stringify({ jsonrpc: "2.0", id: "pay", method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } }) });
        const j = await r.json();
        if (j.error || (j.result && j.result.error)) throw new Error(String((j.error && j.error.message) || j.result.error));
        return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
      } catch (e) { last = e; }
    }
    throw last || new Error("NEAR RPC is not answering");
  }
  const fnCall = (methodName, args, gas, deposit) => ({ type: "FunctionCall", params: { methodName, args, gas, deposit } });
  const GAS_10T = "10000000000000", GAS_15T = "15000000000000";
  async function storageAction(token, account) {
    let reg = null;
    try { reg = await view(token, "storage_balance_of", { account_id: account }); } catch (e) { reg = null; }
    if (reg) return null;
    let min = 1250000000000000000000n;
    try { const b = await view(token, "storage_balance_bounds", {}); if (b && b.min && BigInt(b.min) > 0n) min = BigInt(b.min); } catch (e) {}
    if (min > 100000000000000000000000n) throw new Error("the token asks for an unusually large registration deposit");
    return fnCall("storage_deposit", { account_id: account, registration_only: true }, GAS_15T, min.toString());
  }
  /** ONE transaction on the paid token: (NEAR: register and wrap first), register the deposit address if needed, then
   *  ft_transfer of exactly the quoted amount to the deposit address. */
  async function nearDepositTxs(r, account, dep, amount) {
    const acts = [];
    if (r.native) {
      const reg = await storageAction(r.token, account);
      if (reg) acts.push(reg);
      acts.push(fnCall("near_deposit", {}, GAS_10T, amount.toString()));
    }
    const depReg = await storageAction(r.token, dep);
    if (depReg) acts.push(depReg);
    acts.push(fnCall("ft_transfer", { receiver_id: dep, amount: amount.toString(), memo: MEMO }, GAS_15T, "1"));
    return [{ receiverId: r.token, actions: acts }];
  }

  /* ----- the deposit card and the timeline ----- */
  function startTrack(t) {
    track = t;
    saveTrack(store, track);
    try { const u = new URL(location.href); u.searchParams.set("dep", t.dep); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
    $("payWith").hidden = true; $("next").hidden = true;
    renderTrack();
    poll();
    clearInterval(tickTimer);
    tickTimer = setInterval(renderTick, 1000);
  }
  function renderTrack() {
    const t = track, p = t.pay || null, v = trackView(t);
    // Deposit card.
    const dc = $("deposit");
    dc.hidden = v.final || !p;
    if (p) {
      $("sendAmt").textContent = fromRaw(p.amountInRaw, p.decimals) + " " + p.symbol;
      $("sendChain").textContent = "on " + p.chainName + (p.chain === "near" ? "" : ", in one transfer");
      $("depAddr").textContent = t.dep;
      const changed = t.dryInRaw && t.dryInRaw !== p.amountInRaw;
      $("changed").hidden = !changed;
      if (changed) $("changed").textContent = `The amount changed since the first quote: ${fromRaw(t.dryInRaw, p.decimals)} then, ${fromRaw(p.amountInRaw, p.decimals)} ${p.symbol} now. Send the amount above.`;
      const sentNear = !!t.sentFrom;
      $("qrBox").hidden = sentNear;
      $("sentLine").hidden = !sentNear;
      if (sentNear) {
        $("sentLine").textContent = "";
        $("sentLine").appendChild(document.createTextNode(`Sent from ${t.sentFrom}`));
        if (t.txHash) { $("sentLine").appendChild(document.createTextNode(" in ")); const a = el("a", "mono", t.txHash.slice(0, 10) + "…"); a.href = "https://nearblocks.io/txns/" + encodeURIComponent(t.txHash); a.target = "_blank"; a.rel = "noopener"; $("sentLine").appendChild(a); }
        $("sentLine").appendChild(document.createTextNode("."));
      }
      if (!sentNear && !dc.dataset.qr) drawQr(p, t);
      const link = deepLink(p, t.dep, p.amountInRaw);
      $("openWallet").hidden = sentNear || !link;
      if (link) $("openWallet").href = link;
      if (t.refundTo) $("refundShown").textContent = "Refunds go to " + t.refundTo;
    } else {
      $("refundShown").textContent = "";
    }
    // Timeline.
    $("timeline").hidden = false;
    const ol = $("steps");
    ol.textContent = "";
    STEPS.forEach((s, i) => {
      let label = s;
      if (i === 4 && v.phase === "refunded") label = "Refunded";
      if (i === 4 && v.phase === "failed") label = "Failed";
      if (i === 2 && v.phase === "incomplete") label = "Deposit seen, less than the amount";
      const li = el("li", i < v.step || (i === v.step && v.final && v.phase === "delivered") ? "done" : i === v.step ? "now" : "", label);
      if (i === 4 && (v.phase === "refunded" || v.phase === "failed")) li.className = "bad";
      if (i === 2 && v.phase === "incomplete") li.className = "warn";
      if (i === v.step) li.setAttribute("aria-current", "step");
      ol.appendChild(li);
    });
    const est = Number(t.timeEstimate) || 0;
    $("estimate").textContent = v.final ? "" : est ? `1Click estimates about ${est < 90 ? est + " seconds" : Math.round(est / 60) + " minutes"} once your deposit is seen.` : "";
    $("late").hidden = !v.late;
    const outs = (t.outTxs || []).filter((x) => x.explorerUrl);
    $("payoutLink").hidden = !outs.length;
    if (outs.length) $("payoutLink").href = outs[0].explorerUrl;
    $("statusLink").href = API + "?status=" + encodeURIComponent(t.dep);
    if (v.phase === "incomplete") setMsg("trackMsg", "1Click saw less than the amount. Send the rest to the same address before the deadline, or the deposit is refunded.", "warn");
    else if (v.phase === "refunded") setMsg("trackMsg", `Refunded${t.refunded ? ": " + t.refunded + " " + (p ? p.symbol : "") : ""}${t.refundReason ? " (" + t.refundReason + ")" : ""}. The coins went back to ${t.refundTo || "your refund address"}.`, "error");
    else if (v.phase === "failed") setMsg("trackMsg", "The payment failed. 1Click refunds the deposit to your refund address.", "error");
    else setMsg("trackMsg", p ? "" : "Following this deposit address from 1Click's status. The amount sent is not known on this device.");
    renderTick();
    if (v.phase === "delivered") renderReceipt();
  }
  function renderTick() {
    if (!track) return;
    const v = trackView(track);
    const cd = $("countdown");
    if (v.phase !== "waiting" || v.secondsLeft === null || track.sentFrom) { cd.hidden = true; $("expired").hidden = true; return; }
    cd.hidden = v.expired;
    const s = v.secondsLeft;
    cd.textContent = `Send within ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("expired").hidden = !v.expired;
    if (v.expired) { $("qrBox").hidden = true; $("openWallet").hidden = true; }
    if (track.seenAt && v.late !== !$("late").hidden) $("late").hidden = !v.late;
  }
  async function drawQr(p, t) {
    const box = $("qr");
    try {
      const { qrMatrix } = await import("./vendor/qr.js");
      const text = deepLink(p, t.dep, p.amountInRaw) || t.dep;
      const m = qrMatrix(text, "M");
      const q = 4, n = m.size + q * 2;
      let d = "";
      for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${n} ${n}`); svg.setAttribute("width", "256"); svg.setAttribute("height", "256");
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR code of the deposit address" + (text !== t.dep ? " and amount" : ""));
      svg.setAttribute("shape-rendering", "crispEdges");
      const bg = document.createElementNS(ns, "rect"); bg.setAttribute("width", n); bg.setAttribute("height", n); bg.setAttribute("class", "qr-bg");
      const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("class", "qr-fg");
      svg.append(bg, path);
      box.textContent = ""; box.appendChild(svg);
      $("deposit").dataset.qr = "1";
    } catch (e) { box.textContent = "The QR code could not be drawn. Copy the address instead."; }
  }
  async function poll() {
    clearTimeout(pollTimer);
    const t = track;
    if (!t || !trackView(t).poll) return;
    try {
      const r = await getJson(API + "?status=" + encodeURIComponent(t.dep));
      if (track !== t) return;
      if (r.ok && r.json) {
        const nt = nextTrack(t, r.json);
        if (nt !== t) {
          if (!nt.pay && r.json.amount) nt.statusAmount = String(r.json.amount);
          track = nt; saveTrack(store, track); renderTrack();
        }
      }
    } catch (e) {}
    if (track && trackView(track).poll) pollTimer = setTimeout(poll, POLL_MS);
  }

  /* ----- the receipt ----- */
  function renderReceipt() {
    const t = track, p = t.pay, i = t.invoice || {};
    const a = Object.hasOwn(INVOICE_ASSETS, i.code || "") ? INVOICE_ASSETS[i.code] : inv.asset;
    $("receipt").hidden = false;
    $("deposit").hidden = true;
    $("rcAmt").textContent = (t.deliveredRaw ? fromRaw(t.deliveredRaw, a.decimals) : fromRaw(i.amountRaw || inv.amountRaw, a.decimals)) + " " + a.symbol;
    $("rcChain").textContent = "on " + CHAIN_NAMES[a.chain];
    $("rcTo").textContent = i.to || inv.to;
    $("rcLabel").textContent = i.label || "";
    $("rcLabelRow").hidden = !i.label;
    $("rcPaid").textContent = p ? `${fromRaw(p.amountInRaw, p.decimals)} ${p.symbol} on ${p.chainName}` : "";
    $("rcPaidRow").hidden = !p;
    $("rcDep").textContent = t.dep;
    const outs = (t.outTxs || []).filter((x) => x.explorerUrl);
    $("rcTxRow").hidden = !outs.length;
    if (outs.length) { $("rcTx").href = outs[0].explorerUrl; $("rcTx").textContent = outs[0].hash.slice(0, 12) + "…"; }
    clearInterval(tickTimer);
    if (!notified) {
      notified = true;
      const target = (t.invoice && t.invoice.ref) || inv.ref;
      // Targeted at the merchant's origin from the link: if the opener is anything else, the browser drops it.
      try { if (target && window.opener) window.opener.postMessage({ ns: "checkout", status: "paid", depositAddress: t.dep, amount: fromRaw(i.amountRaw || inv.amountRaw, a.decimals), asset: i.code || inv.code, label: i.label || null, to: i.to || inv.to }, target); } catch (e) {}
    }
  }
  $("backBtn").addEventListener("click", () => {
    let op = null;
    try { op = window.opener; } catch (e) {}
    if (op) { try { op.focus(); } catch (e) {} window.close(); return; }
    if (shownOrigin) location.href = shownOrigin;
    else window.close();
  });

  /* ----- copy buttons, start over, fine print ----- */
  for (const b of document.querySelectorAll("[data-copy]")) {
    b.addEventListener("click", async () => {
      const src = $(b.dataset.copy);
      let text = src ? src.textContent.trim() : "";
      if (b.dataset.copy === "sendAmt") text = text.split(" ")[0];
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
      catch (e) { const range = document.createRange(); range.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(range); b.textContent = "Selected"; }
      setTimeout(() => { b.textContent = "Copy"; }, 1600);
    });
  }
  $("restart").addEventListener("click", () => {
    try { const u = new URL(location.href); u.searchParams.delete("dep"); location.replace(u.pathname + u.search); } catch (e) { location.reload(); }
  });
  function paintFee() {
    if (feeBps === null) return;
    $("feeLine").textContent = feeBps > 0 ? `nearswaps' fee of ${(feeBps / 100).toFixed(2).replace(/\.?0+$/, "")}% is included in the quote: the merchant receives the invoiced amount and you send it plus the fee.` : "nearswaps' fee is included in the quote.";
  }

  /* ----- start: a deposit in progress (reload), or the list ----- */
  if (inv.dep) {
    const saved = loadTrack(store, inv.dep);
    const sameInvoice = saved && saved.invoice && saved.invoice.to === inv.to && saved.invoice.amountRaw === inv.amountRaw && saved.invoice.code === inv.code;
    startTrack(sameInvoice ? saved : { v: 1, dep: inv.dep, createdAt: Date.now(), status: "PENDING_DEPOSIT", invoice: { to: inv.to, code: inv.code, amountRaw: inv.amountRaw, label: inv.label, ref: inv.ref }, pay: null });
  } else loadList();
}
