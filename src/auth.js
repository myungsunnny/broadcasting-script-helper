// 로그인
//  - 학생: 선생님이 만들어 준 개인 계정(아이디 + 비밀번호, users 표)
//  - 선생님: 이름 + 선생님 비밀번호(TEACHER_PASSWORD 비밀값)
// 로그인하면 서명된 쿠키를 발급한다. 학생은 요청마다 계정이 아직 쓸 수 있는지 확인한다.

import { nowKST } from './dates.js';

const COOKIE = 'bs_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30일
// Cloudflare 무료 요금제의 CPU 시간 제한(요청당 10ms) 안에 들도록 반복 횟수를 정했다.
const PBKDF2_ITERATIONS = 10000;

const enc = new TextEncoder();

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verify(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  return payload.exp > Date.now() ? payload : null;
}

/** 길이와 무관하게 같은 시간이 걸리는 비교 */
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc.encode(String(v)))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

async function checkPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(actual), hash);
}

/** 초등학생이 입력하기 쉬운 4자리 숫자 임시 비밀번호 */
export function tempPassword() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, '0');
}

function requireSecrets(env) {
  for (const k of ['TEACHER_PASSWORD', 'SESSION_SECRET']) {
    if (!env[k]) throw new Error(`서버 설정 누락: ${k} 비밀값을 넣어 주세요.`);
  }
}

function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

/** 로그인 성공 시 { user, cookie } 반환, 실패 시 null */
export async function login(env, loginId, password) {
  requireSecrets(env);
  loginId = String(loginId || '').trim().slice(0, 30);
  password = String(password || '');
  if (!loginId || !password) return null;

  const row = await env.DB.prepare('SELECT * FROM users WHERE login_id = ?').bind(loginId).first();
  let user = null;
  if (row && row.active && await checkPassword(password, row.password_hash)) {
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowKST(), row.id).run();
    user = { uid: row.id, name: row.name, role: 'student', mustChange: !!row.must_change };
  } else if (await safeEqual(password, env.TEACHER_PASSWORD)) {
    user = { name: loginId, role: 'teacher', mustChange: false };
  }
  if (!user) return null;
  const token = await sign({ uid: user.uid, name: user.name, role: user.role, exp: Date.now() + MAX_AGE * 1000 }, env.SESSION_SECRET);
  return { user, cookie: sessionCookie(token) };
}

export function logoutCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * 요청 쿠키에서 로그인 사용자 { uid, name, role, mustChange } 를 꺼낸다. 없으면 null.
 * 학생은 계정이 사용 중지·삭제되었으면 바로 로그아웃된 것으로 본다.
 */
export async function currentUser(request, env) {
  requireSecrets(env);
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  let p;
  try { p = await verify(m[1], env.SESSION_SECRET); } catch { return null; }
  if (!p) return null;
  if (p.role === 'teacher') return { name: p.name, role: 'teacher', mustChange: false };
  if (!p.uid) return null; // 예전 공용 비밀번호로 만든 로그인
  const row = await env.DB.prepare('SELECT id, name, active, must_change FROM users WHERE id = ?').bind(p.uid).first();
  if (!row || !row.active) return null;
  return { uid: row.id, name: row.name, role: 'student', mustChange: !!row.must_change };
}

/** 학생이 자기 비밀번호를 바꾼다. */
export async function changePassword(env, user, current, next) {
  if (user.role !== 'student') throw new Error('선생님 비밀번호는 Cloudflare 비밀값(TEACHER_PASSWORD)에서 바꿔요.');
  next = String(next || '');
  if (next.length < 4) throw new Error('새 비밀번호는 4글자 이상으로 정해 주세요.');
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.uid).first();
  if (!row || !await checkPassword(String(current || ''), row.password_hash)) throw new Error('지금 비밀번호가 맞지 않아요.');
  if (current === next) throw new Error('지금 비밀번호와 다른 비밀번호로 정해 주세요.');
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?')
    .bind(await hashPassword(next), user.uid).run();
}
