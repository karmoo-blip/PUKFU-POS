// ปิดยอดประจำวันต้องย้ายเงินขายสดเข้าเงินสำรองทอนทันทีที่กด ไม่ใช่รอข้ามวัน
// และเมื่อย้ายแล้วต้องไม่นับเงินก้อนเดิมซ้ำในช่อง "ต้องมีในลิ้นชัก"
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const WORKER_URL = '../worker/worker.js';

// D1 ปลอมที่ตอบตามรูปแบบคำสั่ง พอให้ handler เดินจนจบและจำทุก SQL ไว้ตรวจ
function fakeDb(opts) {
  const o = opts || {};
  const sql = [];
  const db = {
    sql,
    prepare(text) {
      sql.push(text);
      const stmt = {
        bind() { return stmt; },
        async run() { return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return { value: o.storedVersion || '999' };
          if (/LOWER\(action\) = 'close_day'/.test(text)) return o.alreadyClosed ? { hit: 1 } : null;
          if (/FROM float_log/.test(text)) return { bal: o.floatBalance || 0 };
          return null;
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return db;
}

function post(fn) {
  return new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn, args: [] }),
  });
}

test('the drawer balance counts a close-day done today, so the cash moves the moment the button is pressed', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const db = fakeDb({ floatBalance: 2000 });
  const res = await mod.default.fetch(post('getTodaySummary'), { DB: db, API_TOKEN: 'staff-token' });
  assert.strictEqual(res.status, 200);

  const balanceQuery = db.sql.find(s => /SUM\(CASE WHEN LOWER\(action\) = 'out'/.test(s));
  assert.ok(balanceQuery, 'ต้องมีคำสั่งรวมยอดเงินทอนอยู่');
  assert.ok(!/NOT \(LOWER\(action\) = 'close_day'/.test(balanceQuery),
    'ยอดเงินทอนต้องไม่กรองการปิดยอดของวันนี้ทิ้ง ไม่งั้นตัวเลขไม่ขยับจนกว่าจะข้ามวัน');

  const body = await res.json();
  assert.strictEqual(body.result.closedInRange, false, 'ยังไม่ได้ปิดยอด ต้องรายงานว่ายังไม่ปิด');
});

test('a second close on the same day is refused, so the cash is never folded in twice', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const db = fakeDb({ alreadyClosed: true, floatBalance: 6350 });
  const res = await mod.default.fetch(post('closeDayCash'), { DB: db, API_TOKEN: 'staff-token' });
  const body = await res.json();

  assert.strictEqual(body.result.success, false, 'ปิดซ้ำในวันเดียวกันต้องไม่สำเร็จ');
  assert.ok(!db.sql.some(s => /INSERT INTO float_log/.test(s)),
    'ปิดซ้ำต้องไม่เขียน float_log เพิ่ม ไม่งั้นเงินขายสดถูกบวกเข้าเงินทอนสองรอบ');
});

test('once the day is closed, the expected drawer stops adding the cash sales on top of the float', async () => {
  const closed = { success: true, total: 5120, cash: 4350, floatCash: 6350, closedInRange: true, byType: [], topSellers: [], byHour: [], daily: [], byWeekday: [] };
  const { C, el } = loadController({ replies: { getTodaySummary: closed } });
  C.fetchSummary();
  await new Promise(r => setTimeout(r, 0));

  assert.strictEqual(el('btn-close-day').disabled, true, 'ปิดยอดแล้วต้องกดปุ่มซ้ำไม่ได้');
  assert.strictEqual(el('btn-close-day').innerText, 'ปิดยอดแล้ววันนี้');
  assert.strictEqual(el('sales-expected').innerText, '฿6,350.00',
    'ปิดยอดแล้ว ต้องมีในลิ้นชัก = เงินสำรองทอน ไม่บวกเงินขายสดซ้ำ');
  assert.strictEqual(el('sales-float').innerText, '฿6,350.00',
    'เงินสำรองทอนต้องรวมเงินขายสดที่เพิ่งปิดยอดแล้ว');
});

test('before the day is closed, the expected drawer is still cash sales plus the float', async () => {
  const open = { success: true, total: 5120, cash: 4350, floatCash: 2000, closedInRange: false, byType: [], topSellers: [], byHour: [], daily: [], byWeekday: [] };
  const { C, el } = loadController({ replies: { getTodaySummary: open } });
  C.fetchSummary();
  await new Promise(r => setTimeout(r, 0));

  assert.strictEqual(el('btn-close-day').disabled, false, 'ยังไม่ปิดยอด ปุ่มต้องกดได้');
  assert.strictEqual(el('sales-float').innerText, '฿2,000.00');
  assert.strictEqual(el('sales-expected').innerText, '฿6,350.00');
});
