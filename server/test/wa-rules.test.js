// Pure anti-ban rules (lib/waRules.js) — no server, no WhatsApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLimits, DEFAULT_LIMITS, warmupNewChatLimit, dailyNewChatLimit, currentHealthScore, healthLevel,
  healthMultiplier, gaussianBetween, inSendingWindow, nextWindowStart, phoneTimezone, checkFirstMessage, withOptOut,
  isOptOutReply, similarity, meanSimilarity, parseSpintax, contactCadence, estimateDuration, isRestrictionNotice,
} from '../lib/waRules.js';

const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
const L = normalizeLimits();

test('limits are clamped to the hard bounds', () => {
  const l = normalizeLimits({ maxNewChatsPerDay: 500, maxMessagesPerHour: 9999, minDelaySec: 1, maxDelaySec: 5, windowStartHour: 22, windowEndHour: 8, warmup: 0 });
  assert.equal(l.maxNewChatsPerDay, 50);
  assert.equal(l.maxMessagesPerHour, 200);
  assert.equal(l.minDelaySec, 20);
  assert.ok(l.maxDelaySec >= l.minDelaySec);
  assert.ok(l.windowEndHour > l.windowStartHour);
  assert.equal(l.warmup, false);
  assert.deepEqual(normalizeLimits({ bogus: 1 }), normalizeLimits());
  assert.equal(normalizeLimits({ maxNewChatsPerDay: 'abc' }).maxNewChatsPerDay, DEFAULT_LIMITS.maxNewChatsPerDay);
});

test('warm-up schedule: 0 on day 0, grows, capped, re-warm after 72 h idle', () => {
  const now = Date.now();
  const n = (days, idleH = 1) => ({ warmup_started_at: now - days * DAY - 1000, last_active_at: now - idleH * HOUR });
  assert.equal(warmupNewChatLimit({ warmup_started_at: null }, L, now), 0);
  assert.equal(warmupNewChatLimit(n(0), L, now), 0);
  assert.equal(warmupNewChatLimit(n(1), L, now), 5);
  assert.equal(warmupNewChatLimit(n(4), L, now), 12);
  assert.equal(warmupNewChatLimit(n(11), L, now), 40);
  assert.equal(warmupNewChatLimit(n(60), L, now), 40, 'never above maxNewChatsPerDay');
  assert.equal(warmupNewChatLimit(n(60), normalizeLimits({ maxNewChatsPerDay: 50 }), now), 50);
  assert.equal(warmupNewChatLimit(n(30, 100), L, now), 10, 'idle > 72h → re-warm at 10');
  assert.equal(warmupNewChatLimit(n(0), normalizeLimits({ warmup: false, maxNewChatsPerDay: 20 }), now), 20);
});

test('health score decays 5/h and maps to multipliers; hard stop and half volume after it', () => {
  const now = Date.now();
  assert.equal(currentHealthScore({ health_score: 50, health_at: now - 4 * HOUR }, now), 30);
  assert.equal(currentHealthScore({ health_score: 10, health_at: now - 10 * HOUR }, now), 0);
  assert.deepEqual([0, 29, 30, 59, 60, 84, 85].map(s => healthLevel(s).multiplier), [1, 1, 0.5, 0.5, 0.2, 0.2, 0]);
  assert.equal(healthMultiplier({ health_score: 0, paused_until: now + HOUR }, now), 0);
  assert.equal(healthMultiplier({ health_score: 0, reduced_until: now + HOUR }, now), 0.5);
  const warm = { warmup_started_at: now - 30 * DAY, last_active_at: now, health_score: 40, health_at: now };
  assert.equal(dailyNewChatLimit(warm, L, now), 20);
});

test('gaussian delay stays in range and centres on the middle', () => {
  const xs = Array.from({ length: 4000 }, () => gaussianBetween(45, 180));
  assert.ok(xs.every(x => x >= 45 && x <= 180));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean - 112.5) < 5, `mean ${mean}`);
});

test('sending window uses the recipient timezone and blocks Friday mornings', () => {
  assert.equal(phoneTimezone('+966 50 000 0000'), 'Asia/Riyadh');
  assert.equal(phoneTimezone('201000000000'), 'Africa/Cairo');
  assert.equal(phoneTimezone('15551234567', 'Europe/Berlin'), 'Europe/Berlin');
  const riyadh = (iso) => Date.parse(iso + '+03:00');
  assert.equal(inSendingWindow(riyadh('2026-10-27T10:00:00'), 'Asia/Riyadh', L), true);   // Tuesday 10:00
  assert.equal(inSendingWindow(riyadh('2026-10-27T22:00:00'), 'Asia/Riyadh', L), false);  // 22:00
  assert.equal(inSendingWindow(riyadh('2026-10-27T07:00:00'), 'Asia/Riyadh', L), false);
  assert.equal(inSendingWindow(riyadh('2026-10-30T10:00:00'), 'Asia/Riyadh', L), false);  // Friday 10:00
  assert.equal(inSendingWindow(riyadh('2026-10-30T14:00:00'), 'Asia/Riyadh', L), true);   // Friday 14:00
  const next = nextWindowStart(riyadh('2026-10-27T22:00:00'), 'Asia/Riyadh', L);
  assert.equal(next, riyadh('2026-10-28T09:00:00'));
});

test('first-message content rules', () => {
  const codes = (t) => checkFirstMessage(t, L).map(p => p.code).sort();
  assert.deepEqual(codes('أهلاً أحمد، شفت محلكم على الخريطة. ينفع أبعت لكم التفاصيل؟'), []);
  assert.deepEqual(codes('Hi! Are you open on weekends?'), []);
  assert.deepEqual(codes('Hi, check https://x.com now?'), ['link']);
  assert.deepEqual(codes('Visit www.shop.sa for more?'), ['link']);
  assert.deepEqual(codes('Only 99 SAR this week?'), ['price']);
  assert.deepEqual(codes('العرض بـ 150 ريال؟'), ['price']);
  assert.deepEqual(codes('We have a great offer for you.'), ['no_question']);
  assert.deepEqual(codes('Can we talk? 🙂'), []);
  assert.deepEqual(codes(withOptOut('Can we talk?', L)), [], 'the appended opt-out line does not break the question rule');
  assert.ok(withOptOut('Can we talk?', L).endsWith(L.optOutLine));
  assert.equal(withOptOut(withOptOut('Hi?', L), L), withOptOut('Hi?', L));
  assert.deepEqual(checkFirstMessage('Buy now at x.com', normalizeLimits({ contentRules: false })), []);
});

test('opt-out replies are detected, normal replies are not', () => {
  for (const t of ['لا', 'لا شكرا', 'مش مهتم', 'STOP', 'No thanks', 'no.', 'لأ 🙏', 'إلغاء']) assert.equal(isOptOutReply(t), true, t);
  for (const t of ['لا بأس، ابعت التفاصيل', 'Yes please', 'no problem, send me the price list please', 'ممكن نتكلم بكرة؟', '']) {
    assert.equal(isOptOutReply(t), false, t);
  }
});

test('similarity: templates with only a name are too alike; per-contact text is not', () => {
  const tpl = (n) => `Hi ${n}, we help restaurants in Khobar get more orders through WhatsApp. Can I send you details?`;
  const same = ['Ali', 'Omar', 'Sara', 'Huda', 'Noor'].map(tpl);
  assert.ok(meanSimilarity(same) > 0.7);
  const varied = [
    'Hi Ali, loved the shawarma reviews on your Maps page — do you take delivery orders yet?',
    'Good morning Omar! Your cafe has 4.8 stars, impressive. Are you doing catering for offices?',
    'Sara, saw your bakery opened a second branch. How are you handling online orders there?',
    'Hello Huda — quick one: does your salon book appointments through WhatsApp today?',
  ];
  assert.ok(meanSimilarity(varied) < 0.4);
  assert.equal(similarity('a b c', 'a b c'), 1);
  assert.equal(parseSpintax('{Hi|Hi}'), 'Hi');
  assert.equal(parseSpintax('{name} {{x}}'), '{name} {{x}}', 'braces without | are left alone');
});

test('contact cadence: one touch a day, follow-ups on day 3 and 7, stop after 3 ignored', () => {
  const now = Date.now();
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 0 }, L, now).ok, true);
  assert.equal(contactCadence({ touchesToday: 1, unanswered: 0 }, L, now).code, 'contact_today');
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 1, firstUnansweredAt: now - 2 * DAY }, L, now).code, 'too_early');
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 1, firstUnansweredAt: now - 3 * DAY }, L, now).ok, true);
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 2, firstUnansweredAt: now - 5 * DAY }, L, now).code, 'too_early');
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 2, firstUnansweredAt: now - 7 * DAY }, L, now).ok, true);
  assert.equal(contactCadence({ touchesToday: 0, unanswered: 3, firstUnansweredAt: now - 30 * DAY }, L, now).code, 'ignored');
});

test('estimate respects warm-up and per-day throughput', () => {
  const now = Date.now();
  const fresh = { warmup_started_at: now - 1000, last_active_at: now };
  const e = estimateDuration({ newChats: 30, followUps: 0, number: fresh, limits: L, now });
  assert.equal(e.schedule[0].newChats, 0, 'day 0 of warm-up sends nothing');
  assert.equal(e.schedule[1].newChats, 5);
  assert.ok(e.days > 3);
  const warm = { warmup_started_at: now - 60 * DAY, last_active_at: now };
  assert.equal(estimateDuration({ newChats: 30, followUps: 0, number: warm, limits: L, now }).days, 1);
  const never = estimateDuration({ newChats: 5, followUps: 0, number: { warmup_started_at: null }, limits: L, now });
  assert.equal(never.blocked, true);
});

test('only WhatsApp system messages count as restriction notices, never customer replies', () => {
  for (const [jid, text] of [
    ['966500000000@s.whatsapp.net', 'Is this a limited offer?'],
    ['966500000000@s.whatsapp.net', 'my account was restricted lol'],
    ['966500000000:12@s.whatsapp.net', 'You are banned from my shop'],
    ['123456789012345@lid', 'restricted'],
    ['1203630@g.us', 'Group restricted to admins'],
    ['status@broadcast', 'suspended'],
    ['0@s.whatsapp.net', 'Welcome to WhatsApp'],
    ['', 'restricted'],
  ]) assert.equal(isRestrictionNotice(jid, text), false, `${jid}: ${text}`);
  assert.equal(isRestrictionNotice('0@s.whatsapp.net', 'Your account is restricted from messaging new contacts'), true);
  assert.equal(isRestrictionNotice('0@s.whatsapp.net', 'تم تقييد حسابك مؤقتًا'), true);
});
