'use strict';

const fs = require('fs');
const path = require('path');
const session = require('express-session');

/**
 * 简单的文件会话存储：单进程博客足够用。
 * - 写入 data/sessions.json，容器重启后登录状态仍在
 * - 200ms 防抖合并写，原子替换，避免频繁 IO
 * - 每小时清理过期会话
 */
class FileSessionStore extends session.Store {
  constructor(file) {
    super();
    this.file = file;
    this.sessions = this.load();
    this.timer = null;
    this.pruneTimer = setInterval(() => this.prune(), 60 * 60 * 1000);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      const now = Date.now();
      const alive = {};
      for (const [sid, sess] of Object.entries(raw)) {
        const expires = sess && sess.cookie && sess.cookie.expires;
        if (!expires || new Date(expires).getTime() > now) alive[sid] = sess;
      }
      return alive;
    } catch (_) {
      return {};
    }
  }

  prune() {
    const now = Date.now();
    let changed = false;
    for (const [sid, sess] of Object.entries(this.sessions)) {
      const expires = sess && sess.cookie && sess.cookie.expires;
      if (expires && new Date(expires).getTime() <= now) {
        delete this.sessions[sid];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  persist() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    this.timer = null;
    try {
      const dir = path.dirname(this.file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.sessions), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
      try { fs.chmodSync(this.file, 0o600); } catch (_) {}
    } catch (err) {
      console.error('[session] 持久化失败: ' + err.message);
    }
  }

  get(sid, callback) {
    const sess = this.sessions[sid];
    if (!sess) return callback(null, null);
    const expires = sess.cookie && sess.cookie.expires;
    if (expires && new Date(expires).getTime() <= Date.now()) {
      delete this.sessions[sid];
      this.persist();
      return callback(null, null);
    }
    return callback(null, sess);
  }

  set(sid, sess, callback) {
    this.sessions[sid] = sess;
    this.persist();
    if (callback) callback(null);
  }

  destroy(sid, callback) {
    delete this.sessions[sid];
    this.persist();
    if (callback) callback(null);
  }

  touch(sid, sess, callback) {
    if (this.sessions[sid]) {
      this.sessions[sid].cookie = sess.cookie;
      this.persist();
    }
    if (callback) callback(null);
  }
}

module.exports = FileSessionStore;
