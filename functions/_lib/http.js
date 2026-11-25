export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const bad = (code, message, status = 400) => json({ ok: false, code, message }, status);

// 公开端点的 CORS。门槛判定是公开链上数据的封装，任何板块的页面都该能直接在
// 浏览器里读它 —— 不加这几个头，stocks 这样的子域只能从自己后端绕一趟。
//
// **只有不带 credentials 的端点可以用这个。** 会话类端点一个都不要加：
// ACAO:* 与 credentials 在浏览器里本来就互斥，所以配错的后果是请求失败，
// 不是悄悄放行 —— 但别指望这条兜底，`test/gate.mjs` 里有一条负向断言钉着。
export const PUBLIC_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
};

// 连错误响应一起加上：调用方读不到 400 的原因，就只能看见「失败了」。
export function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(PUBLIC_CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export const corsPreflight = () => new Response(null, { status: 204, headers: PUBLIC_CORS });
