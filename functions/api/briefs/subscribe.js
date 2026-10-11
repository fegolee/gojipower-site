import { json, bad } from "../../_lib/http.js";
import { kvProblem, BRIEF_AGENT } from "../../_lib/config.js";
import { verify, readCookie } from "../../_lib/session.js";
import { evaluate } from "../../_lib/gate.js";

// 登记研报订阅。**要求两道门都过**，这是设计不是限制：
// 没有 carrierAddress 就没法把东西送到人手上，登记一个送不到的人没有意义。
export async function onRequestPost({ request, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  if (!env.SESSION_SECRET) return bad("not-configured", "SESSION_SECRET is missing", 503);

  const token = readCookie(request);
  const s = token ? await verify(token, env.SESSION_SECRET) : null;
  if (!s || !s.wallet) return bad("wallet-first", "sign in with a wallet first", 401);
  if (!s.decentUserid) return bad("beagle-first", "link a Beagle identity first — briefs are delivered over Carrier", 401);

  // 现在就复查一次，不信会话里那份可能已经过时的判定。
  const g = await evaluate(s.wallet, env);
  if (g.meets !== true) {
    return bad("below-threshold", g.meets === null
      ? "holdings could not be read just now — try again"
      : "this wallet does not meet the gate", 403);
  }

  const rec = {
    wallet: s.wallet,
    uiOrigin: s.uiOrigin || null,
    carrierAddress: s.carrierAddress || null,
    t: new Date().toISOString(),
  };
  // 键用 decentUserid：好友请求到达时我们只认得出这个。
  await env.GOJI_KV.put(`sub:briefs:${s.decentUserid}`, JSON.stringify(rec));

  // 把登录时那个 Beagle 的 origin 带回去，前端加好友时钉死用它。
  return json({ ok: true, agent: BRIEF_AGENT, subscribed: rec.t, uiOrigin: s.uiOrigin || null });
}
