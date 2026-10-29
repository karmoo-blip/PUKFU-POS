'use strict';

// หน้าตาคาเฟ่ ขั้นที่ 5: บิลยกเลิกโดนตราแดงบนต้นขั้ว ยอดของวันกับเมนูขายดีอยู่บนกระดานดำ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a cancelled bill is marked for the stamp, a paid one is not', () => {
  const { C, el } = loadController({});
  const now = new Date().toISOString();
  C.history = [
    { invoice: 'INV-1', timestamp: now, total: 40, paymentType: 'QR', status: 'completed', items: [{ sku: 'A', name: 'ลาเต้', price: 40, qty: 1 }] },
    { invoice: 'INV-2', timestamp: now, total: 45, paymentType: 'QR', status: 'cancelled', cancelReason: 'ลูกค้าเปลี่ยนใจ', items: [{ sku: 'B', name: 'อเมริกาโน่', price: 45, qty: 1 }] }
  ];
  C.syncQueue = [];
  C.renderHistory();
  const html = el('history-list').innerHTML;
  const row = inv => (html.match(new RegExp('<div data-invoice="' + inv + '" class="([^"]*)"')) || [])[1] || '';
  assert.ok(row('INV-2').includes('is-cancelled'), 'บิลยกเลิกต้องมีคลาสให้ประทับตรา: ' + row('INV-2'));
  assert.ok(!row('INV-1').includes('is-cancelled'));
});

test('the day total and best sellers are the chalkboards, and the stamp reads in Burmese too', () => {
  const html = read('index.html');
  assert.ok(/id="sales-hero-sec" class="sales-sec"[\s\S]{0,120}id="sales-period-label"/.test(html), 'กระดานต้องเป็นกล่องยอดของวัน');
  const css = read('style.css');
  assert.ok(css.includes('html.look-cafe #sales-hero-sec,\n    html.look-cafe #sales-top-sec {'));
  assert.ok(css.includes("#history-list > .is-cancelled::after { content: 'ပယ်ဖျက်'"), 'ตราภาษาพม่า');
  assert.ok(/html\.calm \*, html\.calm \*::before, html\.calm \*::after \{\s*animation-duration: \.01ms/.test(css), 'ลดการเคลื่อนไหวหยุดชอล์กกับบิลตกด้วย');
});

test('the selected settings item stays readable in the café look', () => {
  const css = read('style.css');
  assert.ok(/html\.look-cafe \.set-nav-item\.is-on \{ background: var\(--color-primary\); color: #f6ecd9;/.test(css), 'ตัวหนังสือขาวบนกระดาษอ่านไม่ออก');
});
