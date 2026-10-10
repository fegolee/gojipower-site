// 只提供 beagle-connect 用到的那两个函数，指向本仓库自己的实现。
// b58.js / xeddsa.js 是 functions/_lib/ 下同名文件的副本 —— 浏览器拿不到
// functions/ 目录（Pages 不把它当静态资源），所以必须在这里有一份。
// 副本由 ./bump-assets.sh 同步，test/auth.mjs 断言两边逐字节一致：
// 让「忘了同步」变成一个会失败的测试，而不是一个要靠记性的约定。
export { b58decode as base58ToBytes } from "./b58.js";
export { verifyDetached } from "./xeddsa.js";

// 注意：beagle-connect.js 的 URL 带了 ?v=，但它内部 import 的这几个文件没有，
// 所以它们仍可能被浏览器缓存最多 4 小时。这是可以接受的 ——
// 客户端这次验签只是给 UI 用的（signIn 在 resolve 前自己验一遍），
// **真正算数的是服务端那次验签**。客户端拿到旧版本最多是 UI 判断不准，
// 不构成安全问题。服务端的 xeddsa.js 永远是随 Function 一起部署的新版。
