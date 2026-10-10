var MINT="DYCLLejhtfyCDUY8ygBx7YuwfcdaRzLo7nHHVGdApump";
var TREASURY_ATA="22Uz4CKMeKS84Z4t7dmWsmZMTUS1XK4wSpJkZzq8T3S2";
// 2026-10-04 从本站 origin 实测：api.mainnet-beta.solana.com 对浏览器请求返回 403
// （从终端 curl 正常，所以第 08 节那些命令依然成立）。drpc 400、ankr 403、public-rpc 拒绝。
// 只有 publicnode 可用，所以它排第一，后面两个作为将来可能恢复时的回退。
var RPCS=["https://solana-rpc.publicnode.com",
          "https://api.mainnet-beta.solana.com",
          "https://solana.drpc.org"];
var LS=function(k,v){try{return v===undefined?localStorage.getItem(k):localStorage.setItem(k,v)}catch(e){return null}};

var lang=LS("goji.lang")||"en";
function applyLang(){
  document.querySelectorAll("[data-en]").forEach(function(el){
    var t=el.getAttribute("data-"+lang); if(t) el.textContent=t;
  });
  var lb=document.getElementById("lang");
  if(lb) lb.textContent = lang==="en" ? "中文" : "EN";
  document.documentElement.lang = lang==="zh" ? "zh-Hans" : "en";
}
var LANGBTN=document.getElementById("lang");
if(LANGBTN) LANGBTN.addEventListener("click",function(){
  lang = lang==="en" ? "zh" : "en"; LS("goji.lang",lang); applyLang(); uplink(null);
});

// 本站只有一个视觉世界（深色终端），不提供主题切换——浅色下的 HUD 两头不靠。
// 背景与每个颜色都显式画出，所以它在任何宿主底色上都成立。

// 上行状态灯：反映实时取数真的成没成。
// 永远是绿的灯是装饰，会变红的灯才是信息——这是本站每个 HUD 元素的准入条件。
// 一个永远停在「连接中」的灯比没有灯更糟，所以不读链的页面干脆不放这个指示器，
// 这里容忍它不存在。
var UP=document.getElementById("uplink"), upOk=0, upBad=0;
function uplink(ok){
  if(ok===true) upOk++; else if(ok===false) upBad++;
  if(!UP) return;
  UP.className = upBad ? (upOk ? "live" : "down") : (upOk ? "live" : "");
  UP.querySelector("b").textContent =
    (upBad && !upOk) ? (lang==="zh"?"链路中断":"uplink down")
    : upBad          ? (lang==="zh"?"部分可用":"partial")
    : upOk           ? (lang==="zh"?"链路正常":"uplink live")
                     : (lang==="zh"?"连接中":"linking");
}

var CABTN=document.getElementById("copyca");
if(CABTN) CABTN.addEventListener("click",function(){
  var b=this;
  (navigator.clipboard?navigator.clipboard.writeText(MINT):Promise.reject()).then(function(){
    b.textContent="copied ✓"; setTimeout(function(){b.textContent="DYCL…Apump ⧉"},1400);
  }).catch(function(){ b.textContent=MINT.slice(0,8)+"…"; });
});

var fmtU=function(n,d){return "$"+n.toLocaleString("en-US",{minimumFractionDigits:d||0,maximumFractionDigits:d||0})};
var fmtN=function(n){return Math.round(n).toLocaleString("en-US")};

// 逐个试，第一个真正给出 result 的算数。
// 不要用 r.ok 判断：403 的响应体也能 .json() 成功，而里面没有 result——
// 「拿到了一个 JSON」和「拿到了答案」是两件事。
function rpc(method,params){
  var body=JSON.stringify({jsonrpc:"2.0",id:1,method:method,params:params});
  var i=0;
  function next(){
    if(i>=RPCS.length) return Promise.reject(new Error("all RPC endpoints failed"));
    var u=RPCS[i++];
    return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:body})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j || j.result===undefined) throw new Error("no result"); return j; })
      .catch(next);
  }
  return next();
}

// A stale number shown as if it were live is exactly what this page argues against,
// so when the chain read fails, the cell says so instead of quietly keeping its fallback.
function markStale(id,asof){
  var d=asof||"2026-10-02";
  var el=document.getElementById(id); if(!el) return;
  var cell=el.parentNode, sub=cell.querySelector(".s");
  if(sub) sub.textContent = lang==="zh" ? ("截至 "+d+" · 实时读取失败") : ("as of "+d+" · live read failed");
  cell.classList.add("stale");
}

// 用 getAccountInfo 读金库余额，不用 getTokenAccountBalance。
// 2026-10-04 实测：publicnode 把 getTokenAccountBalance 与 getTokenSupply 归为
// 「indexed 请求」，要付费 token（403）；而 getAccountInfo 免费，返回的是同一个数。
// NFT 金库的 GOJI ATA：铸造所得回购来的那一笔，同样用 getAccountInfo。
if(document.getElementById("nBuyback")) rpc("getAccountInfo",["G7RymqGpUhoG7UbfRdBs8hQw9Tp4ZZVuUoh8tz3Pck6Q",{encoding:"jsonParsed"}]).then(function(d){
  var i=d&&d.result&&d.result.value&&d.result.value.data.parsed.info;
  if(!i||!i.tokenAmount) throw new Error("no value");
  document.getElementById("nBuyback").textContent=fmtN(parseFloat(i.tokenAmount.uiAmountString));
  uplink(true);
}).catch(function(){ markStale("nBuyback","2026-10-06"); uplink(false); });

if(document.getElementById("mTreas")) rpc("getAccountInfo",[TREASURY_ATA,{encoding:"jsonParsed"}]).then(function(d){
  var i=d&&d.result&&d.result.value&&d.result.value.data.parsed.info;
  if(!i||!i.tokenAmount) throw new Error("no value");
  document.getElementById("mTreas").textContent=fmtN(parseFloat(i.tokenAmount.uiAmountString));
  uplink(true);
}).catch(function(){ markStale("mTreas"); uplink(false); });

// Candy Machine：字段偏移不是查文档来的，是**锚定**出来的——
// 在账户数据里搜到 collection 公钥落在偏移 72，往后依次是
// itemsRedeemed@104、itemsAvailable@112（解出的 4 / 1000 与站点计数器吻合，故可信）。
// 用 dataSlice 只取那 16 字节，不必拉整个 124KB 账户。
var CANDY="GhXYjrSQcgKtDQbo2kcDGCtrgNJkv4FWKKzbo2csn2GQ";
if(document.getElementById("nMinted")) rpc("getAccountInfo",[CANDY,{encoding:"base64",dataSlice:{offset:104,length:16}}]).then(function(d){
  var v=d&&d.result&&d.result.value;
  if(!v||!v.data) throw new Error("no data");
  var bin=atob(v.data[0]), u=new Uint8Array(16);
  for(var i=0;i<16;i++) u[i]=bin.charCodeAt(i);
  var dv=new DataView(u.buffer);
  var redeemed=Number(dv.getBigUint64(0,true)), avail=Number(dv.getBigUint64(8,true));
  // 若将来程序升级挪了字段，解出来的会是垃圾值。宁可标陈，也不要印一个看着像数字的东西。
  if(!(avail>0 && avail<=1e7 && redeemed>=0 && redeemed<=avail)) throw new Error("implausible");
  document.getElementById("nMinted").textContent=fmtN(redeemed);
  document.getElementById("nAvail").textContent=fmtN(avail);
  uplink(true);
}).catch(function(){ markStale("nMinted"); markStale("nAvail"); uplink(false); });

if(document.getElementById("mMint")) rpc("getAccountInfo",[MINT,{encoding:"jsonParsed"}]).then(function(d){
  var i=d&&d.result&&d.result.value&&d.result.value.data.parsed.info;
  if(!i) throw new Error("no value");
  document.getElementById("mMint").textContent = i.mintAuthority===null ? "null" : "SET";
  uplink(true);
}).catch(function(){ markStale("mMint"); uplink(false); });

applyLang();

applyLang();

/* ───────────────── 钱包门：连接 → 签名 → 读持仓 ─────────────────
   零依赖。钱包插件自己注入 signMessage，签名验证在 Pages Function 里做。
   按钮是用 JS 注入的，不写进 5 个页面的 HTML —— 没有 JS 的话这个按钮
   本来也不能用，与其留一个点不动的死按钮，不如不渲染。                      */

var B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58enc(buf) {
  var bytes = Array.prototype.slice.call(buf), digits = [];
  for (var i = 0; i < bytes.length; i++) {
    var c = bytes[i];
    for (var j = 0; j < digits.length; j++) { c += digits[j] << 8; digits[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { digits.push(c % 58); c = (c / 58) | 0; }
  }
  var out = "";
  for (var k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (var m = digits.length - 1; m >= 0; m--) out += B58A[digits[m]];
  return out;
}

function wprovider() {
  return (window.phantom && window.phantom.solana) || window.solana || window.solflare || null;
}
function wname(pv) {
  if (!pv) return "none";
  var n = [];
  if (pv.isPhantom) n.push("Phantom");
  if (pv.isSolflare) n.push("Solflare");
  if (pv.isBackpack) n.push("Backpack");
  if (pv.isBraveWallet) n.push("Brave");
  if (pv.isGlow) n.push("Glow");
  return n.length ? n.join("/") : "unknown";
}
// 钱包之间 signMessage 的签名不一致：有的接受第二个显示编码参数，有的传了就炸
// （"Unexpected error"）。所以先按两个参数试，失败再退回一个参数。
function signWith(pv, msg) {
  return Promise.resolve()
    .then(function () { return pv.signMessage(msg, "utf8"); })
    .catch(function (e) {
      if (e && (e.code === 4001 || /reject|denied|cancel/i.test(e.message || ""))) throw e;
      return pv.signMessage(msg);
    });
}
var shortAddr = function (a) { return a ? a.slice(0, 4) + "…" + a.slice(-4) : ""; };
var T = function (en, zh) { return lang === "zh" ? zh : en; };

var panel, wbtn;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "wpanel";
  panel.hidden = true;
  document.body.appendChild(panel);
  document.addEventListener("click", function (e) {
    if (panel.hidden) return;
    if (panel.contains(e.target) || (wbtn && wbtn.contains(e.target))) return;
    panel.hidden = true;
  });
  return panel;
}

function row(k, v, cls) {
  return '<div class="wrow"><span class="wk">' + k + '</span><span class="wv' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
}

function renderPanel(s) {
  var p = ensurePanel();
  if (!s || !s.signedIn && !s.wallet) {
    p.innerHTML = '<div class="whead">' + T("Not signed in", "未登录") + "</div>";
    p.hidden = false; return;
  }
  var unknown = '<span style="color:var(--muted)">' + T("unknown", "未知") + "</span>";
  var bal = s.balance == null ? unknown : fmtN(s.balance);
  var usd = s.usd == null ? unknown : "$" + s.usd.toFixed(2);
  var thr = s.threshold == null ? T("not set", "未设定") : "$" + s.threshold;
  var meets = s.meets == null
    ? '<span style="color:var(--amber)">' + T("not determined", "未判定") + "</span>"
    : s.meets ? '<span style="color:var(--good)">' + T("yes", "是") + "</span>"
              : '<span style="color:var(--bad)">' + T("no", "否") + "</span>";
  var nft = !s.nft || s.nft.held == null
    ? '<span style="color:var(--muted)">' + T("cannot look up", "查不到") + "</span>"
    : s.nft.held ? '<span style="color:var(--good)">' + s.nft.count + "</span>" : T("none", "无");
  var reach = s.carrierAddress
    ? '<span style="color:var(--good)">' + T("yes", "是") + "</span>"
    : '<span style="color:var(--amber)">' + T("no — needs Beagle sign-in", "否 — 需补 Beagle 登录") + "</span>";

  p.innerHTML =
    '<div class="whead">' + T("Signed in", "已登录") + "</div>" +
    row(T("wallet", "钱包"), '<span class="wmono">' + shortAddr(s.wallet) + "</span>") +
    row("GOJIPOWER", bal) +
    row(T("value", "估值"), usd) +
    row(T("threshold", "门槛"), thr) +
    row(T("meets", "是否达标"), meets) +
    row(T("Genesis NFT", "Genesis NFT"), nft) +
    row(T("reachable", "可触达"), reach) +
    (s.readFailed ? '<div class="wnote" style="color:var(--bad)">' + T("read failed: ", "读取失败：") + s.readFailed.join(", ") + "</div>" : "") +
    '<div class="wnote">' + T(
      "Holdings are read from the chain, not from anything you typed. Nothing here is stored except the wallet address and the time.",
      "持仓是实时读自链上的，不是你填的。除了钱包地址和时间，这里不存别的。") + "</div>" +
    '<button class="chip" id="wout" style="margin-top:12px">' + T("Sign out", "退出") + "</button>";

  p.querySelector("#wout").addEventListener("click", function () {
    fetch("/api/auth/logout", { method: "POST" }).then(function () { setBtn(null); panel.hidden = true; });
  });
  p.hidden = false;
}

function setBtn(s) {
  if (!wbtn) return;
  if (s && s.signedIn) { wbtn.textContent = shortAddr(s.wallet); wbtn.classList.add("on"); }
  else { wbtn.textContent = T("Connect", "连接钱包"); wbtn.classList.remove("on"); }
  wbtn.disabled = false;
}

function walletError(msg) {
  var p = ensurePanel();
  p.innerHTML = '<div class="whead" style="color:var(--bad)">' + T("Sign-in failed", "登录失败") + "</div>" +
    '<div class="wnote">' + msg + "</div>";
  p.hidden = false;
}

function signIn() {
  var pv = wprovider();
  if (!pv) {
    walletError(T("No Solana wallet found in this browser. Phantom, Solflare and Backpack all work.",
                  "这个浏览器里没有检测到 Solana 钱包。Phantom、Solflare、Backpack 都可以。"));
    return;
  }
  wbtn.disabled = true;
  wbtn.textContent = T("Signing…", "签名中…");
  var address;
  Promise.resolve(pv.connect())
    .then(function (res) {
      address = (res && res.publicKey ? res.publicKey : pv.publicKey).toString();
      return fetch("/api/auth/nonce").then(function (r) { return r.json(); });
    })
    .then(function (n) {
      if (!n || !n.ok) throw new Error(T("could not get a nonce from the server", "没能从服务端取到 nonce"));
      // 签的是本页真实的 origin；服务端按它自己收到请求的 host 校验，不看这里传什么。
      var msg = new TextEncoder().encode("beagle-meet-wallet\n" + location.origin + "\n" + n.nonce);
      return signWith(pv, msg).then(function (out) {
        var raw = out && out.signature ? out.signature : out;
        var sig = typeof raw === "string" ? raw : b58enc(raw);
        return fetch("/api/auth/wallet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ walletType: "solana", address: address, nonce: n.nonce, sig: sig }),
        });
      });
    })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
    .then(function (x) {
      if (x.status !== 200 || !x.j.ok) throw new Error((x.j && x.j.message) || ("HTTP " + x.status));
      x.j.signedIn = true;
      setBtn(x.j); renderPanel(x.j);
    })
    .catch(function (e) {
      try { console.error("[gojipower] sign-in failed:", e); } catch (_) {}
      // 4001 是用户在钱包里点了拒绝，那不是错误，是一个决定。
      if (e && (e.code === 4001 || /reject|denied|cancel/i.test(e.message || ""))) {
        setBtn(null);
        walletError(T("Signature declined in the wallet.", "你在钱包里取消了签名。"));
        return;
      }
      // Phantom 在 connect 里抛 -32603「Unexpected error」而且不弹窗，实测是扩展
      // 内部出错而不是站点被拒：消息通道本身是通的（同一时刻 request() 能收到正常
      // 的业务错误）。最常见的两种是钱包被锁、或者扩展里还没有钱包。
      // 原样显示「Unexpected error」等于把人卡死在一句没有信息的话上。
      if (e && e.code === -32603) {
        setBtn(null);
        walletError(T(
          "The wallet extension errored internally before showing a prompt (code -32603). Open " + wname(wprovider()) + " from the toolbar, unlock it, make sure an account exists, then try again. The page reached the extension fine, so this is not a site permission.",
          wname(wprovider()) + " 扩展在弹窗之前内部出错了（code -32603）。请点开工具栏里的钱包图标，解锁它、确认里面已经有账户，然后再试一次。页面和扩展之间是通的，所以不是站点授权的问题。"));
        return;
      }
      var bits = [];
      if (e && e.message) bits.push(e.message);
      if (e && e.code !== undefined) bits.push("code " + e.code);
      if (e && e.name && e.name !== "Error") bits.push(e.name);
      if (!bits.length) bits.push(String(e));
      bits.push(T("wallet: ", "钱包：") + wname(wprovider()));
      bits.push(T("step: ", "步骤：") + (address ? "signMessage" : "connect"));
      setBtn(null); walletError(bits.join(" · "));
    });
}

(function initWallet() {
  var bar = document.querySelector(".topin");
  var langBtn = document.getElementById("lang");
  if (!bar || !langBtn) return;
  wbtn = document.createElement("button");
  wbtn.className = "chip wchip";
  wbtn.id = "wallet";
  wbtn.textContent = T("Connect", "连接钱包");
  bar.insertBefore(wbtn, langBtn);
  wbtn.addEventListener("click", function () {
    if (wbtn.classList.contains("on")) {
      var p = ensurePanel();
      if (!p.hidden) { p.hidden = true; return; }
      fetch("/api/auth/session").then(function (r) { return r.json(); }).then(renderPanel);
    } else signIn();
  });
  // 已有会话就直接显示，省掉一次重复签名
  fetch("/api/auth/session").then(function (r) { return r.json(); }).then(function (s) {
    if (s && s.signedIn) setBtn(s);
  }).catch(function () {});
})();
