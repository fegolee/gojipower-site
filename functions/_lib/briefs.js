// 研报的存储形状与载荷清洗。发布和读取两个路由共用这一份 ——
// 各写一遍迟早会写出两个形状。
//
// 六条裁决写在这里，因为它们不是实现细节。④⑤⑥ 是 2026-11-26 推送方
// 把第一版读完之后改的，三条都是「schema 过、承诺破、还不报错」那一类：
//
// ① **事实与解读是两个字段，不是一段正文。** 首页第 01 节对外承诺
//    「事实与解读分开印，解读那一节明确标注不带任何预测权重」。
//    只活在文案里的承诺，会在第一次赶时间的时候被打破；做成载荷的形状之后，
//    混在一起的简报**发不进来**。
//
// ② **不收 HTML，只收纯文本。** 渲染端用 textContent 落地，不走 innerHTML。
//    推送方是另一台机器上的 Agent —— 收 HTML 等于把 gojipower.xyz 上的
//    脚本注入权交出去。这一条比排版重要。
//
// ③ **visibility 没有默认值。** 一期简报在门里还是门外是产品决定，
//    和 GATE_MIN_USD 同一类（那个也刻意没有默认值）。推送方必须自己说，
//    页面也把它显示出来 —— 否则「门后内容」在别处公开发着，这道门就是装饰。
//
// ④ **facts / reading 只收数组，字符串直接 400。**
//    第一版允许传一整段文本、按空行切条，想着「省得推送方先切好」。
//    推送方指出了它真正的后果：他们的自然段是**在一段之内**把事实和解读
//    连着写的（「…净流入 +5,869 BTC。…价格在涨、币却往交易所走，这是最矛盾的一项。」）。
//    按空行切，整段进 facts，解读被印在「事实」底下，而免责标签管不到它 ——
//    **服务端返 200，页面看起来一切正常。** 正是裁决 ① 要防的那件事，
//    靠这个字段本身拦不住。切条是发布方的判断，不是分隔符的判断，
//    所以这里把它变成一个必须显式做出的动作：传数组。
//    （刻意**不**写一个「这段像不像夹带解读」的启发式判断：会误伤的检查
//    比没有检查更糟，而且它会让人以为服务端在替他把关。）
//
// ⑤ **一期只有一种语言。** 第一版有 titleZh / factsZh / readingZh，
//    暗示中英是同一段的两个版本。推送方说明那不成立：两边各自独立写，
//    同一天中文 985 字分 5 条、英文 2,430 字符分三节，连给出的统计量都不同。
//    把它们当成一期的双语版呈现，是对读者说了一句假话。所以 lang 必填，
//    两份独立产出就是**两期**，页面逐条标出语言。那三个旧字段现在**显式报错**，
//    不是静默丢弃 —— 以为存进去了其实没存，又是一个 200 的谎。
//
// ⑥ **sources 的 url 可选。** 有一条线的事实是自己从交易所 API 算出来的，
//    没有可引用的网页。强制要 url 只会逼出一个假链接。没有链接的来源
//    就写成一句出处说明；页面也写明「没有链接不等于未经核实」。
//
// 载荷字段是**白名单**：认不得的键一律 400。静默忽略一个推送方以为存下来了的
// 字段，和 ⑤ 里那个问题是同一个。
//
// 刻意不收的字段：
//   · 任何「谁可以读」的名单 —— 能不能读由本站的门判，永不由推送方指定。
//   · 推送方声明的发布时间 —— 我们核不了。只记**我们收到的时刻**（at）；
//     他要说这期覆盖哪一天，用 covers，页面明示那是来源自己的说法。
//   · 阅读记录 —— 不存谁读了哪一期。

export const INDEX_KEY = "brief:index";
// 两条线各自每天一期，将来可能中英各一份 —— 60 期只够半个月。
// 索引里一条摘要约 300 字节，180 条约 54 KB，离 KV 的上限还远。
export const KEEP = 180;
export const itemKey = (id) => `brief:item:${id}`;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

// 允许出现的键。多一个就 400，并把那个键名报回去。
export const ALLOWED = new Set([
  "id", "visibility", "lang", "title", "facts", "reading", "sources", "alsoPostedTo", "covers",
]);
// 退役的键单独列出来，好给一句说得清的话，而不是一句「不认识这个字段」。
export const RETIRED = {
  titleZh: "one brief is one language now — send a second brief with lang:\"zh\" instead",
  factsZh: "one brief is one language now — send a second brief with lang:\"zh\" instead",
  readingZh: "one brief is one language now — send a second brief with lang:\"zh\" instead",
  publishedAt: "the receipt time is recorded server-side; use covers to state the period this brief covers",
};

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

// 只收数组（裁决 ④）。返回 null 表示形状不对，调用方据此报 400。
//
// **每条至少 2 个字符**，这一条是 2026-11-26 推送方报来的一个洞补的：
// 他的 build_payload 第一版写的是 `list(facts)`，而 Python 里
// `list("一整段")` 会把字符串切成**逐字**数组 ["一","整","段"] ——
// 每条都是合法的非空字符串，于是「只收数组」这道拦**被客户端的好意绕过去了**。
//
// 实测过边界，比他和我原先以为的都窄：他那段真实正文 117 个字，
// 逐字切出 117 条 > maxItems 24，**已经会被挡下**（400 bad-facts）。
// 真正漏过去的只有「整段本身不超过 24 字」那一小片 —— 实测 list("涨跌互现")
// 四条单字返 200。加上这条最小长度，这个形状就彻底关死了。
//
// 说清它**不**管什么：任何语言里一个字符都不构成一条事实，所以这条没有误伤；
// 但它只认得「逐字切」这一种形状。客户端要是用空格把两句粘成一条，
// 服务端照样看不出来。**切条的判断在写稿的人那里，这里只负责让错误的形状
// 大声失败，而不是让它悄悄成功。**
const MIN_ITEM = 2;

export function items(v, maxItems, maxLen) {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out = [];
  for (const x of v) {
    const s = str(x, maxLen);
    if (!s || s.length < MIN_ITEM) return null;   // 空条目与单字条目都报错，不静默丢弃
    out.push(s);
  }
  return out;
}

export function sources(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 12) return null;
  const out = [];
  for (const s of v) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const raw = s.url == null ? null : str(s.url, 400);
    if (s.url != null && !raw) return null;
    let url = null;
    if (raw) {
      let u;
      try { u = new URL(raw); } catch { return null; }
      // 只收 http(s)。javascript: 与 data: 在渲染端是一个可点击的洞。
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      url = u.toString();
    }
    // 没有链接时必须有说明文字，否则这一条什么也没说。
    const label = str(s.label, 160) || (url ? new URL(url).host : null);
    if (!label) return null;
    out.push({ label, url });
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
  lang: r.lang,
  title: r.title,
  at: r.at,
  covers: r.covers || null,
  alsoPostedTo: r.alsoPostedTo || [],
  counts: {
    facts: r.facts.length,
    reading: (r.reading || []).length,
    sources: (r.sources || []).length,
    // 有几条来源是带链接的。门外看得见「3 条来源、0 条有链接」，
    // 而不是只看见一个 0 然后自己脑补成「没来源」。
    linked: (r.sources || []).filter((s) => s && s.url).length,
  },
});

export async function readIndex(env) {
  const raw = await env.GOJI_KV.get(INDEX_KEY);   // 抛就让它抛（见裁决 ④ 之外的那条：读失败 ≠ 没有）
  if (!raw) return [];
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error("brief index is not an array");
  return arr;
}
