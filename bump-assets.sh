#!/bin/sh
# 给 site.js / site.css 的引用加内容哈希。
#
# 为什么需要：这个域名的 Cloudflare 区域设置把浏览器缓存改写成 4 小时，
# 源站发什么（包括 _headers 里的 no-cache）都会被覆盖。于是 index.html
# 立刻更新、脚本却可能是 4 小时前的 —— 新 HTML 配旧脚本。
# HTML 本身是每次校验的，所以只要 HTML 里的 URL 变了，新文件一定会被取。
#
# 这不是构建步骤：改完前端在本地跑一次，产物（改过的 HTML）直接提交。
# 部署仍然只是复制文件。
set -e
cd "$(dirname "$0")"
JS=$(shasum -a 256 assets/site.js | cut -c1-10)
CSS=$(shasum -a 256 assets/site.css | cut -c1-10)
for f in index.html nft.html event.html dexfans.html 404.html; do
  [ -f "$f" ] || continue
  sed -i '' -E "s#(assets/site\.js)(\?v=[0-9a-f]+)?#\1?v=$JS#g; s#(assets/site\.css)(\?v=[0-9a-f]+)?#\1?v=$CSS#g" "$f"
done
echo "site.js  ?v=$JS"
echo "site.css ?v=$CSS"
grep -o 'assets/site\.[a-z]*?v=[0-9a-f]*' index.html | sort -u
