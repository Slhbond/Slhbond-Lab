module.exports = {
  // 站点基本信息
  title: 'slh＆科技小菜',
  subtitle: '00后业余者，记录折腾、学习心得',
  author: 'Slhbond',
  description: '折腾一些电子垃圾、开发板，记录一些计算机语言、硬件系统的学习心得，也会关注一些AI与硬件科技圈',
  homeTitle: '最新文章',
  homeSubtitle: '记录折腾、学习与生活',
  homeNotice: '**v2.0.0 已发布。** 本版本新增首页卡片、右侧目录、阅读进度、[TOC] 目录、首页文字自定义。\n\n**旧版迁移**：备份 posts/、config.js、data/ → 上传新代码 → 启动 → 恢复数据。文章和图片都是文件，不需要数据库。\n\n[完整迁移说明](/migration/) · [更新内容](/changelog/)',

  // 导航菜单
  menu: {
    home: { label: '首页', icon: 'fa-home', path: '/' },
    archives: { label: '归档', icon: 'fa-archive', path: '/archives/' },
    categories: { label: '分类', icon: 'fa-th', path: '/categories/' },
    tags: { label: '标签', icon: 'fa-tags', path: '/tags/' },
    about: { label: '关于', icon: 'fa-user', path: '/about/' },
  },

  // 每页文章数
  postsPerPage: 10,

  // 日期格式
  dateFormat: 'YYYY-MM-DD',

  // 后台管理密码（⚠️ 部署后请修改）
  adminPassword: 'change-me',
};
