#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/blog}"
ARCHIVE="${1:-}"

if [[ -z "${ARCHIVE}" || ! -f "${ARCHIVE}" ]]; then
  echo "用法：bash deploy/restore.sh /root/slhbond-backup-xxxx.tar.gz" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 运行。" >&2
  exit 1
fi

mkdir -p "${APP_DIR}"
echo "==> 恢复 ${ARCHIVE} 到 ${APP_DIR}"
tar -xzf "${ARCHIVE}" -C "${APP_DIR}"
echo "==> 重启容器"
cd "${APP_DIR}"
docker compose up -d --build
echo "恢复完成。"
