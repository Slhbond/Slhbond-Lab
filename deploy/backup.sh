#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/blog}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-/root/slhbond-backup-${STAMP}.tar.gz}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "目录不存在：${APP_DIR}" >&2
  exit 1
fi

echo "==> 备份 ${APP_DIR} -> ${OUT}"
tar -czf "${OUT}" -C "${APP_DIR}" posts config.js data public/images
echo "完成：${OUT}"
echo "迁移到新设备：解压到目标目录后运行 docker compose up -d --build，或执行 deploy/install.sh。"
