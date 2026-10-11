import { tokenBalance, holdsGenesisNft, priceUsd, MINT, COLLECTION } from "./solana.js";

// 门槛的单一定义点。网页门控和对外契约端点都走这里 ——
// 两处各算一遍迟早会算出两个不同的答案。
//
// 阈值读 GATE_MIN_USD，**不写死**：$25 是 05 号预注册冻结的产品决定，
// 改它要走那份文件第七节的修订日志，不能散落在代码里。
export const gateSpec = (env) => ({
  mint: MINT,
  collection: COLLECTION,
  thresholdUsd: env.GATE_MIN_USD ? Number(env.GATE_MIN_USD) : null,
  rules: [
    { id: "token", test: "USD value of GOJIPOWER held >= thresholdUsd" },
    { id: "nft", test: `owns >= 1 Metaplex Core asset in collection ${COLLECTION}` },
  ],
  combine: "any",
  // 调用方应当知道这件事，所以写在响应里而不是只写在文档里。
  note: "Public chain data. Anyone can read the same chain and get the same answer; " +
        "this endpoint only saves implementing it. The chain is the source of truth, not us.",
});

// 对一个地址求值。三个读取互不拖累，失败的那个报出来是哪一个 ——
// 「查不到」和「不满足」必须分得开，前者是 null，后者是 false。
export async function evaluate(address, env) {
  const settled = await Promise.allSettled([
    tokenBalance(address, env),
    holdsGenesisNft(address, env),
    priceUsd(),
  ]);
  const [b, n, p] = settled;
  const balance = b.status === "fulfilled" ? b.value : null;
  const nft = n.status === "fulfilled" ? n.value : { held: null, reason: "read-failed" };
  const price = p.status === "fulfilled" ? p.value : null;
  const readFailed = settled
    .map((r, i) => (r.status === "rejected"
      ? { read: ["balance", "nft", "price"][i], error: String((r.reason && r.reason.message) || r.reason).slice(0, 160) }
      : null))
    .filter(Boolean);

  const usd = balance && price != null ? balance.amount * price : null;
  const minUsd = env.GATE_MIN_USD ? Number(env.GATE_MIN_USD) : null;
  const byToken = minUsd == null || usd == null ? null : usd >= minUsd;
  const byNft = nft.held;

  // 任一条满足即可。但只有在**两条都确定不满足**时才敢说 false ——
  // 有一条读不到就是 null（未判定），不是拒绝。
  let meets;
  if (byToken === true || byNft === true) meets = true;
  else if (byToken === false && byNft === false) meets = false;
  else meets = null;

  return {
    address,
    meets,
    by: { token: byToken, nft: byNft },
    balance: balance ? balance.amount : null,
    exists: balance ? balance.exists : null,
    priceUsd: price,
    usd,
    thresholdUsd: minUsd,
    nft,
    readFailed: readFailed.length ? readFailed : null,
    asOf: new Date().toISOString(),
  };
}
