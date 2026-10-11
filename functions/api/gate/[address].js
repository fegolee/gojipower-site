import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { b58decode } from "../../_lib/b58.js";
import { evaluate } from "../../_lib/gate.js";
import { rateLimit, cached } from "../../_lib/throttle.js";

export async function onRequestGet({ request, params, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);

  const address = params.address;
  // 先验格式再查链：省掉对垃圾输入的链上调用，也省掉 Helius 配额。
  let raw;
  try { raw = b58decode(address); } catch { return bad("bad-address", "address must be base58"); }
  if (raw.length !== 32) return bad("bad-address", "address must decode to 32 bytes");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rl = await rateLimit(env, `gate:${ip}`, 30, 60);
  if (!rl.ok) {
    return json({ ok: false, code: "rate-limited", retryAfter: rl.retryAfter }, 429,
      { "retry-after": String(rl.retryAfter) });
  }

  const result = await cached(env, `gate:${address}`, 60, () => evaluate(address, env));
  return json({ ok: true, ...result }, 200, { "cache-control": "public, max-age=60" });
}
