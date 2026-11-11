// Node tests for paying from a wallet in the browser (spec part K): the EVM send with a mocked EIP-6963 provider, the
// Solana transfer check and send with a mocked Wallet Standard wallet, wallet discovery, the refund address, the 60 s
// rule, and the local mock's soltx. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../web/assets/pay.js";
import { depositInstructions, unsignedTx, mockSolTx, MOCK_BLOCKHASH, MEMO_PROGRAM, b58encode } from "../tools/mock-soltx.mjs";
import { createMock, start, withMockWallets, MOCK_WALLETS_JS, MOCK_PHANTOM_ADDRESS } from "../tools/serve-local.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "soltx.json"), "utf8"));
const bytesOf = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));

/* ---------- a mocked EVM wallet (EIP-1193 request) ---------- */
const FROM = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
const DEP = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const HASH = "0x" + "ab".repeat(32);
function evmWallet({ chain = "0x2105", known = ["0x1", "0x2105"], switchTo = true, send = () => HASH } = {}) {
  const calls = [];
  const p = { request: async (a) => {
    calls.push(a);
    const m = a.method, prm = a.params || [];
    if (m === "eth_requestAccounts") return [FROM];
    if (m === "eth_chainId") return chain;
    if (m === "wallet_switchEthereumChain") { if (!known.includes(prm[0].chainId)) throw { code: 4902, message: "Unrecognized chain ID" }; if (switchTo) chain = prm[0].chainId; return null; }
    if (m === "wallet_addEthereumChain") { known.push(prm[0].chainId); chain = prm[0].chainId; return null; }
    if (m === "eth_sendTransaction") return send(prm[0]);
    throw new Error("unexpected " + m);
  } };
  return { p, calls, methods: () => calls.map((c) => c.method) };
}
const ETH_BASE = { chain: "base", chainName: "Base", symbol: "ETH", decimals: 18, contract: null };
const USDC_BASE = { chain: "base", chainName: "Base", symbol: "USDC", decimals: 6, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const USDC_ARB = { chain: "arb", chainName: "Arbitrum", symbol: "USDC", decimals: 6, contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" };
const liveOf = (dep, amountIn, at = Date.now()) => ({ at, resp: { dry: false, quote: { depositAddress: dep, amountIn: String(amountIn), amountOut: "1000000", deadline: new Date(at + 30 * 60e3).toISOString() } } });

test("ETH on Base: one eth_sendTransaction with the exact value to the deposit address", async () => {
  const w = evmWallet();
  const hash = await P.sendDeposit({ name: "MetaMask", address: FROM, evm: w.p }, ETH_BASE, liveOf(DEP, "286123456789012"));
  assert.equal(hash, HASH);
  assert.deepEqual(w.methods(), ["eth_requestAccounts", "eth_chainId", "eth_sendTransaction"], "already on Base: no switch");
  assert.deepEqual(w.calls[2], { method: "eth_sendTransaction", params: [{ from: FROM, to: DEP, value: "0x" + (286123456789012n).toString(16) }] });
});
test("USDC on Base: transfer(deposit, amount) to the token contract, value 0", async () => {
  const w = evmWallet();
  await P.sendDeposit({ name: "MetaMask", address: FROM, evm: w.p }, USDC_BASE, liveOf(DEP, "1005025"));
  const data = "0xa9059cbb" + "000000000000000000000000742d35cc6634c0532925a3b844bc454e4438f44e" + "00000000000000000000000000000000000000000000000000000000000f55e1";
  assert.equal((1005025).toString(16), "f55e1");
  assert.deepEqual(w.calls.at(-1), { method: "eth_sendTransaction", params: [{ from: FROM, to: USDC_BASE.contract, value: "0x0", data }] });
  assert.equal(data.length, 2 + 8 + 64 + 64);
});
test("network switch, and the 4902 path that adds the network first", async () => {
  const said = [];
  const w = evmWallet({ chain: "0x1" });
  await P.evmSend(w.p, USDC_BASE, DEP, 1005025n, (m) => said.push(m));
  assert.deepEqual(w.methods(), ["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_sendTransaction"]);
  assert.deepEqual(w.calls[2].params, [{ chainId: "0x2105" }]);
  assert.deepEqual(said, ["Switch to Base in your wallet…", "Confirm the transfer in your wallet…"]);
  const a = evmWallet({ chain: "0x1" });
  await P.evmSend(a.p, USDC_ARB, DEP, 1n);
  assert.deepEqual(a.methods(), ["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "eth_sendTransaction"]);
  assert.deepEqual(a.calls[3].params, [P.EVM_ADD.arb]);
  assert.equal(P.EVM_ADD.arb.chainId, "0xa4b1");
  // No add for Ethereum (every wallet has it): the 4902 is passed on.
  const e = evmWallet({ chain: "0x2105", known: ["0x2105"] });
  await assert.rejects(P.evmSend(e.p, { ...ETH_BASE, chain: "eth", chainName: "Ethereum" }, DEP, 1n), (err) => err.code === 4902);
});
test("still on another network after the switch: refused, nothing sent", async () => {
  const w = evmWallet({ chain: "0x1", switchTo: false });
  await assert.rejects(P.sendDeposit({ name: "MetaMask", address: FROM, evm: w.p }, USDC_BASE, liveOf(DEP, "1")), /still on another network\. Switch it to Base/);
  assert.ok(!w.methods().includes("eth_sendTransaction"));
});
test("cancel in the wallet (4001) and other refusals before anything is signed", async () => {
  const w = evmWallet({ send: () => { throw { code: 4001, message: "MetaMask Tx Signature: User denied transaction signature." }; } });
  let err = null;
  try { await P.sendDeposit({ name: "MetaMask", address: FROM, evm: w.p }, ETH_BASE, liveOf(DEP, "1")); } catch (e) { err = e; }
  assert.ok(err && P.isCancel(err), "4001 reads as a cancel");
  assert.equal(P.isCancel({ message: "User rejected the request." }), true);
  assert.equal(P.isCancel(new Error("Transaction cancelled")), true);
  assert.equal(P.isCancel(new Error("popup closed")), true);
  assert.equal(P.isCancel(new Error("insufficient funds for gas")), false);
  // A deposit address that is not an EVM address, a USDC with no contract, a hash that is not one: refused.
  const b = evmWallet();
  await assert.rejects(P.evmSend(b.p, ETH_BASE, "shop.near", 1n), /Unexpected deposit address/);
  assert.equal(b.calls.length, 0);
  await assert.rejects(P.evmSend(evmWallet().p, { ...USDC_BASE, contract: null }, DEP, 1n), /contract unknown/);
  await assert.rejects(P.evmSend(evmWallet({ send: () => "0x12" }).p, ETH_BASE, DEP, 1n), /transaction id/);
});

/* ---------- Solana: the transfer check, ported exactly ---------- */
const want = (f, over = {}) => ({ from: f.from, to: f.to, amount: BigInt(f.amount), mint: f.mint, decimals: f.decimals, ...over });
test("solTxCheck passes the fixtures built by the site's own builder (SOL and USDC)", async () => {
  assert.equal(await P.solTxCheck(bytesOf(FIX.sol.tx), want(FIX.sol)), "");
  assert.equal(await P.solTxCheck(bytesOf(FIX.usdc.tx), want(FIX.usdc)), "");
  assert.equal(await P.solAta(FIX.usdc.from, FIX.usdc.mint), FIX.usdc.fromAta);
  assert.equal(await P.solAta(FIX.usdc.to, FIX.usdc.mint), FIX.usdc.toAta);
});
test("solTxCheck refuses an altered amount, recipient, an extra instruction and a versioned transaction", async () => {
  // Another amount: the same transaction asked for one base unit more, and the bytes changed by one unit.
  assert.equal(await P.solTxCheck(bytesOf(FIX.sol.tx), want(FIX.sol, { amount: BigInt(FIX.sol.amount) + 1n })), "a transfer of another amount");
  const b = bytesOf(FIX.usdc.tx); b[b.length - 9] ^= 1;                        // TransferChecked amount, low byte
  assert.equal(await P.solTxCheck(b, want(FIX.usdc)), "a transfer of another amount");
  const dec = bytesOf(FIX.usdc.tx); dec[dec.length - 1] = 9;                   // the decimals byte
  assert.equal(await P.solTxCheck(dec, want(FIX.usdc)), "a transfer of another amount");
  // Another recipient.
  const other = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrJ";
  const solTo = { ...FIX.sol, to: other };
  assert.equal(await P.solTxCheck(bytesOf(mockSolTx(solTo).tx), want(FIX.sol)), "a transfer to another address");
  assert.equal(await P.solTxCheck(bytesOf(mockSolTx({ ...FIX.usdc, to: other }).tx), want(FIX.usdc)), "a token account for another address");
  // An extra instruction: a memo, a second transfer.
  const ixs = depositInstructions({ ...FIX.sol, amount: BigInt(FIX.sol.amount) });
  const memo = { program: MEMO_PROGRAM, keys: [], data: Buffer.from("hi") };
  assert.equal(await P.solTxCheck(Uint8Array.from(unsignedTx(FIX.sol.from, ixs.concat([memo]), MOCK_BLOCKHASH)), want(FIX.sol)), "an instruction the deposit doesn't need");
  assert.equal(await P.solTxCheck(Uint8Array.from(unsignedTx(FIX.sol.from, ixs.concat([ixs[2]]), MOCK_BLOCKHASH)), want(FIX.sol)), "more than one transfer");
  // A versioned transaction (the message's first byte has the 0x80 version flag).
  const v = bytesOf(FIX.sol.tx); v[65] = 0x80;
  assert.equal(await P.solTxCheck(v, want(FIX.sol)), "a versioned transaction");
  // Someone else as the signer, trailing bytes, a short read, a priority fee over the cap.
  assert.equal(await P.solTxCheck(bytesOf(FIX.sol.tx), want(FIX.sol, { from: other })), "a signer other than your wallet alone");
  assert.equal(await P.solTxCheck(Uint8Array.from([...bytesOf(FIX.sol.tx), 0]), want(FIX.sol)), "extra data after the instructions");
  assert.equal(await P.solTxCheck(bytesOf(FIX.sol.tx).slice(0, 120), want(FIX.sol)), "a transaction that can't be read");
  const fee = depositInstructions({ ...FIX.sol, amount: BigInt(FIX.sol.amount), computeUnits: 1400000 });
  fee[1] = { ...fee[1], data: Buffer.concat([Buffer.from([3]), Buffer.from(new BigUint64Array([1000000n]).buffer)]) };
  assert.equal(await P.solTxCheck(Uint8Array.from(unsignedTx(FIX.sol.from, fee, MOCK_BLOCKHASH)), want(FIX.sol)), "a priority fee above 0.0001 SOL");
});
test("the Solana check block is the swap page's, word for word (where the site folder is on this PC)", () => {
  const src = "C:/Users/slpto/OneDrive/Desktop/NEKO WEBSITE/Nearswaps/site/assets/swap.js";
  if (!fs.existsSync(src)) return;
  const swap = fs.readFileSync(src, "utf8");
  const body = (text, head) => { const i = text.indexOf(head); assert.ok(i >= 0, head); const j = text.indexOf("\n}\n", i); return text.slice(i, j + 2); };
  for (const head of ["function b58dec(s) {", "function edOnCurve(bytes) {", "async function solAta(owner, mint) {", "async function solTxCheck(bytes, want) {", "function b58enc(bytes) {"]) {
    const mine = body(fs.readFileSync(path.join(here, "../web/assets/pay.js"), "utf8"), "export " + head).replace(/^export /, "");
    assert.equal(mine, body(swap, head), head);
  }
  for (const line of ['const SOL_SYSTEM = "11111111111111111111111111111111", SOL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";', 'const SOL_MAX_PRIORITY_LAMPORTS = 100000n;',
    "const ED_D = edMod(-121665n * edPow(121666n, ED_P - 2n));", 'const EVM_CHAIN_ID = { eth: "0x1", base: "0x2105", arb: "0xa4b1" };']) assert.ok(swap.includes(line), line);
  const pay = fs.readFileSync(path.join(here, "../web/assets/pay.js"), "utf8");
  for (const k of ["base", "arb"]) { const line = pay.split("\n").find((l) => l.startsWith("  " + k + ": { chainId:")); assert.ok(line && swap.includes(line), "EVM_ADD." + k); }
});
test("the local mock's Solana builder is the site's: it rebuilds both fixtures byte for byte", () => {
  for (const k of ["sol", "usdc"]) assert.equal(mockSolTx(FIX[k]).tx, FIX[k].tx, k);
  const rnd = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
  assert.deepEqual(P.b58dec(P.b58enc(rnd)), rnd);
  assert.equal(P.b58enc(rnd), b58encode(rnd));
  assert.equal(P.b58enc(new Uint8Array(32)), "11111111111111111111111111111111");
});

/* ---------- a mocked Wallet Standard wallet ---------- */
function stdWallet({ address = FIX.usdc.from, sign } = {}) {
  const seen = { connect: 0, sign: [] };
  const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signAndSendTransaction"] };
  const w = { version: "1.0.0", name: "Phantom", icon: "data:image/svg+xml,<svg/>", chains: ["solana:mainnet"], accounts: [], features: {
    "standard:connect": { version: "1.0.0", connect: async () => { seen.connect++; w.accounts = [account]; return { accounts: [account] }; } },
    "solana:signAndSendTransaction": { version: "1.0.0", signAndSendTransaction: async (i) => { seen.sign.push(i); return sign ? sign(i) : [{ signature: Uint8Array.from({ length: 64 }, (_, k) => k + 1) }]; } },
  } };
  return { w, seen, account };
}
test("solSend: soltx asked for this deposit and wallet, checked, then signed and sent; the signature comes back in base58", async () => {
  const { w, seen } = stdWallet();
  const asked = [];
  const api = async (b) => { asked.push(b); return { tx: FIX.usdc.tx, amount: FIX.usdc.amount }; };
  const s = { name: "Phantom", address: FIX.usdc.from, std: w };
  const coin = { chain: "sol", chainName: "Solana", symbol: "USDC", decimals: 6, contract: FIX.usdc.mint };
  const sig = await P.sendDeposit(s, coin, liveOf(FIX.usdc.to, FIX.usdc.amount), { api });
  assert.deepEqual(asked, [{ action: "soltx", depositAddress: FIX.usdc.to, from: FIX.usdc.from }]);
  assert.equal(seen.sign.length, 1);
  assert.equal(seen.sign[0].chain, "solana:mainnet");
  assert.equal(seen.sign[0].account.address, FIX.usdc.from);
  assert.deepEqual(Array.from(seen.sign[0].transaction), Array.from(bytesOf(FIX.usdc.tx)));
  assert.equal(sig, P.b58enc(Uint8Array.from({ length: 64 }, (_, k) => k + 1)));
  assert.match(sig, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "the shape the proxy takes as a Solana tx id");
});
test("solSend: a transfer from the server that is not the quote is never signed", async () => {
  const { w, seen } = stdWallet();
  const s = { name: "Phantom", address: FIX.usdc.from, std: w };
  const coin = { chain: "sol", symbol: "USDC", decimals: 6, contract: FIX.usdc.mint };
  const other = mockSolTx({ ...FIX.usdc, amount: "999999999" }).tx;
  await assert.rejects(P.sendDeposit(s, coin, liveOf(FIX.usdc.to, FIX.usdc.amount), { api: async () => ({ tx: other }) }), /isn't the quoted deposit \(a transfer of another amount\), so nothing was signed/);
  await assert.rejects(P.sendDeposit(s, coin, liveOf(FIX.usdc.to, FIX.usdc.amount), { api: async () => ({ tx: "" }) }), /Couldn't build/);
  assert.equal(seen.sign.length, 0);
  // Cancel in the wallet.
  const c = stdWallet({ sign: () => { throw new Error("User rejected the request."); } });
  let err = null;
  try { await P.solSend({ name: "Phantom", address: FIX.usdc.from, std: c.w }, coin, FIX.usdc.to, BigInt(FIX.usdc.amount), async () => ({ tx: FIX.usdc.tx })); } catch (e) { err = e; }
  assert.ok(err && P.isCancel(err));
});

/* ---------- discovery, the refund address, the 60 s rule ---------- */
function fakeWindow(extra = {}) {
  const win = new EventTarget();
  Object.assign(win, extra);
  return win;
}
test("wallet discovery: EIP-6963 and window.ethereum, Wallet Standard and the older Solana objects, Bitcoin and Tron readers", async () => {
  const mm = evmWallet({ chain: "0x1" });
  const win = fakeWindow({ solflare: { connect: async () => {}, publicKey: { toString: () => FIX.sol.to } }, unisat: { requestAccounts: async () => ["bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"] } });
  win.addEventListener("eip6963:requestProvider", () => win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { uuid: "u1", name: "MetaMask", icon: "data:image/svg+xml,<svg/>", rdns: "io.metamask" }, provider: mm.p } })));
  let changes = 0;
  const XW = P.xwInit(win, () => changes++);
  const { w } = stdWallet();
  win.dispatchEvent(Object.assign(new Event("wallet-standard:register-wallet"), { detail: (api) => api.register(w) }));
  assert.equal(changes, 2);
  const base = P.walletsFor("base", XW, win);
  assert.deepEqual(base.map((x) => x.name), ["MetaMask"]);
  assert.equal(base[0].evm, mm.p);
  const sol = P.walletsFor("sol", XW, win);
  assert.deepEqual(sol.map((x) => x.name), ["Phantom", "Solflare"]);
  assert.equal(P.canSend({ std: sol[0].std }, "sol"), true, "Wallet Standard Phantom sends");
  assert.equal(P.canSend({ std: sol[1].std || null }, "sol"), false, "the older Solflare object only fills the address");
  assert.equal(sol[1].icon, "/assets/xc/w-solflare.svg");
  assert.deepEqual(P.walletsFor("btc", XW, win).map((x) => x.name), ["UniSat"]);
  assert.deepEqual(P.walletsFor("zec", XW, win), []);
  // No EIP-6963 announcement: window.ethereum is the fallback.
  const plain = fakeWindow({ ethereum: { isRabby: true, request: mm.p.request } });
  const only = P.walletsFor("arb", P.xwInit(plain), plain);
  assert.deepEqual(only.map((x) => [x.name, x.icon]), [["Rabby", "/assets/xc/w-rabby.svg"]]);
  // Tron: TronLink fills the refund address.
  const tron = fakeWindow({ tronLink: { request: async () => ({ code: 200 }), tronWeb: { defaultAddress: { base58: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7" } } } });
  const tl = P.walletsFor("tron", P.xwInit(tron), tron);
  assert.equal(await (await P.connectWallet(tl[0], "tron")).address, "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7");
  assert.equal(P.walletIcon("javascript:alert(1)"), "");
});
test("the refund address is the connected wallet's address", async () => {
  const win = fakeWindow();
  const XW = P.xwInit(win);
  const { w } = stdWallet({ address: FIX.sol.from });
  win.dispatchEvent(Object.assign(new Event("wallet-standard:register-wallet"), { detail: (api) => api.register(w) }));
  const s = await P.connectWallet(P.walletsFor("sol", XW, win)[0], "sol");
  assert.equal(s.address, FIX.sol.from);
  const inv = P.parseInvoice("?to=shop.near&amount=1&label=Order%201").invoice;
  const row = { assetId: "nep141:sol.omft.near", chain: "sol" };
  const body = P.checkoutBody(row, inv, s.address, false);
  assert.deepEqual(body, { action: "checkout", dry: false, originAsset: row.assetId, destinationAsset: P.INVOICE_ASSETS.usdc.assetId, amount: "1000000", recipient: "shop.near", refundTo: FIX.sol.from, label: "Order 1" });
  const m = evmWallet();
  const e = await P.connectWallet({ name: "MetaMask", get: () => m.p.request({ method: "eth_requestAccounts" }), evm: m.p }, "base");
  assert.equal(P.checkoutBody(row, inv, e.address, false).refundTo, FROM);
  // A wallet that answers no address of the chain is refused, so it can never become the refund address.
  await assert.rejects(P.connectWallet({ name: "Odd", get: async () => "shop.near" }, "sol"), /gave no Solana address/);
});
test("a live quote older than 60 s, or within a minute of its deadline, is not sent from a wallet", async () => {
  const now = 10_000_000;
  assert.equal(P.liveStale(liveOf(DEP, "1", now - 10e3), now), false);
  assert.equal(P.liveStale(liveOf(DEP, "1", now - 60e3), now), false, "60 s exactly is still fresh");
  assert.equal(P.liveStale(liveOf(DEP, "1", now - 61e3), now), true);
  const near = liveOf(DEP, "1", now); near.resp.quote.deadline = new Date(now + 50e3).toISOString();
  assert.equal(P.liveStale(near, now), true);
  assert.equal(P.liveStale(null, now), true);
  const w = evmWallet();
  await assert.rejects(P.sendDeposit({ name: "MetaMask", address: FROM, evm: w.p }, ETH_BASE, liveOf(DEP, "1", now - 61e3), { now }), (e) => e.stale === true);
  assert.equal(w.calls.length, 0, "the wallet is not asked");
  // A wallet that can't send from this page (the older injected Solana objects): refused as manual.
  await assert.rejects(P.sendDeposit({ name: "Solflare", address: FIX.sol.from }, { chain: "sol" }, liveOf(FIX.sol.to, "1")), (e) => e.manual === true);
});
test("a deposit sent from a wallet stays at Deposit seen while 1Click still says waiting; explorer links", () => {
  const t = { dep: DEP, createdAt: 1, status: "KNOWN_DEPOSIT_TX", seenAt: 5, txHash: HASH };
  const n = P.nextTrack(t, { status: "PENDING_DEPOSIT" }, 9);
  assert.equal(n.status, "KNOWN_DEPOSIT_TX");
  assert.equal(P.nextTrack(t, { status: "PROCESSING" }, 9).status, "PROCESSING");
  assert.equal(P.nextTrack({ ...t, txHash: undefined, status: "PENDING_DEPOSIT" }, { status: "PENDING_DEPOSIT" }, 9).status, "PENDING_DEPOSIT");
  assert.equal(P.txUrl("sol", "5abc"), "https://solscan.io/tx/5abc");
  assert.equal(P.txUrl("eth", HASH), "https://etherscan.io/tx/" + HASH);
  assert.equal(P.txUrl("base", HASH), "https://basescan.org/tx/" + HASH);
  assert.equal(P.txUrl("arb", HASH), "https://arbiscan.io/tx/" + HASH);
  assert.equal(P.txUrl("btc", "ab"), "");
  assert.equal(P.txUrl("sol", "<x>"), "");
});

/* ---------- the local mock: ?wallets=mock and soltx ---------- */
test("the local mock answers soltx with a transfer the pay page's check accepts", async () => {
  const mock = createMock();
  const q = mock.handle("POST", "/api/intents", { action: "checkout", dry: false, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    destinationAsset: P.INVOICE_ASSETS.usdc.assetId, amount: "1000000", recipient: "shop.near", refundTo: MOCK_PHANTOM_ADDRESS });
  const dep = q.body.quote.depositAddress;
  assert.equal(P.addressOk("sol", dep), true);
  const r = mock.handle("POST", "/api/intents", { action: "soltx", depositAddress: dep, from: MOCK_PHANTOM_ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(await P.solTxCheck(bytesOf(r.body.tx), { from: MOCK_PHANTOM_ADDRESS, to: dep, amount: BigInt(q.body.quote.amountIn), mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 }), "");
  assert.equal(mock.handle("POST", "/api/intents", { action: "soltx", depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", from: MOCK_PHANTOM_ADDRESS }).status, 400, "unknown deposit address");
  mock.handle("GET", "/__mock?sent=last-soltx");
  assert.equal(mock.handle("GET", "/api/intents?status=" + encodeURIComponent(dep)).body.status, "KNOWN_DEPOSIT_TX", "a mocked send moves the deposit on");
});
test("?wallets=mock serves the pay page with the mocked Phantom and MetaMask", async () => {
  assert.doesNotThrow(() => new Function(MOCK_WALLETS_JS), "the mocked wallets parse as a plain script");
  assert.match(withMockWallets(fs.readFileSync(path.join(here, "../web/pay.html"), "utf8")), /<script src="\/__mock-wallets.js"><\/script>\n<script type="module" src="\/assets\/pay.js">/);
  const srv = await start({ port: 0, shopPort: 0 });
  try {
    const plain = await (await fetch(srv.payOrigin + "/pay?to=shop.near&amount=1&oneclick=/mock-1click")).text();
    assert.ok(!plain.includes("__mock-wallets"), "not without ?wallets=mock");
    const mocked = await (await fetch(srv.payOrigin + "/pay?to=shop.near&amount=1&oneclick=/mock-1click&wallets=mock")).text();
    assert.ok(mocked.includes('<script src="/__mock-wallets.js"></script>'));
    const js = await fetch(srv.payOrigin + "/__mock-wallets.js");
    assert.equal(js.status, 200);
    assert.match(await js.text(), /eip6963:announceProvider[\s\S]*wallet-standard:register-wallet/);
  } finally { await srv.close(); }
});
