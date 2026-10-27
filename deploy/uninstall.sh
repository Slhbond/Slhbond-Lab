#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/blog}"
SERVICE="${SERVICE:-slhbond-blog}"
PURGE=0
YES=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --yes) YES=1 ;;
    -h|--help)
      cat <<'EOF'
用法：
  sudo bash deploy/uninstall.sh              # 停止服务，保留文章、配置、数据、图片
  sudo bash deploy/uninstall.sh --purge      # 删除整个项目目录（会二次确认）
  sudo bash deploy/uninstall.sh --purge --yes # 无确认彻底删除

环境变量：
  APP_DIR=/opt/blog SERVICE=slhbond-blog
EOF
      exit 0
      ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash deploy/uninstall.sh" >&2
  exit 1
fi

echo "==> 停止并禁用开机自启：${SERVICE}"
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
  systemctl disable --now "${SERVICE}" 2>/dev/null || true
fi
rm -f "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload 2>/dev/null || true

if [[ -f "${APP_DIR}/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
  echo "==> 停止容器"
  ( cd "${APP_DIR}" && docker compose down --remove-orphans ) || true
fi

if [[ "${PURGE}" -eq 1 ]]; then
  if [[ "${YES}" -ne 1 ]]; then
    echo
    echo "警告：即将删除 ${APP_DIR}，文章、图片、配置、数据都会丢失。"
    read -r -p "确认请输入 DELETE：" answer
    if [[ "${answer}" != "DELETE" ]]; then
      echo "已取消。"
      exit 1
    fi
  fi
  echo "==> 删除目录：${APP_DIR}"
  rm -rf "${APP_DIR}"
  echo "卸载完成（已彻底删除）。"
else
  echo
  echo "卸载完成（保留数据）。"
  echo "文章和配置仍在：${APP_DIR}"
  echo "如需彻底删除：sudo bash deploy/uninstall.sh --purge"
fi
