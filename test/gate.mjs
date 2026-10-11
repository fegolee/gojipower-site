// 对外门槛契约。纯 node 无依赖：node test/gate.mjs
// 会打真实的链（publicnode + DexScreener），所以慢几秒。
const B = new URL("../functions", import.meta.url).pathname;
const { onRequestGet: specGet } = await import(`${B}/api/gate/index.js`);
const { onRequestGet: addrGet } = await import(`${B}/api/gate/[address].js`);
const { evaluate } = await import(`${B}/_lib/gate.js`);

const store = new Map();
const KV = {
  async put(k, v, o) { store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }); },
  async get(k) { const e = store.get(k); if (!e) return null; if (e.exp && Date.now() > e.exp) { store.delete(k); return null; } return e.v; },
  async delete(k) { store.delete(k); },
};
const envWith = (extra = {}) => ({ GOJI_KV: KV, ...extra });
const req = (ip = "1.2.3.4") => new Request("https://gojipower.xyz/api/gate/x", { headers: { "cf-connecting-ip": ip } });

let pass = 0, fail = 0;
const t = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${x ? "  — " + x : ""}`); };

const TREASURY = "hsXgR17RR3NFD4gSBCSbUR6S31QQVdDwLmh3VbhuEDe";   // 持有 158,037 枚
const EMPTY = "11111111111111111111111111111111";                  // 系统程序，必然 0

// ---- 契约 ----
let j = await (await specGet({ env: envWith({ GATE_MIN_USD: "25" }) })).json();
t("契约给出 mint / collection / 阈值", j.ok && j.mint && j.collection && j.thresholdUsd === 25);
t("两条规则，任一满足即可", j.rules.length === 2 && j.combine === "any");
t("响应里写明链才是来源", /chain is the source of truth/.test(j.note));
j = await (await specGet({ env: envWith() })).json();
t("未配阈值时契约里是 null，不是默认值", j.thresholdUsd === null);
t("没有 KV 时 503", (await specGet({ env: {} })).status === 503);

// ---- 地址校验（先挡住垃圾输入，省链上调用）----
t("非 base58 → 400", (await addrGet({ request: req(), params: { address: "0OIl!!" }, env: envWith() })).status === 400);
t("长度不对 → 400", (await addrGet({ request: req(), params: { address: "abc" }, env: envWith() })).status === 400);

// ---- 真实链上，已知答案 ----
const r1 = await addrGet({ request: req("a"), params: { address: TREASURY }, env: envWith({ GATE_MIN_USD: "25" }) });
const g1 = await r1.json();
t("金库地址读出已知余额", g1.balance === 158037.361699, `balance=${g1.balance}`);
t("余额远超 $25 → meets true", g1.meets === true && g1.by.token === true, `usd=${g1.usd && g1.usd.toFixed(2)}`);
t("首次不是缓存", g1.cached === false);

const r2 = await addrGet({ request: req("a"), params: { address: TREASURY }, env: envWith({ GATE_MIN_USD: "25" }) });
const g2 = await r2.json();
t("60 秒内第二次命中缓存", g2.cached === true);
t("缓存结果带原来的 asOf，不冒充现在", g2.asOf === g1.asOf);

// ---- 「查不到」不等于「不满足」----
const gEmpty = await evaluate(EMPTY, { GATE_MIN_USD: "25" });   // 无 DAS_RPC
t("空地址：代币判 false", gEmpty.by.token === false, `balance=${gEmpty.balance}`);
t("空地址：NFT 查不到 → null 而不是 false", gEmpty.by.nft === null, `reason=${gEmpty.nft.reason}`);
t("一条 false 一条未知 → meets 是 null，不是 false", gEmpty.meets === null,
  `by=${JSON.stringify(gEmpty.by)}`);

const gNoThresh = await evaluate(EMPTY, {});
t("未配阈值 → 代币也判不了，meets null", gNoThresh.by.token === null && gNoThresh.meets === null);

// ---- 限流 ----
const envRl = envWith({ GATE_MIN_USD: "25" });
let limited = 0;
for (let i = 0; i < 34; i++) {
  const r = await addrGet({ request: req("flood"), params: { address: TREASURY }, env: envRl });
  if (r.status === 429) limited++;
}
t("同一 IP 超过 30 次/分钟后开始 429", limited > 0, `${limited}/34 被拦`);
const rOther = await addrGet({ request: req("other-ip"), params: { address: TREASURY }, env: envRl });
t("限流按 IP 分桶，不误伤别人", rOther.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
