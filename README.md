# Slhbond Lab轻量博客系统

基于 Node.js + Express + Markdown 的个人博客，仿 Hexo NexT 主题风格。

## 特点

- **文件即文章** — 每篇文章是一个 `.md` 文件，放在 `posts/` 目录下
- **零构建** — 添加文章刷新即显示，无需重新构建
- **Docker 部署** — 一条命令启动，环境隔离
- **易迁移** — 拷贝整个目录到新设备，`docker compose up -d` 搞定
- **后台管理** — Web 界面管理文章、标签、分类、站点设置
- **Markdown 写作** — 支持代码块高亮、行号、复制按钮、图片上传
- **暗色模式** — 跟随系统自动切换
- **响应式** — 桌面端和移动端自适应
- **本地搜索** — 客户端全文搜索
- **归档页** — 按日期分组，时间排序

## 快速开始

```bash
cd /mnt/sda1/docker/blog
docker compose up -d --build
```

访问：
- 前台：`http://localhost:3000`
- 后台：`http://localhost:3000/admin/`
- 默认密码：`slh1234`

## 目录结构

```
blog/
├── docker-compose.yml   # Docker 编排
├── Dockerfile           # Node 24 Alpine 镜像
├── package.json         # 仅 4 个依赖
├── config.js            # 站点配置（标题/作者/密码等）
├── server.js            # Express 服务
├── lib/
│   └── posts.js         # 文章解析/标签/分类/归档/设置
├── posts/               # 📝 所有文章（Markdown 文件）
├── public/
│   ├── css/style.css    # 主题样式
│   └── images/          # 上传的图片
├── views/
│   ├── layout.ejs       # 主布局
│   ├── index.ejs        # 首页
│   ├── post.ejs         # 文章页
│   ├── archives.ejs     # 归档页
│   ├── tags.ejs         # 标签页
│   ├── categories.ejs   # 分类页
│   ├── about.ejs        # 关于页
│   ├── 404.ejs          # 404 页
│   └── admin/           # 后台模板
│       ├── layout.ejs
│       ├── login.ejs
│       ├── dashboard.ejs
│       ├── posts.ejs
│       ├── edit.ejs
│       ├── tags.ejs
│       ├── categories.ejs
│       ├── about.ejs
│       └── settings.ejs
├── categories.json      # 手动添加的分类
└── posts-order.json     # 文章排序
```

## 文章格式

```markdown
---
title: 文章标题
date: 2026-07-11
time: 14:30
category: 分类名
tags: [标签1, 标签2]
summary: 首页卡片简述
excerpt: 文章顶部摘要（可选）
---

正文内容（Markdown 格式）
```

## 后台功能

| 模块 | 功能 |
|------|------|
| 仪表盘 | 统计数据、最近文章、快捷操作 |
| 文章管理 | 新建/编辑/删除、排序、行内改日期/分类/标签、上传 MD |
| 标签管理 | 添加/重命名/删除标签 |
| 分类管理 | 添加/重命名/删除分类 |
| 关于页面 | Markdown 编辑关于页内容 |
| 站点设置 | 修改标题/副标题/作者/描述/密码 |

## 迁移到新设备

```bash
# 旧设备打包
cd /mnt/sda1/docker/blog
tar -czf blog-backup.tar.gz .

# 新设备解压启动
mkdir -p /mnt/sda1/docker/blog
cd /mnt/sda1/docker/blog
tar -xzf blog-backup.tar.gz
docker compose up -d --build
```

## 技术栈

- Node.js 24 Alpine
- Express 4
- EJS 模板引擎
- markdown-it 渲染
- express-session 会话管理
- highlight.js 代码高亮
- Font Awesome 6 图标
- Docker + Docker Compose
