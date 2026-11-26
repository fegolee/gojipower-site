import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { verify, readCookie } from "../../_lib/session.js";
import { evaluate } from "../../_lib/gate.js";
import { cached } from "../../_lib/throttle.js";
import { readIndex, itemKey, KEEP } from "../../_lib/briefs.js";

// /brief 这一页读的就是这里。
//
// **这条端点不加 CORS**，和所有会话端点一样 —— 它要读 cookie 才能判开不开锁，
// 而 ACAO:* 与 credentials 在浏览器里本来就互斥。门槛本身是公开的，
// 想在别的 origin 上读门槛请用 /api/gate，那条才是对外契约。
//
// **我们就是这道门，所以 meets === null 必须落到「锁着」。**
// /api/gate/beagle/{userid} 刻意在读不到时不给判定 —— 那是**替别人的门**做决定，
// 不该替。这里相反：判不出来还放行，等于门不设防。
// 但 reason 要说清是「读不到」而不是「不够」，否则页面会告诉一个合格的人
// 他不合格 —— 一次 RPC 抖动不该变成一句假话。
export async function onRequestGet({ request, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);

  const u = new URL(request.url);
  const want = Number(u.searchParams.get("limit"));
  const limit = Math.min(Math.max(Number.isFinite(want) && want > 0 ? Math.floor(want) : 10, 1), 30);

  let unlocked = false, reason = "no-session", asOf = null;
  const token = readCookie(request);
  const s = token && env.SESSION_SECRET ? await verify(token, env.SESSION_SECRET) : null;
  if (s && s.wallet) {
    const g = await cached(env, "gate:" + s.wallet, 60, () => evaluate(s.wallet, env));
    asOf = g.asOf || null;
    if (g.meets === true) { unlocked = true; reason = null; }
    else reason = g.meets === null ? "holdings-unreadable" : "below-threshold";
  }

  let idx;
  try { idx = await readIndex(env); }
  catch (e) {
    // 「读不到」不是「还没有简报」。这里报 503，页面标灰显示实时读取失败。
    return bad("index-unreadable", "the brief index could not be read: " + String(e.message || e).slice(0, 160), 503);
  }

  const items = [];
  for (const sum of idx.slice(0, limit)) {
    if (!sum || !sum.id) continue;
    if (!(sum.visibility === "public" || unlocked)) { items.push({ ...sum, locked: true }); continue; }
    let rec = null;
    try { rec = JSON.parse(await env.GOJI_KV.get(itemKey(sum.id))); } catch { /* 下面按 unreadable 报 */ }
    if (!rec) { items.push({ ...sum, locked: false, unreadable: true }); continue; }
    items.push({
      ...sum, locked: false,
      facts: rec.facts,
      reading: rec.reading || [],
      sources: rec.sources || [],
    });
  }

  return json({
    ok: true,
    // keeps 跟着响应走，页面照着显示 —— 写死在 HTML 里的「60」会自己变旧，
    // 而本站已经为这个栽过一次（首屏的实盘天数写死了 190，实际 244）。
    total: idx.length, returned: items.length, keeps: KEEP,
    unlocked, reason,
    thresholdUsd: env.GATE_MIN_USD ? Number(env.GATE_MIN_USD) : null,
    asOf,
    items,
    note: "Facts and reading are stored as separate fields, and the reading carries no predictive weight. " +
          "Each brief states its own visibility: a public one is open to everyone, a gated one needs the gate at /api/gate. " +
          "One brief is one language; two independently written versions are two briefs, not a translation pair. " +
          "A source without a url is a source that has no page to link, not an unverified one.",
  });
}
