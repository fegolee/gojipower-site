import { b58decode, b58encode } from "./b58.js";

// 为什么要自己推导 ATA：publicnode 是 Worker 里唯一能用的 Solana RPC
// （api.mainnet-beta 直接回 "Your IP or provider is blocked"），
// 而 publicnode 把 getTokenAccountsByOwner 这类按 owner 索引的方法列为付费：
//   {"error":{"code":-32602,"message":"Indexed requests require a personal token"}}
// getAccountInfo 是免费的，所以只要知道账户地址就能读。ATA 地址是确定性推导出来的，
// 不需要任何索引 —— 换的是方法，不是端点。
const TOKEN_PROGRAM = b58decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = b58decode("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752n;

const powMod = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };

// ed25519 点解压：地址落在曲线上就是一个普通公钥，落不到才是合法的 PDA。
function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  const sign = Number((y >> 255n) & 1n);
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = y * y % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const vInv = powMod(v, P - 2n, P);
  if (vInv === 0n) return false;
  const x2 = u * vInv % P;
  if (x2 === 0n) return sign === 0;
  let x = powMod(x2, (P + 3n) / 8n, P);
  if (x * x % P !== x2) x = x * SQRT_M1 % P;
  return x * x % P === x2;
}

async function sha256(parts) {
  let len = 0; for (const p of parts) len += p.length;
  const buf = new Uint8Array(len);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

// 关联代币账户地址 = findProgramAddress([owner, TOKEN_PROGRAM, mint], ATA_PROGRAM)
export async function deriveAta(ownerB58, mintB58) {
  const owner = b58decode(ownerB58), mint = b58decode(mintB58);
  if (owner.length !== 32 || mint.length !== 32) throw new Error("ata: bad pubkey");
  for (let bump = 255; bump >= 0; bump--) {
    const h = await sha256([owner, TOKEN_PROGRAM, mint, new Uint8Array([bump]), ATA_PROGRAM, PDA_MARKER]);
    if (!isOnCurve(h)) return { address: b58encode(h), bump };
  }
  throw new Error("ata: no off-curve address found");
}
