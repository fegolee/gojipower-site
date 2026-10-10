// 把本地零依赖的 XEdDSA 验签和官方 @decentnetwork/peer 对拍。
// 跑法：node test/xeddsa.mjs   （需要先 npm i @decentnetwork/peer，见下方提示）
const REF = "/tmp/sigtest/node_modules";
let signDetached, refVerify, bytesToBase58;
try {
  ({ signDetached, verifyDetached: refVerify } = await import(`${REF}/@decentnetwork/peer/dist/crypto/sign.js`));
  ({ bytesToBase58 } = await import(`${REF}/@decentnetwork/peer/dist/utils/base58.js`));
} catch {
  console.log("跳过：找不到参考实现。先 npm i --prefix /tmp/sigtest @decentnetwork/peer");
  process.exit(0);
}
const nacl = (await import(`${REF}/tweetnacl/nacl-fast.js`)).default;
const c25519 = await import(`${REF}/curve25519-js/lib/index.js`);
const mine = await import(new URL("../functions/_lib/xeddsa.js", import.meta.url).pathname);

let pass = 0, fail = 0;
const t = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${x ? "  — " + x : ""}`); };
const enc = (s) => new TextEncoder().encode(s);

// 50 组随机密钥 × 随机消息，正例必须双方都说 true
let agree = 0;
for (let i = 0; i < 50; i++) {
  const kp = c25519.generateKeyPair(nacl.randomBytes(32));
  const msg = enc(`decent-auth\nhttps://gojipower.xyz\n${bytesToBase58(nacl.randomBytes(24))}`);
  const sig = signDetached(kp.private, msg);
  const a = refVerify(kp.public, msg, sig);
  const b = await mine.verifyDetached(kp.public, msg, sig);
  if (a === true && b === true) agree++;
}
t("50 组正例，与官方实现一致", agree === 50, `${agree}/50`);

// 反例：改消息、改签名、换公钥、长度不对
const kp = c25519.generateKeyPair(nacl.randomBytes(32));
const msg = enc("decent-auth\nhttps://gojipower.xyz\nnonce-abc");
const sig = signDetached(kp.private, msg);

t("正确签名 → true", await mine.verifyDetached(kp.public, msg, sig) === true);
t("改一个字节的消息 → false", await mine.verifyDetached(kp.public, enc("decent-auth\nhttps://gojipower.xyz\nnonce-abd"), sig) === false);
t("换 origin → false", await mine.verifyDetached(kp.public, enc("decent-auth\nhttps://evil.example\nnonce-abc"), sig) === false);
t("换 prefix → false", await mine.verifyDetached(kp.public, enc("decent-launch\nhttps://gojipower.xyz\nnonce-abc"), sig) === false);

const other = c25519.generateKeyPair(nacl.randomBytes(32));
t("换一把公钥 → false", await mine.verifyDetached(other.public, msg, sig) === false);

const tampered = Uint8Array.from(sig); tampered[0] ^= 1;
t("签名翻一个 bit → false", await mine.verifyDetached(kp.public, msg, tampered) === false);
const tampered2 = Uint8Array.from(sig); tampered2[63] ^= 0x01;
t("签名尾字节翻一个 bit → false", await mine.verifyDetached(kp.public, msg, tampered2) === false);

t("签名长度不对 → false", await mine.verifyDetached(kp.public, msg, sig.slice(0, 63)) === false);
t("公钥长度不对 → false", await mine.verifyDetached(kp.public.slice(0, 31), msg, sig) === false);
t("全零公钥 → false（不抛异常）", await mine.verifyDetached(new Uint8Array(32), msg, sig) === false);

// u = p-1 时 u+1 ≡ 0，无对应 Edwards 点，必须返回 false 而不是炸
const uBad = new Uint8Array(32); uBad[0] = 0xec; for (let i = 1; i < 31; i++) uBad[i] = 0xff; uBad[31] = 0x7f;
t("u = p-1 边界 → false（不抛异常）", await mine.verifyDetached(uBad, msg, sig) === false);

// 200 组随机垃圾签名：双方都应当说 false
let bothFalse = 0;
for (let i = 0; i < 200; i++) {
  const k = c25519.generateKeyPair(nacl.randomBytes(32));
  const s = nacl.randomBytes(64);
  const a = refVerify(k.public, msg, s);
  const b = await mine.verifyDetached(k.public, msg, s);
  if (a === false && b === false) bothFalse++;
}
t("200 组随机垃圾签名，双方都拒绝", bothFalse === 200, `${bothFalse}/200`);

// ---- /api/auth/decent 端点 ----
const { onRequestPost: decentPost } = await import(new URL("../functions/api/auth/decent.js", import.meta.url).pathname);
const { onRequestGet: nonceGet } = await import(new URL("../functions/api/auth/nonce.js", import.meta.url).pathname);
const { sign: signSession } = await import(new URL("../functions/_lib/session.js", import.meta.url).pathname);

const store = new Map();
const KV = {
  async put(k, v, o) { store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }); },
  async get(k) { const e = store.get(k); if (!e) return null; if (e.exp && Date.now() > e.exp) { store.delete(k); return null; } return e.v; },
  async delete(k) { store.delete(k); },
};
const env = { GOJI_KV: KV, SESSION_SECRET: "test-secret" };
const WALLET = "A5FajdTkzCxhoGmaRkVd1nF85KmQYaaov6zBm9iugxgs";
const now = Math.floor(Date.now() / 1000);
const walletCookie = await signSession({ v: 1, wallet: WALLET, proven: ["wallet"], iat: now, exp: now + 3600 }, env.SESSION_SECRET);

const ck = c25519.generateKeyPair(nacl.randomBytes(32));
const userid = bytesToBase58(ck.public);
const carrier = "J62K9H9ADChUbMcpi2HDWcdj8MMWQ5Va1BtKHtYD53gYaL6uxNkF";
const toHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

const post = (body, cookie) => decentPost({
  request: new Request("https://gojipower.xyz/api/auth/decent", {
    method: "POST", headers: cookie ? { cookie: `goji_session=${cookie}` } : {}, body: JSON.stringify(body),
  }), env,
});
const freshNonce = async () => (await (await nonceGet({ env })).json()).nonce;

let n1 = await freshNonce();
let s1 = toHex(signDetached(ck.private, enc(`decent-auth\nhttps://gojipower.xyz\n${n1}`)));
let r1 = await post({ userid, nonce: n1, sig: s1, address: carrier, name: "fego" }, walletCookie);
let j1 = await r1.json();
t("有钱包会话 + 正确 XEdDSA 签名 → 200", r1.status === 200 && j1.ok === true, `${r1.status} ${j1.code || ""}`);
t("绑定了 Beagle 身份与可达地址", j1.decentUserid === userid && j1.carrierAddress === carrier);
t("proven 里两道门都在", JSON.stringify(j1.proven) === JSON.stringify(["wallet", "decent"]), JSON.stringify(j1.proven));
t("needsBeagleSignIn 变成 false", j1.needsBeagleSignIn === false);
t("双向绑定都写了", !!(await KV.get(`bind:wallet:${WALLET}`)) && !!(await KV.get(`bind:decent:${userid}`)));

let n2 = await freshNonce();
let s2 = toHex(signDetached(ck.private, enc(`decent-auth\nhttps://gojipower.xyz\n${n2}`)));
t("没有钱包会话 → 401 wallet-first", (await post({ userid, nonce: n2, sig: s2 }, null)).status === 401);

let n3 = await freshNonce();
let s3 = toHex(signDetached(ck.private, enc(`decent-auth\nhttps://evil.example\n${n3}`)));
t("签了别的 origin → 401", (await post({ userid, nonce: n3, sig: s3 }, walletCookie)).status === 401);

let n4 = await freshNonce();
let s4 = toHex(signDetached(ck.private, enc(`beagle-meet-wallet\nhttps://gojipower.xyz\n${n4}`)));
t("用钱包门的 prefix 签 → 401（前缀不可互换）", (await post({ userid, nonce: n4, sig: s4 }, walletCookie)).status === 401);

let n5 = await freshNonce();
let s5 = toHex(signDetached(ck.private, enc(`decent-auth\nhttps://gojipower.xyz\n${n5}`)));
await post({ userid, nonce: n5, sig: s5, address: carrier }, walletCookie);
t("nonce 重放 → 401", (await post({ userid, nonce: n5, sig: s5, address: carrier }, walletCookie)).status === 401);

let n6 = await freshNonce();
let s6b58 = bytesToBase58(signDetached(ck.private, enc(`decent-auth\nhttps://gojipower.xyz\n${n6}`)));
t("sig 用 base58 也认（两道门编码不同）", (await post({ userid, nonce: n6, sig: s6b58, address: carrier }, walletCookie)).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
