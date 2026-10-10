// 链上读取。注意这是在 Worker 里跑，不是浏览器 ——
// CLAUDE.md 里记的「api.mainnet-beta 对站点 origin 返回 403」只发生在浏览器，
// 服务端请求正常。但 publicnode 会对受限方法返回 {"result":[]} 加 HTTP 200，
// 那是个「自信的错误事实」，所以这里按顺序试、并且只认有 result 的响应。
const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

export const MINT = "DYCLLejhtfyCDUY8ygBx7YuwfcdaRzLo7nHHVGdApump";
export const COLLECTION = "5znqnBGEnEFJB11YsAVN85uPShfu6vXd5Egx9GKoTo58";

async function rpc(method, params, endpoints = RPCS) {
  let lastErr;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      // 「拿到了一个 JSON」和「拿到了答案」是两件事：403 的响应体一样能解析
      if (!j || j.result === undefined) { lastErr = new Error(`${url}: no result`); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}

// 某个钱包持有多少 GOJIPOWER。一个 owner 可能有多个 token account，要加总。
export async function tokenBalance(owner) {
  const res = await rpc("getTokenAccountsByOwner", [owner, { mint: MINT }, { encoding: "jsonParsed" }]);
  const accounts = (res && res.value) || [];
  let total = 0;
  for (const a of accounts) {
    const amt = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof amt === "number") total += amt;
  }
  return { amount: total, accounts: accounts.length };
}

// Genesis NFT 是 Metaplex Core 资产，不是 SPL token —— getTokenAccountsByOwner 看不见它。
// 要列出某个钱包持有的 Core 资产需要 DAS 索引（getAssetsByOwner），公共 RPC 不提供。
// 所以这一条在配置了 DAS_RPC 之前是「未知」，而不是「没有」：
// 「查不到」和「不存在」是两件事，不能把前者当后者返回。
export async function holdsGenesisNft(owner, dasRpc) {
  if (!dasRpc) return { held: null, reason: "no-das-endpoint" };
  try {
    const res = await rpc("getAssetsByOwner", [{ ownerAddress: owner, page: 1, limit: 1000 }], [dasRpc]);
    const items = (res && res.items) || [];
    const n = items.filter((it) => {
      const g = it?.grouping || [];
      return g.some((x) => x.group_key === "collection" && x.group_value === COLLECTION);
    }).length;
    return { held: n > 0, count: n };
  } catch (e) {
    return { held: null, reason: "das-read-failed" };
  }
}

// 代币的美元价格。门槛是以美元计的（05 号预注册冻结为 $25 等值），
// 所以要价格才能判定；取不到价格时返回 null，由调用方决定怎么表述。
export async function priceUsd() {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, {
      headers: { "user-agent": "gojipower-site/1.0" },
    });
    const j = await r.json();
    const p = j?.pairs?.[0]?.priceUsd;
    return p ? Number(p) : null;
  } catch { return null; }
}
