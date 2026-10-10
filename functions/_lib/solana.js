import { deriveAta } from "./ata.js";

// 从 Worker 里实测（2026-10-10，/api/diag/rpc）：
//   api.mainnet-beta.solana.com  403  "Your IP or provider is blocked from this endpoint"
//   solana-rpc.publicnode.com    200  可用，约 220ms        ← 唯一能用的
//   drpc 400（免费不含此链）/ ankr 403（要 key）/ onfinality 429 / omniatech 429
// 所以 publicnode 排第一。SOLANA_RPC 环境变量可以覆盖（例如将来上 Helius）。
const DEFAULT_RPCS = ["https://solana-rpc.publicnode.com"];

export const MINT = "DYCLLejhtfyCDUY8ygBx7YuwfcdaRzLo7nHHVGdApump";
export const COLLECTION = "5znqnBGEnEFJB11YsAVN85uPShfu6vXd5Egx9GKoTo58";

function endpoints(env) {
  return env && env.SOLANA_RPC ? [env.SOLANA_RPC, ...DEFAULT_RPCS] : DEFAULT_RPCS;
}

async function rpc(method, params, urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      // 「拿到了一个 JSON」和「拿到了答案」是两件事：403 与 -32602 的响应体一样能解析。
      if (!j || j.result === undefined) { lastErr = new Error(j?.error?.message || `${url}: no result`); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}

// 读余额。不用 getTokenAccountsByOwner —— publicnode 把按 owner 索引的方法列为付费
// （"Indexed requests require a personal token"）。改为自己推导 ATA 再 getAccountInfo，
// 后者免费且返回同一个数。换的是方法，不是端点。
//
// 局限，写出来而不是藏着：只看关联代币账户。如果有人把币放在非 ATA 的代币账户里，
// 这里会读成 0。对门控来说这是保守方向（误拒而非误放），但它是个真实的误拒。
export async function tokenBalance(address, env) {
  const { address: ata } = await deriveAta(address, MINT);
  const res = await rpc("getAccountInfo", [ata, { encoding: "jsonParsed" }], endpoints(env));
  // value === null 是「这个账户不存在」，也就是确确实实持有 0 —— 这跟「读取失败」不同，
  // 后者会从 rpc() 抛出去。「查不到」和「不存在」必须分开。
  if (!res || res.value === null) return { amount: 0, ata, exists: false };
  const info = res.value?.data?.parsed?.info;
  const amt = info?.tokenAmount?.uiAmount;
  if (info?.mint !== MINT) throw new Error("ata holds a different mint");
  return { amount: typeof amt === "number" ? amt : 0, ata, exists: true };
}

// Genesis NFT 是 Metaplex Core 资产，不是 SPL token，按 owner 列出来需要 DAS 索引，
// 公共 RPC 不提供。没有 DAS_RPC 时返回 held: null 而不是 false ——
// 「查不到」不等于「没有」。
export async function holdsGenesisNft(address, env) {
  const das = env && env.DAS_RPC;
  if (!das) return { held: null, reason: "no-das-endpoint" };
  // DAS 的 params 是**对象**，不是数组 —— 普通 JSON-RPC 方法是数组，这一族不是。
  const res = await rpc("getAssetsByOwner", { ownerAddress: address, page: 1, limit: 1000 }, [das]);
  const items = (res && res.items) || [];
  const mine = items.filter((it) => {
    if ((it?.grouping || []).some((g) => g.group_key === "collection" && g.group_value === COLLECTION)) return true;
    // 不同索引器对 Core 资产的字段不完全一致，留一条回退，但只认明确等于本集合的。
    return it?.collection === COLLECTION || it?.collection?.key === COLLECTION;
  });
  // 带上资产地址：Core 资产的持有人可以用免费的 getAccountInfo 单独复核，
  // 所以这个答案是可以被独立验证的，不必只靠索引器自己说。
  return { held: mine.length > 0, count: mine.length, assets: mine.map((a) => a.id).slice(0, 10) };
}

export async function priceUsd() {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, {
    headers: { "user-agent": "gojipower-site/1.0" },
  });
  const j = await r.json();
  const p = j?.pairs?.[0]?.priceUsd;
  return p ? Number(p) : null;
}
