import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { requireAgent } from "../../_lib/agentauth.js";
import { INDEX_KEY, KEEP, itemKey, ID_RE, str, lines, sources, postedTo, summary, readIndex }
  from "../../_lib/briefs.js";

// 把一期简报推到 /brief 这一页上。鉴权和名册那两条共用同一个 AGENT_TOKEN。
//
// 载荷的形状与清洗规则都在 _lib/briefs.js 的开头，包括四条裁决；
// 这里只做校验与落盘。两件只属于这个路由的事：
//
// **写入顺序是「先条目、后索引」。** 反过来的话，索引会短暂指向一个还不存在的
// 条目，列表就会出现一行点不开的简报。写完条目、索引写失败，则索引里仍是旧摘要
// （重发同 id 时是旧标题）—— 这一侧的失败只会少显示新东西，不会显示坏东西。
//
// **索引的读改写不是原子的。** KV 没有 CAS。推送是每天一期、一个推送方，
// 撞车的窗口是几毫秒，所以这里不做锁 —— 但把这句话写下来，省得以后有人
// 并发推一百期然后奇怪为什么少了几条。
export async function onRequestPost({ request, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  const denied = requireAgent(request, env);
  if (denied) return denied;

  let b;
  try { b = await request.json(); } catch { return bad("bad-json", "body must be JSON", 400); }
  if (!b || typeof b !== "object" || Array.isArray(b))
    return bad("bad-json", "body must be a JSON object", 400);

  // visibility 必填，刻意没有默认值（_lib/briefs.js 裁决 ③）。
  if (b.visibility !== "public" && b.visibility !== "gated")
    return bad("visibility-required",
      'visibility must be "public" or "gated" — there is no default. Whether a brief sits behind the gate is a product decision, not a code default. ' +
      'Use "gated" only if this text is not also being published somewhere open: a door that gates nothing is decoration.', 400);

  const title = str(b.title, 200);
  if (!title) return bad("bad-title", "title is required, 1-200 chars", 400);
  const titleZh = b.titleZh == null ? null : str(b.titleZh, 200);
  if (b.titleZh != null && !titleZh) return bad("bad-title", "titleZh, if sent, must be 1-200 chars", 400);

  const facts = lines(b.facts, 24, 4000);
  if (!facts || !facts.length)
    return bad("bad-facts", "facts is required: a string (split on blank lines) or an array of strings, max 24 items of 4000 chars", 400);
  const factsZh = b.factsZh == null ? null : lines(b.factsZh, 24, 4000);
  if (b.factsZh != null && !factsZh) return bad("bad-facts", "factsZh must be a string or an array of strings", 400);

  const reading = b.reading == null ? [] : lines(b.reading, 24, 4000);
  if (reading === null) return bad("bad-reading", "reading must be a string or an array of strings", 400);
  const readingZh = b.readingZh == null ? null : lines(b.readingZh, 24, 4000);
  if (b.readingZh != null && !readingZh) return bad("bad-reading", "readingZh must be a string or an array of strings", 400);

  const src = sources(b.sources);
  if (src === null) return bad("bad-sources", "sources must be an array of {label?, url} with http(s) urls, max 12", 400);
  const posted = postedTo(b.alsoPostedTo);
  if (posted === null) return bad("bad-posted", "alsoPostedTo must be an array of up to 8 short plain names", 400);

  const covers = b.covers == null ? null : str(b.covers, 120);
  if (b.covers != null && !covers) return bad("bad-covers", "covers, if sent, must be 1-120 chars", 400);

  const at = new Date().toISOString();

  let idx;
  try { idx = await readIndex(env); }
  catch (e) { return bad("index-unreadable", "the brief index could not be read: " + String(e.message || e).slice(0, 160), 503); }

  // id 显式传就按它来（重发同 id = 就地更正，这是特性：错了能改）。
  // 不传就按收到的日期，同一天第二期加 -2、-3……
  let id = b.id == null ? null : str(b.id, 64);
  if (b.id != null && (!id || !ID_RE.test(id)))
    return bad("bad-id", "id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}", 400);
  if (!id) {
    const day = at.slice(0, 10);
    id = day;
    for (let n = 2; n <= 20 && idx.some((x) => x && x.id === id); n++) id = day + "-" + n;
  }

  const rec = {
    id, visibility: b.visibility, title, titleZh,
    facts, factsZh, reading, readingZh,
    sources: src, alsoPostedTo: posted, covers, at,
  };

  await env.GOJI_KV.put(itemKey(id), JSON.stringify(rec));

  const s = summary(rec);
  const was = idx.findIndex((x) => x && x.id === id);
  if (was >= 0) idx[was] = s; else idx.unshift(s);
  idx.sort((a, b2) => String(b2.at || "").localeCompare(String(a.at || "")));
  const kept = idx.slice(0, KEEP), evicted = idx.slice(KEEP);
  await env.GOJI_KV.put(INDEX_KEY, JSON.stringify(kept));
  // 被挤出索引的条目一起删掉：留着就是永远读不到的 KV 垃圾。
  for (const e of evicted) { try { await env.GOJI_KV.delete(itemKey(e.id)); } catch { /* 下次再清 */ } }

  return json({
    ok: true, id, visibility: rec.visibility, at,
    replaced: was >= 0, count: kept.length, evicted: evicted.length,
    page: "https://gojipower.xyz/brief",
  });
}
