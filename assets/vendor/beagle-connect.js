// vendored: @decentnetwork/beagle-connect@0.1.2 (MIT), 2026-10-10，未改动除下面这一行 import。
//
// 为什么 vendor 而不是从 CDN 加载：这是一个会让用户签名的流程。CDN 上的代码明天
// 发什么我们管不着，而一次投毒就能换掉签名内容。所以依赖要钉死、自己托管。
//
// 原文 import 的是 @decentnetwork/peer（1.1MB，主入口带 dgram/node:net，浏览器里本来也跑不了），
// 而它只用到其中两个函数。这里改指向本仓库自己的实现：
//   base58ToBytes  → _lib 的 base58（与服务端同一份逻辑）
//   verifyDetached → 自己写的零依赖 XEdDSA（test/xeddsa.mjs 与官方逐例对拍过）
// 因此这个文件连带依赖只有约 12KB，而且仓库里没有 GPL 代码。
// @decentnetwork/beagle-connect — talk to a user's Beagle from a website.
//
// Three things a site needs, and none of them should be re-derived per site:
//
//   signIn()     prove who the visitor is
//   addFriend()  ask their Beagle to send a friend request
//   readLaunch() they arrived from Beagle's Apps tab; they are already signed in
//
// The reason this is a package and not a snippet: WHICH Beagle answers is not
// a constant. An installed client serves http://localhost:8766 and is instant;
// app.beagle.chat serves the same routes for someone who installed nothing.
// Every site that hardcoded one of them got the other case wrong.

import { base58ToBytes, verifyDetached } from "./peer-shim.js";

/** Where a Beagle might be listening. Local first: it holds a real identity on
 *  disk and its popup opens instantly.
 *
 *  8766 is the default for BOTH the CLI and the desktop app (the desktop
 *  adopts an instance already on 8766 rather than moving up). 8767/8768 appear
 *  when BEAGLE_PORT was set or someone is running two, and 8765 is the old
 *  agentnet UI. Probing the spares costs nothing — a closed port refuses
 *  immediately — and missing one costs a button that silently does nothing.
 *
 *  The web client is LAST and is never probed: it is the fallback, and it
 *  always answers. */
export const DEFAULT_UI_ORIGINS = [
  "http://127.0.0.1:8766",
  "http://localhost:8766",
  "https://localhost:8766",
  "https://127.0.0.1:8766",
  "http://localhost:8767",
  "http://localhost:8768",
  "http://localhost:8765",
  "https://app.beagle.chat",
];

const PROBE_MS = 1200;
const REPLY_MS = 120_000;
/** How old a launch assertion may be. Short, because a timestamp is a weaker
 *  replay defence than a nonce the site issued itself. */
export const LAUNCH_MAX_AGE_MS = 120_000;

const hexToBytes = (h) => {
  const clean = String(h || "");
  if (clean.length % 2) throw new Error("bad signature encoding");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** "up" | "opaque" | "down".
 *
 *  Three states, not two, because a no-cors probe cannot tell a closed port
 *  from a browser refusing the request. An https page reaching for
 *  http://localhost is subject to Private Network Access, and a PNA refusal
 *  REJECTS exactly like a dead port — so a two-state probe silently sends a
 *  user who has Beagle installed to the web client instead. (gpu-59 found this
 *  while integrating; beagle-meet's probeCli already distinguished the three.)
 *
 *  Beagle does send CORS headers — it reflects the requesting Origin on
 *  /api/state — so a real readable fetch is possible and definitive. no-cors
 *  stays as the fallback for older builds: an opaque response still proves
 *  something accepted the connection. */
async function probe(origin) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    const r = await fetch(`${origin}/api/state`, { method: "GET", mode: "cors", credentials: "omit", signal: ctl.signal });
    if (r.ok) return "up";
  } catch { /* older build, or CORS/PNA refusal — fall through */ }
  try {
    await fetch(`${origin}/connect`, { method: "GET", mode: "no-cors", credentials: "omit", signal: ctl.signal });
    return "opaque";
  } catch { return "down"; } finally { clearTimeout(timer); }
}

/** The first Beagle that answers, or the last candidate as a fallback so the
 *  caller always has somewhere to send the user.
 *
 *  Probed in PARALLEL, not in sequence. Five candidates at a 1.2s timeout each
 *  is six seconds of staring at nothing before the web fallback — and the user
 *  is waiting on a click. A closed port refuses immediately, so the whole
 *  sweep costs about as long as the slowest live one. Preference order is kept
 *  by taking the earliest candidate that answered, not the fastest. */
export async function pickUiOrigin(origins = DEFAULT_UI_ORIGINS) {
  const local = origins.slice(0, -1);
  const states = await Promise.all(local.map((o) => probe(o)));
  // A definite "up" wins; an "opaque" is still far better evidence than the
  // web fallback, which is only for someone with nothing installed. Earliest
  // candidate in each tier, so preference order beats latency.
  const up = states.findIndex((x) => x === "up");
  if (up !== -1) return local[up];
  const opaque = states.findIndex((x) => x === "opaque");
  if (opaque !== -1) return local[opaque];
  return origins[origins.length - 1];
}

/** Open one of Beagle's /connect flows and wait for its postMessage.
 *
 *  The window is opened SYNCHRONOUSLY, before any await, and parked on
 *  about:blank while the origin is probed. This module told everyone else
 *  "pop-ups need a user gesture, and one opened after an await has already
 *  lost it" — and then opened its own window after awaiting pickUiOrigin().
 *  Safari and Firefox block that outright; Chrome decides by heuristic, so it
 *  passes on the developer's machine and fails for users, looking exactly like
 *  "Beagle did not answer". Found by gpu-59 reading the code against the guide.
 *
 *  `existingWindow` lets a caller that already opened a window in its own click
 *  handler hand it over, for sites that want the gesture even more tightly held.
 */
async function popup({ params, expectType, nonce, origins, features, existingWindow }) {
  const win = existingWindow ?? window.open("about:blank", "beagle-connect", features);
  if (!win) throw new Error("Beagle could not open — allow pop-ups for this site.");

  const accept = new Set(origins ?? DEFAULT_UI_ORIGINS);
  let uiOrigin;
  try {
    uiOrigin = await pickUiOrigin(origins);
  } catch (err) {
    win.close();
    throw err;
  }
  const url = new URL("/connect", uiOrigin);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  url.searchParams.set("origin", location.origin);
  url.searchParams.set("nonce", nonce);
  win.location.href = url.toString();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      err ? reject(err) : resolve(val);
    };
    const onMessage = (e) => {
      if (!accept.has(e.origin)) return;
      const d = e.data;
      if (!d || d.type !== expectType || d.nonce !== nonce) return;
      if (d.error) { finish(new Error(d.error === "denied" ? "Cancelled" : String(d.error))); return; }
      finish(null, { ...d, uiOrigin });
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(
      () => finish(new Error(win.closed ? "Cancelled" : "Beagle did not answer.")),
      REPLY_MS,
    );
  });
}

/** Prove who the visitor is.
 *
 *  `nonce` should come from YOUR SERVER and be single-use — that is what makes
 *  the assertion unreplayable. Verify server-side too; the check below is for
 *  the UI, not for trust. */
export async function signIn({ nonce, origins, features = "width=420,height=560", existingWindow } = {}) {
  if (!nonce) throw new Error("signIn needs a nonce (get one from your server)");
  const r = await popup({ params: {}, expectType: "decent-auth", nonce, origins, features, existingWindow });
  if (!verifySignIn(r.userid, location.origin, nonce, r.sig)) throw new Error("Signature did not verify");
  return r;   // { userid, address, name, avatar, sig, nonce, uiOrigin }
}

/** Ask the visitor's Beagle to send a friend request to `address`. Nothing is
 *  disclosed to you — you already had the address. */
export async function addFriend({ address, name, origins, features = "width=420,height=560", existingWindow }) {
  if (!address) throw new Error("addFriend needs an address");
  const nonce = crypto.randomUUID();
  return popup({ params: { action: "add", address, name }, expectType: "beagle-action", nonce, origins, features, existingWindow });
}

export function verifySignIn(userid, origin, nonce, sigHex) {
  try {
    const msg = new TextEncoder().encode(`decent-auth\n${origin}\n${nonce}`);
    return verifyDetached(base58ToBytes(userid), msg, hexToBytes(sigHex));
  } catch { return false; }
}

export function verifyLaunch(userid, origin, ts, sigHex) {
  try {
    const msg = new TextEncoder().encode(`decent-launch\n${origin}\n${ts}`);
    return verifyDetached(base58ToBytes(userid), msg, hexToBytes(sigHex));
  } catch { return false; }
}

/** Did this visitor arrive from Beagle's Apps tab already signed in?
 *
 *  Beagle puts the assertion in the URL FRAGMENT, which never reaches a
 *  server, never appears in a Referer header and never lands in an access log.
 *  This reads it, verifies it, and strips it from the address bar so a copied
 *  URL carries no credential.
 *
 *  Returns null when there is nothing to read. Throws when there IS something
 *  and it does not check out — a bad assertion is a fact worth surfacing, not
 *  a silent "not signed in".
 *
 *  `assertion` is the raw payload: send it to your server and verify it there
 *  before you mint a session. Your server must also refuse a `sig` it has
 *  already seen, because a timestamp alone cannot stop replay. */
export async function readLaunch({ maxAgeMs = LAUNCH_MAX_AGE_MS, strip = true } = {}) {
  const m = /(?:^|[#&])beagle=([A-Za-z0-9_-]+)/.exec(location.hash || "");
  if (!m) return null;
  if (strip) {
    try {
      const rest = (location.hash || "").replace(/(?:^|[#&])beagle=[A-Za-z0-9_-]+/, "").replace(/^#?&?/, "");
      history.replaceState(null, "", location.pathname + location.search + (rest ? `#${rest}` : ""));
    } catch { /* a stripped fragment is hygiene, not correctness */ }
  }
  let a;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    a = JSON.parse(decodeURIComponent(escape(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)))));
  } catch { throw new Error("Beagle launch assertion is malformed"); }

  const age = Date.now() - Number(a.ts || 0);
  if (!Number.isFinite(age)) throw new Error("Beagle launch assertion has no timestamp");
  // Both directions: a clock ahead of ours is as suspect as one behind.
  if (Math.abs(age) > maxAgeMs) throw new Error("Beagle launch assertion has expired");
  if (!verifyLaunch(a.userid, location.origin, a.ts, a.sig)) throw new Error("Beagle launch signature did not verify");
  return { ...a, assertion: m[1] };
}
