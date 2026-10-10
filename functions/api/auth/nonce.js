import { json, bad } from "../../_lib/http.js";

// nonce 必须来自我们自己的域、单次、短命 —— 这是整个重放防御。
// 「用户签的是你的 origin，所以 nonce 得由你发」。
const TTL = 120;

export async function onRequestGet({ env }) {
  if (!env.GOJI_KV) return bad("not-configured", "KV binding GOJI_KV is missing", 503);
  const nonce = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.GOJI_KV.put(`nonce:${nonce}`, String(Date.now()), { expirationTtl: TTL });
  return json({ ok: true, nonce, expiresIn: TTL });
}
