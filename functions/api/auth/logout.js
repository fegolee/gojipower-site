import { json } from "../../_lib/http.js";
import { clearCookie } from "../../_lib/session.js";

export const onRequestPost = () => json({ ok: true }, 200, { "set-cookie": clearCookie() });
