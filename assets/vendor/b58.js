// base58（比特币字母表）。Beagle 的钱包门里 address 和 sig 都是 base58 ——
// 不是 hex。文档没写这一条，是 2026-10-10 问 Beagle 那边的 agent 才确认的，
// 按 hex 解会静默地验签失败。
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = (() => { const m = new Int16Array(128).fill(-1); for (let i = 0; i < A.length; i++) m[A.charCodeAt(i)] = i; return m; })();

export function b58decode(s) {
  if (typeof s !== "string" || s.length === 0) throw new Error("base58: empty");
  // 从空数组开始：写成 [0] 会给全零输入（如 111…1 系统程序地址）多出一个前导零字节，
  // 解出 33 字节而不是 32。本地单元测试当场抓到的。
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? MAP[c] : -1;
    if (v < 0) throw new Error("base58: bad character");
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // 前导 '1' 是前导零字节
  for (let i = 0; i < s.length && s[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function b58encode(buf) {
  const bytes = Array.from(buf);
  const digits = [];
  for (const b of bytes) {
    let carry = b;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const b of bytes) { if (b !== 0) break; out += "1"; }
  for (let i = digits.length - 1; i >= 0; i--) out += A[digits[i]];
  return out;
}
