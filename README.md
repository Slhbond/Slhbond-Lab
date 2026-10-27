# Slhbond Lab 轻量博客系统

基于 Node.js + Express + Markdown 的个人博客，仿 Hexo NexT 主题风格。

> 当前版本：**v2.0.0**  
> [迁移说明](MIGRATION.md) · [更新日志](CHANGELOG.md)

## 特点

- **文件即文章** — 每篇文章是一个 `.md` 文件，放在 `posts/` 目录下
- **零构建** — 添加文章刷新即显示，无需重新构建
- **标准 Frontmatter** — 统一的文章元数据格式，导入/导出不会丢字段
- **后台管理** — 文章、标签、分类、关于页、站点设置全部 Web 化管理
- **Markdown 编辑器** — 分屏实时预览、工具栏、快捷键、图片粘贴/拖拽上传、本地草稿自动保存
- **本地保存 / 读取** — 一键导出标准格式 `.md`，也可导入已有 Markdown 文件继续编辑
- **Docker 部署** — 一条命令启动，升级代码不影响文章与配置
- **一键安装 / 开机自启** — `deploy/install.sh` 自动配置 systemd
- **图标本地化** — Font Awesome 随项目提供，不依赖外网 CDN，离线也能正常显示
- **单一浅色主题** — 参考站配色，深色顶栏 + 浅灰页底 + 白色内容，不提供明暗切换
- **顶部导航** — 站点标题、副标题和菜单在顶部；移动端自动收进三条横，无侧栏、无头像
- **首页卡片** — 每篇文章独立白色卡片，不再连成大长条
- **右侧文章目录** — 后端自动为 h2/h3 生成锚点，文章页右侧目录可点击跳转
- **阅读进度 / 回顶** — 右下角显示阅读百分比，点击一键回到顶部
- **自建目录** — 写作工具栏可插入 `[TOC]`，正文中自动生成目录
- **上一篇 / 下一篇** — 文章底部快速翻页
- **文章资源随 posts 迁移** — 图片存 `posts/assets/`，复制 posts 即完成迁移
- **响应式** — 桌面端和移动端自适应
- **本地搜索** — 客户端全文搜索
- **归档页** — 按日期分组，时间排序

## 快速开始

推荐用一键脚本（自动构建、启动并配置开机自启）：

```bash
sudo bash deploy/install.sh
```

默认安装到 `/root/blog`，也可指定目录：

```bash
APP_DIR=/opt/blog sudo -E bash deploy/install.sh
```

卸载（默认保留文章、配置、数据和图片）：

```bash
sudo bash deploy/uninstall.sh
```

彻底删除整个项目目录：

```bash
sudo bash deploy/uninstall.sh --purge
```

手动启动：

```bash
cd /root/blog
docker compose up -d --build
```

访问：

- 前台：`http://localhost:3000`
- 后台：`http://localhost:3000/admin/`
- 默认密码：见 `config.js` 的 `adminPassword`（仓库默认 `change-me`，**首次部署请立即修改**）

不使用 Docker：

```bash
npm install
npm start
```

## 目录结构

```
blog/
├── docker-compose.yml   # Docker 编排
├── Dockerfile           # Node 24 Alpine 镜像
├── package.json         # 依赖与 npm scripts
├── config.js            # 站点配置（后台「站点设置」会重写此文件）
├── server.js            # Express 服务与路由
├── lib/
│   ├── frontmatter.js   # 标准 Frontmatter 解析 / 序列化
│   ├── posts.js         # 文章读写、标签、分类、归档、设置
│   └── session-store.js # 文件会话存储（重启不掉登录）
├── test/
│   └── frontmatter.test.js  # node:test 单元测试
├── deploy/
│   ├── install.sh       # 一键安装 + systemd 开机自启
│   ├── backup.sh        # 备份文章/配置/数据/图片
│   └── restore.sh       # 恢复备份
├── posts/               # 📝 所有文章（Markdown 文件）
│   └── assets/          # 文章图片（随 posts 一起迁移）
├── public/
│   ├── css/style.css    # 基础主题
│   ├── css/layout.css   # 顶部导航 / 分类 / 文章页布局
│   ├── vendor/fontawesome/  # 本地图标字体（不依赖 CDN）
│   └── images/          # 站点图片（示例图等）
├── views/               # EJS 模板
│   └── admin/           # 后台模板
├── data/                # 运行时数据（Docker 挂载持久化）
│   ├── categories.json
│   ├── posts-order.json
│   ├── tags.json
│   └── sessions.json    # 登录会话
```

## 文章格式（标准）

每篇文章是一个 UTF-8 编码的 `.md` 文件，文件名即文章地址（slug）：

```markdown
---
title: 文章标题
date: 2026-07-12
time: 14:30
category: 开发技术
tags: [Node.js, 教程]
summary: 首页卡片上的一句话简介
excerpt: 文章标题下方的引导摘要（可选）
---

正文内容（Markdown 格式）

[TOC]

## 第一节

在正文任意位置写 `[TOC]`（或 `[[TOC]]`），会在这里生成目录；
h2/h3 标题会自动获得锚点，文章页右侧也会自动显示目录。
```

### 字段规则

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 文章标题；含 `: `、`#`、引号等字符时自动加引号 |
| `date` | 否 | `YYYY-MM-DD`，也兼容 `YYYY/MM/DD`；缺失时按当天处理 |
| `time` | 否 | `HH:mm`，用于归档页排序 |
| `category` | 否 | 单个分类名 |
| `tags` | 否 | 行内数组 `[a, b]` 或块数组；含逗号的标签会自动加引号 |
| `summary` | 否 | 首页卡片简述；留空自动截取正文前 200 字 |
| `excerpt` | 否 | 文章页顶部摘要 |

### 兼容性

- 支持 BOM、CRLF / LF 换行
- 支持引号字符串（`"a \"b\""`、`'a''b'`）
- 支持块数组：

  ```yaml
  tags:
    - Node
    - 教程
  ```

- 支持块文本 `summary: |`（多行）
- 未知字段会原样保留，不会被编辑器丢弃
- 保存时统一为「标准格式」：字段顺序固定、日期规范化、正文只去掉首尾空白

## 后台功能

| 模块 | 功能 |
|------|------|
| 仪表盘 | 文章/分类/标签/本月新增统计、总字数、最近文章、快捷操作 |
| 文章管理 | 新建/编辑/删除、拖拽排序、行内改日期/分类、标签增删、标题筛选 |
| Markdown 编辑器 | 分屏实时预览（真实站点样式）、工具栏（含插入目录）、Tab 缩进、快捷键、图片上传、本地草稿、导入/导出 |
| 整篇 Markdown 识别 | 把带 frontmatter 的整篇文章粘贴到任意输入框，自动填充标题/日期/分类/标签/正文 |
| 标签管理 | 添加/重命名/删除标签 |
| 分类管理 | 添加/重命名/删除分类 |
| 关于页面 | Markdown 编辑 + 预览 + 本地草稿 |
| 站点设置 | 标题/副标题/首页标题/首页副标题/首页公告/作者/描述/密码 |

### 编辑器快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/⌘ + S` | 保存文章 |
| `Ctrl/⌘ + Shift + S` | 保存到浏览器本地草稿 |
| `Ctrl/⌘ + B` | 加粗 |
| `Ctrl/⌘ + I` | 斜体 |
| `Ctrl/⌘ + K` | 插入链接 |
| `Ctrl/⌘ + Enter` | 保存文章 |
| `Tab` / `Shift + Tab` | 缩进 / 反缩进 |

编辑器会把草稿自动保存在浏览器 `localStorage`，误关页面后可恢复；点击「导出 .md」会下载与服务器保存完全一致的标准格式文件。

## 安装 / 开机自启

推荐使用一键脚本：

```bash
sudo bash deploy/install.sh
```

脚本会：

1. 创建 `posts/`、`data/`、`public/images/`（保留已有数据）；
2. `docker compose up -d --build`；
3. 写入 `/etc/systemd/system/slhbond-blog.service` 并 `systemctl enable --now`。

管理服务：

```bash
systemctl status slhbond-blog
systemctl restart slhbond-blog
systemctl disable slhbond-blog   # 取消开机自启
```

## 主题与个性化

- 全站固定为参考站风格的浅色主题，不提供明暗切换。
- 后台「站点设置」可改：站点标题、副标题、作者、SEO 描述、管理密码。
- 自我介绍直接写在「关于页面」，用 Markdown 排版，前台不显示个人资料卡和头像。

## 备份 / 迁移

```bash
bash deploy/backup.sh
# 默认生成 /root/slhbond-backup-日期-时间.tar.gz

bash deploy/restore.sh /root/slhbond-backup-xxxx.tar.gz
```

备份包含 `posts/`（含 `assets/` 图片）、`config.js`、`data/`、`public/images/`。

把文章迁移到另一台设备时，**只需复制整个 `posts/` 目录**（图片在 `posts/assets/`），再复制 `config.js` 即可；新设备启动后会自动识别标准 frontmatter 与图片。

升级代码时不要把仓库里的 `config.js` 覆盖到已修改密码的线上配置。

## 测试

```bash
npm test
```

覆盖 Frontmatter 特殊字符、BOM/CRLF、块数组、时区日期、标签增删改、重复 slug、目录穿越等场景。

## 安全说明

- 后台写操作需要登录；所有 POST 请求带同源校验，降低 CSRF 风险
- 图片上传需要登录，且只允许 PNG / JPG / GIF / WebP（校验文件头，拒绝 SVG）
- 文章 slug 经过严格校验，杜绝 `../` 目录穿越
- 登录失败有频率限制
- 会话保存在 `data/sessions.json`（权限 600），重启容器不会掉登录
- 建议在生产环境通过环境变量设置 `SESSION_SECRET`，并修改默认管理密码

## 技术栈

- Node.js 24 Alpine
- Express 4
- EJS 模板引擎
- markdown-it 渲染 + highlight.js 代码高亮
- express-session 会话管理（文件存储，见 `lib/session-store.js`）
- compression（gzip）
- Font Awesome 6 图标（本地托管）
- Docker + Docker Compose + systemd

## 已知限制

- 文件会话存储适合单进程/单容器；多副本部署需要换成共享存储
- 文章每次请求从磁盘读取（带 mtime 缓存），文章量特别大时可再引入索引
- 没有日期的文章不会出现在归档页
- 客户端搜索每篇只索引正文前 1200 字
- 一键安装脚本面向 Linux + systemd（Docker 环境）