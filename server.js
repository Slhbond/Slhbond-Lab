const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const markdownit = require('markdown-it');
const hljs = require('highlight.js');
// Config is mutable — reloaded when settings change
let config = require('./config');
function reloadConfig() {
  delete require.cache[require.resolve('./config')];
  config = require('./config');
}

const {
  loadPosts, loadOrderedPosts, getTags, getCategories, getArchives, getAllCategories,
  savePost, deletePost, slugify,
  movePost, updatePostField,
  addTagToPost, removeTagFromPost, renameTagInPosts, deleteTagFromAllPosts,
  renameCategoryInPosts, deleteCategoryFromPosts, addCategory,
  loadAbout, saveAbout, updateSettings,
} = require('./lib/posts');

const app = express();
const md = markdownit({ html: true, linkify: true, typographer: true });

// Custom code fence renderer — header bar + line numbers + server-side highlight
md.renderer.rules.fence = function(tokens, idx, options, env, self) {
  const token = tokens[idx];
  const lang = token.info ? token.info.trim().split(/\s+/)[0] : '';
  const code = token.content;

  // Server-side syntax highlighting
  let highlighted;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
  } catch (e) {
    // Fallback: escape HTML
    highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const lines = highlighted.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let gutter = '';
  let codeLines = '';
  lines.forEach((line, i) => {
    gutter += `<span class="line">${i + 1}</span>\n`;
    codeLines += `<span class="line">${line || ' '}</span>\n`;
  });

  const langDisplay = lang || 'code';

  return `<figure class="highlight" data-lang="${langDisplay}">`
    + `<div class="highlight-header">`
    + `<span class="mac-dots">`
    + `<span class="mac-dot red"></span>`
    + `<span class="mac-dot yellow"></span>`
    + `<span class="mac-dot green"></span>`
    + `</span>`
    + `<span class="highlight-lang">${langDisplay}</span>`
    + `<button class="copy-btn" onclick="copyCode(this)" title="复制代码">`
    + `<i class="fa-regular fa-copy"></i>`
    + `</button>`
    + `</div>`
    + `<div class="highlight-body">`
    + `<table><tr>`
    + `<td class="gutter"><pre>${gutter}</pre></td>`
    + `<td class="code"><pre><code>${codeLines}</code></pre></td>`
    + `</tr></table>`
    + `</div></figure>`;
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: config.adminPassword + '_session_secret_v2',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Global template locals
app.use((req, res, next) => {
  res.locals.config = config;
  res.locals.currentPath = req.path;
  res.locals.isAdmin = !!req.session.admin;
  res.locals.formatDate = (d) => {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  next();
});

// ─── Render helpers ───────────────────────────────────────

function renderWithLayout(res, view, data) {
  res.render(view, data, (err, html) => {
    if (err) { console.error(err); return res.status(500).send('Render error'); }
    res.render('layout', { ...data, body: html });
  });
}

function renderAdmin(res, view, data) {
  res.render(view, data, (err, html) => {
    if (err) { console.error(err); return res.status(500).send('Admin render error'); }
    res.render('admin/layout', { ...data, body: html });
  });
}

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  return res.redirect('/admin/login');
}

// ─── Public routes ────────────────────────────────────────

app.get('/', (req, res) => {
  const posts = loadOrderedPosts();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = config.postsPerPage;
  const totalPages = Math.ceil(posts.length / perPage);
  const pagedPosts = posts.slice((page - 1) * perPage, page * perPage);
  pagedPosts.forEach(p => { p.html = md.render(p.body); });
  const tags = getTags(posts);
  const categories = getCategories(posts);
  renderWithLayout(res, 'index', { posts: pagedPosts, page, totalPages, totalPosts: posts.length, tags, categories });
});

app.get('/post/:slug', (req, res) => {
  const posts = loadPosts();
  const post = posts.find(p => p.slug === req.params.slug);
  if (!post) { res.status(404); return renderWithLayout(res, '404', { title: '404', message: '文章未找到' }); }
  post.html = md.render(post.body);
  renderWithLayout(res, 'post', { title: post.title, post });
});

app.get('/archives/', (req, res) => {
  const posts = loadPosts();
  const archives = getArchives(posts);
  const tags = getTags(posts);
  const categories = getCategories(posts);
  renderWithLayout(res, 'archives', { title: '归档', archives, totalPosts: posts.length, tags, categories });
});

app.get('/tags/', (req, res) => {
  const posts = loadPosts();
  const tags = getTags(posts);
  const categories = getCategories(posts);
  renderWithLayout(res, 'tags', { title: '标签', tags, activeTag: null, posts: [], totalPosts: posts.length, categories });
});

app.get('/tags/:tag', (req, res) => {
  const posts = loadPosts();
  const tags = getTags(posts);
  const categories = getCategories(posts);
  const tag = req.params.tag;
  const filtered = posts.filter(p => (p.tags || []).includes(tag));
  renderWithLayout(res, 'tags', { title: '标签: ' + tag, tags, activeTag: tag, posts: filtered, totalPosts: posts.length, categories });
});

app.get('/categories/', (req, res) => {
  const posts = loadPosts();
  const categories = getAllCategories();
  const tags = getTags(posts);
  renderWithLayout(res, 'categories', { title: '分类', categories, activeCat: null, posts: [], totalPosts: posts.length, tags });
});

app.get('/categories/:cat', (req, res) => {
  const posts = loadPosts();
  const tags = getTags(posts);
  const categories = getAllCategories();
  const cat = req.params.cat;
  const filtered = posts.filter(p => (p.category || '未分类') === cat);
  renderWithLayout(res, 'categories', { title: '分类: ' + cat, categories, activeCat: cat, posts: filtered, totalPosts: posts.length, tags });
});

// About page (renders from _about.md)
app.get('/about/', (req, res) => {
  const aboutBody = loadAbout();
  const aboutHtml = aboutBody ? md.render(aboutBody) : `<blockquote><p>写代码，爱生活，记录技术与思考。</p></blockquote>
<p>欢迎来到我的博客。</p>`;
  renderWithLayout(res, 'about', { title: '关于', aboutHtml });
});

// ─── Admin: Login / Logout ────────────────────────────────

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/');
  renderAdmin(res, 'admin/login', { title: '后台登录', pageTitle: '登录' });
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === config.adminPassword) {
    req.session.admin = true;
    return res.redirect('/admin/');
  }
  renderAdmin(res, 'admin/login', { title: '后台登录', pageTitle: '登录', error: '密码错误' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ─── Admin: Dashboard ─────────────────────────────────────

app.get('/admin/', requireAuth, (req, res) => {
  const posts = loadPosts();
  const tags = getTags(posts);
  const categories = getCategories(posts);
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recentPosts = posts.filter(p => p.date && p.date >= thisMonth);
  renderAdmin(res, 'admin/dashboard', {
    title: '仪表盘', pageTitle: '仪表盘',
    totalPosts: posts.length, tags, categories, recentPosts,
  });
});

// ─── Admin: Posts ─────────────────────────────────────────

app.get('/admin/posts', requireAuth, (req, res) => {
  const posts = loadOrderedPosts();
  renderAdmin(res, 'admin/posts', {
    title: '文章管理', pageTitle: '文章管理', posts,
  });
});

app.get('/admin/posts/new', requireAuth, (req, res) => {
  const categories = getAllCategories();
  const prefill = {};
  if (req.query.category) prefill.category = req.query.category;
  renderAdmin(res, 'admin/edit', { title: '新建文章', pageTitle: '新建文章', post: prefill, categories });
});

app.post('/admin/posts/new', requireAuth, (req, res) => {
  const { title, date, time, category, tags, summary, excerpt, body } = req.body;
  const slug = slugify(title);
  savePost({ title, date, time, category, tags: tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), summary, excerpt, body, slug });
  res.redirect('/admin/posts');
});

app.get('/admin/posts/edit/:slug', requireAuth, (req, res) => {
  const posts = loadPosts();
  const post = posts.find(p => p.slug === req.params.slug);
  if (!post) return res.redirect('/admin/posts');
  const categories = getCategories(posts);
  renderAdmin(res, 'admin/edit', { title: '编辑: ' + post.title, pageTitle: '编辑文章', post, categories });
});

app.post('/admin/posts/edit/:slug', requireAuth, (req, res) => {
  const oldSlug = req.params.slug;
  const { title, date, time, category, tags, summary, excerpt, body } = req.body;
  const slug = slugify(title);
  savePost({ title, date, time, category, tags: tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), summary, excerpt, body, slug, oldSlug });
  res.redirect('/admin/posts');
});

app.post('/admin/posts/delete/:slug', requireAuth, (req, res) => {
  deletePost(req.params.slug);
  res.redirect('/admin/posts');
});

// Inline: move post (reorder)
app.post('/admin/posts/move', requireAuth, (req, res) => {
  movePost(req.body.slug, req.body.dir);
  res.json({ ok: true });
});

// Inline: update single field
app.post('/admin/posts/update-field', requireAuth, (req, res) => {
  updatePostField(req.body.slug, req.body.field, req.body.value);
  res.json({ ok: true });
});

// Inline: remove tag from post
app.post('/admin/posts/remove-tag', requireAuth, (req, res) => {
  removeTagFromPost(req.body.slug, req.body.tag);
  res.json({ ok: true });
});

// Inline: add tag to post
app.post('/admin/posts/add-tag', requireAuth, (req, res) => {
  addTagToPost(req.body.slug, req.body.tag);
  res.json({ ok: true });
});

// ─── Admin: Tags ──────────────────────────────────────────

app.get('/admin/tags', requireAuth, (req, res) => {
  const posts = loadPosts();
  const tags = getTags(posts);
  renderAdmin(res, 'admin/tags', { title: '标签管理', pageTitle: '标签管理', tags });
});

app.post('/admin/tags/delete', requireAuth, (req, res) => {
  const count = deleteTagFromAllPosts(req.body.tag);
  renderAdmin(res, 'admin/tags', {
    title: '标签管理', pageTitle: '标签管理',
    tags: getTags(loadPosts()),
    success: `已删除标签「${req.body.tag}」，从 ${count} 篇文章中移除。`,
  });
});

app.post('/admin/tags/rename', requireAuth, (req, res) => {
  const count = renameTagInPosts(req.body.old, req.body.new);
  renderAdmin(res, 'admin/tags', {
    title: '标签管理', pageTitle: '标签管理',
    tags: getTags(loadPosts()),
    success: `已将「${req.body.old}」重命名为「${req.body.new}」（${count} 篇文章）。`,
  });
});

app.post('/admin/tags/add', requireAuth, (req, res) => {
  if (req.body.slug) {
    addTagToPost(req.body.slug, req.body.tag);
  }
  const posts = loadPosts();
  const tags = getTags(posts);
  renderAdmin(res, 'admin/tags', {
    title: '标签管理', pageTitle: '标签管理', tags,
    success: req.body.slug
      ? `已添加标签「${req.body.tag}」到文章。`
      : `标签「${req.body.tag}」已创建（未关联文章）。`,
  });
});

// ─── Admin: Categories ────────────────────────────────────

app.get('/admin/categories', requireAuth, (req, res) => {
  const categories = getAllCategories();
  renderAdmin(res, 'admin/categories', { title: '分类管理', pageTitle: '分类管理', categories });
});

app.post('/admin/categories/add', requireAuth, (req, res) => {
  addCategory(req.body.cat);
  const categories = getAllCategories();
  renderAdmin(res, 'admin/categories', {
    title: '分类管理', pageTitle: '分类管理', categories,
    success: `已添加分类「${req.body.cat}」。`,
  });
});

app.post('/admin/categories/delete', requireAuth, (req, res) => {
  const count = deleteCategoryFromPosts(req.body.cat);
  const categories = getAllCategories();
  renderAdmin(res, 'admin/categories', {
    title: '分类管理', pageTitle: '分类管理', categories,
    success: `已删除分类「${req.body.cat}」，从 ${count} 篇文章中移除。`,
  });
});

app.post('/admin/categories/rename', requireAuth, (req, res) => {
  const count = renameCategoryInPosts(req.body.old, req.body.new);
  const categories = getAllCategories();
  renderAdmin(res, 'admin/categories', {
    title: '分类管理', pageTitle: '分类管理', categories,
    success: `已将「${req.body.old}」重命名为「${req.body.new}」（${count} 篇文章）。`,
  });
});

// ─── Admin: About page ────────────────────────────────────

app.get('/admin/about', requireAuth, (req, res) => {
  renderAdmin(res, 'admin/about', {
    title: '关于页面', pageTitle: '关于页面',
    aboutBody: loadAbout(),
  });
});

app.post('/admin/about', requireAuth, (req, res) => {
  saveAbout(req.body.body);
  renderAdmin(res, 'admin/about', {
    title: '关于页面', pageTitle: '关于页面',
    aboutBody: req.body.body,
    success: '关于页面已保存。',
  });
});

// ─── Admin: Settings ──────────────────────────────────────

app.get('/admin/settings', requireAuth, (req, res) => {
  renderAdmin(res, 'admin/settings', {
    title: '站点设置', pageTitle: '站点设置',
    settings: {
      title: config.title,
      subtitle: config.subtitle,
      adminPassword: config.adminPassword,
    },
  });
});

app.post('/admin/settings', requireAuth, (req, res) => {
  updateSettings(req.body);
  reloadConfig(); // Update in-memory config for all future requests
  res.locals.config = config;
  renderAdmin(res, 'admin/settings', {
    title: '站点设置', pageTitle: '站点设置',
    settings: {
      title: config.title,
      subtitle: config.subtitle,
      adminPassword: config.adminPassword,
    },
    success: '设置已保存。',
  });
});

// ─── Image upload API ────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

app.post('/api/upload-image', (req, res) => {
  const { data, name } = req.body;
  if (!data) return res.status(400).json({ error: 'No image data' });

  const ext = path.extname(name || 'image.png') || '.png';
  const filename = Date.now() + '-' + Math.random().toString(36).substring(2, 8) + ext;
  const filePath = path.join(__dirname, 'public', 'images', filename);

  // Remove data URL prefix if present
  const base64 = data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

  res.json({ url: '/images/' + filename });
});

// ─── Preview API ─────────────────────────────────────────

app.post('/api/preview', (req, res) => {
  const html = md.render(req.body.body || '');
  res.send(html);
});

// ─── Search API ──────────────────────────────────────────

app.get('/search.json', (req, res) => {
  const posts = loadPosts();
  const results = posts.map(p => ({
    title: p.title,
    slug: p.slug,
    date: p.date ? res.locals.formatDate(p.date) : '',
    category: p.category || '',
    tags: p.tags || [],
    summary: p.summary || '',
    // Strip markdown syntax for raw search text
    text: p.body.replace(/[#*`>\[\]()!\-|]/g, ' ').replace(/\s+/g, ' ').substring(0, 500),
  }));
  res.json(results);
});

// ─── 404 ──────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404);
  renderWithLayout(res, '404', { title: '404', message: '页面未找到' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📝 Blog: http://localhost:${PORT}`);
  console.log(`🔧 Admin: http://localhost:${PORT}/admin/`);
});
