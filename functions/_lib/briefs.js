// 研报的存储形状与载荷清洗。发布和读取两个路由共用这一份 ——
// 各写一遍迟早会写出两个形状。
//
// 四条裁决写在这里，因为它们不是实现细节：
//
// ① **事实与解读是两个字段，不是一段正文。** 首页第 01 节对外承诺
//    「事实与解读分开印，解读那一节明确标注不带任何预测权重」。
//    只活在文案里的承诺，会被第一次不守它的推送打破；做成载荷的形状之后，
//    混在一起的简报**发不进来**。
//
// ② **不收 HTML，只收纯文本。** 渲染端用 textContent 落地，不走 innerHTML。
//    推送方是另一台机器上的 Agent —— 收 HTML 等于把 gojipower.xyz 上的
//    脚本注入权交出去。这一条比排版重要。
//
// ③ **visibility 没有默认值。** 一期简报在门里还是门外是产品决定，
//    和 GATE_MIN_USD 同一类（那个也刻意没有默认值）。推送方必须自己说，
//    页面也把它显示出来 —— 否则「门后内容」在别处公开发着，这道门就是装饰，
//    而本站的硬规矩是「永远是绿的灯是装饰，会变红的灯才是信息」。
//
// ④ **读失败和「还没有任何一期」必须分得开。** 空数组同时长得像这两者 ——
//    publicnode 那个 `{"result":[]}` 就是这么骗过我一次的。所以 readIndex
//    读失败**抛**，由路由报 503、页面显示「实时读取失败」，而不是静悄悄
//    显示成「还没有简报」。
//
// 刻意不收的字段：
//   · 任何「谁可以读」的名单 —— 能不能读由本站的门判，永不由推送方指定。
//   · 推送方声明的发布时间 —— 我们核不了。只记**我们收到的时刻**（at）；
//     他要说这期覆盖哪一天，用 covers，页面明示那是来源自己的说法。
//   · 阅读记录 —— 不存谁读了哪一期。

export const INDEX_KEY = "brief:index";
export const KEEP = 60;                       // index 里保留多少期
export const itemKey = (id) => `brief:item:${id}`;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// 不可见字符的码点表。刻意不用正则字符类 —— 这一段要经过好几层转义，
// 而 \uXXXX 在其中任何一层被展开成真字符，写出来的就是另一个意思了（实测吃过一次）。
const ZAP = new Set([0, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0xfeff]);

export function str(v, max) {
  if (typeof v !== "string") return null;
  // 去掉 NUL 与零宽字符：它们在页面上不可见，却能让两条看起来一样的标题不相等。
  let s = "";
  for (const ch of v) if (!ZAP.has(ch.codePointAt(0))) s += ch;
  s = s.trim();
  return !s || s.length > max ? null : s;
}

// 允许一段文本或一个字符串数组。一段文本按空行切条 ——
// 推送方那边更可能是一段话，强迫它先切好只会换来一个 400。
export function lines(v, maxItems, maxLen) {
  let arr;
  if (typeof v === "string") arr = v.split(/\n\s*\n/);
  else if (Array.isArray(v)) arr = v;
  else return null;
  const out = [];
  for (const x of arr) {
    const s = str(x, maxLen);
    if (s) out.push(s);
    if (out.length > maxItems) return null;
  }
  return out;
}

export function sources(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 12) return null;
  const out = [];
  for (const s of v) {
    if (!s || typeof s !== "object") return null;
    const raw = str(s.url, 400);
    if (!raw) return null;
    let u;
    try { u = new URL(raw); } catch { return null; }
    // 只收 http(s)。javascript: 与 data: 在渲染端是一个可点击的洞。
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    out.push({ label: str(s.label, 120) || u.host, url: u.toString() });
  }
  return out;
}

export function postedTo(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 8) return null;
  const out = [];
  for (const x of v) {
    const s = str(x, 32);
    if (!s || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(s)) return null;
    out.push(s);
  }
  return out;
}

// index 里只放摘要。读列表是 1 次 KV 读，展开正文才按期各读一次 ——
// 否则一页 10 期就是 10 次读，而大多数访客只看标题。
export const summary = (r) => ({
  id: r.id,
  visibility: r.visibility,
  title: r.title,
  titleZh: r.titleZh || null,
  at: r.at,
  covers: r.covers || null,
  alsoPostedTo: r.alsoPostedTo || [],
  counts: {
    facts: r.facts.length,
    reading: (r.reading || []).length,
    sources: (r.sources || []).length,
  },
});

export async function readIndex(env) {
  const raw = await env.GOJI_KV.get(INDEX_KEY);   // 抛就让它抛（见裁决 ④）
  if (!raw) return [];
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error("brief index is not an array");
  return arr;
}
