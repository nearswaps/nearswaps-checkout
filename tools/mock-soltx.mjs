// The unsigned Solana deposit transfer, for the local mock's "soltx" answer and the Node tests. No packages.
// The same layout as the site's builder (netlify/shared/solana-tx.mjs: depositInstructions + unsignedTx): native SOL is
// one System transfer; USDC / USDT is an idempotent creation of the deposit address's token account, then
// TransferChecked; two compute-budget settings first. tests/wallet.test.mjs checks that this file rebuilds the fixture
// made by the site's own builder (tests/fixtures/soltx.json) byte for byte, so the mock answers what the server would.
import crypto from "node:crypto";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAM = "MemoSq4gqABAXKQ9qd6ZsnYbJ9nFAk8m4SPS1ZQWNM2";
const PRIORITY_MICROLAMPORTS = 50000n;
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = ""; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
export function b58decode(s) {
  let n = 0n;
  for (const ch of String(s)) { const i = A.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.push(Number(n & 255n)); n >>= 8n; }
  for (const ch of String(s)) { if (ch !== "1") break; out.push(0); }
  return Buffer.from(out.reverse());
}
export function pubkey(s) {
  const b = b58decode(s);
  if (b.length !== 32) throw new Error("bad Solana address");
  return b;
}

const P = 2n ** 255n - 19n;
const mod = (a) => { const r = a % P; return r < 0n ? r + P : r; };
const modPow = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; };
const D = mod(-121665n * modPow(121666n, P - 2n));
function onCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y = mod(y & ((1n << 255n) - 1n));
  const yy = (y * y) % P, u = mod(yy - 1n), v = mod(D * yy + 1n);
  if (u === 0n) return true;
  return modPow((u * modPow(v, P - 2n)) % P, (P - 1n) / 2n) === 1n;
}
export function ata(owner, mint) {
  const prog = pubkey(ATA_PROGRAM);
  for (let bump = 255; bump >= 0; bump--) {
    const out = crypto.createHash("sha256").update(pubkey(owner)).update(pubkey(TOKEN_PROGRAM)).update(pubkey(mint)).update(Buffer.from([bump])).update(prog).update(Buffer.from("ProgramDerivedAddress")).digest();
    if (!onCurve(out)) return b58encode(out);
  }
  throw new Error("no program address");
}

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
function shortvec(n) { const out = []; for (;;) { const x = n & 0x7f; n >>= 7; if (n) out.push(x | 0x80); else { out.push(x); return Buffer.from(out); } } }

/** instructions: [{ program, keys: [{ key, signer, writable }], data }]; feePayer signs and pays. Unsigned legacy bytes. */
export function unsignedTx(feePayer, instructions, recentBlockhash) {
  const metas = new Map();
  const add = (key, signer, writable) => { const m = metas.get(key) || { key, signer: false, writable: false }; m.signer ||= signer; m.writable ||= writable; metas.set(key, m); };
  add(feePayer, true, true);
  for (const ix of instructions) { for (const k of ix.keys) add(k.key, k.signer, k.writable); add(ix.program, false, false); }
  const all = [...metas.values()];
  const order = (m) => (m.key === feePayer ? 0 : m.signer && m.writable ? 1 : m.signer ? 2 : m.writable ? 3 : 4);
  all.sort((a, b) => order(a) - order(b));
  const idx = new Map(all.map((m, i) => [m.key, i]));
  const signers = all.filter((m) => m.signer).length;
  const header = Buffer.from([signers, all.filter((m) => m.signer && !m.writable).length, all.filter((m) => !m.signer && !m.writable).length]);
  const parts = [header, shortvec(all.length), ...all.map((m) => pubkey(m.key)), pubkey(recentBlockhash), shortvec(instructions.length)];
  for (const ix of instructions) parts.push(Buffer.from([idx.get(ix.program)]), shortvec(ix.keys.length), Buffer.from(ix.keys.map((k) => idx.get(k.key))), shortvec(ix.data.length), Buffer.from(ix.data));
  return Buffer.concat([shortvec(signers), Buffer.alloc(64 * signers), ...parts]);
}
/** The instructions for a deposit of `amount` (base units) to `to`; mint and decimals only for SPL tokens. */
export function depositInstructions({ from, to, amount, mint, decimals, computeUnits }) {
  const budget = [
    { program: COMPUTE_BUDGET, keys: [], data: Buffer.concat([Buffer.from([2]), u32(computeUnits || (mint ? 60000 : 1000))]) },
    { program: COMPUTE_BUDGET, keys: [], data: Buffer.concat([Buffer.from([3]), u64(PRIORITY_MICROLAMPORTS)]) },
  ];
  if (!mint) return budget.concat([{ program: SYSTEM_PROGRAM, keys: [{ key: from, signer: true, writable: true }, { key: to, signer: false, writable: true }], data: Buffer.concat([u32(2), u64(amount)]) }]);
  const src = ata(from, mint), dst = ata(to, mint);
  return budget.concat([
    { program: ATA_PROGRAM, keys: [{ key: from, signer: true, writable: true }, { key: dst, signer: false, writable: true }, { key: to, signer: false, writable: false },
      { key: mint, signer: false, writable: false }, { key: SYSTEM_PROGRAM, signer: false, writable: false }, { key: TOKEN_PROGRAM, signer: false, writable: false }], data: Buffer.from([1]) },
    { program: TOKEN_PROGRAM, keys: [{ key: src, signer: false, writable: true }, { key: mint, signer: false, writable: false }, { key: dst, signer: false, writable: true }, { key: from, signer: true, writable: false }],
      data: Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])]) },
  ]);
}
/** The mock's soltx answer: { tx (base64), amount }. A made-up block hash: nothing built here can land on Solana. */
export const MOCK_BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
export function mockSolTx({ from, to, amount, mint, decimals }) {
  return { tx: unsignedTx(from, depositInstructions({ from, to, amount: BigInt(amount), mint: mint || null, decimals }), MOCK_BLOCKHASH).toString("base64"), amount: String(amount) };
}
/** A valid Solana address made from a number (the mock's deposit addresses). */
export function mockSolAddress(n) {
  const b = crypto.createHash("sha256").update("mock deposit " + n).digest();
  return b58encode(b);
}
