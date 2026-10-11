import { json } from "../../_lib/http.js";
import { verify, readCookie } from "../../_lib/session.js";
import { BRIEF_AGENT, hydrateBinding } from "../../_lib/config.js";
import { evaluate } from "../../_lib/gate.js";

// 重开面板时要能看到和登录当时同样的内容。先前这里只回会话字段、不读链，
// 于是已登录状态下再打开面板，余额和 NFT 会显示成 unknown ——
// 那不是「查不到」，是「根本没查」，而面板分不出这两者。
export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) return json({ ok: false, signedIn: false, reason: "not-configured" }, 503);
  const token = readCookie(request);
  const payload = token ? await verify(token, env.SESSION_SECRET) : null;
  if (!payload) return json({ ok: true, signedIn: false });

  // 和 /api/gate、钱包门共用同一份求值 —— 面板看到的和第三方查到的必须是同一个答案。
  // 刷新页面走的就是这里。cookie 里没有 Beagle 身份时去读绑定补上，
  // 否则已经登录的人永远卡在「补上 Beagle 登录」。
  const bound = await hydrateBinding(env, payload.wallet, {
    decentUserid: payload.decentUserid, carrierAddress: payload.carrierAddress,
  });
  const restored = !!(bound && bound.restored);
  const decentUserid = (bound && bound.decentUserid) || null;
  const carrierAddress = (bound && bound.carrierAddress) || null;
  const uiOriginV = (bound && bound.uiOrigin) || null;
  const proven = decentUserid ? ["wallet", "decent"] : (payload.proven || ["wallet"]);

  const g = await evaluate(payload.wallet, env);

  let subscribedAt = null;
  if (decentUserid) {
    try {
      const r = await env.GOJI_KV.get(`sub:briefs:${decentUserid}`);
      if (r) subscribedAt = JSON.parse(r).t;
    } catch { /* 读不到就当未订阅，面板会显示订阅按钮 */ }
  }

  return json({
    ok: true, signedIn: true,
    wallet: payload.wallet,
    decentUserid,
    carrierAddress,
    uiOrigin: uiOriginV,
    proven,
    expiresAt: payload.exp,
    needsBeagleSignIn: !carrierAddress,
    // 持仓是**此刻**重新读的，不是登录那一刻的快照 —— 持仓会变，
    // 把旧数字当现状展示正是这个站反对的事。
    balance: g.balance,
    priceUsd: g.priceUsd,
    usd: g.usd,
    threshold: g.thresholdUsd,
    meets: g.meets,
    by: g.by,
    nft: g.nft,
    readFailed: g.readFailed,
    briefs: { subscribedAt, agent: BRIEF_AGENT },
  });
}
