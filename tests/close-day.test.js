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

// กันพนักงานลืมกดปิดยอด cron ตอนตี 3 ต้องปิดของ "เมื่อวาน" ให้เอง แต่ต้องไม่ไปทับของที่ปิดมือไปแล้ว
// D1 ปลอมตัวนี้จำทั้ง SQL และค่าที่ bind เพราะข้อสอบอยู่ที่ "ปิดวันไหน" และ "ลงวันที่แถวเป็นวันไหน"
function fakeCronDb(opts) {
  const o = opts || {};
  const calls = [];
  const db = {
    calls,
    prepare(text) {
      const call = { text, args: [] };
      calls.push(call);
      const stmt = {
        bind(...args) { call.args = args; return stmt; },
        async run() { return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return { value: '999' };
          if (/LOWER\(action\) = 'close_day'/.test(text)) {
            return o.closedDays && o.closedDays.includes(call.args[0]) ? { hit: 1 } : null;
          }
          if (/FROM float_log/.test(text)) return { bal: o.floatBalance || 0 };
          if (/FROM backups/.test(text)) return { created_at: new Date().toISOString() };
          return null;
        },
        async all() {
          if (/FROM payment_methods/.test(text)) return { results: [{ name: 'เงินสด', is_cash: 1 }] };
          if (/FROM payments/.test(text)) return { results: o.payments || [] };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return db;
}

function yesterdayBkk() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function runCron(mod, db) {
  const waits = [];
  mod.default.scheduled({}, { DB: db, API_TOKEN: 'staff-token' }, { waitUntil: p => waits.push(p) });
  return Promise.all(waits);
}

function floatInserts(db) {
  return db.calls.filter(c => /INSERT INTO float_log/.test(c.text));
}

test('the nightly cron closes yesterday when the staff forgot to press the button', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const day = yesterdayBkk();
  const db = fakeCronDb({ payments: [{ total: 4350, payment_type: 'เงินสด', bkk_date: day, bkk_hour: '19' }] });
  await runCron(mod, db);

  const ins = floatInserts(db);
  assert.strictEqual(ins.length, 1, 'ลืมกดปิดยอด cron ต้องปิดให้หนึ่งรอบ');
  const [timestamp, user, action, amount, note] = ins[0].args;
  assert.strictEqual(action, 'close_day');
  assert.strictEqual(amount, 4350, 'ต้องย้ายเงินขายสดของเมื่อวานทั้งก้อน');
  assert.strictEqual(timestamp.slice(0, 10), day,
    'แถวต้องลงวันที่ของวันที่ปิด ไม่ใช่วันที่ cron ทำงาน ไม่งั้นพนักงานจะกดปิดยอดของวันนี้ไม่ได้');
  assert.strictEqual(user, 'system:auto', 'ต้องแยกออกจากการกดเอง เจ้าของร้านจะได้เห็นว่าคืนไหนลืม');
  assert.strictEqual(note, 'ปิดยอดอัตโนมัติ');
});

test('the nightly cron leaves yesterday alone when the staff already closed it by hand', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const day = yesterdayBkk();
  const db = fakeCronDb({ closedDays: [day], payments: [{ total: 4350, payment_type: 'เงินสด', bkk_date: day, bkk_hour: '19' }] });
  await runCron(mod, db);

  assert.strictEqual(floatInserts(db).length, 0,
    'กดปิดยอดเองไปแล้ว cron ต้องไม่ปิดซ้ำ ไม่งั้นเงินก้อนเดียวเข้าเงินทอนสองรอบ');
});

test('a day with no cash sales is not closed by the cron, so the drawer history stays clean', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const db = fakeCronDb({ payments: [] });
  await runCron(mod, db);

  assert.strictEqual(floatInserts(db).length, 0, 'ไม่มีเงินสดก็ไม่ต้องใส่แถว 0 บาท');
});

test('the manual button still closes today after the cron closed yesterday', async () => {
  const mod = await import(WORKER_URL + '?fresh=' + Date.now());
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const db = fakeCronDb({ closedDays: [yesterdayBkk()], payments: [{ total: 900, payment_type: 'เงินสด', bkk_date: today, bkk_hour: '11' }] });
  const res = await mod.default.fetch(post('closeDayCash'), { DB: db, API_TOKEN: 'staff-token' });
  const body = await res.json();

  assert.strictEqual(body.result.success, true, 'เมื่อวานถูกปิดอัตโนมัติไปแล้ว วันนี้ต้องยังกดปิดได้');
  const ins = floatInserts(db);
  assert.strictEqual(ins.length, 1);
  assert.strictEqual(ins[0].args[1], 'system', 'กดเองต้องยังบันทึกเป็นการกดเอง');
});
