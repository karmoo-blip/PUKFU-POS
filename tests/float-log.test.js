// ประวัติเงินในลิ้นชัก: float_log เคยถูกเขียนอย่างเดียวจนหาไม่เจอว่าเงินเข้าออกตอนไหน
// เทสต์นี้กันไม่ให้ยอดคงเหลือรายแถวคิดผิด และกันไม่ให้จอประวัติหายไปอีก
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

function dbWithRows(rows, balance) {
  return {
    prepare(text) {
      const stmt = {
        bind() { return stmt; },
        async run() { return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return { value: '999' };
          if (/SUM\(CASE WHEN LOWER\(action\)/.test(text)) return { bal: balance };
          return null;
        },
        async all() { return { results: /FROM float_log/.test(text) ? rows : [] }; },
      };
      return stmt;
    },
  };
}

function post(fn) {
  return new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn, args: [] }),
  });
}

test('every row carries the drawer balance as it stood right after that entry', async () => {
  const mod = await import('../worker/worker.js?fresh=' + Date.now());
  // เรียงใหม่ไปเก่า: ปิดยอด +4350, นำเงินออก -1500, นำเงินเข้า +3500 → คงเหลือตอนนี้ 6350
  const rows = [
    { id: 3, timestamp: '2026-09-17 23:41:00', user: 'system', action: 'close_day', total_amount: 4350, note: '' },
    { id: 2, timestamp: '2026-09-17 18:20:00', user: 'บอส', action: 'OUT', total_amount: 1500, note: 'ฝากธนาคาร' },
    { id: 1, timestamp: '2026-09-17 08:05:00', user: 'บอส', action: 'IN', total_amount: 3500, note: 'เงินทอนเปิดร้าน', b1000: 2, b500: 2, b100: 5 },
  ];
  const res = await mod.default.fetch(post('getFloatLogs'), { DB: dbWithRows(rows, 6350), API_TOKEN: 'staff-token' });
  const { result } = await res.json();

  assert.strictEqual(result.balance, 6350);
  assert.deepStrictEqual(result.rows.map(r => r.balanceAfter), [6350, 2000, 3500]);
  assert.deepStrictEqual(result.rows.map(r => r.signed), [4350, -1500, 3500]);
  assert.deepStrictEqual(result.rows.map(r => r.action), ['close_day', 'out', 'in'],
    'action ที่เครื่องส่งมาเป็นตัวใหญ่ ต้องเทียบแบบตัวเล็กให้เหมือนกันหมด');
});

test('the history sheet names who moved the money, and reads system rows as ระบบ', async () => {
  const { C, el } = loadController({});
  C.renderFloatLog({
    success: true,
    balance: 6350,
    rows: [
      { timestamp: new Date().toISOString(), user: 'system', action: 'close_day', amount: 4350, signed: 4350, balanceAfter: 6350, note: '' },
      { timestamp: new Date().toISOString(), user: 'บอส', action: 'out', amount: 1500, signed: -1500, balanceAfter: 2000, note: 'ฝากธนาคาร' },
      { timestamp: new Date().toISOString(), user: 'บอส', action: 'in', amount: 3500, signed: 3500, balanceAfter: 3500, note: '', denominations: { b1000: 2, b100: 5 } },
    ],
  });

  const html = el('float-log-list').innerHTML;
  assert.ok(html.includes('ปิดยอดประจำวัน') && html.includes('นำเงินออก') && html.includes('นำเงินเข้า'));
  assert.ok(html.includes('ระบบ'), 'แถวที่ระบบทำต้องอ่านว่า ระบบ ไม่ใช่ system');
  assert.ok(html.includes('ฝากธนาคาร'), 'หมายเหตุต้องขึ้นให้เห็น');
  assert.ok(html.includes('1000×2') && html.includes('100×5'), 'แบงก์ที่นับไว้ต้องขึ้นด้วย');
  assert.ok(html.includes('−฿1,500.00') && html.includes('+฿3,500.00'), 'เงินออกต้องติดลบ เงินเข้าต้องบวก');
  assert.ok(html.includes('เหลือ ฿2,000.00'), 'ต้องบอกยอดคงเหลือหลังรายการนั้น');
  assert.strictEqual(el('fl-sum-bal').innerText, '฿6,350.00');
});

test('an empty drawer history says so instead of showing a blank sheet', async () => {
  const { C, el } = loadController({});
  C.renderFloatLog({ success: true, balance: 0, rows: [] });
  assert.ok(el('float-log-list').innerHTML.includes('ยังไม่มีรายการ'));
});
