// 백업 내려받기(/api/backup) 시험: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* 이 Node에서는 못 씀 */ }
const skip = DatabaseSync ? false : 'node:sqlite를 쓸 수 없는 Node 버전';

const plain = rows => rows.map(r => ({ ...r }));
function d1(db) {
  const stmt = (sql, args) => ({
    sql, args,
    first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    all: async () => ({ results: plain(db.prepare(sql).all(...args)) }),
    run: async () => { db.prepare(sql).run(...args); return {}; }
  });
  return {
    prepare: sql => ({ ...stmt(sql, []), bind: (...args) => stmt(sql, args) }),
    batch: async stmts => stmts.map(s => /^\s*SELECT/i.test(s.sql)
      ? { results: plain(db.prepare(s.sql).all(...s.args)) }
      : (db.prepare(s.sql).run(...s.args), { results: [] }))
  };
}

const TABLES = ['scripts', 'script_history', 'users', 'calendar_events', 'posts', 'post_reads', 'script_comments', 'notifications', 'ai_usage'];

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES ('s1', 'ise', '이서', ?, 0, 1, '2026-01-01 00:00:00')")
    .run(await hashPassword('1234'));
  const env = { DB: d1(db), TEACHER_PASSWORD: 'teach', SESSION_SECRET: 'test-secret', ASSETS: { fetch: () => new Response('') } };
  const loginAs = async (name, password) => {
    const res = await worker.fetch(new Request('https://x.test/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password })
    }), env);
    assert.equal(res.status, 200);
    return res.headers.get('Set-Cookie').split(';')[0];
  };
  const get = async cookie => {
    const res = await worker.fetch(new Request('https://x.test/api/backup', { headers: { Cookie: cookie } }), env);
    return { status: res.status, data: await res.json(), cache: res.headers.get('Cache-Control') };
  };
  return { db, loginAs, get };
}

test('선생님: 200, 표 9개, users에 password_hash 없음, login_fails 없음', { skip }, async () => {
  const { db, loginAs, get } = await setup();
  db.prepare("INSERT INTO login_fails (key, at) VALUES ('id:x', ?)").run(Date.now());
  const r = await get(await loginAs('김선생', 'teach'));
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  assert.match(r.data.created_at, /^\d{4}-\d{2}-\d{2} /);
  assert.deepEqual(Object.keys(r.data.tables).sort(), [...TABLES].sort());
  assert.equal(r.data.tables.users.length, 1);
  assert.equal(r.data.tables.users[0].login_id, 'ise');
  assert.equal('password_hash' in r.data.tables.users[0], false);
  assert.equal(JSON.stringify(r.data).includes('pbkdf2'), false);
});

test('학생: 403', { skip }, async () => {
  const { loginAs, get } = await setup();
  const r = await get(await loginAs('ise', '1234'));
  assert.equal(r.status, 403);
  assert.equal(r.data.error, '백업은 선생님만 받을 수 있어요.');
});
