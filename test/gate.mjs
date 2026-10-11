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
  async list({ prefix = "", cursor, limit = 1000 } = {}) {
    const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = cursor ? all.indexOf(cursor) + 1 : 0;
    const page = all.slice(from, from + limit);
    const last = page[page.length - 1];
    return { keys: page.map((name) => ({ name })), list_complete: from + page.length >= all.length, cursor: last };
  },
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

// ---- 研报订阅 ----
const { onRequestPost: subPost } = await import(`${B}/api/briefs/subscribe.js`);
const { onRequestGet: rosterGet } = await import(`${B}/api/briefs/roster.js`);
const { sign: signSession } = await import(`${B}/_lib/session.js`);

const SECRET = "test-secret";
const envB = (extra = {}) => ({ GOJI_KV: KV, SESSION_SECRET: SECRET, GATE_MIN_USD: "25", ...extra });
const now = Math.floor(Date.now() / 1000);
const mkSession = (o) => signSession({ v: 1, iat: now, exp: now + 3600, ...o }, SECRET);
const postSub = async (cookie, env) => subPost({
  request: new Request("https://gojipower.xyz/api/briefs/subscribe", {
    method: "POST", headers: cookie ? { cookie: `goji_session=${cookie}` } : {},
  }), env: env || envB(),
});

t("没有会话 → 401", (await postSub(null)).status === 401);

const walletOnly = await mkSession({ wallet: TREASURY, proven: ["wallet"] });
let r = await postSub(walletOnly);
t("只过钱包门 → 401 beagle-first（送不到就不登记）",
  r.status === 401 && (await r.json()).code === "beagle-first");

const DECENT = "BVuiTvzuNTscma9uFZVy9auMb4doc64X6Qu5eaUNAzkU";
const both = await mkSession({ wallet: TREASURY, decentUserid: DECENT, carrierAddress: "Q5M2Hr7B…", proven: ["wallet", "decent"] });
r = await postSub(both);
const jSub = await r.json();
t("两道门都过且达标 → 200", r.status === 200 && jSub.ok === true, `${r.status} ${jSub.code || ""}`);
t("返回推送 Agent 的地址", !!(jSub.agent && jSub.agent.address));
t("订阅写进了 KV", !!(await KV.get(`sub:briefs:${DECENT}`)));

const poor = await mkSession({ wallet: EMPTY, decentUserid: "someone-else", carrierAddress: "x", proven: ["wallet", "decent"] });
r = await postSub(poor);
t("不达标 → 403，且不写 KV", r.status === 403 && !(await KV.get("sub:briefs:someone-else")));

// ---- 名册（只列人，零外呼）----
const { onRequestGet: checkGet } = await import(`${B}/api/briefs/check/[userid].js`);
const getRoster = (token, env) => rosterGet({
  request: new Request("https://gojipower.xyz/api/briefs/roster", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }), env: env || envB({ AGENT_TOKEN: "tok-abc" }),
});
t("没有 token → 401", (await getRoster(null)).status === 401);
t("token 不对 → 401", (await getRoster("wrong")).status === 401);
t("长度不同的 token 也拒绝", (await getRoster("tok-abc-extra")).status === 401);
t("未配 AGENT_TOKEN → 503 而不是放行", (await getRoster("x", envB())).status === 503);

const jr = await (await getRoster("tok-abc")).json();
t("名册列出订阅者", jr.ok && jr.count >= 1, `count=${jr.count}`);
// 整个设计里最要紧的一行断言
t("名册里没有任何钱包地址（token 泄漏也不暴露链上身份）",
  !JSON.stringify(jr).includes(TREASURY) && !jr.roster.some((x) => "wallet" in x));
t("名册不做链上判定（那是复查端点的事）", !jr.roster.some((x) => "meets" in x));

// ---- 逐人复查 ----
const doCheck = (userid, token = "tok-abc") => checkGet({
  request: new Request("https://gojipower.xyz/api/briefs/check/x", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }), params: { userid }, env: envB({ AGENT_TOKEN: "tok-abc" }),
});
t("复查也要 token", (await doCheck(DECENT, null)).status === 401);
const jc = await (await doCheck(DECENT)).json();
t("订阅者复查 → meets true", jc.subscribed === true && jc.meets === true, `meets=${jc.meets}`);
t("复查结果不含钱包地址", !JSON.stringify(jc).includes(TREASURY));
const jc2 = await (await doCheck("never-subscribed")).json();
t("未订阅的人 → subscribed false、meets null", jc2.subscribed === false && jc2.meets === null);

// ---- 按 Beagle 身份问（registerRoomGate 用的那条）----
const { onRequestGet: bGet } = await import(`${B}/api/gate/beagle/[userid].js`);
const askB = (userid, env) => bGet({
  request: new Request("https://gojipower.xyz/api/gate/beagle/x", {
    headers: { "cf-connecting-ip": "b-ip" },
  }), params: { userid }, env: env || envB(),
});

t("没有 KV 时 503", (await askB(DECENT, {})).status === 503);
t("非 base58 的 userid → 400", (await askB("0OIl!!")).status === 400);
t("长度不对的 userid → 400", (await askB("abc")).status === 400);

// 没绑过钱包的 Beagle 身份：是一个**确定**的拒绝，而且附补救办法
const UNBOUND = "8mtSvgSNa4juR9LUaEum6QahccuziaT87Km7uP3wQsGD";
const jb0 = await (await askB(UNBOUND)).json();
t("没绑过 → bound false、meets false（不是 null）", jb0.bound === false && jb0.meets === false);
t("没绑过时给出可以直接回给用户的拒绝理由与去处",
  jb0.gate.ok === false && jb0.gate.code === "not-bound" && /gojipower\.xyz/.test(jb0.link));

// 绑定是两道门各一个签名之后我们自己写下的，这里直接按那个键喂进去
await KV.put(`bind:decent:${DECENT}`, JSON.stringify({ wallet: TREASURY, t: "2026-10-11T00:00:00.000Z" }));
const rb = await askB(DECENT);
const jb = await rb.json();
t("绑过且达标 → meets true，gate 可直接 return", jb.bound === true && jb.meets === true && jb.gate.ok === true);
t("和按地址那条共用同一份缓存（多身份不重复打链）", jb.cached === true);
t("给出凭哪一条过的", jb.by && jb.by.token === true);

// 整条端点存在的理由就是这一行：它回答资格，不泄露是谁
const raw = JSON.stringify(jb);
t("响应里没有钱包地址", !raw.includes(TREASURY));
t("响应里没有余额、美元值、单价", !/"balance"|"usd"|"priceUsd"|"exists"/.test(raw));
t("响应里没有 NFT 资产 id（带上它等于带上钱包：Core 资产的持有人可免费反查）",
  !raw.includes("FzAZAT2DHUuZ1uJA8y4WzSZze926c69An7cMYnH8NreP") && !/"assets"/.test(raw));

// 读不到的时候**不替别人决定**开还是关。失败时放行还是挡住是那道门自己的策略，
// 我们给 null 让调用方自己选；给 false 等于一次 RPC 抖动就把合格的人关在门外。
const AIR = "5uJ3x2N9ALexhruGicAaVUBYrXBSeQ83wm9SpHHH9vSp";
await KV.put(`bind:decent:${AIR}`, JSON.stringify({ wallet: EMPTY }));
const jbn = await (await askB(AIR)).json();
t("持仓判不定 → meets null", jbn.bound === true && jbn.meets === null, `meets=${jbn.meets}`);
t("判不定就不给 gate（开还是关是调用方的策略，不是我们的）", jbn.gate === null);
t("响应里写明 meets null 不是拒绝", /not a denial/.test(jbn.note));

// ---- 限流 ----
let lim2 = 0;
for (let i = 0; i < 64; i++) if ((await askB(DECENT)).status === 429) lim2++;
t("按 userid 的那条也限流（60 次/分钟）", lim2 > 0, `${lim2}/64 被拦`);
t("限流按 IP 分桶", (await bGet({
  request: new Request("https://gojipower.xyz/api/gate/beagle/x", { headers: { "cf-connecting-ip": "other-b" } }),
  params: { userid: DECENT }, env: envB(),
})).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
