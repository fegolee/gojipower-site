// 跑法：node test/auth.mjs（需要 Node 20+，无依赖）
const B = new URL("../functions", import.meta.url).pathname;
const { onRequestGet: nonceGet } = await import(`${B}/api/auth/nonce.js`);
const { onRequestPost: walletPost } = await import(`${B}/api/auth/wallet.js`);
const { onRequestGet: sessionGet } = await import(`${B}/api/auth/session.js`);
const { b58encode } = await import(`${B}/_lib/b58.js`);

// 最小 KV 替身：put/get/delete + TTL
const store = new Map();
const KV = {
  async put(k, v, o) { store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }); },
  async get(k) { const e = store.get(k); if (!e) return null; if (e.exp && Date.now() > e.exp) { store.delete(k); return null; } return e.v; },
  async delete(k) { store.delete(k); },
};
const env = { GOJI_KV: KV, SESSION_SECRET: "test-secret-not-the-real-one" };
const ORIGIN = "https://gojipower.xyz";
const PREFIX = "beagle-meet-wallet";
const enc = new TextEncoder();
const req = (headers = {}) => new Request("https://gojipower.xyz/x", { headers });

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${name}${extra ? "  — " + extra : ""}`); };

// 造一个 Solana 风格的 Ed25519 钱包
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const address = b58encode(pubRaw);
const signMsg = async (m) => b58encode(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, enc.encode(m))));

console.log("测试钱包:", address, `(${address.length} 字符)\n`);

// 1. 发 nonce
const n1 = await (await nonceGet({ env })).json();
t("nonce 端点返回 nonce", n1.ok && typeof n1.nonce === "string" && n1.nonce.length === 64, `len=${n1.nonce?.length} ttl=${n1.expiresIn}`);

// 2. 正常登录
const sig1 = await signMsg(`${PREFIX}\n${ORIGIN}\n${n1.nonce}`);
const r1 = await walletPost({ request: new Request("https://gojipower.xyz/api/auth/wallet", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n1.nonce, sig: sig1 }) }), env });
const j1 = await r1.json();
t("正确签名 → 200", r1.status === 200 && j1.ok === true, `status=${r1.status} ${j1.code || ""}`);
t("返回钱包地址", j1.wallet === address);
t("读到链上余额", j1.balance !== undefined, `balance=${j1.balance} priceUsd=${j1.priceUsd}`);
t("门槛未配置时 meets=null（不假装通过）", j1.threshold === null && j1.meets === null);
t("NFT 无 DAS 时 held=null 而不是 false", j1.nft?.held === null, `reason=${j1.nft?.reason}`);
t("网页钱包提示需要补 Beagle 登录", j1.needsBeagleSignIn === true);
const setCookie = r1.headers.get("set-cookie") || "";
t("下发 HttpOnly+Secure+SameSite 会话", /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie));

// 3. 同一个 nonce 重放
const r2 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n1.nonce, sig: sig1 }) }), env });
t("nonce 重放 → 401 bad-nonce", r2.status === 401 && (await r2.json()).code === "bad-nonce");

// 4. 签了别的 origin
const n2 = (await (await nonceGet({ env })).json()).nonce;
const sigEvil = await signMsg(`${PREFIX}\nhttps://evil.example\n${n2}`);
const r3 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n2, sig: sigEvil }) }), env });
t("错误 origin → 401", r3.status === 401 && (await r3.json()).code === "bad-signature");

// 5. body 里塞一个假 origin 想绕过（服务端写死，应无效）
const n3 = (await (await nonceGet({ env })).json()).nonce;
const sigEvil2 = await signMsg(`${PREFIX}\nhttps://evil.example\n${n3}`);
const r4 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n3, sig: sigEvil2, origin: "https://evil.example" }) }), env });
t("body 里传 origin 无法覆盖服务端写死的 → 401", r4.status === 401);

// 6. 错误前缀
const n4 = (await (await nonceGet({ env })).json()).nonce;
const sigPrefix = await signMsg(`decent-auth\n${ORIGIN}\n${n4}`);
const r5 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n4, sig: sigPrefix }) }), env });
t("错误 prefix（decent-auth 当钱包门用）→ 401", r5.status === 401);

// 7. 未知 nonce
const r6 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: "never-issued", sig: sig1 }) }), env });
t("伪造 nonce → 401", r6.status === 401);

// 8. 以太坊明确拒绝
const r7 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "ethereum", address, nonce: "x", sig: "y" }) }), env });
t("walletType=ethereum → 400 明确拒绝", r7.status === 400 && (await r7.json()).code === "unsupported-wallet");

// 9. 字段名写成 signature（文档里的错名）应当被拒
const n5 = (await (await nonceGet({ env })).json()).nonce;
const r8 = await walletPost({ request: new Request("https://x/", { method: "POST", body: JSON.stringify({ walletType: "solana", address, nonce: n5, signature: await signMsg(`${PREFIX}\n${ORIGIN}\n${n5}`) }) }), env });
t("用 signature 而非 sig → 400 缺字段", r8.status === 400 && (await r8.json()).code === "missing-fields");

// 10. 会话 cookie 能被读回
const token = setCookie.split(";")[0].split("=")[1];
const s1 = await (await sessionGet({ request: req({ cookie: `goji_session=${token}` }), env })).json();
t("会话 cookie 验得过", s1.signedIn === true && s1.wallet === address, `proven=${JSON.stringify(s1.proven)}`);

// 11. 篡改会话
const s2 = await (await sessionGet({ request: req({ cookie: `goji_session=${token.slice(0, -4)}AAAA` }), env })).json();
t("篡改会话 → 未登录", s2.signedIn === false);

// 12. 无 cookie
const s3 = await (await sessionGet({ request: req(), env })).json();
t("无 cookie → 未登录", s3.signedIn === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
