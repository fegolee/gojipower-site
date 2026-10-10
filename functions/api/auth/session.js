import { json } from "../../_lib/http.js";
import { verify, readCookie } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) return json({ ok: false, signedIn: false, reason: "not-configured" }, 503);
  const token = readCookie(request);
  const payload = token ? await verify(token, env.SESSION_SECRET) : null;
  if (!payload) return json({ ok: true, signedIn: false });
  return json({
    ok: true, signedIn: true,
    wallet: payload.wallet,
    decentUserid: payload.decentUserid,
    carrierAddress: payload.carrierAddress,
    proven: payload.proven,
    expiresAt: payload.exp,
    needsBeagleSignIn: !payload.carrierAddress,
  });
}
