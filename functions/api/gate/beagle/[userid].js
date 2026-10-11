import { json, bad } from "../../../_lib/http.js";
import { kvProblem } from "../../../_lib/config.js";
import { b58decode } from "../../../_lib/b58.js";
import { evaluate } from "../../../_lib/gate.js";
import { rateLimit, cached } from "../../../_lib/throttle.js";

// 按 **Beagle 身份** 求门槛，而不是按钱包地址。
//
// 为什么要有这一个：门槛长在链上（钱包里有没有货），而会用到门槛的地方
// 握着的是 Carrier userid —— Beagle Meet 的 registerRoomGate(ctx) 拿到的是
// `ctx.userid` 与 profile，它那一侧**没有钱包这个字段**（账户页只有
// Session userid / Beagle userid / Carrier address / Punk）。
// 这中间缺的一跳只有我们有：两道门在同一个会话里各收一个签名之后写下的
// `bind:decent:<userid>` —— 不是用户自报，是钱包的 Ed25519 和 Carrier 的
// XEdDSA 两个签名共同见证的。
//
// 公开、不鉴权，和 /api/gate/{address} 一样。这是刻意的：要求调用方持 token
// 就等于我们要发 token、要管调用方 —— 那就又变成一套账号系统，正是这整件事
// 想删掉的那一层。
//
// **但响应里绝不出现钱包地址。** 「这个 Beagle 身份达标」是用户自己要出示的
// 凭证；「他是哪个钱包」不是。所以 balance / usd / priceUsd / 资产 id 全部不出 ——
// Core 资产的持有人可以免费反查，带上资产 id 就等于带上了钱包。
export async function onRequestGet({ request, params, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);

  const userid = params.userid;
  // userid 是 Carrier 的 X25519 公钥，base58 32 字节。先验格式：垃圾输入不该
  // 走到 KV，更不该走到链上。
  let raw;
  try { raw = b58decode(userid); } catch { return bad("bad-userid", "userid must be base58"); }
  if (raw.length !== 32) return bad("bad-userid", "userid must decode to 32 bytes");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  // 比按地址那条宽一些：真正花钱的是**不同钱包**的链上读取，而那一层已经由
  // 60 秒缓存按钱包合并了；同一个 userid 被反复问几乎是零成本。
  const rl = await rateLimit(env, `gateb:${ip}`, 60, 60);
  if (!rl.ok) {
    return json({ ok: false, code: "rate-limited", retryAfter: rl.retryAfter }, 429,
      { "retry-after": String(rl.retryAfter) });
  }

  let bind = null;
  try { bind = JSON.parse(await env.GOJI_KV.get(`bind:decent:${userid}`)); } catch { bind = null; }

  if (!bind || !bind.wallet) {
    // 「没绑过」不是「读不到」—— 这是一个确定的答案，而且有确定的补救办法，
    // 所以给 false 加一条链接，而不是给 null。
    return json({
      ok: true, userid, bound: false, meets: false, code: "not-bound",
      gate: {
        ok: false, code: "not-bound",
        error: "Connect a wallet at gojipower.xyz to use this Beagle identity",
      },
      link: "https://gojipower.xyz/",
      asOf: new Date().toISOString(),
      note: NOTE,
    }, 200, { "cache-control": "public, max-age=15" });
  }

  // 缓存键按**钱包**，和 /api/gate/{address} 共用一份 —— 同一个钱包上的多个
  // Beagle 身份不会各打一遍链。
  const g = await cached(env, `gate:${bind.wallet}`, 60, () => evaluate(bind.wallet, env));

  // meets === null 是「这一刻读不到」。**我们不替别人决定这时该放还是该挡** ——
  // 失败时开还是关是那道门自己的策略，不是我们的。所以这种情况不给 gate，
  // 由调用方按自己的风险取舍处理。
  const gate = g.meets === true
    ? { ok: true }
    : g.meets === false
      ? { ok: false, code: "below-threshold", error: "Holding below the GOJIPOWER threshold" }
      : null;

  return json({
    ok: true,
    userid,
    bound: true,
    meets: g.meets,
    by: g.by,                  // 哪一条过的。够用来显示「凭 NFT 进入」，又不含数额
    thresholdUsd: g.thresholdUsd,
    gate,
    readFailed: g.readFailed || null,
    boundAt: bind.t || null,
    asOf: g.asOf,
    cached: g.cached,
    note: NOTE,
  }, 200, { "cache-control": "public, max-age=60" });
}

const NOTE =
  "Answers one question about a Beagle identity: does the wallet it proved at gojipower.xyz " +
  "meet the published threshold (GET /api/gate). No wallet address, balance or asset id is " +
  "returned — that link is the user's, not ours. meets:null means the chain read failed just " +
  "now; it is not a denial, and whether to fail open or closed is the caller's policy, not ours.";
