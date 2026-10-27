#!/usr/bin/env bash
set -euo pipefail

# Slhbond Lab 一键安装脚本
# 用法：
#   sudo bash deploy/install.sh
#   APP_DIR=/opt/blog sudo -E bash deploy/install.sh

APP_DIR="${APP_DIR:-/root/blog}"
SERVICE_NAME="slhbond-blog"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash deploy/install.sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未安装 Docker，请先安装 Docker Engine 与 Compose 插件。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未找到 docker compose 插件，请先安装。" >&2
  exit 1
fi

echo "==> 安装目录：${APP_DIR}"
mkdir -p "${APP_DIR}/posts" "${APP_DIR}/data" "${APP_DIR}/public/images"

if [[ "${SRC_DIR}" != "${APP_DIR}" ]]; then
  echo "==> 复制代码到 ${APP_DIR}（保留 posts / data / config.js / public/images）"
  tar -C "${SRC_DIR}" --exclude='./posts' --exclude='./data' --exclude='./config.js' --exclude='./public/images' --exclude='./node_modules' --exclude='./.git' -cf - . | tar -C "${APP_DIR}" -xf -
  if [[ ! -f "${APP_DIR}/config.js" ]]; then
    cp "${SRC_DIR}/config.js" "${APP_DIR}/config.js"
    echo "==> 已创建默认 config.js（请登录后台修改密码）"
  fi
fi

# 全新安装时补上默认头像/示例图；已有图片目录则完全保留
if [[ -d "${SRC_DIR}/public/images" && -z "$(ls -A "${APP_DIR}/public/images" 2>/dev/null)" ]]; then
  cp -a "${SRC_DIR}/public/images/." "${APP_DIR}/public/images/" 2>/dev/null || true
fi

if [[ ! -f "${APP_DIR}/config.js" ]]; then
  echo "缺少 config.js，无法启动。" >&2
  exit 1
fi

echo "==> 构建并启动容器"
cd "${APP_DIR}"
docker compose up -d --build

echo "==> 配置开机自启（systemd）"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Slhbond Lab Blog
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

echo
echo "安装完成。"
echo "  前台: http://<服务器IP>:3000/"
echo "  后台: http://<服务器IP>:3000/admin/"
echo "  目录: ${APP_DIR}"
echo "  自启: systemctl status ${SERVICE_NAME}"
echo "  备份: bash deploy/backup.sh"
echo "  卸载: sudo bash deploy/uninstall.sh"
echo "首次登录后请立即在「站点设置」修改管理密码。"