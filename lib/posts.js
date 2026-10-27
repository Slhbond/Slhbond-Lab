'use strict';

const fs = require('fs');
const path = require('path');

const {
  parseFrontmatter,
  serializeFrontmatter,
  splitTags,
  splitDate,
  normalizeDateInput,
  normalizeTime,
  toLocalDate,
  formatDate,
  formatTime,
  todayString,
} = require('./frontmatter');

const rootDir = path.join(__dirname, '..');

// SLH_POSTS_DIR 仅用于测试 / 自定义数据目录；默认使用项目下的 posts/
const postsDir = process.env.SLH_POSTS_DIR
  ? path.resolve(process.env.SLH_POSTS_DIR)
  : path.join(rootDir, 'posts');
const dataDir = process.env.SLH_DATA_DIR
  ? path.resolve(process.env.SLH_DATA_DIR)
  : (process.env.SLH_POSTS_DIR ? path.dirname(postsDir) : rootDir);

// 旧版本把运行时 JSON 放在项目根目录；存在 data 目录时自动迁移过去
function migrateLegacyData() {
  if (!process.env.SLH_DATA_DIR || dataDir === rootDir) return;
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    for (const name of ['categories.json', 'posts-order.json', 'tags.json']) {
      const target = path.join(dataDir, name);
      const legacy = path.join(rootDir, name);
      if (!fs.existsSync(target) && fs.existsSync(legacy)) fs.copyFileSync(legacy, target);
    }
  } catch (_) {
    /* 迁移失败不阻塞启动 */
  }
}
migrateLegacyData();

const orderFile = path.join(dataDir, 'posts-order.json');
const categoriesFile = path.join(dataDir, 'categories.json');
const tagsFile = path.join(dataDir, 'tags.json');
const configPath = path.join(rootDir, 'config.js');
const aboutFile = path.join(postsDir, '_about.md');

class ValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ValidationError';
    this.code = code || 'INVALID';
  }
}

// ─── 基础工具 ─────────────────────────────────────────────

function textOf(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value).trim();
}

/** 粗略去除 Markdown / HTML 标记，用于首页摘要和搜索文本 */
function stripMarkdown(source) {
  return String(source == null ? '' : source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSafeSlug(slug) {
  if (typeof slug !== 'string') return false;
  const s = slug.trim();
  if (!s || s.length > 100) return false;
  if (s === '.' || s === '..') return false;
  if (s.startsWith('.') || s.startsWith('_')) return false;
  if (/[\/\\:*?"<>|\u0000-\u001f]/.test(s)) return false;
  if (/\s/.test(s)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) return false;
  return true;
}

function slugify(text) {
  let s = String(text == null ? '' : text).normalize('NFKC').toLowerCase().trim();
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s._-]/gu, ' ');
  s = s
    .replace(/[\s_]+/g, '-')
    .replace(/\.+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!s) s = 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = 'post-' + s;
  return s;
}

/** 校验并返回文章文件路径，杜绝 ../ 目录穿越 */
function postFile(slug) {
  if (!isSafeSlug(slug)) throw new ValidationError('非法的文章标识（slug）', 'SLUG_INVALID');
  const file = path.join(postsDir, slug + '.md');
  if (path.dirname(file) !== postsDir) throw new ValidationError('非法的文章标识（slug）', 'SLUG_INVALID');
  return file;
}

function ensurePostsDir() {
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
}

/** 原子写入：先写临时文件再重命名，避免进程中断造成文章损坏 */
function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp');
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Docker 单文件 bind mount（如 config.js）不能 rename 覆盖，退回直接写入
    if (err.code === 'EBUSY' || err.code === 'EXDEV' || err.code === 'EPERM') {
      try {
        fs.writeFileSync(file, content, 'utf-8');
        fs.unlinkSync(tmp);
        return;
      } catch (writeErr) {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        throw writeErr;
      }
    }
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ─── 解析 & 缓存 ──────────────────────────────────────────

const cache = new Map();

function clonePost(post) {
  return Object.assign({}, post, { tags: post.tags.slice() });
}

function parsePost(filePath, stat) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { meta, body, hasFrontmatter } = parseFrontmatter(raw);
  const slug = path.basename(filePath, '.md');
  const dateParts = splitDate(meta.date);
  const time = normalizeTime(meta.time) || dateParts.time;
  const date = toLocalDate(dateParts.date, time);

  return {
    slug,
    title: textOf(meta.title) || slug,
    date,
    dateStr: dateParts.date,
    time,
    isoDate: date ? date.toISOString() : '',
    category: textOf(meta.category) || null,
    tags: splitTags(meta.tags),
    summary: textOf(meta.summary),
    excerpt: textOf(meta.excerpt),
    body,
    plain: stripMarkdown(body),
    hasFrontmatter,
    updatedAt: stat ? stat.mtime : null,
  };
}

function readPostCached(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    cache.delete(filePath);
    return null;
  }

  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return clonePost(cached.post);
  }

  let post;
  try {
    post = parsePost(filePath, stat);
  } catch (err) {
    console.error('[posts] 解析失败: ' + filePath + ' - ' + err.message);
    return null;
  }

  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, post });
  return clonePost(post);
}

function listPostFiles() {
  if (!fs.existsSync(postsDir)) return [];
  return fs.readdirSync(postsDir)
    .filter(name => name.endsWith('.md') && !name.startsWith('_'))
    .map(name => path.join(postsDir, name));
}

function comparePosts(a, b) {
  const ta = a.date ? a.date.getTime() : -Infinity;
  const tb = b.date ? b.date.getTime() : -Infinity;
  if (ta !== tb) return tb - ta;
  const byTime = String(b.time || '').localeCompare(String(a.time || ''));
  if (byTime !== 0) return byTime;
  return String(a.title).localeCompare(String(b.title), 'zh-CN');
}

/** 加载全部文章，按日期倒序 */
function loadPosts() {
  const posts = [];
  for (const file of listPostFiles()) {
    const post = readPostCached(file);
    if (post) posts.push(post);
  }
  posts.sort(comparePosts);
  return posts;
}

function getPost(slug) {
  if (!isSafeSlug(slug)) return null;
  try {
    return readPostCached(postFile(slug));
  } catch (_) {
    return null;
  }
}

// ─── 排序（posts-order.json）───────────────────────────────

function readOrder() {
  try {
    const value = JSON.parse(fs.readFileSync(orderFile, 'utf-8'));
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  } catch (_) {
    return [];
  }
}

function writeOrder(order) {
  writeFileAtomic(orderFile, JSON.stringify(order, null, 2) + '\n');
}

function addToOrder(slug) {
  const order = readOrder();
  if (order.includes(slug)) return;
  order.unshift(slug);
  writeOrder(order);
}

function replaceInOrder(oldSlug, newSlug) {
  const order = readOrder();
  const index = order.indexOf(oldSlug);
  if (index !== -1) order[index] = newSlug;
  else if (!order.includes(newSlug)) order.unshift(newSlug);
  const deduped = [];
  for (const slug of order) {
    if (!deduped.includes(slug)) deduped.push(slug);
  }
  writeOrder(deduped);
}

function removeFromOrder(slug) {
  const order = readOrder();
  if (!order.includes(slug)) return;
  writeOrder(order.filter(item => item !== slug));
}

/** 按自定义顺序加载文章 */
function loadOrderedPosts() {
  const posts = loadPosts();
  const order = readOrder();
  const map = new Map(posts.map(post => [post.slug, post]));
  const ordered = [];
  const seen = new Set();

  for (const slug of order) {
    const post = map.get(slug);
    if (post && !seen.has(slug)) {
      ordered.push(post);
      seen.add(slug);
    }
  }
  for (const post of posts) {
    if (!seen.has(post.slug)) {
      ordered.push(post);
      seen.add(post.slug);
    }
  }
  return ordered;
}

/** 调整文章顺序（上移 / 下移） */
function movePost(slug, dir) {
  if (!isSafeSlug(slug)) return false;
  const order = readOrder();
  const allSlugs = loadPosts().map(post => post.slug);

  for (const item of allSlugs) {
    if (!order.includes(item)) order.push(item);
  }
  const filtered = order.filter(item => allSlugs.includes(item));
  const index = filtered.indexOf(slug);
  if (index === -1) return false;

  const target = dir === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= filtered.length) return false;

  const tmp = filtered[index];
  filtered[index] = filtered[target];
  filtered[target] = tmp;
  writeOrder(filtered);
  return true;
}

// ─── 标签 / 分类 / 归档 ───────────────────────────────────

function getTags(posts) {
  const map = {};
  (posts || []).forEach(post => {
    (post.tags || []).forEach(tag => {
      map[tag] = (map[tag] || 0) + 1;
    });
  });
  for (const tag of loadTagStore()) {
    if (map[tag] === undefined) map[tag] = 0;
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function getCategories(posts) {
  const map = {};
  (posts || []).forEach(post => {
    const category = post.category || '未分类';
    map[category] = (map[category] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function getArchives(posts) {
  const years = {};

  (posts || []).forEach(post => {
    if (!post.dateStr) return;
    const year = Number(post.dateStr.slice(0, 4));
    const dateKey = post.dateStr;

    if (!years[year]) years[year] = { year, dates: {}, dateList: [] };
    if (!years[year].dates[dateKey]) {
      years[year].dates[dateKey] = { date: dateKey, posts: [] };
      years[year].dateList.push(dateKey);
    }
    years[year].dates[dateKey].posts.push({
      slug: post.slug,
      title: post.title,
      date: post.date,
      dateStr: dateKey,
      time: post.time || '00:00',
    });
  });

  return Object.values(years)
    .sort((a, b) => b.year - a.year)
    .map(group => ({
      year: group.year,
      dates: group.dateList
        .sort((a, b) => b.localeCompare(a))
        .map(dateKey => {
          const day = group.dates[dateKey];
          day.posts.sort((a, b) => String(b.time).localeCompare(String(a.time)));
          return day;
        }),
    }));
}

// ─── 序列化 / 保存 / 删除 ─────────────────────────────────

function toMarkdown(post) {
  const source = post || {};
  return serializeFrontmatter({
    title: textOf(source.title),
    date: normalizeDateInput(source.date) || normalizeDateInput(source.dateStr),
    time: normalizeTime(source.time),
    category: textOf(source.category),
    tags: splitTags(source.tags),
    summary: textOf(source.summary),
    excerpt: textOf(source.excerpt),
  }, source.body == null ? '' : String(source.body));
}

function parseMarkdownText(text) {
  const { meta, body, hasFrontmatter } = parseFrontmatter(text);
  const dateParts = splitDate(meta.date);
  return {
    title: textOf(meta.title),
    date: dateParts.date,
    time: normalizeTime(meta.time) || dateParts.time,
    category: textOf(meta.category),
    tags: splitTags(meta.tags),
    summary: textOf(meta.summary),
    excerpt: textOf(meta.excerpt),
    body,
    hasFrontmatter,
  };
}

function savePost(input) {
  const payload = input || {};
  ensurePostsDir();

  const title = String(payload.title == null ? '' : payload.title).replace(/\s+/g, ' ').trim();
  if (!title) throw new ValidationError('标题不能为空', 'TITLE_REQUIRED');

  let slug = String(payload.slug == null ? '' : payload.slug).trim();
  if (!slug) slug = slugify(title);
  if (!isSafeSlug(slug)) {
    throw new ValidationError('文章地址（slug）不合法：只能包含文字、数字、-、_ 和 .，且不能以点或下划线开头', 'SLUG_INVALID');
  }

  const oldSlugRaw = payload.oldSlug ? String(payload.oldSlug).trim() : '';
  const oldSlug = oldSlugRaw && isSafeSlug(oldSlugRaw) ? oldSlugRaw : '';
  const file = postFile(slug);
  const exists = fs.existsSync(file);

  if (exists && oldSlug !== slug) {
    throw new ValidationError('已存在地址为「' + slug + '」的文章，请修改标题或文章地址', 'SLUG_EXISTS');
  }

  const dateParts = splitDate(payload.date);
  const date = dateParts.date || todayString();
  const time = normalizeTime(payload.time) || dateParts.time;

  const meta = {
    title,
    date,
    time,
    category: textOf(payload.category),
    tags: splitTags(payload.tags),
    summary: textOf(payload.summary),
    excerpt: textOf(payload.excerpt),
  };

  const body = payload.body == null ? '' : String(payload.body);
  writeFileAtomic(file, serializeFrontmatter(meta, body));
  cache.delete(file);

  if (oldSlug && oldSlug !== slug) {
    try { fs.unlinkSync(postFile(oldSlug)); } catch (_) { /* 原文件可能已不存在 */ }
    cache.delete(postFile(oldSlug));
    replaceInOrder(oldSlug, slug);
  } else if (!oldSlug) {
    addToOrder(slug);
  }

  return { slug, created: !oldSlug };
}

function deletePost(slug) {
  if (!isSafeSlug(slug)) return false;
  const file = postFile(slug);
  let existed = false;
  try {
    fs.unlinkSync(file);
    existed = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  cache.delete(file);
  if (existed) removeFromOrder(slug);
  return existed;
}

// ─── 单独字段更新（文章列表页行内编辑）──────────────────

const EDITABLE_FIELDS = new Set(['title', 'date', 'time', 'category', 'summary', 'excerpt']);

function updatePostField(slug, field, value) {
  if (!EDITABLE_FIELDS.has(field)) return false;
  const post = getPost(slug);
  if (!post) return false;

  const meta = {
    title: post.title,
    date: post.dateStr,
    time: post.time,
    category: post.category || '',
    tags: post.tags,
    summary: post.summary,
    excerpt: post.excerpt,
  };

  if (field === 'date') {
    const normalized = normalizeDateInput(value);
    if (!normalized) return false;
    meta.date = normalized;
  } else if (field === 'time') {
    meta.time = normalizeTime(value);
  } else if (field === 'title') {
    const title = textOf(value);
    if (!title) return false;
    meta.title = title;
  } else {
    meta[field] = textOf(value);
  }

  const file = postFile(slug);
  writeFileAtomic(file, serializeFrontmatter(meta, post.body));
  cache.delete(file);
  return true;
}

// ─── 标签存储（用于创建尚未关联文章的标签）──────────────

function loadTagStore() {
  try {
    const value = JSON.parse(fs.readFileSync(tagsFile, 'utf-8'));
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch (_) {
    return [];
  }
}

function saveTagStore(tags) {
  writeFileAtomic(tagsFile, JSON.stringify(tags, null, 2) + '\n');
}

function addTag(name) {
  const tag = textOf(name);
  if (!tag) throw new ValidationError('标签名不能为空', 'TAG_REQUIRED');
  const stored = loadTagStore();
  if (!stored.includes(tag)) {
    stored.push(tag);
    saveTagStore(stored);
  }
  return tag;
}

// ─── 标签操作 ─────────────────────────────────────────────

function rewriteTags(post, nextTags) {
  const file = postFile(post.slug);
  writeFileAtomic(file, serializeFrontmatter({
    title: post.title,
    date: post.dateStr,
    time: post.time,
    category: post.category || '',
    tags: nextTags,
    summary: post.summary,
    excerpt: post.excerpt,
  }, post.body));
  cache.delete(file);
}

function addTagToPost(slug, tag) {
  const name = textOf(tag);
  const post = getPost(slug);
  if (!post || !name) return false;
  if (post.tags.includes(name)) return true;
  rewriteTags(post, post.tags.concat(name));
  return true;
}

function removeTagFromPost(slug, tag) {
  const name = textOf(tag);
  const post = getPost(slug);
  if (!post) return false;
  if (!post.tags.includes(name)) return true;
  rewriteTags(post, post.tags.filter(item => item !== name));
  return true;
}

function renameTagInPosts(oldName, newName) {
  const from = textOf(oldName);
  const to = textOf(newName);
  if (!from || !to) throw new ValidationError('标签名不能为空', 'TAG_REQUIRED');

  let count = 0;
  for (const post of loadPosts()) {
    if (!post.tags.includes(from)) continue;
    const next = [];
    for (const tag of post.tags) {
      const value = tag === from ? to : tag;
      if (!next.includes(value)) next.push(value);
    }
    rewriteTags(post, next);
    count += 1;
  }

  const stored = loadTagStore();
  const index = stored.indexOf(from);
  if (index !== -1) {
    if (stored.includes(to)) stored.splice(index, 1);
    else stored[index] = to;
    saveTagStore(stored);
  }
  return count;
}

function deleteTagFromAllPosts(tag) {
  const name = textOf(tag);
  if (!name) return 0;
  let count = 0;
  for (const post of loadPosts()) {
    if (!post.tags.includes(name)) continue;
    rewriteTags(post, post.tags.filter(item => item !== name));
    count += 1;
  }
  saveTagStore(loadTagStore().filter(item => item !== name));
  return count;
}

// ─── 分类存储 ─────────────────────────────────────────────

function loadCategoryStore() {
  try {
    const value = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch (_) {
    return [];
  }
}

function saveCategoryStore(categories) {
  writeFileAtomic(categoriesFile, JSON.stringify(categories, null, 2) + '\n');
}

function getAllCategories() {
  const map = {};
  for (const post of loadPosts()) {
    if (post.category) map[post.category] = (map[post.category] || 0) + 1;
  }
  for (const category of loadCategoryStore()) {
    if (map[category] === undefined) map[category] = 0;
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function addCategory(name) {
  const category = textOf(name);
  if (!category) throw new ValidationError('分类名不能为空', 'CATEGORY_REQUIRED');
  const stored = loadCategoryStore();
  if (!stored.includes(category)) {
    stored.push(category);
    saveCategoryStore(stored);
  }
  return category;
}

function renameCategoryInPosts(oldName, newName) {
  const from = textOf(oldName);
  const to = textOf(newName);
  if (!from || !to) throw new ValidationError('分类名不能为空', 'CATEGORY_REQUIRED');

  let count = 0;
  for (const post of loadPosts()) {
    if (post.category !== from) continue;
    if (updatePostField(post.slug, 'category', to)) count += 1;
  }

  const stored = loadCategoryStore();
  const index = stored.indexOf(from);
  if (index !== -1) {
    if (!stored.includes(to)) stored[index] = to;
    else stored.splice(index, 1);
    saveCategoryStore(stored);
  }
  return count;
}

function deleteCategoryFromPosts(name) {
  const category = textOf(name);
  if (!category) return 0;
  let count = 0;
  for (const post of loadPosts()) {
    if (post.category !== category) continue;
    if (updatePostField(post.slug, 'category', '')) count += 1;
  }
  saveCategoryStore(loadCategoryStore().filter(item => item !== category));
  return count;
}

// ─── 关于页 ───────────────────────────────────────────────

function loadAbout() {
  try {
    return fs.readFileSync(aboutFile, 'utf-8');
  } catch (_) {
    return '';
  }
}

function saveAbout(body) {
  ensurePostsDir();
  writeFileAtomic(aboutFile, String(body == null ? '' : body));
}

// ─── 站点设置 ─────────────────────────────────────────────

function readConfig() {
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

/**
 * 更新 config.js
 * 使用 JSON.stringify 生成，避免密码/标题里出现引号导致配置文件损坏或代码注入。
 */
function updateSettings(patch) {
  const input = patch || {};
  const current = readConfig();
  const next = Object.assign({}, current);

  for (const key of ['title', 'subtitle', 'homeTitle', 'homeSubtitle', 'homeNotice', 'author', 'description', 'bio', 'avatar']) {
    if (input[key] !== undefined) next[key] = String(input[key]).trim();
  }
  if (!next.title) throw new ValidationError('站点标题不能为空', 'TITLE_REQUIRED');
  if (next.bio && next.bio.length > 300) throw new ValidationError('个人简介不能超过 300 字', 'BIO_TOO_LONG');
  if (next.avatar && !/^(\/|https?:\/\/)/i.test(next.avatar)) {
    throw new ValidationError('头像地址必须是 / 开头的站内路径或 http(s) 链接', 'AVATAR_INVALID');
  }

  if (input.adminPassword) {
    const password = String(input.adminPassword);
    if (password.length < 4) throw new ValidationError('管理密码至少 4 位', 'PASSWORD_SHORT');
    if (/[\r\n]/.test(password)) throw new ValidationError('管理密码不能包含换行', 'PASSWORD_INVALID');
    next.adminPassword = password;
  }

  const header = '// 站点配置（后台「站点设置」会重写此文件，也可手动修改）\n' +
    '// 修改后重启服务生效：docker compose restart\n';
  writeFileAtomic(configPath, header + 'module.exports = ' + JSON.stringify(next, null, 2) + ';\n');
  delete require.cache[require.resolve(configPath)];
  return next;
}

module.exports = {
  ValidationError,
  postsDir,
  dataDir,
  isSafeSlug,
  slugify,
  stripMarkdown,
  parsePost,
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
  readOrder,
  saveOrder: writeOrder,
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
  readConfig,
};
