// 会话是一个 HMAC-SHA256 签名的 cookie，不落库：服务端只要密钥在手就能验，
// 省掉一次 KV 往返。真正需要持久化的是登录记录，那个单独写。
const enc = new TextEncoder();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verify(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".", 2);
  // crypto.subtle.verify 本身是常数时间的，不要改成手写字符串比较
  const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(sig), enc.encode(body));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
  if (!payload || typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

export const cookie = (token, maxAge) =>
  `goji_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const clearCookie = () =>
  `goji_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readCookie(request) {
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(/(?:^|;\s*)goji_session=([^;]+)/);
  return m ? m[1] : null;
}
