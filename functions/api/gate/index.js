import { json, bad } from "../../_lib/http.js";
import { kvProblem } from "../../_lib/config.js";
import { gateSpec } from "../../_lib/gate.js";

// 门槛的公开契约。Beagle、dexfans、任何第三方都应该读这里，
// 而不是各自再实现一遍链上读取 —— 那样门槛一改就有人落后。
export function onRequestGet({ env }) {
  const kvErr = kvProblem(env);
  if (kvErr) return bad("not-configured", kvErr, 503);
  return json({
    ok: true,
    ...gateSpec(env),
    check: {
      // 按链上地址问。任何人都能自己读同样的链得到同样的答案。
      address: "/api/gate/{address}",
      // 按 Beagle 身份问。给 registerRoomGate 这类只握着 userid 的调用方用 ——
      // userid ↔ 钱包这一跳是两道门各一个签名换来的，响应里不含钱包地址。
      beagle: "/api/gate/beagle/{userid}",
    },
  });
}
