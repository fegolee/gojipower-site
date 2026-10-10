import { json } from "../../_lib/http.js";
import { verify, readCookie } from "../../_lib/session.js";
import { tokenBalance, holdsGenesisNft, priceUsd } from "../../_lib/solana.js";

// 重开面板时要能看到和登录当时同样的内容。先前这里只回会话字段、不读链，
// 于是已登录状态下再打开面板，余额和 NFT 会显示成 unknown ——
// 那不是「查不到」，是「根本没查」，而面板分不出这两者。
export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) return json({ ok: false, signedIn: false, reason: "not-configured" }, 503);
  const token = readCookie(request);
  const payload = token ? await verify(token, env.SESSION_SECRET) : null;
  if (!payload) return json({ ok: true, signedIn: false });

  const settled = await Promise.allSettled([
    tokenBalance(payload.wallet, env),
    holdsGenesisNft(payload.wallet, env),
    priceUsd(),
  ]);
  const [bRes, nRes, pRes] = settled;
  const balance = bRes.status === "fulfilled" ? bRes.value : null;
  const nft = nRes.status === "fulfilled" ? nRes.value : { held: null, reason: "read-failed" };
  const price = pRes.status === "fulfilled" ? pRes.value : null;
  const readFailed = settled
    .map((r, i) => (r.status === "rejected"
      ? { read: ["balance", "nft", "price"][i], error: String((r.reason && r.reason.message) || r.reason).slice(0, 160) }
      : null))
    .filter(Boolean);

  const usd = balance && price != null ? balance.amount * price : null;
  const minUsd = env.GATE_MIN_USD ? Number(env.GATE_MIN_USD) : null;

  return json({
    ok: true, signedIn: true,
    wallet: payload.wallet,
    decentUserid: payload.decentUserid,
    carrierAddress: payload.carrierAddress,
    proven: payload.proven,
    expiresAt: payload.exp,
    needsBeagleSignIn: !payload.carrierAddress,
    // 持仓是**此刻**重新读的，不是登录那一刻的快照 —— 持仓会变，
    // 把旧数字当现状展示正是这个站反对的事。
    balance: balance ? balance.amount : null,
    priceUsd: price,
    usd,
    threshold: minUsd,
    meets: minUsd == null || usd == null ? null : usd >= minUsd,
    nft,
    readFailed: readFailed.length ? readFailed : null,
  });
}
