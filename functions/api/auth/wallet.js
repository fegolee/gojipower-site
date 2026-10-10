import { json, bad } from "../../_lib/http.js";
import { b58decode } from "../../_lib/b58.js";
import { sign, cookie } from "../../_lib/session.js";
import { tokenBalance, holdsGenesisNft, priceUsd } from "../../_lib/solana.js";

// 钱包门。契约不是从文档抄的 —— 文档没写全，这是 2026-10-10 向 Beagle 那边
// 核对服务端实现后确认的：
//   · 消息是 UTF-8 的 "beagle-meet-wallet\n{origin}\n{nonce}"
//   · Solana 用标准 Ed25519；address 是 base58 公钥，sig 是 base58 的 64 字节（不是 hex）
//   · 字段名是 sig，不是文档里写的 signature；walletType 必填
//   · 响应里的 userid 是链上钱包，Beagle 身份在 decentUserid
//   · decentUserid / carrierAddress 只是客户端自带的未签名回显，永远不作为证明
const PREFIX = "beagle-meet-wallet";

// origin 在服务端写死，绝不信 body 里传来的那个。
// 这是对方主动提醒的一条，也是他们文档里说的「最常见的集成 bug」的另一面。
const ORIGIN = "https://gojipower.xyz";

const SESSION_TTL = 60 * 60 * 24 * 7;

export async function onRequestPost({ request, env }) {
  if (!env.GOJI_KV) return bad("not-configured", "KV binding GOJI_KV is missing", 503);
  if (!env.SESSION_SECRET) return bad("not-configured", "SESSION_SECRET is missing", 503);

  let body;
  try { body = await request.json(); } catch { return bad("bad-json", "body must be JSON"); }

  const { walletType, address, nonce, sig } = body || {};
  if (walletType !== "solana") {
    // 以太坊走的是 personal_sign / EIP-191，要 secp256k1 恢复，WebCrypto 不支持，
    // 而且 GOJIPOWER 与 Genesis NFT 都在 Solana 上 —— 一个以太坊钱包本来也满足不了门槛。
    // 与其半实现，不如明确拒绝。
    return bad("unsupported-wallet", "only walletType \"solana\" is accepted here", 400);
  }
  if (!address || !nonce || !sig) return bad("missing-fields", "address, nonce and sig are required");

  // nonce：先取再删，单次使用。KV 没有原子 CAS，所以并发重放理论上有极窄的窗口；
  // 窗口内两次请求最多各建一个等价会话，不会越权，而登录记录按 nonce 去重。
  const seen = await env.GOJI_KV.get(`nonce:${nonce}`);
  if (!seen) return bad("bad-nonce", "nonce unknown, already used, or expired", 401);
  await env.GOJI_KV.delete(`nonce:${nonce}`);

  let pub, sigBytes;
  try {
    pub = b58decode(address);
    sigBytes = b58decode(sig);
  } catch { return bad("bad-encoding", "address and sig must be base58"); }
  if (pub.length !== 32) return bad("bad-address", "address must decode to 32 bytes");
  if (sigBytes.length !== 64) return bad("bad-sig", "sig must decode to 64 bytes");

  const message = new TextEncoder().encode(`${PREFIX}\n${ORIGIN}\n${nonce}`);
  let ok = false;
  try {
    const k = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "Ed25519" }, k, sigBytes, message);
  } catch { return bad("verify-error", "signature could not be checked", 400); }
  if (!ok) return bad("bad-signature", "signature does not match address over this origin and nonce", 401);

  // 到这里：这个钱包的控制权已经证明。下面查它持有什么 —— 这一半是我们自己的事，
  // 对方文档也是这么说的：gate on what you can look up yourself on-chain.
  let balance = null, nft = { held: null, reason: "not-checked" }, price = null, readFailed = false;
  try {
    const [b, n, p] = await Promise.all([
      tokenBalance(address),
      holdsGenesisNft(address, env.DAS_RPC),
      priceUsd(),
    ]);
    balance = b; nft = n; price = p;
  } catch { readFailed = true; }

  const usd = balance && price != null ? balance.amount * price : null;
  // 门槛数值来自环境变量，刻意没有默认值：
  // 05 号预注册把它冻结为 $25 等值，且「不得中途调整」—— 那是产品决定，不是代码默认值。
  const minUsd = env.GATE_MIN_USD ? Number(env.GATE_MIN_USD) : null;
  const meets = minUsd == null || usd == null ? null : usd >= minUsd;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    wallet: address,
    // 未签名的回显字段：存下来是为了以后能联系到人，但绝不当作身份证明。
    decentUserid: typeof body.decentUserid === "string" ? body.decentUserid : (typeof body.userid === "string" ? body.userid : null),
    carrierAddress: typeof body.carrierAddress === "string" ? body.carrierAddress : null,
    proven: ["wallet"],
    iat: now,
    exp: now + SESSION_TTL,
  };
  const token = await sign(payload, env.SESSION_SECRET);

  // 登录记录。这张网按「至少一次」投递，所以写入要幂等 ——
  // 键里带 nonce，同一次登录重放多少遍也只落一条。
  const record = {
    t: new Date().toISOString(), wallet: address, nonce,
    door: "wallet", walletType,
    decentUserid: payload.decentUserid, carrierAddress: payload.carrierAddress,
    balance: balance?.amount ?? null, usd, meets,
    nft: nft.held, ua: request.headers.get("user-agent") || null,
    cf: request.headers.get("cf-ipcountry") || null,
  };
  try {
    await env.GOJI_KV.put(`auth:${record.t}:${nonce}`, JSON.stringify(record));
    await env.GOJI_KV.put(`wallet:${address}`, JSON.stringify({ lastSeen: record.t, lastBalance: record.balance }));
  } catch { /* 记录失败不应该把已经验过签的用户挡在门外 */ }

  return json({
    ok: true,
    wallet: address,
    decentUserid: payload.decentUserid,
    carrierAddress: payload.carrierAddress,
    balance: balance?.amount ?? null,
    priceUsd: price,
    usd,
    threshold: minUsd,
    meets,
    nft,
    readFailed,
    // 网页端用 Phantom 只会有 address，拿不到可达地址；要能联系到人还得补一次
    // decent-auth。Beagle 的 iOS/Android 走钱包门时自带这两个字段，一个门就够。
    needsBeagleSignIn: !payload.carrierAddress,
  }, 200, { "set-cookie": cookie(token, SESSION_TTL) });
}
