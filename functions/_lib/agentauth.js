import { bad } from "./http.js";

// 本地推送 Agent 的鉴权。常数时间比较：长度先异或进去，再逐字节累加，
// 不提前返回 —— 用 === 比较会按字符逐位短路，泄漏前缀信息。
export function requireAgent(request, env) {
  if (!env.AGENT_TOKEN) return bad("not-configured", "AGENT_TOKEN is missing", 503);
  const auth = request.headers.get("authorization") || "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(env.AGENT_TOKEN);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0 ? null : bad("unauthorized", "bad or missing bearer token", 401);
}
