import { json, bad } from "../../_lib/http.js";
import { kvProblem, originOf } from "../../_lib/config.js";
import { b58decode } from "../../_lib/b58.js";
import { verifyDetached } from "../../_lib/xeddsa.js";
import { sign, verify, cookie, readCookie } from "../../_lib/session.js";

// 第二道门：decent-auth。
//
// 网页端用 Phantom 只拿得到链上地址 —— 能查持仓，却联系不上人。Beagle 这一门
// 补的就是可达地址（Carrier address），于是「谁进来了」和「怎么找到他」才算齐。
// Beagle 那边确认过：userid ↔ 钱包没有现成的绑定机制，要我们自己做 ——
// 同一个 session 收两个签名，各用一个 nonce，绑定关系自己存。所以这里要求
// **先有钱包会话**：只有 Beagle 身份而没有钱包，持仓无从查起。
//
// 签名是 XEdDSA（Carrier 密钥是 X25519，公钥那一半就是 userid），不是 Ed25519。
// 验签实现在 _lib/xeddsa.js，零依赖，和官方 curve25519-js 逐例对拍过。
const PREFIX = "decent-auth";
const SESSION_TTL = 60 * 60 * 24 * 7;

// 文档的服务端示例里 sig 是 hex；而钱包门那条是 base58。两道门编码不同，
// 传错了只会静默验不过，所以两种都认 —— 长度和字符集足以区分，不存在歧义。
function decodeSig(sig) {
  if (typeof sig !== "string") return null;
  if (/^[0-9a-fA-F]{128}$/.test(sig)) {
    return Uint8Array.from(sig.match(/../g).map((b) => parseInt(b, 16)));
  }
  try {
    const b = b58decode(sig);
    return b.length === 64 ? b : null;
  } catch { return null; }
}

export async function onRequestPost({ request, env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  if (!env.SESSION_SECRET) return bad("not-configured", "SESSION_SECRET is missing", 503);

  const ORIGIN = originOf(request);
  if (!ORIGIN) return bad("bad-origin", `sign-in is not served on ${new URL(request.url).origin}`, 400);

  // 必须已经过了钱包门。没有钱包就没有持仓，这道门单独用没有意义。
  const token = readCookie(request);
  const current = token ? await verify(token, env.SESSION_SECRET) : null;
  if (!current || !current.wallet) {
    return bad("wallet-first", "connect a wallet before linking a Beagle identity", 401);
  }

  let body;
  try { body = await request.json(); } catch { return bad("bad-json", "body must be JSON"); }
  const { userid, nonce, sig } = body || {};
  if (!userid || !nonce || !sig) return bad("missing-fields", "userid, nonce and sig are required");

  const seen = await env.GOJI_KV.get(`nonce:${nonce}`);
  if (!seen) return bad("bad-nonce", "nonce unknown, already used, or expired", 401);
  await env.GOJI_KV.delete(`nonce:${nonce}`);

  let pub;
  try { pub = b58decode(userid); } catch { return bad("bad-encoding", "userid must be base58"); }
  if (pub.length !== 32) return bad("bad-userid", "userid must decode to 32 bytes");
  const sigBytes = decodeSig(sig);
  if (!sigBytes) return bad("bad-sig", "sig must be 64 bytes, hex or base58");

  const message = new TextEncoder().encode(`${PREFIX}\n${ORIGIN}\n${nonce}`);
  const ok = await verifyDetached(pub, message, sigBytes);
  if (!ok) return bad("bad-signature", "signature does not match userid over this origin and nonce", 401);

  // signIn 返回的 address 是 **Carrier 可达地址**（52 字符），不是链上钱包。
  // 它本身没有签名，但现在它和一个刚刚被证明的 userid 一起到达，
  // 所以作为「去哪找这个人」是可用的 —— 仍然不作为身份证明。
  const carrierAddress = typeof body.address === "string" ? body.address : null;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...current,
    decentUserid: userid,
    carrierAddress,
    name: typeof body.name === "string" ? body.name.slice(0, 64) : null,
    proven: Array.from(new Set([...(current.proven || []), "decent"])),
    iat: now,
    exp: now + SESSION_TTL,
  };
  const next = await sign(payload, env.SESSION_SECRET);

  const record = {
    t: new Date().toISOString(), wallet: current.wallet, nonce,
    door: "decent", decentUserid: userid, carrierAddress,
    name: payload.name, ua: request.headers.get("user-agent") || null,
  };
  try {
    await env.GOJI_KV.put(`auth:${record.t}:${nonce}`, JSON.stringify(record));
    // 绑定关系自己存，两个方向都存：按钱包找人，和按 Beagle 身份找钱包。
    await env.GOJI_KV.put(`bind:wallet:${current.wallet}`, JSON.stringify({ decentUserid: userid, carrierAddress, t: record.t }));
    await env.GOJI_KV.put(`bind:decent:${userid}`, JSON.stringify({ wallet: current.wallet, carrierAddress, t: record.t }));
  } catch { /* 记录失败不该把已经验过签的用户挡在外面 */ }

  return json({
    ok: true,
    wallet: current.wallet,
    decentUserid: userid,
    carrierAddress,
    proven: payload.proven,
    needsBeagleSignIn: !carrierAddress,
  }, 200, { "set-cookie": cookie(next, SESSION_TTL) });
}
