'use strict';

const express = require('express');
const session = require('express-session');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const markdownit = require('markdown-it');
const hljs = require('highlight.js');
const FileSessionStore = require('./lib/session-store');

let config = require('./config');

function reloadConfig() {
  delete require.cache[require.resolve('./config')];
  config = require('./config');
  return config;
}

const {
  ValidationError,
  postsDir,
  dataDir,
  isSafeSlug,
  loadPosts,
  loadOrderedPosts,
  getPost,
  getTags,
  getCategories,
  getArchives,
  getAllCategories,
  toMarkdown,
  parseMarkdownText,
  savePost,
  deletePost,
  movePost,
  updatePostField,
  addTagToPost,
  removeTagFromPost,
  addTag,
  renameTagInPosts,
  deleteTagFromAllPosts,
  addCategory,
  renameCategoryInPosts,
  deleteCategoryFromPosts,
  loadAbout,
  saveAbout,
  updateSettings,
} = require('./lib/posts');

const { splitTags, splitDate, normalizeTime, toLocalDate, formatDate, formatTime, todayString, nowTimeString } = require('./lib/frontmatter');

const app = express();
const APP_VERSION = require('./package.json').version;
app.locals.version = APP_VERSION;
app.disable('x-powered-by');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const POSTS_ASSETS_DIR = path.join(postsDir, 'assets');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

// 让文章图片随 posts 目录一起迁移：新上传默认写入 posts/assets
function ensurePostsAssets() {
  if (!fs.existsSync(POSTS_ASSETS_DIR)) fs.mkdirSync(POSTS_ASSETS_DIR, { recursive: true });
  try {
    if (!fs.existsSync(IMAGES_DIR)) return;
    for (const entry of fs.readdirSync(IMAGES_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) continue;
      const target = path.join(POSTS_ASSETS_DIR, entry.name);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(IMAGES_DIR, entry.name), target);
    }
  } catch (err) {
    console.error('[assets] 迁移图片失败: ' + err.message);
  }
}
ensurePostsAssets();

// ─── Markdown 渲染 ────────────────────────────────────────

const md = markdownit({ html: true, linkify: true, typographer: true });

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// 表格外层包一层可横向滚动的容器，避免宽表格撑破移动端布局
md.renderer.rules.table_open = function renderTableOpen() {
  return '<div class="table-wrap"><table>';
};
md.renderer.rules.table_close = function renderTableClose() {
  return '</table></div>';
};

// 代码块：顶部工具条 + 行号 + 服务端高亮
md.renderer.rules.fence = function renderFence(tokens, idx) {
  const token = tokens[idx];
  const lang = token.info ? token.info.trim().split(/\s+/)[0] : '';
  const code = token.content;

  let highlighted;
  try {
    highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
  } catch (_) {
    highlighted = escapeHtml(code);
  }

  const lines = highlighted.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let gutter = '';
  let body = '';
  lines.forEach((line, i) => {
    gutter += '<span class="line">' + (i + 1) + '</span>\n';
    body += '<span class="line">' + (line || ' ') + '</span>\n';
  });

  const langDisplay = escapeHtml(lang || 'code');

  return '<figure class="highlight" data-lang="' + langDisplay + '">'
    + '<div class="highlight-header">'
    + '<span class="mac-dots"><span class="mac-dot red"></span><span class="mac-dot yellow"></span><span class="mac-dot green"></span></span>'
    + '<span class="highlight-lang">' + langDisplay + '</span>'
    + '<button class="copy-btn" onclick="copyCode(this)" title="复制代码"><i class="fa-regular fa-copy" aria-hidden="true"></i><span class="copy-label">复制</span></button>'
    + '</div>'
    + '<div class="highlight-body"><table><tr>'
    + '<td class="gutter"><pre>' + gutter + '</pre></td>'
    + '<td class="code"><pre><code>' + body + '</code></pre></td>'
    + '</tr></table></div></figure>';
};


// ─── 文章目录（后端统一识别）──────────────────────────────
function headingText(token) {
  if (!token) return '';
  if (token.type !== 'inline') return token.content || '';
  let out = '';
  (token.children || []).forEach(child => {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content;
    else if (child.type === 'image') out += child.content || '';
    else if (child.type === 'softbreak' || child.type === 'hardbreak') out += ' ';
    else if (child.children) out += headingText(child);
  });
  return out || token.content || '';
}

function headingSlug(text) {
  let s = String(text || '').normalize('NFKC').toLowerCase().trim();
  s = s.replace(/<[^>]*>/g, '').replace(/[\x60*_~]/g, '');
  s = s.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'section';
}

// 给 h1~h4 自动加稳定 id，目录和正文共用同一套锚点
md.core.ruler.push('slh_heading_ids', state => {
  const seen = Object.create(null);
  for (let i = 0; i < state.tokens.length; i += 1) {
    const token = state.tokens[i];
    if (token.type !== 'heading_open' || !/^h[1-4]$/.test(token.tag)) continue;
    const base = headingSlug(headingText(state.tokens[i + 1]));
    let id = base;
    let n = 2;
    while (seen[id]) { id = base + '-' + n; n += 1; }
    seen[id] = true;
    token.attrSet('id', id);
  }
});

function buildToc(tokens) {
  const toc = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open' || !/^h[1-3]$/.test(token.tag)) continue;
    const text = headingText(tokens[i + 1]).trim();
    if (!text) continue;
    toc.push({ level: Number(token.tag.slice(1)), id: token.attrGet('id'), text });
  }
  return toc;
}

function renderTocHtml(toc) {
  if (!toc.length) return '';
  let html = '<nav class="md-toc"><div class="md-toc-title">目录</div><ul>';
  toc.forEach(item => {
    html += '<li class="md-toc-level-' + item.level + '"><a href="#' + escapeHtml(item.id) + '">'
      + escapeHtml(item.text) + '</a></li>';
  });
  return html + '</ul></nav>';
}

// 支持两种写法：[TOC] 或 [[TOC]]，同时给文章页返回右侧目录数据
function markdownWithToc(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const markerRe = /^\[\[?TOC\]?\]\s*$/gim;
  const hasToc = markerRe.test(text);
  const tokens = md.parse(text, {});
  const toc = buildToc(tokens);
  let renderSource = text;
  if (hasToc) renderSource = text.replace(markerRe, renderTocHtml(toc) + '\n\n');
  return { html: md.render(renderSource), toc, hasToc };
}

// ─── 基础中间件 ───────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(compression());
app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), { maxAge: '30d', immutable: true }));
app.use('/images', express.static(POSTS_ASSETS_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // CSS / SVG 改版后不能让浏览器继续用旧缓存；用 ETag 协商，未变化时仍是 304
    if (/\.(css|svg|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
      res.removeHeader('Expires');
    }
  },
}));
app.use((req, res, next) => {
  // 页面本身不缓存；静态资源用版本号 + no-cache 协商
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.locals.assetVersion = fs.statSync(path.join(PUBLIC_DIR, 'css', 'layout.css')).mtimeMs.toString(36);
  } catch (_) {
    res.locals.assetVersion = '1';
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '25mb' }));

const sessionSecret = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update('slhbond-lab::' + config.adminPassword + '::' + __dirname).digest('hex');

const sessionStore = new FileSessionStore(path.join(dataDir, 'sessions.json'));

app.use(session({
  name: 'slh.sid',
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// 同源校验：防止其它站点用受害者浏览器提交后台表单（CSRF）
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');
  let source = origin || referer;
  if (!source) return next(); // 非浏览器客户端（curl 等）没有 Origin/Referer
  try {
    const parsed = new URL(source);
    if (parsed.host !== host) {
      return res.status(403).send('跨站请求被拒绝');
    }
  } catch (_) {
    return res.status(403).send('跨站请求被拒绝');
  }
  return next();
});

// 模板全局变量
app.use((req, res, next) => {
  res.locals.config = config;
  res.locals.currentPath = req.path;
  res.locals.isAdmin = !!req.session.admin;
  res.locals.formatDate = formatDate;
  res.locals.formatTime = formatTime;
  res.locals.today = todayString();
  res.locals.nowTime = nowTimeString();
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  if (!req.path.startsWith('/admin') && !req.path.startsWith('/api')) {
    const allPosts = loadPosts();
    res.locals.siteStats = {
      posts: allPosts.length,
      categories: getAllCategories().length,
      tags: getTags(allPosts).length,
    };
  } else {
    res.locals.siteStats = { posts: 0, categories: 0, tags: 0 };
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── 渲染助手 ─────────────────────────────────────────────

function renderWithLayout(res, view, data) {
  res.render(view, data, (err, html) => {
    if (err) {
      console.error('[render] ' + view + ': ' + err.message);
      return res.status(500).send('页面渲染失败');
    }
    return res.render('layout', Object.assign({}, data, { body: html }));
  });
}

function renderAdmin(res, view, data) {
  res.render(view, data, (err, html) => {
    if (err) {
      console.error('[render:admin] ' + view + ': ' + err.message);
      return res.status(500).send('后台页面渲染失败');
    }
    return res.render('admin/layout', Object.assign({}, data, { body: html }));
  });
}

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  return res.redirect('/admin/login');
}

function requireAuthApi(req, res, next) {
  if (req.session.admin) return next();
  return res.status(401).json({ error: '登录已过期，请重新登录' });
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// ─── 输入处理 ─────────────────────────────────────────────

function postPayload(body) {
  const source = body || {};
  return {
    title: String(source.title == null ? '' : source.title),
    date: String(source.date == null ? '' : source.date),
    time: String(source.time == null ? '' : source.time),
    category: String(source.category == null ? '' : source.category),
    tags: splitTags(source.tags),
    summary: String(source.summary == null ? '' : source.summary),
    excerpt: String(source.excerpt == null ? '' : source.excerpt),
    body: String(source.body == null ? '' : source.body),
    slug: String(source.slug == null ? '' : source.slug).trim(),
  };
}

function postForForm(payload, slug, oldSlug) {
  const dateParts = splitDate(payload.date);
  const time = normalizeTime(payload.time) || dateParts.time;
  return {
    slug: slug || '',
    oldSlug: oldSlug || '',
    title: payload.title || '',
    date: toLocalDate(dateParts.date, time),
    dateStr: dateParts.date,
    time,
    category: payload.category || '',
    tags: splitTags(payload.tags),
    summary: payload.summary || '',
    excerpt: payload.excerpt || '',
    body: payload.body || '',
    isNew: !slug,
  };
}

// ─── 公开页面 ─────────────────────────────────────────────

app.get('/', (req, res) => {
  const posts = loadOrderedPosts();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.max(1, Number(config.postsPerPage) || 10);
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  if (page > totalPages && posts.length > 0) return res.redirect('/?page=' + totalPages);

  const pagedPosts = posts.slice((page - 1) * perPage, page * perPage);
  const tags = getTags(posts);
  const categories = getCategories(posts);
  return renderWithLayout(res, 'index', {
    posts: pagedPosts,
    page,
    totalPages,
    totalPosts: posts.length,
    tags,
    categories,
    homeNoticeHtml: config.homeNotice ? markdownWithToc(config.homeNotice).html : '',
  });
});

app.get('/post/:slug', (req, res) => {
  const posts = loadPosts();
  const index = posts.findIndex(item => item.slug === req.params.slug);
  const post = index >= 0 ? posts[index] : getPost(req.params.slug);
  if (!post) {
    res.status(404);
    return renderWithLayout(res, '404', { title: '404', message: '文章未找到' });
  }
  const rendered = markdownWithToc(post.body);
  post.html = rendered.html;
  const readingMinutes = Math.max(1, Math.ceil(countWords(post.body) / 300));
  return renderWithLayout(res, 'post', {
    title: post.title,
    post,
    toc: rendered.toc,
    readingMinutes,
    prevPost: index > 0 ? posts[index - 1] : null,
    nextPost: index >= 0 && index < posts.length - 1 ? posts[index + 1] : null,
  });
});

app.get('/archives/', (req, res) => {
  const posts = loadPosts();
  return renderWithLayout(res, 'archives', {
    title: '归档',
    archives: getArchives(posts),
    totalPosts: posts.length,
    tags: getTags(posts),
    categories: getCategories(posts),
  });
});

app.get('/tags/', (req, res) => {
  const posts = loadPosts();
  return renderWithLayout(res, 'tags', {
    title: '标签',
    tags: getTags(posts),
    activeTag: null,
    posts: [],
    totalPosts: posts.length,
    categories: getCategories(posts),
  });
});

app.get('/tags/:tag', (req, res) => {
  const posts = loadPosts();
  const tag = req.params.tag;
  const filtered = posts.filter(post => (post.tags || []).includes(tag));
  return renderWithLayout(res, 'tags', {
    title: '标签: ' + tag,
    tags: getTags(posts),
    activeTag: tag,
    posts: filtered,
    totalPosts: posts.length,
    categories: getCategories(posts),
  });
});

app.get('/categories/', (req, res) => {
  const posts = loadPosts();
  return renderWithLayout(res, 'categories', {
    title: '分类',
    categories: getAllCategories(),
    activeCat: null,
    posts: [],
    totalPosts: posts.length,
    tags: getTags(posts),
  });
});

app.get('/categories/:cat', (req, res) => {
  const posts = loadPosts();
  const cat = req.params.cat;
  const filtered = posts.filter(post => (post.category || '未分类') === cat);
  return renderWithLayout(res, 'categories', {
    title: '分类: ' + cat,
    categories: getAllCategories(),
    activeCat: cat,
    posts: filtered,
    totalPosts: posts.length,
    tags: getTags(posts),
  });
});

function readRootMarkdown(filename) {
  try {
    return fs.readFileSync(path.join(__dirname, filename), 'utf8');
  } catch (_) {
    return '';
  }
}

app.get('/migration/', (req, res) => {
  const source = readRootMarkdown('MIGRATION.md');
  const rendered = markdownWithToc(source || '迁移说明文件缺失，请查看项目根目录 MIGRATION.md。');
  return renderWithLayout(res, 'page', {
    title: '迁移说明',
    pageTitle: '迁移说明',
    pageSubtitle: '从旧版本升级到 v' + APP_VERSION,
    bodyHtml: rendered.html,
  });
});

app.get('/changelog/', (req, res) => {
  const source = readRootMarkdown('CHANGELOG.md');
  const rendered = markdownWithToc(source || '更新日志文件缺失，请查看项目根目录 CHANGELOG.md。');
  return renderWithLayout(res, 'page', {
    title: '更新日志',
    pageTitle: '更新日志',
    pageSubtitle: 'v' + APP_VERSION,
    bodyHtml: rendered.html,
  });
});

app.get('/about/', (req, res) => {
  const aboutBody = loadAbout();
  const aboutHtml = aboutBody
    ? markdownWithToc(aboutBody).html
    : '<blockquote><p>写代码，爱生活，记录技术与思考。</p></blockquote><p>欢迎来到我的博客。</p>';
  return renderWithLayout(res, 'about', { title: '关于', aboutHtml });
});

// ─── 后台：登录 / 登出 ────────────────────────────────────

const loginAttempts = new Map();
const LOGIN_WINDOW = 10 * 60 * 1000;
const LOGIN_MAX = 5;

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function pruneAttempts() {
  const now = Date.now();
  for (const [key, value] of loginAttempts) {
    if (value.resetAt <= now) loginAttempts.delete(key);
  }
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/');
  return renderAdmin(res, 'admin/login', { title: '后台登录', pageTitle: '登录' });
});

app.post('/admin/login', (req, res) => {
  pruneAttempts();
  const key = clientKey(req);
  const record = loginAttempts.get(key);

  if (record && record.count >= LOGIN_MAX) {
    res.status(429);
    return renderAdmin(res, 'admin/login', {
      title: '后台登录',
      pageTitle: '登录',
      error: '尝试次数过多，请 10 分钟后再试',
    });
  }

  if (constantTimeEqual(req.body.password || '', config.adminPassword)) {
    loginAttempts.delete(key);
    return req.session.regenerate(err => {
      if (err) {
        console.error('[session] ' + err.message);
        res.status(500);
        return renderAdmin(res, 'admin/login', { title: '后台登录', pageTitle: '登录', error: '登录失败，请重试' });
      }
      req.session.admin = true;
      return res.redirect('/admin/');
    });
  }

  const current = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW };
  current.count += 1;
  if (current.resetAt <= Date.now()) current.resetAt = Date.now() + LOGIN_WINDOW;
  loginAttempts.set(key, current);

  res.status(401);
  return renderAdmin(res, 'admin/login', {
    title: '后台登录',
    pageTitle: '登录',
    error: '密码错误',
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ─── 后台：仪表盘 ─────────────────────────────────────────

function countWords(text) {
  const source = String(text || '');
  const cjk = (source.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (source.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
  return cjk + latin;
}

app.get('/admin/', requireAuth, (req, res) => {
  const posts = loadPosts();
  const monthPrefix = todayString().slice(0, 7);
  const monthCount = posts.filter(post => post.dateStr && post.dateStr.startsWith(monthPrefix)).length;
  const recentPosts = posts.slice(0, 8);
  const totalWords = posts.reduce((sum, post) => sum + countWords(post.body), 0);

  return renderAdmin(res, 'admin/dashboard', {
    title: '仪表盘',
    pageTitle: '仪表盘',
    totalPosts: posts.length,
    totalWords,
    monthCount,
    tags: getTags(posts),
    categories: getCategories(posts),
    recentPosts,
  });
});

// ─── 后台：文章管理 ───────────────────────────────────────

app.get('/admin/posts', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/posts', {
    title: '文章管理',
    pageTitle: '文章管理',
    posts: loadOrderedPosts(),
  });
});

app.get('/admin/posts/new', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/edit', {
    title: '新建文章',
    pageTitle: '新建文章',
    post: {
      title: '',
      dateStr: res.locals.today,
      time: res.locals.nowTime,
      category: req.query.category ? String(req.query.category) : '',
      tags: [],
      summary: '',
      excerpt: '',
      body: '',
      slug: '',
    },
    categories: getAllCategories(),
  });
});

app.post('/admin/posts/new', requireAuth, (req, res) => {
  const payload = postPayload(req.body);

  try {
    const result = savePost(payload);
    flash(req, 'success', '文章已发布：' + result.slug);
    return res.redirect('/admin/posts');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return renderAdmin(res, 'admin/edit', {
        title: '新建文章',
        pageTitle: '新建文章',
        error: err.message,
        post: postForForm(payload, payload.slug || '', ''),
        categories: getAllCategories(),
      });
    }
    throw err;
  }
});

app.get('/admin/posts/edit/:slug', requireAuth, (req, res) => {
  const post = getPost(req.params.slug);
  if (!post) {
    flash(req, 'error', '文章不存在或已被删除');
    return res.redirect('/admin/posts');
  }
  return renderAdmin(res, 'admin/edit', {
    title: '编辑: ' + post.title,
    pageTitle: '编辑文章',
    post,
    categories: getAllCategories(),
  });
});

app.post('/admin/posts/edit/:slug', requireAuth, (req, res) => {
  const oldSlug = req.params.slug;
  if (!isSafeSlug(oldSlug)) {
    flash(req, 'error', '文章地址不合法');
    return res.redirect('/admin/posts');
  }

  const payload = postPayload(req.body);
  if (!payload.slug) payload.slug = oldSlug;

  try {
    const result = savePost(Object.assign({}, payload, { oldSlug }));
    flash(req, 'success', '文章已保存：' + result.slug);
    if (result.slug !== oldSlug) {
      return res.redirect('/admin/posts/edit/' + encodeURIComponent(result.slug));
    }
    return res.redirect('/admin/posts');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return renderAdmin(res, 'admin/edit', {
        title: '编辑文章',
        pageTitle: '编辑文章',
        error: err.message,
        post: postForForm(payload, oldSlug, oldSlug),
        categories: getAllCategories(),
      });
    }
    throw err;
  }
});

app.post('/admin/posts/delete/:slug', requireAuth, (req, res) => {
  const slug = req.params.slug;
  try {
    const removed = deletePost(slug);
    flash(req, removed ? 'success' : 'error', removed ? '文章已删除：' + slug : '文章不存在');
  } catch (err) {
    flash(req, 'error', '删除失败：' + err.message);
  }
  return res.redirect('/admin/posts');
});

function apiHandler(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      const status = err instanceof ValidationError ? 400 : 500;
      if (status === 500) console.error('[api] ' + err.stack);
      res.status(status).json({ error: err.message || '操作失败' });
    }
  };
}

app.post('/admin/posts/move', requireAuthApi, apiHandler((req, res) => {
  const ok = movePost(String(req.body.slug || ''), String(req.body.dir || 'up'));
  res.json({ ok });
}));

app.post('/admin/posts/update-field', requireAuthApi, apiHandler((req, res) => {
  const ok = updatePostField(String(req.body.slug || ''), String(req.body.field || ''), req.body.value);
  if (!ok) throw new ValidationError('更新失败：文章或字段不存在');
  res.json({ ok: true });
}));

app.post('/admin/posts/remove-tag', requireAuthApi, apiHandler((req, res) => {
  const ok = removeTagFromPost(String(req.body.slug || ''), String(req.body.tag || ''));
  if (!ok) throw new ValidationError('移除标签失败');
  res.json({ ok: true });
}));

app.post('/admin/posts/add-tag', requireAuthApi, apiHandler((req, res) => {
  const ok = addTagToPost(String(req.body.slug || ''), String(req.body.tag || ''));
  if (!ok) throw new ValidationError('添加标签失败');
  res.json({ ok: true });
}));

// ─── 后台：标签 ───────────────────────────────────────────

app.get('/admin/tags', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/tags', {
    title: '标签管理',
    pageTitle: '标签管理',
    tags: getTags(loadPosts()),
  });
});

app.post('/admin/tags/delete', requireAuth, (req, res) => {
  try {
    const count = deleteTagFromAllPosts(req.body.tag);
    flash(req, 'success', '已删除标签「' + req.body.tag + '」，从 ' + count + ' 篇文章中移除。');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/tags');
});

app.post('/admin/tags/rename', requireAuth, (req, res) => {
  try {
    const count = renameTagInPosts(req.body.old, req.body.new);
    flash(req, 'success', '已将「' + req.body.old + '」重命名为「' + req.body.new + '」（' + count + ' 篇文章）。');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/tags');
});

app.post('/admin/tags/add', requireAuth, (req, res) => {
  const tag = String(req.body.tag || '').trim();
  if (!tag) {
    flash(req, 'error', '标签名不能为空');
    return res.redirect('/admin/tags');
  }
  try {
    if (req.body.slug) {
      const added = addTagToPost(String(req.body.slug), tag);
      flash(req, added ? 'success' : 'error', added ? '已添加标签「' + tag + '」到文章。' : '添加失败：文章不存在');
    } else {
      addTag(tag);
      flash(req, 'success', '标签「' + tag + '」已创建，写文章时填写即可使用。');
    }
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/tags');
});

// ─── 后台：分类 ───────────────────────────────────────────

app.get('/admin/categories', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/categories', {
    title: '分类管理',
    pageTitle: '分类管理',
    categories: getAllCategories(),
  });
});

app.post('/admin/categories/add', requireAuth, (req, res) => {
  try {
    addCategory(req.body.cat);
    flash(req, 'success', '已添加分类「' + req.body.cat + '」。');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/categories');
});

app.post('/admin/categories/delete', requireAuth, (req, res) => {
  try {
    const count = deleteCategoryFromPosts(req.body.cat);
    flash(req, 'success', '已删除分类「' + req.body.cat + '」，从 ' + count + ' 篇文章中移除。');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/categories');
});

app.post('/admin/categories/rename', requireAuth, (req, res) => {
  try {
    const count = renameCategoryInPosts(req.body.old, req.body.new);
    flash(req, 'success', '已将「' + req.body.old + '」重命名为「' + req.body.new + '」（' + count + ' 篇文章）。');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  return res.redirect('/admin/categories');
});

// ─── 后台：关于页 ─────────────────────────────────────────

app.get('/admin/about', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/about', {
    title: '关于页面',
    pageTitle: '关于页面',
    aboutBody: loadAbout(),
  });
});

app.post('/admin/about', requireAuth, (req, res) => {
  try {
    saveAbout(req.body.body || '');
    flash(req, 'success', '关于页面已保存。');
  } catch (err) {
    flash(req, 'error', '保存失败：' + err.message);
  }
  return res.redirect('/admin/about');
});

// ─── 后台：站点设置 ───────────────────────────────────────

app.get('/admin/settings', requireAuth, (req, res) => {
  return renderAdmin(res, 'admin/settings', {
    title: '站点设置',
    pageTitle: '站点设置',
    settings: {
      title: config.title,
      subtitle: config.subtitle,
      homeTitle: config.homeTitle || '',
      homeSubtitle: config.homeSubtitle || '',
      homeNotice: config.homeNotice || '',
      author: config.author,
      bio: config.bio || '',
      avatar: config.avatar || '',
      description: config.description,
    },
  });
});

app.post('/admin/settings', requireAuth, (req, res) => {
  try {
    updateSettings(req.body);
    reloadConfig();
    flash(req, 'success', '设置已保存。');
    return res.redirect('/admin/settings');
  } catch (err) {
    res.status(400);
    return renderAdmin(res, 'admin/settings', {
      title: '站点设置',
      pageTitle: '站点设置',
      error: err.message,
      settings: {
        title: req.body.title || config.title,
        subtitle: req.body.subtitle || '',
        homeTitle: req.body.homeTitle || '',
        homeSubtitle: req.body.homeSubtitle || '',
        homeNotice: req.body.homeNotice || '',
        author: req.body.author || '',
        bio: req.body.bio || '',
        avatar: req.body.avatar || '',
        description: req.body.description || '',
      },
    });
  }
});

// ─── 上传图片 ─────────────────────────────────────────────

function detectImageExt(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') return '.gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '';
}

app.post('/api/upload-image', requireAuthApi, apiHandler((req, res) => {
  const data = String(req.body.data || '');
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/.exec(data);
  if (!match) throw new ValidationError('图片数据格式不正确');

  let buffer;
  try {
    buffer = Buffer.from(match[1], 'base64');
  } catch (_) {
    throw new ValidationError('图片解码失败');
  }
  if (!buffer.length) throw new ValidationError('图片内容为空');
  if (buffer.length > MAX_IMAGE_BYTES) throw new ValidationError('图片不能超过 10MB');

  const ext = detectImageExt(buffer);
  if (!ext) throw new ValidationError('只支持 PNG / JPG / GIF / WebP 图片');

  // 头像放 public/images；文章图片放 posts/assets，随 posts 一起迁移
  const targetDir = String(req.body.scope || '') === 'avatar' ? IMAGES_DIR : POSTS_ASSETS_DIR;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = 'img-' + stamp + '-' + crypto.randomBytes(4).toString('hex') + ext;
  fs.writeFileSync(path.join(targetDir, filename), buffer);

  res.json({ url: '/images/' + filename, filename, size: buffer.length });
}));

// ─── 编辑器 API：预览 / 导入 / 导出 ──────────────────────

app.post('/api/preview', requireAuthApi, (req, res) => {
  const body = String(req.body.body || '');
  if (Buffer.byteLength(body, 'utf-8') > MAX_MARKDOWN_BYTES) {
    return res.status(413).send('<p>内容过大，无法预览</p>');
  }
  return res.type('html').send(markdownWithToc(body).html);
});

app.post('/api/parse-md', requireAuthApi, (req, res) => {
  const text = String(req.body.text || '');
  if (Buffer.byteLength(text, 'utf-8') > MAX_MARKDOWN_BYTES) {
    return res.status(413).json({ error: '文件过大（上限 5MB）' });
  }
  const parsed = parseMarkdownText(text);
  return res.json({
    meta: {
      title: parsed.title,
      date: parsed.date,
      time: parsed.time,
      category: parsed.category,
      tags: parsed.tags,
      summary: parsed.summary,
      excerpt: parsed.excerpt,
    },
    body: parsed.body,
    hasFrontmatter: parsed.hasFrontmatter,
    canonical: toMarkdown(parsed),
  });
});

app.post('/api/export-md', requireAuthApi, (req, res) => {
  const payload = postPayload(req.body);
  const title = payload.title.trim() || '未命名文章';
  const slug = payload.slug || 'untitled';
  const markdown = toMarkdown(Object.assign({}, payload, { title }));
  const filename = slug + '.md';
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + ascii + '"; filename*=UTF-8' + "''" + encodeURIComponent(filename));
  return res.send(markdown);
});

// ─── 搜索 ─────────────────────────────────────────────────

// 浏览器仍会探测 /favicon.ico，统一跳转到 SVG 图标，避免控制台 404
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

app.get('/search.json', (req, res) => {
  const payload = loadPosts().map(post => ({
    title: post.title,
    slug: post.slug,
    date: post.dateStr || '',
    category: post.category || '',
    tags: post.tags || [],
    summary: post.summary || '',
    excerpt: post.excerpt || '',
    text: (post.plain || '').slice(0, 1200),
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

// ─── 404 / 错误处理 ───────────────────────────────────────

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  res.status(404);
  return renderWithLayout(res, '404', { title: '404', message: '页面未找到' });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error] ' + req.method + ' ' + req.path + ': ' + (err && err.stack ? err.stack : err));
  if (res.headersSent) return;
  res.status(500).send('服务器内部错误');
});

// ─── 启动 ─────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log('📝 Blog:  http://localhost:' + PORT);
  console.log('🔧 Admin: http://localhost:' + PORT + '/admin/');
});

function shutdown(signal) {
  console.log('[' + signal + '] 正在关闭...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));