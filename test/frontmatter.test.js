'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const F = String.fromCharCode(96, 96, 96);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slh-blog-test-'));
process.env.SLH_POSTS_DIR = path.join(tmp, 'posts');

const fm = require('../lib/frontmatter');
const posts = require('../lib/posts');

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

test('frontmatter: 解析并序列化特殊字符', () => {
  const source = '---\ntitle: "A: B # C"\ndate: 2026-07-12\ntime: 14:30\ncategory: 开发\ntags: [Node, "a, b"]\nsummary: hello\n---\n\n## 标题\n\n正文';
  const parsed = fm.parseFrontmatter(source);

  assert.equal(parsed.meta.title, 'A: B # C');
  assert.deepEqual(parsed.meta.tags, ['Node', 'a, b']);
  assert.equal(parsed.body, '## 标题\n\n正文');

  const output = fm.serializeFrontmatter(parsed.meta, parsed.body);
  const again = fm.parseFrontmatter(output);

  assert.equal(again.meta.title, 'A: B # C');
  assert.deepEqual(again.meta.tags, ['Node', 'a, b']);
  assert.equal(again.body, parsed.body);
  assert.ok(output.startsWith('---\n'));
  assert.ok(output.endsWith('正文\n'));
});

test('frontmatter: BOM / CRLF / 块数组', () => {
  const source = '\uFEFF---\r\ntitle: 标题\r\ntags:\r\n  - 甲\r\n  - 乙\r\n---\r\n\r\n正文';
  const parsed = fm.parseFrontmatter(source);

  assert.equal(parsed.meta.title, '标题');
  assert.deepEqual(parsed.meta.tags, ['甲', '乙']);
  assert.equal(parsed.body, '正文');
});

test('frontmatter: 块文本 summary', () => {
  const source = '---\ntitle: T\nsummary: |\n  第一行\n  第二行\n---\n';
  const parsed = fm.parseFrontmatter(source);
  assert.equal(parsed.meta.summary, '第一行\n第二行');
  assert.equal(parsed.body, '');
});

test('frontmatter: 日期按本地时区解析，不发生时区偏移', () => {
  const date = fm.toLocalDate('2026-07-12', '08:30');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 8);
  assert.equal(date.getMinutes(), 30);

  assert.deepEqual(fm.splitDate('2026/7/1 8:05'), { date: '2026-07-01', time: '08:05' });
  assert.deepEqual(fm.splitDate('2026-07-12'), { date: '2026-07-12', time: '' });
  assert.deepEqual(fm.splitDate(''), { date: '', time: '' });
  assert.deepEqual(fm.splitDate('not a date'), { date: '', time: '' });
});

test('frontmatter: 自动加引号与空正文', () => {
  const markdown = fm.serializeFrontmatter({
    title: 'a: b',
    date: '2026-01-02',
    tags: ['x,y'],
    summary: 'line1\nline2',
  }, '');

  assert.match(markdown, /^title: "a: b"$/m);
  assert.match(markdown, /^tags: \["x,y"\]$/m);
  assert.match(markdown, /^summary: "line1\\nline2"$/m);
  assert.ok(markdown.endsWith('---\n'));

  const empty = fm.serializeFrontmatter({ title: 't' }, '');
  assert.equal(empty, '---\ntitle: t\ntags: []\n---\n');
});

test('posts: 保存后重新读取字段一致', () => {
  const result = posts.savePost({
    title: '测试: "A"',
    date: '2026-07-12',
    time: '9:05',
    category: '开发',
    tags: 'a, b',
    summary: 's',
    excerpt: 'e',
    body: '正文\n\n---\n\n结尾',
    slug: 'roundtrip',
  });

  assert.equal(result.slug, 'roundtrip');
  const raw = fs.readFileSync(path.join(tmp, 'posts', 'roundtrip.md'), 'utf8');
  assert.match(raw, /^time: 09:05$/m);
  assert.match(raw, /^tags: \[a, b\]$/m);

  const post = posts.getPost('roundtrip');
  assert.equal(post.title, '测试: "A"');
  assert.equal(post.dateStr, '2026-07-12');
  assert.equal(post.time, '09:05');
  assert.deepEqual(post.tags, ['a', 'b']);
  assert.equal(post.body, '正文\n\n---\n\n结尾');
});

test('posts: 行内改日期/分类不破坏正文', () => {
  posts.savePost({
    title: 'B',
    date: '2026-07-12',
    body: 'line1\n\n---\n\n' + F + 'js\ncode\n' + F,
    slug: 'body-preserve',
  });

  assert.ok(posts.updatePostField('body-preserve', 'date', '2026-08-01'));
  assert.ok(posts.updatePostField('body-preserve', 'category', '新分类'));

  const post = posts.getPost('body-preserve');
  assert.equal(post.dateStr, '2026-08-01');
  assert.equal(post.category, '新分类');
  assert.equal(post.body, 'line1\n\n---\n\n' + F + 'js\ncode\n' + F);
});

test('posts: 标签增删改', () => {
  posts.savePost({ title: 'Tagged', date: '2026-07-12', tags: ['a'], body: 'x', slug: 'tagged' });

  assert.ok(posts.addTagToPost('tagged', 'b'));
  assert.ok(posts.addTagToPost('tagged', 'b'));
  assert.deepEqual(posts.getPost('tagged').tags, ['a', 'b']);

  assert.ok(posts.removeTagFromPost('tagged', 'a'));
  assert.deepEqual(posts.getPost('tagged').tags, ['b']);

  assert.equal(posts.renameTagInPosts('b', 'c'), 2);
  assert.deepEqual(posts.getPost('tagged').tags, ['c']);
  assert.deepEqual(posts.getPost('roundtrip').tags, ['a', 'c']);
});

test('posts: 拒绝重复 slug 与目录穿越', () => {
  posts.savePost({ title: 'Dup', date: '2026-07-12', body: 'x', slug: 'dup' });

  assert.throws(() => {
    posts.savePost({ title: 'Dup 2', date: '2026-07-12', body: 'y', slug: 'dup' });
  }, /已存在/);

  assert.throws(() => {
    posts.savePost({ title: 'Bad', slug: '../evil', body: 'x' });
  }, /不合法/);

  assert.equal(posts.deletePost('../config'), false);
  assert.equal(posts.getPost('../../server'), null);
});

test('posts: 修改 slug 时移动文件并更新排序', () => {
  posts.savePost({ title: 'Old', date: '2026-07-12', body: 'x', slug: 'old-slug' });
  posts.savePost({ title: 'New', date: '2026-07-12', body: 'x', slug: 'new-slug', oldSlug: 'old-slug' });

  assert.equal(fs.existsSync(path.join(tmp, 'posts', 'old-slug.md')), false);
  assert.ok(fs.existsSync(path.join(tmp, 'posts', 'new-slug.md')));
  assert.ok(posts.readOrder().includes('new-slug'));
  assert.ok(!posts.readOrder().includes('old-slug'));
});

test('posts: 独立标签持久化', () => {
  posts.addTag('待用标签');
  let tags = posts.getTags(posts.loadPosts());
  const found = tags.find(t => t.name === '待用标签');
  assert.ok(found && found.count === 0);
  assert.ok(fs.existsSync(path.join(tmp, 'tags.json')));

  assert.equal(posts.renameTagInPosts('待用标签', '待用标签2'), 0);
  tags = posts.getTags(posts.loadPosts());
  assert.ok(tags.some(t => t.name === '待用标签2'));
  assert.ok(!tags.some(t => t.name === '待用标签'));

  posts.deleteTagFromAllPosts('待用标签2');
  tags = posts.getTags(posts.loadPosts());
  assert.ok(!tags.some(t => t.name === '待用标签2'));
});

test('posts: slugify 与删除', () => {
  assert.equal(posts.slugify('Hello World!'), 'hello-world');
  assert.equal(posts.slugify('中文 标题'), '中文-标题');
  assert.equal(posts.slugify('   '), 'untitled');

  assert.ok(posts.deletePost('tagged'));
  assert.equal(posts.getPost('tagged'), null);
});

test('posts: 导入解析使用标准格式导出', () => {
  const source = '---\ntitle: "X: Y"\ndate: 2026-07-12\ntime: 08:00\ntags:\n  - p\n  - q\n---\n\n正文';
  const parsed = posts.parseMarkdownText(source);

  assert.equal(parsed.title, 'X: Y');
  assert.equal(parsed.date, '2026-07-12');
  assert.equal(parsed.time, '08:00');
  assert.deepEqual(parsed.tags, ['p', 'q']);
  assert.equal(parsed.body, '正文');

  const output = posts.toMarkdown(parsed);
  assert.match(output, /^tags: \[p, q\]$/m);
  assert.equal(fm.parseFrontmatter(output).body, '正文');
});