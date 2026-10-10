import { json } from "../../_lib/http.js";

// 临时诊断：从 Worker 里逐个试 Solana RPC，看哪个真的能用。
// 本地 node 能读通不代表 Worker 能 —— 公共 RPC 普遍封云厂商出口 IP，
// 这正是「本地过了、线上空值」那一类差异，只能实测。
const CANDIDATES = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://rpc.ankr.com/solana",
  "https://solana.api.onfinality.io/public",
  "https://endpoints.omniatech.io/v1/sol/mainnet/public",
];
const MINT = "DYCLLejhtfyCDUY8ygBx7YuwfcdaRzLo7nHHVGdApump";

export async function onRequestGet({ env }) {
  const list = env.SOLANA_RPC ? [env.SOLANA_RPC, ...CANDIDATES] : CANDIDATES;
  const out = [];
  for (const url of list) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [MINT, { encoding: "jsonParsed" }] }),
      });
      const text = await r.text();
      let hasResult = false, note = "";
      try { const j = JSON.parse(text); hasResult = j && j.result !== undefined; note = j?.error?.message || ""; }
      catch { note = "non-JSON body"; }
      out.push({ url: url.replace(/^https:\/\//, ""), status: r.status, hasResult, ms: Date.now() - t0, note: note.slice(0, 90) || text.slice(0, 60) });
    } catch (e) {
      out.push({ url: url.replace(/^https:\/\//, ""), status: 0, hasResult: false, ms: Date.now() - t0, note: String(e).slice(0, 90) });
    }
  }
  // DexScreener 也一起测，它和 RPC 是两条独立的外呼
  let dex = null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, { headers: { "user-agent": "gojipower-site/1.0" } });
    const j = await r.json();
    dex = { status: r.status, priceUsd: j?.pairs?.[0]?.priceUsd ?? null };
  } catch (e) { dex = { status: 0, error: String(e).slice(0, 90) }; }

  return json({ ok: true, rpc: out, dexscreener: dex });
}
