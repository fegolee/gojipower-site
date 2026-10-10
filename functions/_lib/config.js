// 配置检查。GOJI_KV 必须是 KV 命名空间绑定，不是文本变量 ——
// 在面板的「Variables and secrets」里把它填成 Text 会让 env.GOJI_KV 变成一个字符串，
// 真值判断照样通过，然后在 .put() 处炸成 500。一个说不清原因的 500 比 503 难查得多，
// 所以这里按「有没有 get/put 方法」判，而不是按真值判。
export function kvProblem(env) {
  const kv = env && env.GOJI_KV;
  if (!kv) return "KV binding GOJI_KV is missing";
  if (typeof kv.get !== "function" || typeof kv.put !== "function")
    return "GOJI_KV is set but is not a KV namespace binding (looks like a plain text variable) — bind it under Bindings, not Variables and secrets";
  return null;
}
