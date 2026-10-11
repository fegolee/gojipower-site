// 配置检查。GOJI_KV 必须是 KV 命名空间绑定，不是文本变量 ——
// 在面板的「Variables and secrets」里把它填成 Text 会让 env.GOJI_KV 变成一个字符串，
// 真值判断照样通过，然后在 .put() 处炸成 500。一个说不清原因的 500 比 503 难查得多，
// 所以这里按「有没有 get/put 方法」判，而不是按真值判。
export function kvProblem(env) {
  const kv = env && env.GOJI_KV;
  if (!kv) return "KV binding GOJI_KV is missing";
  if (typeof kv.get !== "function" || typeof kv.put !== "function")
    return "GOJI_KV is set but is not a KV namespace binding (looks like a plain text variable) — bind it under Bindings, not Variables and secrets";
  return null;
}

// origin 由服务端决定，绝不信 body 或 Origin 头里传来的 —— 两道门共用这一份。
// www 服务的是同一个站，漏掉它会让从 www 进来的人永远验不过。
export const ALLOWED_ORIGINS = new Set([
  "https://gojipower.xyz",
  "https://www.gojipower.xyz",
]);

export function originOf(request) {
  // Worker 里 request.url 的 host 由 Cloudflare 路由决定，请求方伪造不了。
  const o = new URL(request.url).origin;
  return ALLOWED_ORIGINS.has(o) ? o : null;
}

// 研报推送 Agent 的 Carrier 地址。写成常量而不是环境变量：它是公开信息
// （用户就是要把它加成好友），而且极少变——换身份本身就是件大事，值得一次部署。
// 常量还少一处可以配错的地方。
export const BRIEF_AGENT = {
  address: "Q5M2Hr7BtLHNz3GV5C3AEXwzBUyA4yaJfc1wJNepxDteG9tvXTaC",
  userid: "BVuiTvzuNTscma9uFZVy9auMb4doc64X6Qu5eaUNAzkU",
  name: "GojiPower Briefs",
};

// 从服务端存的绑定补齐会话里的 Beagle 身份。
//
// 只在钱包门做这件事是不够的：已经登录的人**刷新页面走的是 session 端点**，
// 读的是现有 cookie，里面本来就没有身份，于是刷新多少次都修不好 ——
// 实测就是这么卡住的。两个端点都要补。
//
// 补进来的是**我们自己在验过 XEdDSA 签名之后写下的记录**，不是客户端传的。
export async function hydrateBinding(env, wallet, have) {
  if (have && have.decentUserid && have.carrierAddress) return have;
  try {
    const raw = await env.GOJI_KV.get(`bind:wallet:${wallet}`);
    if (!raw) return have;
    const b = JSON.parse(raw);
    return {
      decentUserid: (have && have.decentUserid) || b.decentUserid || null,
      carrierAddress: (have && have.carrierAddress) || b.carrierAddress || null,
      restored: true,
    };
  } catch {
    return have;   // 读不到就维持现状，用户还可以手动走一次 Beagle 门
  }
}
