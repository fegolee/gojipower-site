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
