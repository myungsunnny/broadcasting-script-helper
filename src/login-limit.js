// 로그인 시도 제한: 시도를 login_fails 표에 아이디 기준·인터넷 주소 기준으로 "먼저 적고 나중에 센다".
// 동시에 여러 번 보내도 각 요청이 자기 줄을 먼저 넣고 세므로 한도를 넘어 비밀번호를 확인하지 못한다.
// 비밀번호가 틀리면 넣은 줄이 그대로 실패 기록이 되고, 맞으면 지운다.
// 표가 아직 없는 등 DB 오류면 서버 기록만 남기고 막지 않는다(로그인은 그대로 되게).
// D1 batch는 시험 어댑터에서 RETURNING 결과를 못 받으므로 한 문장씩 부른다.

const WINDOW_MS = 10 * 60 * 1000;
const ID_LIMIT = 5;
const IP_LIMIT = 30;
const IPV6_PREFIX_GROUPS = 4; // /64
export const LOGIN_LIMIT_MESSAGE = '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 보세요. 비밀번호를 잊었으면 선생님께 말씀드려요.';

const idKey = loginId => `id:${loginId}`;

/** IPv4는 그대로, IPv6는 앞 4묶음(/64)으로 묶는다(한 사람이 /64 안의 주소를 바꿔 가며 피하지 못하게). */
export function ipKey(ip) {
  if (!ip.includes(':')) return `ip:${ip}`;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `ip:${groups.slice(0, IPV6_PREFIX_GROUPS).map(g => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

async function insertRow(env, key, at) {
  const row = await env.DB.prepare('INSERT INTO login_fails (key, at) VALUES (?, ?) RETURNING rowid').bind(key, at).first();
  return row.rowid;
}

async function countSince(env, key, since) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > ?').bind(key, since).first();
  return row.n;
}

const deleteRow = (env, rowid) => env.DB.prepare('DELETE FROM login_fails WHERE rowid = ?').bind(rowid).run();

/**
 * 시도 1번을 먼저 적고 센다.
 * 반환: 한도를 넘으면 { blocked: true }(방금 넣은 줄은 지움), 아니면 { ipRowid }. DB 오류면 {}(막지 않음).
 * ip가 빈 값이면 주소 기준은 건너뜀(로컬·시험).
 */
export async function reserveAttempt(env, loginId, ip) {
  try {
    const now = Date.now();
    const since = now - WINDOW_MS;
    await env.DB.prepare('DELETE FROM login_fails WHERE at <= ?').bind(since).run();
    const idRowid = await insertRow(env, idKey(loginId), now);
    const ipRowid = ip ? await insertRow(env, ipKey(ip), now) : undefined;
    const idOver = await countSince(env, idKey(loginId), since) > ID_LIMIT;
    const ipOver = !!ip && await countSince(env, ipKey(ip), since) > IP_LIMIT;
    if (!idOver && !ipOver) return { ipRowid };
    await deleteRow(env, idRowid);
    if (ipRowid !== undefined) await deleteRow(env, ipRowid);
    return { blocked: true };
  } catch (err) {
    console.error('로그인 제한 확인 실패', err);
    return {};
  }
}

/** 로그인 성공: 방금 넣은 주소 줄 하나만 지운다(성공한 로그인은 주소 수에 안 들어감). */
export async function releaseIp(env, attempt) {
  if (attempt?.ipRowid === undefined) return;
  try {
    await deleteRow(env, attempt.ipRowid);
  } catch (err) {
    console.error('로그인 주소 기록 지우기 실패', err);
  }
}

/** 그 아이디 기록을 모두 지운다(로그인 성공, 선생님의 비밀번호 초기화). 주소 기록은 남김. */
export async function clearFails(env, loginId) {
  try {
    await env.DB.prepare('DELETE FROM login_fails WHERE key = ?').bind(idKey(loginId)).run();
  } catch (err) {
    console.error('로그인 실패 기록 지우기 실패', err);
  }
}
