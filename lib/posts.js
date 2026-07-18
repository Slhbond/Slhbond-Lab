const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, '..', 'posts');
const orderFile = path.join(__dirname, '..', 'posts-order.json');
const aboutFile = path.join(postsDir, '_about.md');

/**
 * Parse frontmatter from a markdown file.
 * Returns { slug, title, date, category, tags, summary, body }
 */
function parsePost(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const slug = path.basename(filePath, '.md');

  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { slug, title: slug, date: null, time: '', category: null, tags: [], summary: '', excerpt: '', body: raw };
  }

  const fmText = fmMatch[1];
  const body = fmMatch[2].trim();

  const meta = {};
  fmText.split('\n').forEach(line => {
    const sepIdx = line.indexOf(':');
    if (sepIdx === -1) return;
    const key = line.slice(0, sepIdx).trim();
    let value = line.slice(sepIdx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }

    meta[key] = value;
  });

  return {
    slug,
    title: meta.title || slug,
    date: meta.date ? new Date(meta.date) : null,
    time: meta.time || '',
    category: meta.category || null,
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    summary: meta.summary || '',
    excerpt: meta.excerpt || '',
    body,
  };
}

/** Load all posts (excludes _about.md), newest-first by default */
function loadPosts() {
  if (!fs.existsSync(postsDir)) return [];

  return fs.readdirSync(postsDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => parsePost(path.join(postsDir, f)))
    .filter(p => p !== null)
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date - a.date;
    });
}

// ─── Ordering ─────────────────────────────────────────────

function loadOrder() {
  try { return JSON.parse(fs.readFileSync(orderFile, 'utf-8')); }
  catch { return []; }
}

function saveOrder(order) {
  fs.writeFileSync(orderFile, JSON.stringify(order, null, 2), 'utf-8');
}

/** Load posts respecting custom order */
function loadOrderedPosts() {
  const posts = loadPosts();
  const order = loadOrder();

  // Build a map for lookup
  const postMap = {};
  posts.forEach(p => { postMap[p.slug] = p; });

  const ordered = [];
  const seen = new Set();

  // First, posts in the order file (that still exist)
  order.forEach(slug => {
    if (postMap[slug] && !seen.has(slug)) {
      ordered.push(postMap[slug]);
      seen.add(slug);
    }
  });

  // Then, remaining posts (new ones not in order file) by date desc
  const remaining = posts.filter(p => !seen.has(p.slug))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date - a.date;
    });

  return ordered.concat(remaining);
}

/** Move a post up or down in the order */
function movePost(slug, dir) {
  let order = loadOrder();
  const posts = loadPosts();
  const allSlugs = posts.map(p => p.slug);

  // Ensure all current slugs are in the order
  allSlugs.forEach(s => { if (!order.includes(s)) order.push(s); });
  // Remove slugs that no longer exist
  order = order.filter(s => allSlugs.includes(s));

  const idx = order.indexOf(slug);
  if (idx === -1) return;

  const newIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= order.length) return;

  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  saveOrder(order);
}

// ─── Tags helpers ─────────────────────────────────────────

function getTags(posts) {
  const map = {};
  posts.forEach(p => {
    (p.tags || []).forEach(t => {
      map[t] = (map[t] || 0) + 1;
    });
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function getCategories(posts) {
  const map = {};
  posts.forEach(p => {
    const cat = p.category || '未分类';
    map[cat] = (map[cat] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function getArchives(posts) {
  const years = {};
  posts.forEach(p => {
    if (!p.date) return;
    const y = p.date.getFullYear();
    const m = p.date.getMonth() + 1;
    const d = p.date.getDate();
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hh = String(p.date.getHours()).padStart(2, '0');
    const mm = String(p.date.getMinutes()).padStart(2, '0');

    if (!years[y]) years[y] = { year: y, dates: {}, dateList: [] };
    if (!years[y].dates[dateKey]) {
      years[y].dates[dateKey] = { date: dateKey, posts: [] };
      years[y].dateList.push(dateKey);
    }
    years[y].dates[dateKey].posts.push({
      slug: p.slug, title: p.title, date: p.date,
      time: p.time || `${hh}:${mm}`,
    });
  });

  return Object.values(years)
    .sort((a, b) => b.year - a.year)
    .map(y => ({
      year: y.year,
      dates: y.dateList.sort((a, b) => b.localeCompare(a)).map(dk => y.dates[dk]),
    }));
}

// ─── Slug ─────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80) || 'untitled';
}

// ─── Serialize / Save / Delete ───────────────────────────

function toMarkdown(post) {
  const tags = Array.isArray(post.tags) ? post.tags.join(', ') : (post.tags || '');
  const lines = [
    '---',
    `title: ${post.title}`,
    `date: ${post.date}`,
  ];
  if (post.time) lines.push(`time: ${post.time}`);
  lines.push(`category: ${post.category || ''}`);
  lines.push(`tags: [${tags}]`);
  if (post.summary) lines.push(`summary: ${post.summary}`);
  if (post.excerpt) lines.push(`excerpt: ${post.excerpt}`);
  lines.push('---', '', post.body);
  return lines.join('\n') + '\n';
}

function savePost(post) {
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
  const slug = post.slug || slugify(post.title);
  const filePath = path.join(postsDir, `${slug}.md`);
  if (post.oldSlug && post.oldSlug !== slug) {
    const oldPath = path.join(postsDir, `${post.oldSlug}.md`);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  fs.writeFileSync(filePath, toMarkdown(post), 'utf-8');
  return slug;
}

function deletePost(slug) {
  const filePath = path.join(postsDir, `${slug}.md`);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
  return false;
}

// ─── Inline field updates ─────────────────────────────────

function updatePostField(slug, field, value) {
  const filePath = path.join(postsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;

  let fmText = fmMatch[1];
  const bodyStart = raw.indexOf('---', fmMatch.index + 3) + 3;
  let body = raw.slice(bodyStart).trim();

  if (field === 'date') {
    // Update date in frontmatter
    if (fmText.includes('\ndate:')) {
      fmText = fmText.replace(/\ndate:.*/, `\ndate: ${value}`);
    } else {
      fmText += `\ndate: ${value}`;
    }
  } else if (field === 'category') {
    if (fmText.includes('\ncategory:')) {
      fmText = fmText.replace(/\ncategory:.*/, `\ncategory: ${value}`);
    } else {
      fmText += `\ncategory: ${value}`;
    }
  }

  const newContent = `---\n${fmText}\n---\n\n${body}`;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

// ─── Tag operations ───────────────────────────────────────

function addTagToPost(slug, tag) {
  const filePath = path.join(postsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;

  let fmText = fmMatch[1];
  const bodyStart = raw.indexOf('---', fmMatch.index + 3) + 3;
  let body = raw.slice(bodyStart).trim();

  // Parse existing tags
  const tagsMatch = fmText.match(/^tags:\s*\[(.*?)\]$/m);
  let tags = [];
  if (tagsMatch) {
    tags = tagsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!tags.includes(tag)) {
    tags.push(tag);
    const newTagLine = `tags: [${tags.join(', ')}]`;
    if (tagsMatch) {
      fmText = fmText.replace(tagsMatch[0], newTagLine);
    } else {
      fmText += `\n${newTagLine}`;
    }
  }

  const newContent = `---\n${fmText}\n---\n\n${body}`;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

function removeTagFromPost(slug, tag) {
  const filePath = path.join(postsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;

  let fmText = fmMatch[1];
  const bodyStart = raw.indexOf('---', fmMatch.index + 3) + 3;
  let body = raw.slice(bodyStart).trim();

  const tagsMatch = fmText.match(/^tags:\s*\[(.*?)\]$/m);
  if (tagsMatch) {
    let tags = tagsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    tags = tags.filter(t => t !== tag);
    const newTagLine = `tags: [${tags.join(', ')}]`;
    fmText = fmText.replace(tagsMatch[0], newTagLine);
  }

  const newContent = `---\n${fmText}\n---\n\n${body}`;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

function renameTagInPosts(oldName, newName) {
  const posts = loadPosts();
  let count = 0;
  posts.forEach(p => {
    if ((p.tags || []).includes(oldName)) {
      const filePath = path.join(postsDir, `${p.slug}.md`);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) return;

      let fmText = fmMatch[1];
      const bodyStart = raw.indexOf('---', fmMatch.index + 3) + 3;
      let body = raw.slice(bodyStart).trim();

      const tagsMatch = fmText.match(/^tags:\s*\[(.*?)\]$/m);
      if (tagsMatch) {
        let tags = tagsMatch[1].split(',').map(s => s.trim());
        tags = tags.map(t => t === oldName ? newName : t);
        fmText = fmText.replace(tagsMatch[0], `tags: [${tags.join(', ')}]`);
        count++;
      }

      const newContent = `---\n${fmText}\n---\n\n${body}`;
      fs.writeFileSync(filePath, newContent, 'utf-8');
    }
  });
  return count;
}

function deleteTagFromAllPosts(tag) {
  const posts = loadPosts();
  let count = 0;
  posts.forEach(p => {
    if ((p.tags || []).includes(tag)) {
      removeTagFromPost(p.slug, tag);
      count++;
    }
  });
  return count;
}

// ─── About page ───────────────────────────────────────────

function loadAbout() {
  try { return fs.readFileSync(aboutFile, 'utf-8'); }
  catch { return ''; }
}

function saveAbout(body) {
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(aboutFile, body, 'utf-8');
}

// ─── Settings ─────────────────────────────────────────────

function updateSettings(settings) {
  const configPath = path.join(__dirname, '..', 'config.js');
  let content = fs.readFileSync(configPath, 'utf-8');

  const fields = ['title', 'subtitle', 'adminPassword'];
  fields.forEach(field => {
    if (settings[field] !== undefined && settings[field] !== '') {
      const regex = new RegExp(`(${field}:\\s*['"])[^'"]*['"]`, '');
      content = content.replace(regex, `$1${settings[field]}'`);
    }
  });

  fs.writeFileSync(configPath, content, 'utf-8');
  // Clear require cache so config reloads
  delete require.cache[require.resolve(configPath)];
}

// ─── Category storage ─────────────────────────────────────

const categoriesFile = path.join(__dirname, '..', 'categories.json');

function loadCategoryStore() {
  try { return JSON.parse(fs.readFileSync(categoriesFile, 'utf-8')); }
  catch { return []; }
}

function saveCategoryStore(cats) {
  fs.writeFileSync(categoriesFile, JSON.stringify(cats, null, 2), 'utf-8');
}

function getAllCategories() {
  const posts = loadPosts();
  const map = {};
  // From posts
  posts.forEach(p => {
    const cat = p.category;
    if (cat) map[cat] = (map[cat] || 0) + 1;
  });
  // From stored categories (even if no posts yet)
  const stored = loadCategoryStore();
  stored.forEach(c => {
    if (!map[c]) map[c] = 0;
  });

  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function addCategory(name) {
  const stored = loadCategoryStore();
  if (!stored.includes(name)) {
    stored.push(name);
    saveCategoryStore(stored);
  }
}

// ─── Category operations ──────────────────────────────────

function renameCategoryInPosts(oldName, newName) {
  const posts = loadPosts();
  let count = 0;
  posts.forEach(p => {
    if (p.category === oldName) {
      updatePostField(p.slug, 'category', newName);
      count++;
    }
  });
  // Also update stored categories
  const stored = loadCategoryStore();
  const idx = stored.indexOf(oldName);
  if (idx !== -1) {
    stored[idx] = newName;
    saveCategoryStore(stored);
  }
  return count;
}

function deleteCategoryFromPosts(cat) {
  const posts = loadPosts();
  let count = 0;
  posts.forEach(p => {
    if (p.category === cat) {
      updatePostField(p.slug, 'category', '');
      count++;
    }
  });
  // Also remove from stored categories
  const stored = loadCategoryStore();
  saveCategoryStore(stored.filter(c => c !== cat));
  return count;
}

module.exports = {
  loadPosts, loadOrderedPosts, getTags, getCategories, getArchives, getAllCategories,
  parsePost, savePost, deletePost, slugify,
  loadOrder, saveOrder, movePost, updatePostField,
  addTagToPost, removeTagFromPost, renameTagInPosts, deleteTagFromAllPosts,
  renameCategoryInPosts, deleteCategoryFromPosts, addCategory,
  loadAbout, saveAbout, updateSettings,
};
