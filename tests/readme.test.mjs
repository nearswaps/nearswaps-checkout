// Node tests for the README and docs/: the first real payment's record agrees with the verifier and with what the
// README quotes, the README's local links resolve, the hero is 1200 x 630, the diagram stays in the brand colours.
// No network. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify, parseArgs } from "../verify-payment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");   // a Windows checkout may be CRLF
const README = read("README.md");
const DEP = "2C8zc62gRcd7g3PsbvptBpxqYLmpctuxyAKcs8yvE1EB";
const STATUS = JSON.parse(read("docs/runs/01-first-payment-status.json"));
const RUN = read("docs/runs/01-first-payment-verify.txt");

test("the first real payment: the recorded status answer passes the verifier offline", () => {
  const args = parseArgs([DEP, "--to", "tome.near", "--amount", "2", "--asset", "usdc"]);
  const r = verify(STATUS, { to: args.to, asset: args.asset, amountRaw: args.amountRaw, label: null });
  assert.equal(r.paid, true);
  assert.equal(r.lines.at(-1), "PAID: 2 USDC delivered to tome.near");
  assert.equal(verify(STATUS, { ...args, label: "Demo shop: coffee" }).paid, true, "the stored label is the demo shop's coffee");
  assert.equal(verify(STATUS, { to: "tome.near", asset: "usdc", amountRaw: 5000000n }).paid, false, "it does not pay a 5 USDC invoice");
  // the saved live run is exactly the deposit address, the status call and these lines
  const out = RUN.slice(RUN.indexOf("$ node verify-payment.mjs")).split("\n");
  assert.equal(out[0], `$ node verify-payment.mjs ${DEP} --to tome.near --amount 2 --asset usdc`);
  assert.deepEqual(out.slice(3, 3 + r.lines.length), r.lines, "the live run printed what the recorded answer gives");
  assert.ok(RUN.includes("(exit code 0)"));
});

test("the README quotes the saved run line for line and names the record files", () => {
  const run = RUN.slice(RUN.indexOf("$ node verify-payment.mjs")).split("\n").slice(1).filter((l) => /^(ok|info|NO|PAID)/.test(l));
  const block = README.slice(README.indexOf("```text\ninfo  deposit address: " + DEP));
  assert.ok(block.length > 0, "the README has the verifier output block");
  const quoted = block.slice(8, block.indexOf("\n```", 8)).split("\n");
  assert.deepEqual(quoted, run);
  for (const f of ["docs/runs/01-first-payment-status.json", "docs/runs/01-first-payment-verify.txt"]) assert.ok(README.includes(f), f);
  for (const fact of ["2 USDC", "tome.near", "Demo shop: coffee", "GvHFEnPF2CuXzuvEozrbFUWrXeCXwZiy9ZzAp25FcMga", "0.0103"]) assert.ok(README.includes(fact), fact);
  assert.equal(STATUS.swapDetails.nearTxHashes.includes("GvHFEnPF2CuXzuvEozrbFUWrXeCXwZiy9ZzAp25FcMga"), true, "the payout is a NEAR transaction of this payment");
});

test("README: the sections the hackathon asks for, and every local link resolves", () => {
  for (const h of ["## The one tag", "## Try it in two minutes", "## Pay from a wallet", "## Accept a real payment", "## Verify before you ship",
    "## What NEAR does here", "## This repository", "## Hackathon scope, libraries and how it was built", "## Licence", "## Links"]) assert.ok(README.includes("\n" + h + "\n"), h);
  assert.match(README, /NEAR HACKATHON/);
  assert.match(README, /Real-World Money/);
  assert.match(README, /Open Innovation/);
  assert.match(README, /https:\/\/github\.com\/nearswaps\/nearswaps-agents/, "names the team's other project");
  assert.match(README, /AI-generated code/);
  assert.ok(fs.existsSync(path.join(ROOT, "LICENSE")) && /MIT License/.test(read("LICENSE")));
  const links = [...README.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)|src="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((u) => !/^https?:|^mailto:/.test(u));
  assert.ok(links.length >= 6);
  for (const u of links) assert.ok(fs.existsSync(path.join(ROOT, u)), "README links a missing file: " + u);
  for (const f of ["SECURITY.md", "CONTRIBUTING.md", "docs/api.md"]) {
    for (const m of read(f).matchAll(/\]\(([^)#\s]+)\)/g)) if (!/^https?:/.test(m[1])) assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), m[1])), `${f} links a missing file: ${m[1]}`);
  }
});

test("README: no placeholder left", () => {
  assert.deepEqual([...README.matchAll(/<<[^>]*>>/g)].map((m) => m[0]), []);
  assert.ok(!/\b(TODO|TBD|lorem)\b/i.test(README));
});

test("the second and third real payments: each record passes the verifier offline, matches its saved run and the README", () => {
  for (const p of [
    { n: "02-phantom-payment", dep: "DenPpjHzt9eoikJes5kmqrY4TBTCD1wcHqAqXzHoUFum", amount: "1", label: "Test", payout: "8HuJGTb3qcMDrzYr5usXMJEkSHsEoqYEo6PpcECjNT9K", refund: "0.000175" },
    { n: "03-recorded-payment", dep: "7oJ4WHRhr21cwRNG9G2EzVdWhw5rcDNfHPajpQK2pFeE", amount: "2", label: "Demo shop: coffee", payout: "BnF5zaMcm2eDumi4LEt4218fsPKhxpZoJxyHTLfWW87o", refund: "0.0103" },
  ]) {
    const status = JSON.parse(read(`docs/runs/${p.n}-status.json`));
    const run = read(`docs/runs/${p.n}-verify.txt`);
    const a = parseArgs([p.dep, "--to", "tome.near", "--amount", p.amount, "--asset", "usdc", "--label", p.label]);
    const r = verify(status, { to: a.to, asset: a.asset, amountRaw: a.amountRaw, label: a.label });
    assert.equal(r.paid, true, p.n);
    const out = run.slice(run.indexOf("$ node verify-payment.mjs")).split("\n");
    assert.ok(out[0].startsWith(`$ node verify-payment.mjs ${p.dep} --to tome.near --amount ${p.amount} --asset usdc --label `), p.n);
    assert.deepEqual(out.slice(3, 3 + r.lines.length), r.lines, p.n + ": the live run printed what the recorded answer gives");
    assert.ok(run.includes("(exit code 0)"), p.n);
    assert.ok(status.swapDetails.nearTxHashes.includes(p.payout), p.n + ": the payout is a NEAR transaction of this payment");
    assert.equal(status.swapDetails.refundedAmountFormatted, p.refund);
    for (const fact of [p.dep, p.payout, p.refund, `docs/runs/${p.n}-status.json`, `docs/runs/${p.n}-verify.txt`]) assert.ok(README.includes(fact), `${p.n}: ${fact}`);
  }
});

test("CONTRIBUTING: the one block the wording test skips is short and only names the rules", () => {
  const t = read("CONTRIBUTING.md");
  const blocks = [...t.matchAll(/<!-- wording-rules[\s\S]*?<!-- \/wording-rules -->/g)];
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0][0].length < 700, "keep the skipped block short");
});

test("docs/hero.png is a 1200 x 630 PNG; the diagram is titled and uses the brand colours only", () => {
  const png = fs.readFileSync(path.join(ROOT, "docs/hero.png"));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const svg = read("docs/architecture.svg");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<title id="t">[^<]+<\/title>/);
  assert.match(svg, /<desc id="d">[^<]+<\/desc>/);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#060708"\/>/, "a solid ground, so it reads on light and dark GitHub");
  const colours = new Set([...svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
  const BRAND = new Set(["#060708", "#0A0B0D", "#2A2B2E", "#F2F2F0", "#9A9FA8", "#7D828B", "#01FAC0", "#FF5C5C", "#E8B04B"]);
  for (const c of colours) assert.ok(BRAND.has(c), "off-brand colour " + c);
  for (const word of ["checkout.js", "nearswaps.com/pay", "/api/intents", "1Click", "BUYER'S WALLET", "MERCHANT'S ACCOUNT"]) assert.ok(svg.includes(word), word);
  // every tag that opens is closed (a light well-formedness check; there is no XML parser without packages)
  const open = (svg.match(/<(?!\/|!|\?)[a-zA-Z]+[^>]*[^/]>/g) || []).length, close = (svg.match(/<\/[a-zA-Z]+>/g) || []).length;
  assert.equal(open, close);
});
