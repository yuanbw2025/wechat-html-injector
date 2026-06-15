#!/usr/bin/env bash
# 打包云中书公众号排版引擎 -> engine.js
# 依赖：与本仓库同级存在 ../yuntype（云中书源码）。仅开发机需要；engine.js 已提交，部署无需构建。
set -e
cd "$(dirname "$0")"
if [ ! -d ../yuntype/src ]; then
  echo "❌ 找不到 ../yuntype/src，请确保云中书仓库在同级目录"; exit 1
fi
npx --yes esbuild engine/entry.ts \
  --bundle --format=iife --legal-comments=none \
  --outfile=engine.js --log-level=warning
echo "✅ engine.js 生成完毕：$(wc -c < engine.js) 字节"
