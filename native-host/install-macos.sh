#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST="$ROOT/host-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "请先复制 host-manifest.example.json 为 host-manifest.json，并填写扩展 ID 和绝对 path。" >&2
  exit 1
fi
chmod +x "$ROOT/host.js"
mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
cp "$MANIFEST" "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yunzhongshu.clipbridge.json"
echo "Native Messaging host 已注册。请重新加载扩展后重试。"
