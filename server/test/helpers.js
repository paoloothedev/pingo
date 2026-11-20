// Test helpers: boot a real server on a random port with a throwaway DB, jobs file and WA auth dir,
// so tests never touch live data in server/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// `gmapsJobs`: optional { id: job } written to the jobs file before boot (jobs without projectId are
// adopted by the Default workspace at startup).
export async function startServer({ gmapsJobs, seedAdmin = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-test-'));
  if (gmapsJobs) fs.writeFileSync(path.join(tmp, 'jobs.json'), JSON.stringify(gmapsJobs));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      SEED_ADMIN: seedAdmin ? '1' : '0',
      HOST: '127.0.0.1',
      DB_PATH: path.join(tmp, 'test.db'),
      GMAPS_JOBS_FILE: path.join(tmp, 'jobs.json'),
      WA_AUTH_DIR: path.join(tmp, 'wa'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + output)), 15000);
    const onData = (d) => {
      output += d;
      if (output.includes('LeadDesk server running')) { clearTimeout(timer); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const base = `http://127.0.0.1:${port}/api`;
  return {
    base,
    dbPath: path.join(tmp, 'test.db'),
    async stop() {
      proc.removeAllListeners('exit');
      proc.kill('SIGKILL');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

// Minimal cookie-keeping API client.
export function client(base, projectId = null) {
  let cookie = '';
  const api = {
    projectId,
    as(pid) { const c = client(base, pid); c._setCookie(cookie); return c; },
    _setCookie(c) { cookie = c; },
    async req(method, url, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = cookie;
      if (api.projectId) headers['X-Project-Id'] = api.projectId;
      const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, body: data };
    },
    get: (u) => api.req('GET', u),
    post: (u, b) => api.req('POST', u, b ?? {}),
    put: (u, b) => api.req('PUT', u, b ?? {}),
    del: (u) => api.req('DELETE', u),
    async login(username = 'admin', password = 'admin') {
      const r = await api.post('/auth/login', { username, password });
      if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.body));
      return r.body;
    },
  };
  return api;
}
