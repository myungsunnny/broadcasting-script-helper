// 선생님이 학생 계정을 만들고 관리한다.
// 새 계정과 비밀번호 초기화에는 4자리 임시 비밀번호를 주고, 학생은 처음 로그인할 때 자기 비밀번호로 바꾼다.

import { hashPassword, tempPassword } from './auth.js';
import { nowKST } from './dates.js';

const MAX_NAME = 20;

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, login_id, name, must_change, active, created_at, last_login_at FROM users ORDER BY active DESC, name'
  ).all();
  return results;
}

/**
 * 여러 명을 한 번에 만든다. entries: [{ name, login_id?, password? }]
 * 아이디를 비우면 이름을 아이디로 쓰고, 이미 있으면 '김방송2'처럼 숫자를 붙인다.
 * 반환: 만든 계정과 임시 비밀번호 목록 (비밀번호는 이때 한 번만 보여 준다)
 */
export async function createUsers(env, entries) {
  const { results } = await env.DB.prepare('SELECT login_id FROM users').all();
  const taken = new Set(results.map(r => r.login_id));
  const created = [];
  const stmts = [];
  for (const e of entries.slice(0, 100)) {
    const name = cleanName(e.name);
    if (!name) continue;
    let loginId = cleanName(e.login_id) || name;
    if (e.login_id && taken.has(loginId)) throw new Error(`'${loginId}' 아이디는 이미 있어요.`);
    for (let n = 2; taken.has(loginId); n++) loginId = `${cleanName(e.login_id) || name}${n}`;
    taken.add(loginId);
    const password = String(e.password || '').trim() || tempPassword();
    if (password.length < 4) throw new Error('비밀번호는 4글자 이상이어야 해요.');
    const id = crypto.randomUUID().slice(0, 8);
    stmts.push(env.DB.prepare(
      'INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)'
    ).bind(id, loginId, name, await hashPassword(password), nowKST()));
    created.push({ id, name, login_id: loginId, password });
  }
  if (!stmts.length) throw new Error('만들 학생 이름을 입력해 주세요.');
  await env.DB.batch(stmts);
  return created;
}

/** 이름·아이디·사용 여부를 바꾼다. */
export async function updateUser(env, id, input) {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!row) throw new Error('계정을 찾을 수 없어요.');
  const name = input.name !== undefined ? cleanName(input.name) : row.name;
  const loginId = input.login_id !== undefined ? cleanName(input.login_id) : row.login_id;
  const active = input.active !== undefined ? (input.active ? 1 : 0) : row.active;
  if (!name || !loginId) throw new Error('이름과 아이디를 비울 수 없어요.');
  if (loginId !== row.login_id) {
    const dup = await env.DB.prepare('SELECT 1 FROM users WHERE login_id = ? AND id != ?').bind(loginId, id).first();
    if (dup) throw new Error(`'${loginId}' 아이디는 이미 있어요.`);
  }
  await env.DB.prepare('UPDATE users SET name = ?, login_id = ?, active = ? WHERE id = ?').bind(name, loginId, active, id).run();
  return { ok: true };
}

/** 새 임시 비밀번호를 만들어 주고, 다음 로그인 때 바꾸게 한다. */
export async function resetPassword(env, id) {
  const row = await env.DB.prepare('SELECT name, login_id FROM users WHERE id = ?').bind(id).first();
  if (!row) throw new Error('계정을 찾을 수 없어요.');
  const password = tempPassword();
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').bind(await hashPassword(password), id).run();
  return { id, name: row.name, login_id: row.login_id, password };
}

/** 계정을 지운다. 그 학생이 쓴 대본·메모는 그대로 남고, 공지 읽음 기록은 함께 지운다. */
export async function deleteUser(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM post_reads WHERE user_uid = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id)
  ]);
  return { ok: true };
}
