// KV 没有原子自增，所以这是一个**近似**的固定窗口计数器：
// 高并发下同一秒的几个请求可能读到同一个旧值，实际放行量会略高于 limit。
// 这里要挡的是「有人拿公开端点当爬虫打爆 Helius 配额」，不是精确配额分配，
// 近似够用 —— 但不要把它当成安全控制，所以写在这里而不是假装它精确。
export async function rateLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  let n = 0;
  try { n = Number((await env.GOJI_KV.get(k)) || 0); } catch { return { ok: true, approximate: true }; }
  if (n >= limit) return { ok: false, retryAfter: windowSec - (Math.floor(Date.now() / 1000) % windowSec) };
  try { await env.GOJI_KV.put(k, String(n + 1), { expirationTtl: windowSec * 2 }); } catch { /* 记不上就放行 */ }
  return { ok: true };
}

// 按地址缓存求值结果。持仓变化是分钟级的事，60 秒的陈旧度换掉绝大部分重复链上读取。
// 每条结果自带 asOf，所以调用方永远知道自己拿到的是什么时候的数。
export async function cached(env, key, ttlSec, fn) {
  const k = `cache:${key}`;
  try {
    const hit = await env.GOJI_KV.get(k);
    if (hit) return { ...JSON.parse(hit), cached: true };
  } catch { /* 缓存读不到就直接算 */ }
  const fresh = await fn();
  // 读取失败的结果不缓存 —— 否则一次抖动会被钉住 60 秒。
  if (!fresh.readFailed) {
    try { await env.GOJI_KV.put(k, JSON.stringify(fresh), { expirationTtl: ttlSec }); } catch { /* 忽略 */ }
  }
  return { ...fresh, cached: false };
}
