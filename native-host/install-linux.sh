#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST="$ROOT/host-manifest.json"
[ -f "$MANIFEST" ] || { echo "请先准备 host-manifest.json" >&2; exit 1; }
chmod +x "$ROOT/host.js"
mkdir -p "$HOME/.config/google-chrome/NativeMessagingHosts"
cp "$MANIFEST" "$HOME/.config/google-chrome/NativeMessagingHosts/com.yunzhongshu.clipbridge.json"
echo "Native Messaging host 已注册。请重新加载扩展。"
