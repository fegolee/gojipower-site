import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { requireAgent } from "../../_lib/agentauth.js";

// 名册只**列人**，不查链。
//
// 第一版对每个订阅者各跑一次求值，每次 3 个外呼 —— Workers 的子请求有上限，
// 十几个订阅者就会撞墙。而且那也不是「每次推送前复查」该有的形状：
// 复查是逐个收件人、在推送那一刻做的事。所以拆成两个端点，
// 这个只做 KV 列举（零外呼），复查走 /api/briefs/check/{userid}。
//
// **刻意不返回钱包地址。**「Beagle 身份 ↔ 钱包」才是真正敏感的连接：
// 一个 Solana 地址等于一份完整的链上财务史。token 万一泄漏，暴露的是
// 「谁订阅了」，不是任何人的链上身份。跑这个 Agent 的机器 2026-09-07
// 被入侵过且未重装 —— 能少放一样就少放一样。
export async function onRequestGet({ request, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  const denied = requireAgent(request, env);
  if (denied) return denied;

  const out = [];
  let cursor;
  do {
    const page = await env.GOJI_KV.list({ prefix: "sub:briefs:", cursor, limit: 1000 });
    for (const k of page.keys) {
      const userid = k.name.slice("sub:briefs:".length);
      let since = null;
      try { since = JSON.parse(await env.GOJI_KV.get(k.name)).t; } catch { /* 坏行就只给 userid */ }
      out.push({ userid, since });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  return json({ ok: true, count: out.length, roster: out, check: "/api/briefs/check/{userid}" });
}
