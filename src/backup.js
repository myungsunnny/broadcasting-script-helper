// 선생님 백업: 주요 표를 JSON 하나로 돌려준다(읽기만). users는 비밀번호 해시를 뺀다. login_fails는 넣지 않는다.

import { nowKST } from './dates.js';

const TABLES = {
  scripts: 'SELECT * FROM scripts',
  script_history: 'SELECT * FROM script_history',
  users: 'SELECT id, login_id, name, must_change, active, created_at, last_login_at FROM users',
  calendar_events: 'SELECT * FROM calendar_events',
  posts: 'SELECT * FROM posts',
  post_reads: 'SELECT * FROM post_reads',
  script_comments: 'SELECT * FROM script_comments',
  notifications: 'SELECT * FROM notifications',
  ai_usage: 'SELECT * FROM ai_usage'
};

export async function getBackup(env) {
  const names = Object.keys(TABLES);
  const results = await env.DB.batch(names.map(n => env.DB.prepare(TABLES[n])));
  return { created_at: nowKST(), tables: Object.fromEntries(names.map((n, i) => [n, results[i].results])) };
}
