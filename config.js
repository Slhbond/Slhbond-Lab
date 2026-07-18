module.exports = {
  // 站点基本信息
  title: 'slh＆科技小菜',
  subtitle: '00后业余者，记录折腾、学习心得',
  author: 'slh',
  description: '折腾一些电子垃圾、开发板，记录一些计算机语言、硬件系统的学习心得，也会关注一些AI与硬件科技圈',

  // 导航菜单
  menu: {
    home: { label: '首页', icon: 'fa-home', path: '/' },
    archives: { label: '归档', icon: 'fa-archive', path: '/archives/' },
    tags: { label: '标签', icon: 'fa-tags', path: '/tags/' },
    categories: { label: '分类', icon: 'fa-th', path: '/categories/' },
    about: { label: '关于', icon: 'fa-user', path: '/about/' },
  },

  // 每页文章数
  postsPerPage: 10,

  // 日期格式
  dateFormat: 'YYYY-MM-DD',

  // 后台管理密码（⚠️ 部署后请修改）
  adminPassword: '1234',
};
