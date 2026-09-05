#!/usr/bin/env bash
# 🦞 claw-fry-cards 测试环境 — 飞书凭据一键填写
#
# 用法:
#   ./set-feishu-credentials.sh <app_id> <app_secret>
#
# 会同时写入 openclaw.json 的两处（官方通道 + claw-fry-cards 插件），
# 然后重启 claw-gw 容器使配置生效。
set -euo pipefail

APP_ID="${1:?用法: $0 <app_id> <app_secret>}"
APP_SECRET="${2:?用法: $0 <app_id> <app_secret>}"

if ! docker ps --format '{{.Names}}' | grep -qx 'claw-gw'; then
  echo "❌ 找不到运行中的 claw-gw 容器。先启动: docker start claw-gw"
  exit 1
fi

docker exec claw-gw node -e '
const fs = require("fs");
const p = "/home/node/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const appId = process.argv[1], appSecret = process.argv[2];
c.channels.feishu.appId = appId;
c.channels.feishu.appSecret = appSecret;
c.plugins.entries["claw-fry-cards"].config.feishu.app_id = appId;
c.plugins.entries["claw-fry-cards"].config.feishu.app_secret = appSecret;
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("✅ credentials written (channels.feishu + plugins.entries.claw-fry-cards)");
' "$APP_ID" "$APP_SECRET"

docker restart claw-gw >/dev/null
echo "🔄 claw-gw 重启中，10 秒后看日志确认:"
echo "   docker logs claw-gw --since 60s | grep 🦞"
