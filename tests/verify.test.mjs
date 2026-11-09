// Node tests for verify-payment.mjs: the pure check against the status fixtures, the command line, and the real CLI
// (a child process) against a local HTTP server that answers the fixtures. No network. Run: npm test
//
// The fixtures in tests/fixtures/status/ have the shape of GET /api/intents?status= for a checkout as the backend
// contract gives it (9 Nov 2026). They are not recorded from the live site (the checkout action is not published yet);
// once a real payment exists, add its answer here as another fixture.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verify, parseArgs, run, toRaw, fromRaw, sameAddress, statusUrl, ASSETS, DEFAULT_API } from "../verify-payment.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../verify-payment.mjs");
const fx = (name) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/status", name + ".json"), "utf8"));
const INVOICE = { to: "tome.near", asset: "usdc", amountRaw: 2000000n };

test("success: every check passes, one fact per line, the verdict last", () => {
  const r = verify(fx("success"), INVOICE);
  assert.equal(r.paid, true);
  assert.ok(r.lines.every((l) => !l.includes("\n")));
  assert.ok(!r.lines.some((l) => l.startsWith("NO ")));
  for (const want of ["ok    status: SUCCESS (delivered)", "ok    kind: checkout", "ok    quote type: EXACT_OUTPUT", "ok    recipient: tome.near",
    "ok    destination asset: USDC on NEAR " + ASSETS.usdc.id, "ok    invoiced: 2 USDC (2000000)", "ok    delivered: 2 USDC (2000000)"]) assert.ok(r.lines.includes(want), want);
  assert.equal(r.lines.at(-1), "PAID: 2 USDC delivered to tome.near");
});

test("pending: not paid, nothing delivered yet", () => {
  const r = verify(fx("pending"), INVOICE);
  assert.equal(r.paid, false);
  assert.ok(r.lines.includes("NO    status: PENDING_DEPOSIT (waiting for the deposit)"));
  assert.ok(r.lines.includes("NO    delivered: nothing yet (at least 2 USDC expected)"));
  assert.match(r.lines.at(-1), /^NOT PAID: status is PENDING_DEPOSIT, waiting for the deposit; nothing delivered yet$/);
});

test("refunded: not paid, the refund facts are shown", () => {
  const r = verify(fx("refunded"), INVOICE);
  assert.equal(r.paid, false);
  assert.ok(r.lines.includes("NO    status: REFUNDED (refunded to the buyer)"));
  assert.ok(r.lines.some((l) => l.startsWith("info  refunded to the buyer: ")));
  assert.ok(r.lines.some((l) => l.startsWith("info  refund reason: ")));
});

test("wrong recipient: not paid even though the status is SUCCESS", () => {
  const r = verify(fx("wrong-recipient"), INVOICE);
  assert.equal(r.paid, false);
  assert.ok(r.lines.includes("ok    status: SUCCESS (delivered)"));
  assert.ok(r.lines.includes("NO    recipient: someone-else.near (expected tome.near)"));
  assert.equal(r.lines.at(-1), "NOT PAID: paid to someone else");
});

test("short amount: less than the invoice delivered is not paid", () => {
  const r = verify(fx("short-amount"), INVOICE);
  assert.equal(r.paid, false);
  assert.ok(r.lines.includes("NO    delivered: 1.99 USDC (1990000) (at least 2 USDC expected)"));
  assert.equal(r.lines.at(-1), "NOT PAID: less than the invoice delivered");
});

test("other mismatches: asset, invoice amount, kind, quote type, label, a plain swap, junk", () => {
  const s = fx("success");
  assert.equal(verify({ ...s, destinationAsset: ASSETS["usdc-base"].id }, INVOICE).paid, false);
  assert.ok(verify({ ...s, destinationAsset: ASSETS["usdc-base"].id }, INVOICE).lines.some((l) => l.startsWith("NO    destination asset: USDC on Base")));
  assert.equal(verify(s, { ...INVOICE, amountRaw: 5000000n }).paid, false, "a 2 USDC payment does not pay a 5 USDC invoice");
  assert.equal(verify({ ...s, amount: "1000000" }, INVOICE).paid, false, "the record is for another invoice");
  assert.equal(verify({ ...s, kind: undefined }, INVOICE).paid, false);
  assert.equal(verify({ ...s, swapType: "EXACT_INPUT" }, INVOICE).paid, false);
  assert.equal(verify(s, { ...INVOICE, label: "Demo shop: coffee" }).paid, true);
  assert.equal(verify(s, { ...INVOICE, label: "Order 7" }).paid, false);
  const plain = { status: "SUCCESS", updatedAt: "2026-11-09T21:05:12.000Z", swapDetails: { amountOut: "2000000" } };
  const r = verify(plain, INVOICE);
  assert.equal(r.paid, false);
  assert.ok(r.lines.includes("NO    kind: (none: not a nearswaps checkout payment)"));
  for (const junk of [null, "x", [], { swapDetails: "x" }, { swapDetails: { amountOut: "-5" } }]) assert.equal(verify(junk, INVOICE).paid, false);
  assert.equal(verify({ ...s, swapDetails: { ...s.swapDetails, amountOut: "2500000" } }, INVOICE).paid, true, "more than the invoice is still paid");
});

test("EVM recipients compare without case; NEAR and Solana exactly", () => {
  assert.ok(sameAddress("0xAbC0000000000000000000000000000000000001", "0xabc0000000000000000000000000000000000001"));
  assert.ok(!sameAddress("Tome.near", "tome.near"));
  assert.ok(!sameAddress("So1ana", "so1ana"));
  assert.ok(!sameAddress(undefined, "tome.near"));
  const s = { ...fx("success"), recipient: "0xAbC0000000000000000000000000000000000001", destinationAsset: ASSETS["usdc-base"].id };
  assert.equal(verify(s, { to: "0xabc0000000000000000000000000000000000001", asset: "usdc-base", amountRaw: 2000000n }).paid, true);
});

test("amounts: decimals, base units, refusals", () => {
  assert.equal(toRaw("2", 6), 2000000n);
  assert.equal(toRaw("12.50", 6), 12500000n);
  assert.equal(toRaw("0.1", 24), 10n ** 23n);
  for (const bad of ["0", "-1", "1e3", "1.1234567", "", "abc", "1,5"]) assert.equal(toRaw(bad, 6), null, bad);
  assert.equal(fromRaw(2000000n, 6), "2");
  assert.equal(fromRaw("1990000", 6), "1.99");
  assert.equal(fromRaw(1n, 24), "0.000000000000000000000001");
});

test("command line: flags, = form, defaults and errors", () => {
  const a = parseArgs(["dep1", "--to", "tome.near", "--amount", "2", "--asset", "USDC"]);
  assert.equal(a.depositAddress, "dep1"); assert.equal(a.asset, "usdc"); assert.equal(a.amountRaw, 2000000n); assert.equal(a.api, DEFAULT_API); assert.equal(a.label, null);
  const b = parseArgs(["--to=shop.near", "--amount=25", "--asset=usdc-sol", "--label", "Order 1042", "--api", "http://127.0.0.1:8787/api/", "dep2"]);
  assert.equal(b.to, "shop.near"); assert.equal(b.label, "Order 1042"); assert.equal(statusUrl(b.api, "dep2"), "http://127.0.0.1:8787/api/intents?status=dep2");
  assert.equal(statusUrl(DEFAULT_API, "a b"), "https://nearswaps.com/api/intents?status=a%20b");
  assert.ok(parseArgs([]).error);
  assert.match(parseArgs(["d", "--amount", "2", "--asset", "usdc"]).error, /--to/);
  assert.match(parseArgs(["d", "--to", "x.near", "--asset", "usdc"]).error, /--amount/);
  assert.match(parseArgs(["d", "--to", "x.near", "--amount", "2", "--asset", "btc"]).error, /--asset must be one of/);
  assert.match(parseArgs(["d", "--to", "x.near", "--amount", "2", "--asset", "__proto__"]).error, /--asset must be one of/);
  assert.match(parseArgs(["d", "--to", "x.near", "--amount", "0", "--asset", "usdc"]).error, /--amount/);
  assert.match(parseArgs(["d/../x", "--to", "x.near", "--amount", "2", "--asset", "usdc"]).error, /deposit address/);
  assert.match(parseArgs(["d", "e", "--to", "x.near", "--amount", "2", "--asset", "usdc"]).error, /exactly one/);
  assert.match(parseArgs(["d", "--to", "x.near", "--amount", "2", "--asset", "usdc", "--api", "ftp://x"]).error, /--api/);
  assert.match(parseArgs(["d", "--to", "x.near", "--amount", "2", "--asset", "usdc", "--nope"]).error, /unknown option/);
  assert.match(parseArgs(["d", "--to"]).error, /needs a value/);
});

test("run(): HTTP errors, non-JSON and network failures are 'not paid', never a throw", async () => {
  const args = parseArgs(["dep1", "--to", "tome.near", "--amount", "2", "--asset", "usdc"]);
  const answer = (status, text) => async () => ({ ok: status < 300, status, text: async () => text });
  let r = await run(args, { fetchImpl: answer(200, JSON.stringify(fx("success"))) });
  assert.equal(r.paid, true);
  assert.equal(r.lines[1], "info  status call: GET https://nearswaps.com/api/intents?status=dep1");
  r = await run(args, { fetchImpl: answer(429, '{"error":"Too many requests. Try again in a minute."}') });
  assert.equal(r.paid, false); assert.match(r.lines.join("\n"), /HTTP 429/);
  r = await run(args, { fetchImpl: answer(200, "<html>") });
  assert.equal(r.paid, false); assert.match(r.lines.join("\n"), /not JSON/);
  r = await run(args, { fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  assert.equal(r.paid, false); assert.match(r.lines.join("\n"), /ENOTFOUND/);
});

/* ---------- the real command, against a local server ---------- */
function serveFixtures() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const name = u.searchParams.get("status");
    if (u.pathname !== "/api/intents" || !/^[a-z-]+$/.test(name || "") || !fs.existsSync(path.join(here, "fixtures/status", name + ".json"))) { res.writeHead(404); res.end('{"error":"not found"}'); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(fx(name)));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}
const cli = (args) => new Promise((resolve) => execFile(process.execPath, [CLI, ...args], { timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

test("CLI: exit 0 for the paid fixture, 1 for every other one and for bad input", async () => {
  const srv = await serveFixtures();
  const api = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const ok = await cli(["success", "--to", "tome.near", "--amount", "2", "--asset", "usdc", "--api", api]);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^PAID: 2 USDC delivered to tome\.near$/m);
    for (const name of ["pending", "refunded", "wrong-recipient", "short-amount"]) {
      const r = await cli([name, "--to", "tome.near", "--amount", "2", "--asset", "usdc", "--api", api]);
      assert.equal(r.code, 1, name);
      assert.match(r.stdout, /^NOT PAID: /m, name);
    }
    const missing = await cli(["no-such-address", "--to", "tome.near", "--amount", "2", "--asset", "usdc", "--api", api]);
    assert.equal(missing.code, 1); assert.match(missing.stdout, /HTTP 404/);
    const bad = await cli(["success", "--amount", "2", "--asset", "usdc"]);
    assert.equal(bad.code, 1); assert.match(bad.stderr, /--to is needed/);
  } finally { await new Promise((r) => srv.close(r)); }
});
