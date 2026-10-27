'use strict';

/**
 * 标准 Markdown Frontmatter 解析 / 序列化（无第三方依赖）
 *
 * 支持的写法：
 *   ---
 *   title: 文章标题
 *   date: 2026-07-12
 *   time: 14:30
 *   category: 开发
 *   tags: [Node, Express]
 *   summary: 一句话简介
 *   excerpt: 文章摘要
 *   ---
 *
 * 兼容：
 *   - CRLF / BOM
 *   - 引号字符串（"a \"b\"" / 'a''b'）
 *   - 行内数组 tags: [a, "b, c"]
 *   - 块数组：
 *       tags:
 *         - a
 *         - b
 *   - 块文本 summary: |
 *   - 未知字段原样保留
 */

const KEY_ORDER = ['title', 'date', 'time', 'category', 'tags', 'summary', 'excerpt'];

function normalizeNewlines(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function formatTime(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

/** 清理正文：只去掉首尾空白，保留段落/代码块内部结构 */
function normalizeBody(body) {
  return normalizeNewlines(body).replace(/^\n+/, '').replace(/\s+$/, '');
}

function splitTags(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (value == null || value === '') return [];
  return String(value)
    .split(/[,，;；]/)
    .map(v => v.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function unescapeDoubleQuoted(text) {
  return text.replace(/\\(["\\/nrtbf])/g, function (m, ch) {
    switch (ch) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      default: return ch;
    }
  });
}

function parseScalar(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  if (text === '~' || /^(null|Null|NULL)$/.test(text)) return '';
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    return unescapeDoubleQuoted(text.slice(1, -1));
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text[0] === '[' && text[text.length - 1] === ']') {
    return splitFlow(text.slice(1, -1));
  }
  return text;
}

/** 按顶层逗号切分行内数组，正确处理引号与嵌套 */
function splitFlow(text) {
  const parts = [];
  let current = '';
  let quoteChar = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoteChar) {
      current += ch;
      if (quoteChar === '"' && ch === '\\') {
        i += 1;
        current += text[i] || '';
        continue;
      }
      if (ch === quoteChar) quoteChar = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map(parseScalar).filter(v => v !== '');
}

function parseMeta(text) {
  const meta = {};
  const lines = normalizeNewlines(text).split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line) || /^\s/.test(line)) {
      i += 1;
      continue;
    }

    const match = /^([A-Za-z0-9_$][A-Za-z0-9_$-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2];

    // 块文本：| 保留换行，> 折叠为空格
    if (/^[|>][+-]?$/.test(value.trim())) {
      const folded = value.trim()[0] === '>';
      const block = [];
      let indent = null;
      i += 1;
      while (i < lines.length) {
        const current = lines[i];
        if (current.trim() === '') {
          block.push('');
          i += 1;
          continue;
        }
        const leading = /^\s*/.exec(current)[0].length;
        if (leading === 0) break;
        if (indent === null) indent = leading;
        block.push(current.slice(Math.min(indent, leading)));
        i += 1;
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop();
      meta[key] = folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n');
      continue;
    }

    // 空值：可能是块数组
    if (value.trim() === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const current = lines[j];
        if (/^\s*$/.test(current)) {
          j += 1;
          continue;
        }
        const item = /^\s*-\s+(.*)$/.exec(current) || /^\s*-\s*$/.exec(current);
        if (!item) break;
        items.push(parseScalar(item[1] || ''));
        j += 1;
      }
      if (items.length > 0) {
        meta[key] = items;
        i = j;
        continue;
      }
      meta[key] = '';
      i += 1;
      continue;
    }

    // 折行续写（缩进行）
    let full = value;
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*-\s/.test(lines[j])) {
      full += ' ' + lines[j].trim();
      j += 1;
    }
    meta[key] = parseScalar(full);
    i = j;
  }

  return meta;
}

/** 解析整篇 Markdown（含 frontmatter） */
function parseFrontmatter(source) {
  const raw = normalizeNewlines(source).replace(/^\uFEFF/, '');
  const open = /^---[ \t]*\n/.exec(raw);
  if (!open) {
    return { meta: {}, body: normalizeBody(raw), hasFrontmatter: false };
  }
  const rest = raw.slice(open[0].length);
  const close = /\n---[ \t]*(?:\n|$)/.exec(rest);
  if (!close) {
    return { meta: {}, body: normalizeBody(raw), hasFrontmatter: false };
  }
  return {
    meta: parseMeta(rest.slice(0, close.index)),
    body: normalizeBody(rest.slice(close.index + close[0].length)),
    hasFrontmatter: true,
  };
}

const SPECIAL_START = /^[-?:,\[\]{}#&*!|>'"%@`]/;

function needsQuote(value) {
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  if (/[\n\r\t]/.test(value)) return true;
  if (SPECIAL_START.test(value)) return true;
  if (/:\s| #/.test(value)) return true;
  if (/^(?:true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return true;
  if (/^0\d+$/.test(value)) return true;
  return false;
}

function quoteValue(value) {
  return '"' + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t') + '"';
}

function serializeScalar(value) {
  if (value == null) return '""';
  const text = String(value);
  return needsQuote(text) ? quoteValue(text) : text;
}

/** 流式数组（tags 等）里的值：逗号/方括号必须加引号，否则会被拆成多个元素 */
function serializeFlowValue(value) {
  const text = String(value == null ? '' : value);
  return needsQuote(text) || /[,\[\]]/.test(text) ? quoteValue(text) : text;
}

/**
 * 生成标准格式文章：
 * ---
 * title: ...
 * date: YYYY-MM-DD
 * time: HH:mm
 * category: ...
 * tags: [a, b]
 * summary: ...
 * excerpt: ...
 * ---
 *
 * 正文
 */
function serializeFrontmatter(meta, body) {
  const source = meta || {};
  const lines = ['---'];

  for (const key of KEY_ORDER) {
    if (key === 'tags') {
      lines.push('tags: [' + splitTags(source.tags).map(serializeFlowValue).join(', ') + ']');
      continue;
    }
    if (key === 'title') {
      lines.push('title: ' + serializeScalar(source.title == null ? '' : source.title));
      continue;
    }
    if (key === 'date') {
      const date = normalizeDateInput(source.date);
      if (!date) continue;
      lines.push('date: ' + serializeScalar(date));
      continue;
    }
    const value = source[key];
    if (value == null || value === '') continue;
    lines.push(key + ': ' + serializeScalar(value));
  }

  for (const [key, value] of Object.entries(source)) {
    if (KEY_ORDER.includes(key)) continue;
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(key + ': [' + value.map(serializeFlowValue).join(', ') + ']');
      continue;
    }
    lines.push(key + ': ' + serializeScalar(value));
  }

  lines.push('---');
  const normalized = normalizeBody(body);
  return lines.join('\n') + '\n' + (normalized ? '\n' + normalized + '\n' : '');
}

const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** 支持 Date / 2026-07-12 / 2026/7/12 / 2026-07-12 14:30 / ISO 字符串 */
function splitDate(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { date: '', time: '' };
    return { date: formatDate(value), time: formatTime(value) };
  }
  const text = String(value == null ? '' : value).trim();
  if (!text) return { date: '', time: '' };

  const match = DATE_RE.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] == null ? 0 : Number(match[4]);
    const minute = match[5] == null ? 0 : Number(match[5]);
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return {
        date: formatDate(date),
        time: match[4] == null ? '' : pad2(hour) + ':' + pad2(minute),
      };
    }
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return { date: formatDate(parsed), time: '' };
  return { date: '', time: '' };
}

function normalizeDateInput(value) {
  if (value == null || value === '') return '';
  return splitDate(value).date;
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value == null ? '' : value).trim());
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return pad2(hour) + ':' + pad2(minute);
}

/** 以本地时区构造日期，避免 new Date('YYYY-MM-DD') 被当成 UTC 导致日期偏移 */
function toLocalDate(dateStr, timeStr) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr == null ? '' : dateStr).trim());
  if (!dateMatch) return null;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr == null ? '' : timeStr).trim());
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const date = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute, 0, 0);
  if (isNaN(date.getTime()) || date.getDate() !== Number(dateMatch[3])) return null;
  return date;
}

function todayString() {
  return formatDate(new Date());
}

function nowTimeString() {
  return formatTime(new Date());
}

module.exports = {
  KEY_ORDER,
  normalizeNewlines,
  normalizeBody,
  splitTags,
  parseScalar,
  parseFrontmatter,
  serializeFrontmatter,
  serializeScalar,
  serializeFlowValue,
  needsQuote,
  splitDate,
  normalizeDateInput,
  normalizeTime,
  toLocalDate,
  formatDate,
  formatTime,
  todayString,
  nowTimeString,
};
