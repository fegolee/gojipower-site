// XEdDSA 验签，零依赖。
//
// Carrier 身份密钥是 X25519（和 crypto_box 同一把），公钥那一半就是 userid。
// X25519 公钥不能直接喂给 Ed25519，所以 Beagle 用 Signal 的 XEdDSA。
// 官方实现走 curve25519-js（再加 tweetnacl），而 @decentnetwork/peer 的主入口
// 在 Workers 上跑不了。
//
// 但 XEdDSA 的**验证**这一半可以拆开：把 Montgomery 公钥 u 换算成 Edwards 的 y、
// 符号位取 0，剩下就是一次标准的 Ed25519 验签 —— 而 Ed25519 在 WebCrypto 里是原生的。
// 于是不需要引入任何 npm 包，也不需要构建步骤。
//
// 正确性不靠推导背书：test/xeddsa.mjs 用官方 curve25519-js 生成签名，
// 逐例和这里对拍（含篡改消息、篡改签名、换公钥等反例）。
const P = (1n << 255n) - 19n;

function powMod(b, e, m) {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}

const leToBig = (b) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };

// u -> y 的 Edwards 编码。符号位由调用方填 ——
// curve25519-js / Signal 的实现把**公钥的符号位藏在签名最后一字节的最高位**里，
// 并不是规范文字上那个「恒为 0」。照字面写出来的版本会**恰好有一半的签名验不过**，
// 而用自己手上那把密钥测又很可能正好落在能过的那一半。
// 这个 bug 是和官方实现逐例对拍才暴露的（25/50），不是推导出来的。
export function montgomeryToEdwards(pub32) {
  let u = leToBig(pub32) & ((1n << 255n) - 1n);   // 规范要求先对 2^255 取模
  if (u >= P) return null;
  const denom = (u + 1n) % P;
  if (denom === 0n) return null;                   // u = -1 无对应 Edwards 点
  const y = (((u - 1n + P) % P) * powMod(denom, P - 2n, P)) % P;
  const A = new Uint8Array(32);
  let t = y;
  for (let i = 0; i < 32; i++) { A[i] = Number(t & 0xffn); t >>= 8n; }
  A[31] &= 0x7f;                                   // 先清空，符号位由签名提供
  return A;
}

export async function verifyDetached(x25519Pub, message, signature) {
  if (!x25519Pub || x25519Pub.length !== 32) return false;
  if (!signature || signature.length !== 64) return false;
  const A = montgomeryToEdwards(x25519Pub);
  if (!A) return false;
  // 取出藏在签名里的符号位，放回公钥；签名本身要把那一位清掉再验。
  const sig = Uint8Array.from(signature);
  A[31] |= sig[63] & 0x80;
  sig[63] &= 0x7f;
  try {
    const key = await crypto.subtle.importKey("raw", A, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, message);
  } catch {
    return false;   // 公钥不是曲线上的点时 importKey 会抛；当作验签失败而不是报错
  }
}
