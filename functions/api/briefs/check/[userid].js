import { json, bad } from "../../../_lib/http.js";
import { kvProblem } from "../../../_lib/config.js";
import { requireAgent } from "../../../_lib/agentauth.js";
import { evaluate } from "../../../_lib/gate.js";
import { cached } from "../../../_lib/throttle.js";

// 推送前复查一个订阅者。一次调用一个人 —— 这样子请求数是常数，
// 订阅者再多也不会撞 Workers 的上限。
export async function onRequestGet({ request, params, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  const denied = requireAgent(request, env);
  if (denied) return denied;

  const userid = params.userid;
  let rec;
  try { rec = JSON.parse(await env.GOJI_KV.get(`sub:briefs:${userid}`)); } catch { rec = null; }
  if (!rec || !rec.wallet) return json({ ok: true, userid, subscribed: false, meets: null });

  const g = await cached(env, `gate:${rec.wallet}`, 60, () => evaluate(rec.wallet, env));
  // meets 为 null 是「这一刻读不到」，不是「不达标」—— Agent 应当**跳过**而不是拒绝，
  // 否则一次 RPC 抖动就会把合格的人踢出这一轮推送。
  return json({
    ok: true, userid, subscribed: true,
    meets: g.meets, by: g.by, asOf: g.asOf, cached: g.cached,
    since: rec.t,
  });
}
