// Slows password guessing: after too many failed logins from one client, that client gets 429 until the window ends.
// In memory on purpose — one process, and a restart simply clears it.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const attempts = new Map();

// Behind a local tunnel/reverse proxy every request comes from loopback, so only then is the forwarded address trusted.
export function clientIp(req) {
  const socketIp = req.socket?.remoteAddress || '';
  if (/^(::1|127\.|::ffff:127\.)/.test(socketIp)) {
    return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || socketIp).split(',')[0].trim();
  }
  return socketIp;
}

export function retryAfterSeconds(ip, now = Date.now()) {
  const a = attempts.get(ip);
  if (!a || a.until <= now) { attempts.delete(ip); return 0; }
  return a.failures >= MAX_FAILURES ? Math.ceil((a.until - now) / 1000) : 0;
}

export function recordFailure(ip, now = Date.now()) {
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const a = attempts.get(ip);
  if (a && a.until > now) a.failures++;
  else attempts.set(ip, { failures: 1, until: now + WINDOW_MS });
}

export const clearFailures = (ip) => attempts.delete(ip);
