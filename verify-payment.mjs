#!/usr/bin/env node
// verify-payment.mjs: is this nearswaps checkout payment delivered, to you, in full? Node 18 or later, no packages.
//
//   node verify-payment.mjs <depositAddress> --to <address> --amount <n> --asset <code> [--label <text>] [--api https://nearswaps.com/api]
//
//   node verify-payment.mjs 0x5c7f...e1 --to shop.near --amount 25 --asset usdc
//
// It asks GET <api>/intents?status=<depositAddress> (public, read-only) and checks, one fact per line:
//   status SUCCESS, kind "checkout", quote type EXACT_OUTPUT, the recipient, the destination asset, the invoiced
//   amount, and the amount delivered at or above the invoice (and the label, when you pass --label).
// Exit code 0 when every check passes (paid), 1 otherwise (not paid yet, refunded, not yours, or the call failed).
//
// Asset codes, as in data-asset: usdc (USDC on NEAR), usdt (USDT on NEAR), near, usdc-base, usdc-sol, usdc-arb, usdc-eth.
// Record each deposit address against one order and never accept it for a second one.
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEFAULT_API = "https://nearswaps.com/api";

export const ASSETS = {
  usdc: { id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", name: "USDC on NEAR", symbol: "USDC", decimals: 6 },
  usdt: { id: "nep141:usdt.tether-token.near", name: "USDT on NEAR", symbol: "USDT", decimals: 6 },
  near: { id: "nep141:wrap.near", name: "NEAR", symbol: "NEAR", decimals: 24 },
  "usdc-base": { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", name: "USDC on Base", symbol: "USDC", decimals: 6 },
  "usdc-sol": { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", name: "USDC on Solana", symbol: "USDC", decimals: 6 },
  "usdc-arb": { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", name: "USDC on Arbitrum", symbol: "USDC", decimals: 6 },
  "usdc-eth": { id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", name: "USDC on Ethereum", symbol: "USDC", decimals: 6 },
};

const STATUS_WORDS = {
  PENDING_DEPOSIT: "waiting for the deposit",
  KNOWN_DEPOSIT_TX: "deposit seen, not delivered yet",
  INCOMPLETE_DEPOSIT: "the deposit was below the amount asked",
  PROCESSING: "processing, not delivered yet",
  SUCCESS: "delivered",
  REFUNDED: "refunded to the buyer",
  FAILED: "failed",
};

const USAGE = "usage: node verify-payment.mjs <depositAddress> --to <address> --amount <n> --asset <code> [--label <text>] [--api " + DEFAULT_API + "]";

/** "1.5" with 6 decimals -> 1500000n, or null when it is not a plain positive decimal with at most `decimals` places. */
export function toRaw(text, decimals) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
  if (!m) return null;
  const frac = m[2] || "";
  if (frac.length > decimals) return null;
  const raw = BigInt(m[1] + frac.padEnd(decimals, "0"));
  return raw > 0n ? raw : null;
}
/** 1500000n with 6 decimals -> "1.5". */
export function fromRaw(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals), f = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return f ? i + "." + f : i;
}
const isRaw = (v) => typeof v === "string" && /^\d{1,40}$/.test(v);
/** EVM addresses compare without case; everything else (NEAR accounts, Solana) exactly. */
export function sameAddress(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (/^0x[0-9a-f]{40}$/i.test(a) && /^0x[0-9a-f]{40}$/i.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Read the command line. Returns { depositAddress, to, amount, asset, label, api } or { error }. */
export function parseArgs(argv) {
  const out = { api: DEFAULT_API, label: null }, rest = [];
  const flags = { "--to": "to", "--amount": "amount", "--asset": "asset", "--label": "label", "--api": "api" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    const eq = a.indexOf("=");
    const name = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    if (Object.hasOwn(flags, name)) {
      const v = eq > 0 && a.startsWith("--") ? a.slice(eq + 1) : argv[++i];
      if (v == null) return { error: `${name} needs a value` };
      out[flags[name]] = v;
    } else if (a.startsWith("--")) return { error: `unknown option ${a}` };
    else rest.push(a);
  }
  if (rest.length !== 1) return { error: "give exactly one deposit address" };
  out.depositAddress = rest[0];
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(out.depositAddress)) return { error: "that does not look like a deposit address" };
  if (!out.to) return { error: "--to is needed (the address you are paid at)" };
  if (out.amount == null) return { error: "--amount is needed (the invoiced amount, e.g. 25)" };
  out.asset = String(out.asset || "").toLowerCase();
  if (!Object.hasOwn(ASSETS, out.asset)) return { error: `--asset must be one of ${Object.keys(ASSETS).join(", ")}` };
  out.amountRaw = toRaw(out.amount, ASSETS[out.asset].decimals);
  if (out.amountRaw == null) return { error: `--amount must be a positive number with at most ${ASSETS[out.asset].decimals} decimals` };
  if (!/^https?:\/\/[^\s/]+(\/[^\s?#]*)?$/.test(out.api)) return { error: "--api must be an http(s) address, e.g. " + DEFAULT_API };
  return out;
}

export function statusUrl(api, depositAddress) {
  return api.replace(/\/+$/, "") + "/intents?status=" + encodeURIComponent(depositAddress);
}

/**
 * Check one status answer against the invoice. Pure: no network.
 *   s        the JSON of GET /api/intents?status=<depositAddress>
 *   invoice  { to, asset (code), amountRaw (bigint), label? }
 * Returns { paid, lines } where every line is one fact: "ok    ...", "NO    ..." or "info  ...", then a verdict line.
 */
export function verify(s, invoice) {
  const lines = [], fails = [];
  const asset = ASSETS[invoice.asset];
  const want = BigInt(invoice.amountRaw);
  const fmt = (raw) => `${fromRaw(raw, asset.decimals)} ${asset.symbol}`;
  const check = (pass, text, why) => { lines.push((pass ? "ok    " : "NO    ") + text); if (!pass) fails.push(why || text); };
  if (!s || typeof s !== "object") s = {};
  const sd = s.swapDetails && typeof s.swapDetails === "object" ? s.swapDetails : {};

  const st = typeof s.status === "string" ? s.status : "(none)";
  check(st === "SUCCESS", `status: ${st}${STATUS_WORDS[st] ? " (" + STATUS_WORDS[st] + ")" : ""}`, `status is ${st}${STATUS_WORDS[st] ? ", " + STATUS_WORDS[st] : ""}`);
  check(s.kind === "checkout", `kind: ${s.kind == null ? "(none: not a nearswaps checkout payment)" : s.kind}`, "not a nearswaps checkout payment");
  check(s.swapType === "EXACT_OUTPUT", `quote type: ${s.swapType == null ? "(none)" : s.swapType}`, "not an exact-amount quote");
  check(sameAddress(s.recipient, invoice.to), `recipient: ${s.recipient == null ? "(none)" : s.recipient}${sameAddress(s.recipient, invoice.to) ? "" : " (expected " + invoice.to + ")"}`, "paid to someone else");
  const assetOk = s.destinationAsset === asset.id;
  const assetName = Object.values(ASSETS).find((a) => a.id === s.destinationAsset)?.name;
  check(assetOk, `destination asset: ${assetName ? assetName + " " : ""}${s.destinationAsset == null ? "(none)" : s.destinationAsset}${assetOk ? "" : " (expected " + asset.name + " " + asset.id + ")"}`, "a different asset");
  const invOk = isRaw(s.amount) && BigInt(s.amount) === want;
  check(invOk, `invoiced: ${isRaw(s.amount) && assetOk ? fmt(s.amount) + " (" + s.amount + ")" : isRaw(s.amount) ? s.amount + " base units" : "(none)"}${invOk ? "" : " (expected " + fmt(want) + ")"}`, "a different invoice amount");
  const got = isRaw(sd.amountOut) ? BigInt(sd.amountOut) : null;
  const gotOk = got != null && got >= want;
  check(gotOk, `delivered: ${got == null ? "nothing yet" : (assetOk ? fmt(got) + " (" + got + ")" : got + " base units")}${gotOk ? "" : " (at least " + fmt(want) + " expected)"}`, got == null ? "nothing delivered yet" : "less than the invoice delivered");
  if (invoice.label != null) {
    const labelOk = s.label === invoice.label;
    check(labelOk, `label: ${s.label == null ? "(none)" : JSON.stringify(s.label)}${labelOk ? "" : " (expected " + JSON.stringify(invoice.label) + ")"}`, "a different label");
  } else if (typeof s.label === "string") lines.push(`info  label: ${JSON.stringify(s.label)}`);
  if (typeof sd.refundedAmountFormatted === "string" && sd.refundedAmountFormatted) lines.push(`info  refunded to the buyer: ${sd.refundedAmountFormatted}`);
  if (typeof sd.refundReason === "string" && sd.refundReason) lines.push(`info  refund reason: ${sd.refundReason}`);
  for (const t of Array.isArray(sd.destinationChainTxHashes) ? sd.destinationChainTxHashes : []) {
    if (t && typeof t.hash === "string") lines.push(`info  payout transaction: ${t.hash}${typeof t.explorerUrl === "string" ? " " + t.explorerUrl : ""}`);
  }
  if (typeof s.updatedAt === "string") lines.push(`info  updated: ${s.updatedAt}`);
  const paid = fails.length === 0;
  lines.push(paid ? `PAID: ${fmt(got)} delivered to ${invoice.to}` : `NOT PAID: ${fails.join("; ")}`);
  return { paid, lines };
}

/** Ask the status and check it. Returns { paid, lines }; never throws for network or HTTP trouble. */
export async function run(args, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const url = statusUrl(args.api, args.depositAddress);
  const head = [`info  deposit address: ${args.depositAddress}`, `info  status call: GET ${url}`];
  let res, body;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    body = await res.text();
  } catch (e) {
    return { paid: false, lines: [...head, `NO    status call: ${e && e.name === "TimeoutError" ? "no answer in " + timeoutMs / 1000 + " s" : (e && e.message) || String(e)}`, "NOT PAID: the status call failed"] };
  }
  if (!res.ok) return { paid: false, lines: [...head, `NO    status call: HTTP ${res.status} ${body.slice(0, 200).replace(/\s+/g, " ")}`, "NOT PAID: the status call failed"] };
  let json;
  try { json = JSON.parse(body); } catch (e) { return { paid: false, lines: [...head, "NO    status call: the answer is not JSON", "NOT PAID: the status call failed"] }; }
  const r = verify(json, { to: args.to, asset: args.asset, amountRaw: args.amountRaw, label: args.label });
  return { paid: r.paid, lines: [...head, ...r.lines] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(0); }
  if (args.error) { console.error("verify-payment: " + args.error + "\n" + USAGE); process.exit(1); }
  const r = await run(args);
  console.log(r.lines.join("\n"));
  process.exit(r.paid ? 0 : 1);
}
