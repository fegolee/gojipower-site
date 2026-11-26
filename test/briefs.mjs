// 研报推送与读取。纯 node 无依赖：node test/briefs.mjs
// 绝大部分断言离线；只有最后一组「已登录但判不出持仓」会真打链，单独标出来。
import { readFileSync } from "node:fs";
const B = new URL("../functions", import.meta.url).pathname;
const { onRequestPost: publish } = await import(`${B}/api/briefs/publish.js`);
const { onRequestGet: feed } = await import(`${B}/api/briefs/feed.js`);
const { sign } = await import(`${B}/_lib/session.js`);
const { INDEX_KEY, KEEP, itemKey } = await import(`${B}/_lib/briefs.js`);

const store = new Map();
const KV = {
  async put(k, v, o) { store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }); },
  async get(k) { const e = store.get(k); if (!e) return null; if (e.exp && Date.now() > e.exp) { store.delete(k); return null; } return e.v; },
  async delete(k) { store.delete(k); },
  async list({ prefix = "", cursor, limit = 1000 } = {}) {
    const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = cursor ? all.indexOf(cursor) + 1 : 0;
    const page = all.slice(from, from + limit);
    return { keys: page.map((name) => ({ name })), list_complete: from + page.length >= all.length, cursor: page[page.length - 1] };
  },
};
const SECRET = "test-secret-not-a-real-one";
const TOKEN = "agent-token-for-tests";
const env = (extra = {}) => ({ GOJI_KV: KV, AGENT_TOKEN: TOKEN, SESSION_SECRET: SECRET, ...extra });

const post = (body, { auth = TOKEN } = {}) => new Request("https://gojipower.xyz/api/briefs/publish", {
  method: "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer " + auth } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = (qs = "", cookie = null) => new Request("https://gojipower.xyz/api/briefs/feed" + qs,
  { headers: cookie ? { cookie: "goji_session=" + cookie } : {} });

let pass = 0, fail = 0;
const t = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${x ? "  — " + x : ""}`); };
const J = async (r) => [r.status, await r.json()];

const ONE = { visibility: "public", title: "Flows moved to L2", facts: ["Bridged value rose.", "Two launches cleared."], reading: ["Reads like rotation, not inflow."] };

// ---- 鉴权 ----
t("无 token 的推送 → 401", (await publish({ request: post(ONE, { auth: null }), env: env() })).status === 401);
t("错 token 的推送 → 401", (await publish({ request: post(ONE, { auth: "wrong" }), env: env() })).status === 401);
t("未配 AGENT_TOKEN → 503", (await publish({ request: post(ONE), env: { GOJI_KV: KV } })).status === 503);
t("没有 KV → 503", (await publish({ request: post(ONE), env: { AGENT_TOKEN: TOKEN } })).status === 503);

// ---- visibility 必填，刻意没有默认值 ----
let [st, j] = await J(await publish({ request: post({ ...ONE, visibility: undefined }), env: env() }));
t("不写 visibility → 400", st === 400 && j.code === "visibility-required");
t("拒绝理由里写明「没有默认值」", /no default/i.test(j.message || ""), (j.message || "").slice(0, 60));
t("visibility 写别的词也拒", (await publish({ request: post({ ...ONE, visibility: "yes" }), env: env() })).status === 400);

// ---- 载荷校验 ----
t("没有 title → 400", (await publish({ request: post({ ...ONE, title: "" }), env: env() })).status === 400);
t("没有 facts → 400", (await publish({ request: post({ ...ONE, facts: [] }), env: env() })).status === 400);
t("只有 reading 没有 facts → 400", (await publish({ request: post({ visibility: "public", title: "x", reading: "只有解读" }), env: env() })).status === 400);
t("javascript: 的来源链接 → 400", (await publish({ request: post({ ...ONE, sources: [{ url: "javascript:alert(1)" }] }), env: env() })).status === 400);
t("不合法的 id → 400", (await publish({ request: post({ ...ONE, id: "../../etc" }), env: env() })).status === 400);
t("不是 JSON → 400", (await publish({ request: post("not json"), env: env() })).status === 400);

// ---- 落盘与读取 ----
store.clear();
[st, j] = await J(await publish({ request: post({ ...ONE, id: "d1" }), env: env() }));
t("推送成功并回 id", st === 200 && j.id === "d1" && j.replaced === false);
t("条目与索引都写进了 KV", store.has(itemKey("d1")) && store.has(INDEX_KEY));

[st, j] = await J(await feed({ request: get(), env: env({ GATE_MIN_USD: "25" }) }));
t("未登录也读得到列表", st === 200 && j.total === 1);
t("公开那期未登录就带正文", j.items[0].locked === false && j.items[0].facts.length === 2);
t("事实与解读是两个字段，没有被合成一段", Array.isArray(j.items[0].facts) && Array.isArray(j.items[0].reading));
t("响应里写明解读不带预测权重", /no predictive weight/i.test(j.note || ""));
t("门槛跟着响应一起给出", j.thresholdUsd === 25);

// ---- 门后那期：未登录拿不到正文 ----
await publish({ request: post({ visibility: "gated", title: "Behind the door", facts: ["secret-fact-string"], id: "d2" }), env: env() });
[st, j] = await J(await feed({ request: get(), env: env({ GATE_MIN_USD: "25" }) }));
const locked = j.items.find((x) => x.id === "d2");
t("门后那期标为 locked", locked && locked.locked === true);
t("locked 的条目里没有 facts 字段", locked && !("facts" in locked));
t("locked 的条目里没有 reading 字段", locked && !("reading" in locked));
t("整个响应里不出现正文字符串", !JSON.stringify(j).includes("secret-fact-string"));
t("但计数仍然给出，门外能看见有多少", locked && locked.counts.facts === 1);
t("未登录的理由是 no-session", j.unlocked === false && j.reason === "no-session");

// ---- 会话端点不加 CORS（和 test/gate.mjs 里那条负向断言同一类）----
const rf = await feed({ request: get(), env: env() });
t("feed 不带 access-control-allow-origin", rf.headers.get("access-control-allow-origin") === null);
t("feed 是 no-store", /no-store/.test(rf.headers.get("cache-control") || ""));

// ---- 重发同 id = 就地更正，不是多出一条 ----
[st, j] = await J(await publish({ request: post({ ...ONE, id: "d1", title: "Corrected title" }), env: env() }));
t("重发同 id 报 replaced", j.replaced === true);
[st, j] = await J(await feed({ request: get(), env: env() }));
t("列表里还是两期，没有重复", j.total === 2);
t("索引里的标题跟着更新了", j.items.some((x) => x.id === "d1" && x.title === "Corrected title"));

// ---- 顺序与条数 ----
store.clear();
for (let i = 0; i < 3; i++) {
  await publish({ request: post({ ...ONE, id: "s" + i, title: "no " + i }), env: env() });
  await new Promise((r) => setTimeout(r, 3));   // 让 at 真的不同
}
[st, j] = await J(await feed({ request: get(), env: env() }));
t("最新的在最前", j.items[0].id === "s2" && j.items[2].id === "s0", j.items.map((x) => x.id).join(","));
[st, j] = await J(await feed({ request: get("?limit=1"), env: env() }));
t("limit 生效，total 仍报全量", j.returned === 1 && j.total === 3);
[st, j] = await J(await feed({ request: get("?limit=999"), env: env() }));
t("limit 上限封在 30", j.returned === 3);
[st, j] = await J(await feed({ request: get("?limit=abc"), env: env() }));
t("limit 是垃圾值时回落到默认", st === 200 && j.returned === 3);

// ---- 挤出索引的条目会被删掉，不留 KV 垃圾 ----
store.clear();
for (let i = 0; i <= KEEP; i++) {
  await publish({ request: post({ ...ONE, id: "k" + String(i).padStart(3, "0"), title: "k" + i }), env: env() });
}
[st, j] = await J(await feed({ request: get("?limit=30"), env: env() }));
t(`索引封在 ${KEEP} 期`, j.total === KEEP, `total=${j.total}`);
const leftovers = [...store.keys()].filter((k) => k.startsWith("brief:item:")).length;
t("被挤出的条目键也删了", leftovers === KEEP, `还剩 ${leftovers} 个条目键`);

// ---- 「读不到」绝不能长成「还没有简报」 ----
store.set(INDEX_KEY, { v: "{not json", exp: null });
[st, j] = await J(await feed({ request: get(), env: env() }));
t("索引坏了 → 503 index-unreadable，不是空列表", st === 503 && j.code === "index-unreadable", `status=${st} code=${j.code}`);
t("503 的响应里没有 items 字段冒充空列表", !("items" in j));

// ---- 渲染端不许用 innerHTML 落推送来的文本 ----
const js = readFileSync(new URL("../assets/site.js", import.meta.url), "utf8");
const block = js.slice(js.indexOf("研报列表"), js.indexOf("研报列表") + 6000);
t("site.js 里有研报渲染块", block.length > 500);
t("研报渲染块里没有 innerHTML", block.length > 500 && !/innerHTML/.test(block));

// ---- 真打链的一组：已登录但持仓判不出来，应当锁着并说明原因 ----
store.clear();
await publish({ request: post({ visibility: "gated", title: "g", facts: ["x"], id: "g1" }), env: env() });
const sess = await sign({ wallet: "11111111111111111111111111111111", exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
[st, j] = await J(await feed({ request: get("", sess), env: env({ GATE_MIN_USD: "25" }) }));
t("已登录但判不出 → 仍然锁着", j.unlocked === false && j.items[0].locked === true);
t("理由说的是读不到，不是不够", j.reason === "holdings-unreadable", `reason=${j.reason}`);

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
