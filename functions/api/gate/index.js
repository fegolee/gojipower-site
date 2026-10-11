import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { gateSpec } from "../../_lib/gate.js";

// 门槛的公开契约。Beagle、dexfans、任何第三方都应该读这里，
// 而不是各自再实现一遍链上读取 —— 那样门槛一改就有人落后。
export function onRequestGet({ env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  return json({ ok: true, ...gateSpec(env), check: "/api/gate/{address}" });
}
