// WhatsApp anti-ban rules — pure functions only (no DB, no sockets) so they are unit-testable.
// Numbers follow community experience (Green API, Periskope, baileys-antiban); WhatsApp publishes no limits for
// unofficial clients. lib/waGuard.js applies them to real data; routes/jobs.js asks waGuard before every send.

export const DEFAULT_LIMITS = {
  maxNewChatsPerDay: 40,        // first message to a contact; the warm-up schedule may allow fewer
  maxMessagesPerHour: 30,
  maxMessagesPerMinute: 4,
  minDelaySec: 45,              // between contacts, gaussian jitter
  maxDelaySec: 180,
  firstMessageExtraDelayMinSec: 5,
  firstMessageExtraDelayMaxSec: 15,
  typingMsPerCharMin: 30,
  typingMsPerCharMax: 50,
  windowStartHour: 9,           // recipient's local time
  windowEndHour: 21,
  blockFridayMorning: true,     // Friday before 13:00 (KSA / EG)
  maxPerContactPerDay: 1,       // touches (one broadcast delivery, even with several message parts)
  followUpDays: [3, 7, 14],     // days after the first unanswered touch when follow-ups are allowed
  maxUnansweredTouches: 3,      // after this many ignored touches the contact is never messaged again
  maxSameTextCount: 3,          // identical rendered text, last 7 days
  maxSimilarity: 0.7,           // reject a campaign whose rendered first messages are more alike than this
  warmup: true,
  contentRules: true,           // no links / prices in a first message, must end with a question, opt-out line
  optOutLine: 'لو الموضوع مش مناسب لك، رد بكلمة "لا" ومش هراسلك تاني.',
};

// Absolute bounds — settings outside them are clamped, whatever the user enters.
export const HARD_LIMITS = {
  maxNewChatsPerDay: [0, 50],
  maxMessagesPerHour: [1, 200],
  maxMessagesPerMinute: [1, 10],
  minDelaySec: [20, 600],
  maxDelaySec: [30, 1800],
  firstMessageExtraDelayMinSec: [0, 120],
  firstMessageExtraDelayMaxSec: [0, 300],
  typingMsPerCharMin: [10, 200],
  typingMsPerCharMax: [10, 300],
  windowStartHour: [0, 23],
  windowEndHour: [1, 24],
  maxPerContactPerDay: [1, 5],
  maxUnansweredTouches: [1, 5],
  maxSameTextCount: [1, 20],
  maxSimilarity: [0.3, 1],
};

export const WARMUP_SCHEDULE = [0, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Merge stored/user settings over the defaults, validating and clamping every field.
export function normalizeLimits(input = {}) {
  const out = { ...DEFAULT_LIMITS };
  for (const [k, def] of Object.entries(DEFAULT_LIMITS)) {
    const v = input?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof def === 'boolean') out[k] = !!v;
    else if (typeof def === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (typeof def === 'string') out[k] = String(v).slice(0, 500);
    else if (Array.isArray(def) && Array.isArray(v)) {
      const days = v.map(Number).filter(n => Number.isFinite(n) && n >= 1 && n <= 90).sort((a, b) => a - b).slice(0, 5);
      if (days.length) out[k] = days;
    }
  }
  for (const [k, range] of Object.entries(HARD_LIMITS)) out[k] = clamp(out[k], range);
  for (const k of ['maxNewChatsPerDay', 'maxMessagesPerHour', 'maxMessagesPerMinute', 'windowStartHour', 'windowEndHour', 'maxPerContactPerDay', 'maxUnansweredTouches', 'maxSameTextCount']) {
    out[k] = Math.round(out[k]);
  }
  if (out.maxDelaySec < out.minDelaySec) out.maxDelaySec = out.minDelaySec;
  if (out.firstMessageExtraDelayMaxSec < out.firstMessageExtraDelayMinSec) out.firstMessageExtraDelayMaxSec = out.firstMessageExtraDelayMinSec;
  if (out.typingMsPerCharMax < out.typingMsPerCharMin) out.typingMsPerCharMax = out.typingMsPerCharMin;
  if (out.windowEndHour <= out.windowStartHour) out.windowEndHour = Math.min(24, out.windowStartHour + 1);
  return out;
}

// ── Warm-up ─────────────────────────────────────────────────────

export function daysSince(ts, now = Date.now()) {
  return ts ? Math.floor((now - ts) / DAY) : 0;
}

// New chats allowed today, before the health multiplier. Day 0 = the 24 h after the QR scan → 0.
// After the schedule ends, volume grows at most 20 % per week, never above the configured cap.
export function warmupNewChatLimit(number, limits, now = Date.now()) {
  const cap = limits.maxNewChatsPerDay;
  if (!limits.warmup) return cap;
  if (!number?.warmup_started_at) return 0;
  const day = daysSince(number.warmup_started_at, now);
  if (day < 1) return 0;
  const last = WARMUP_SCHEDULE.length - 1;
  let limit = day <= last ? WARMUP_SCHEDULE[day] : WARMUP_SCHEDULE[last] * Math.pow(1.2, Math.floor((day - last) / 7));
  if (number.last_active_at && now - number.last_active_at > 72 * HOUR) limit = Math.min(limit, 10); // re-warm after idleness
  return Math.min(cap, Math.floor(limit));
}

// ── Health score ────────────────────────────────────────────────

export const HEALTH_POINTS = {
  disconnect: 15,
  send_failed: 10,
  blocked: 30,
  restricted: 30,
  low_reply_rate: 20,
  low_delivery_rate: 20,
};
export const HEALTH_DECAY_PER_HOUR = 5;
export const HARD_STOP_SCORE = 85;
export const HARD_STOP_MS = 48 * HOUR;
export const REDUCED_AFTER_STOP_MS = 7 * DAY;

export function currentHealthScore(number, now = Date.now()) {
  if (!number) return 0;
  const hours = number.health_at ? Math.max(0, (now - number.health_at) / HOUR) : 0;
  return Math.max(0, (number.health_score || 0) - HEALTH_DECAY_PER_HOUR * hours);
}

export function healthLevel(score) {
  if (score >= HARD_STOP_SCORE) return { level: 'stopped', multiplier: 0 };
  if (score >= 60) return { level: 'danger', multiplier: 0.2 };
  if (score >= 30) return { level: 'warning', multiplier: 0.5 };
  return { level: 'good', multiplier: 1 };
}

// Effective multiplier: health level, hard stop, and "half volume" for a week after a hard stop ends.
export function healthMultiplier(number, now = Date.now()) {
  if (number?.paused_until && number.paused_until > now) return 0;
  let m = healthLevel(currentHealthScore(number, now)).multiplier;
  if (number?.reduced_until && number.reduced_until > now) m = Math.min(m, 0.5);
  return m;
}

export function dailyNewChatLimit(number, limits, now = Date.now()) {
  return Math.round(warmupNewChatLimit(number, limits, now) * healthMultiplier(number, now));
}

// ── Pacing ──────────────────────────────────────────────────────

// Gaussian (Box–Muller) between min and max: mean in the middle, ±3σ = the range, clamped.
export function gaussianBetween(min, max, rand = Math.random) {
  if (max <= min) return min;
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const mean = (min + max) / 2, sd = (max - min) / 6;
  return Math.min(max, Math.max(min, mean + z * sd));
}

export function uniformBetween(min, max, rand = Math.random) {
  return min + (max - min) * rand();
}

// ── Recipient time window ───────────────────────────────────────

// Longest-prefix match of the phone's country code → timezone (common markets; else the workspace timezone).
const PREFIX_TZ = [
  ['966', 'Asia/Riyadh'], ['971', 'Asia/Dubai'], ['965', 'Asia/Kuwait'], ['974', 'Asia/Qatar'], ['973', 'Asia/Bahrain'],
  ['968', 'Asia/Muscat'], ['962', 'Asia/Amman'], ['961', 'Asia/Beirut'], ['963', 'Asia/Damascus'], ['964', 'Asia/Baghdad'],
  ['967', 'Asia/Aden'], ['970', 'Asia/Gaza'], ['249', 'Africa/Khartoum'], ['212', 'Africa/Casablanca'],
  ['213', 'Africa/Algiers'], ['216', 'Africa/Tunis'], ['218', 'Africa/Tripoli'], ['20', 'Africa/Cairo'],
  ['90', 'Europe/Istanbul'], ['44', 'Europe/London'], ['49', 'Europe/Berlin'], ['33', 'Europe/Paris'],
  ['92', 'Asia/Karachi'], ['91', 'Asia/Kolkata'], ['880', 'Asia/Dhaka'],
];

export function phoneTimezone(phone, fallback = 'UTC') {
  const digits = String(phone || '').replace(/\D/g, '');
  for (const [prefix, tz] of PREFIX_TZ) if (digits.startsWith(prefix)) return tz;
  return fallback || 'UTC';
}

function localParts(ts, tz) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }); }
  catch { fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }); }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ts)).map(p => [p.type, p.value]));
  return { hour: Number(parts.hour) % 24, weekday: parts.weekday };
}

export function inSendingWindow(ts, tz, limits) {
  const { hour, weekday } = localParts(ts, tz);
  if (hour < limits.windowStartHour || hour >= limits.windowEndHour) return false;
  if (limits.blockFridayMorning && weekday === 'Fri' && hour < 13) return false;
  return true;
}

// Next moment (≥ ts) inside the window, searched in 5-minute steps up to 8 days ahead.
export function nextWindowStart(ts, tz, limits) {
  const step = 5 * 60 * 1000;
  for (let t = ts; t < ts + 8 * DAY; t += step) {
    if (inSendingWindow(t, tz, limits)) return t;
  }
  return ts + DAY;
}

// ── Content rules ───────────────────────────────────────────────

const LINK_RE = /(https?:\/\/|www\.|wa\.me\/|\b[a-z0-9-]+\.(com|net|org|io|co|me|sa|eg|ae|store|shop|link|ly)\b)/i;
const PRICE_RE = /([$€£]\s?\d|\d[\d.,]*\s?([$€£]|sar|egp|usd|aed|kwd|qar|eur|ريال|ر\.س|جنيه|ج\.م|درهم|دينار|دولار)|\b(sar|egp|usd|aed)\s?\d|(ريال|جنيه|درهم|دولار)\s?\d)/i;
const QUESTION_END_RE = /[?؟]\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*$/u;

function stripOptOut(text, optOutLine) {
  const t = String(text || '').trim();
  if (optOutLine && t.endsWith(optOutLine.trim())) return t.slice(0, -optOutLine.trim().length).trim();
  return t;
}

// Problems (block sending) for a FIRST message to a new contact. `text` is a template or a rendered message.
export function checkFirstMessage(text, limits) {
  const problems = [];
  if (!limits.contentRules) return problems;
  const body = stripOptOut(text, limits.optOutLine);
  if (LINK_RE.test(body)) problems.push({ code: 'link', message: 'First message to a new contact must not contain a link.' });
  if (PRICE_RE.test(body)) problems.push({ code: 'price', message: 'First message to a new contact must not contain a price.' });
  if (!QUESTION_END_RE.test(body)) problems.push({ code: 'no_question', message: 'First message must end with a question (? or ؟) to invite a reply.' });
  return problems;
}

// Appends the opt-out line to a first message unless it is already there.
export function withOptOut(text, limits) {
  const line = (limits.optOutLine || '').trim();
  if (!limits.contentRules || !line || String(text).includes(line)) return text;
  return `${String(text).trimEnd()}\n\n${line}`;
}

const OPT_OUT_WORDS = [
  'no', 'nope', 'stop', 'unsubscribe', 'not interested', 'no thanks', 'no thank you', 'remove me', 'dont message me',
  'لا', 'لأ', 'لاء', 'لا شكرا', 'لا شكراً', 'لا شكرًا', 'لا مش مهتم', 'مش مهتم', 'غير مهتم', 'مو مهتم', 'ما ابغى', 'مابغى',
  'ما أبغى', 'توقف', 'وقف', 'الغاء', 'إلغاء', 'الغي', 'إلغي', 'لا تراسلني', 'متراسلنيش', 'بلاش',
];
const normalizeReply = (s) => String(s || '').toLowerCase().replace(/[ً-ْ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const OPT_OUT_SET = new Set(OPT_OUT_WORDS.map(normalizeReply));

// A short reply that is (or starts with) an opt-out phrase.
export function isOptOutReply(text) {
  const t = normalizeReply(text);
  if (!t || t.length > 40) return false;
  if (OPT_OUT_SET.has(t)) return true;
  const words = t.split(' ');
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    if (OPT_OUT_SET.has(words.slice(0, n).join(' ')) && words.length <= n + 2) return true;
  }
  return false;
}

// ── Variation ───────────────────────────────────────────────────

export function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokens(text) {
  return new Set(normalizeText(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(' ').filter(Boolean));
}

export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Mean pairwise similarity over up to `maxPairs` pairs (deterministic sample).
export function meanSimilarity(texts, maxPairs = 300) {
  const n = texts.length;
  if (n < 2) return 0;
  const pairs = [];
  for (let i = 0; i < n && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < n && pairs.length < maxPairs; j += Math.max(1, Math.floor(n / 20))) pairs.push([i, j]);
  }
  return pairs.reduce((s, [i, j]) => s + similarity(texts[i], texts[j]), 0) / pairs.length;
}

// {a|b|c} → one option. Leaves {{variables}} alone (they are replaced first).
export function parseSpintax(text, rand = Math.random) {
  return String(text).replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group) => {
    const options = group.split('|');
    return options[Math.floor(rand() * options.length)];
  });
}

// ── Contact cadence ─────────────────────────────────────────────

// Whether another touch to a contact is allowed. `history`: { touchesToday, unanswered, firstUnansweredAt }.
export function contactCadence(history, limits, now = Date.now()) {
  if (history.touchesToday >= limits.maxPerContactPerDay) return { ok: false, code: 'contact_today', reason: 'Already messaged today' };
  if (history.unanswered >= limits.maxUnansweredTouches) return { ok: false, code: 'ignored', reason: `Ignored ${history.unanswered} messages — not contacting again` };
  if (history.unanswered >= 1) {
    const need = limits.followUpDays[history.unanswered - 1];
    if (need === undefined) return { ok: false, code: 'ignored', reason: 'No follow-up slot left' };
    const days = (now - history.firstUnansweredAt) / DAY;
    if (days < need) return { ok: false, code: 'too_early', reason: `Follow-up allowed from day ${need} (now day ${Math.floor(days)})` };
  }
  return { ok: true };
}

// ── Estimate ────────────────────────────────────────────────────

// Rough finish time for `newChats` first messages + `followUps` other touches, given limits and today's usage.
// Throughput per day = min(window hours × hourly cap, window seconds / average gap); new chats also capped per day.
export function estimateDuration({ newChats, followUps, partsPerTouch = 1, number, limits, newChatsToday = 0, now = Date.now() }) {
  const windowHours = Math.max(1, limits.windowEndHour - limits.windowStartHour);
  const avgGapSec = (limits.minDelaySec + limits.maxDelaySec) / 2 + 20 * (partsPerTouch - 1) + 15;
  const touchesPerDayByTime = Math.floor((windowHours * 3600) / avgGapSec);
  const touchesPerDayByHourCap = Math.floor((windowHours * limits.maxMessagesPerHour) / partsPerTouch);
  const perDay = Math.max(1, Math.min(touchesPerDayByTime, touchesPerDayByHourCap));

  let remainingNew = newChats, remainingOther = followUps, days = 0;
  const schedule = [];
  while ((remainingNew > 0 || remainingOther > 0) && days < 365) {
    const t = now + days * DAY;
    let newCap = dailyNewChatLimit(number, limits, t);
    if (days === 0) newCap = Math.max(0, newCap - newChatsToday);
    const doNew = Math.min(remainingNew, newCap, perDay);
    const doOther = Math.min(remainingOther, perDay - doNew);
    remainingNew -= doNew; remainingOther -= doOther;
    schedule.push({ day: days, newChats: doNew, followUps: doOther });
    days++;
    if (days > 14 && doNew === 0 && doOther === 0 && newCap === 0 && remainingOther === 0) {
      return { days: null, blocked: true, perDay, schedule: schedule.slice(0, 14) };
    }
  }
  return { days, blocked: days >= 365, perDay, schedule: schedule.slice(0, 14) };
}

// ── Restriction notices ─────────────────────────────────────────

// True only for a restriction/ban notice from WhatsApp itself. Replies from people (1:1 chats, LIDs), groups,
// status broadcasts and channels never count — a customer writing "limited offer?" must not stop all sending.
// The reliable signal is still the connection closing with 401 / "restricted" (handled in whatsapp.js).
const PERSON_OR_GROUP = /@(lid|g\.us|broadcast|newsletter|call)$/;
const RESTRICTION_RE = /(restricted|banned|suspended|temporarily (blocked|limited)|account (is|has been) (limited|locked)|محظور|مقيد|تقييد|موقوف|تم إيقاف)/i;

export function isRestrictionNotice(jid, text) {
  const j = String(jid || '');
  if (!j || PERSON_OR_GROUP.test(j)) return false;
  if (j.endsWith('@s.whatsapp.net') && j.split('@')[0].split(':')[0] !== '0') return false;
  return RESTRICTION_RE.test(String(text || ''));
}
