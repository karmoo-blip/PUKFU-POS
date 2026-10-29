'use strict';

// หน้าตาคาเฟ่ ขั้นที่ 4: ใบเสร็จพิมพ์ออกจากช่อง เลขคิวตัวใหญ่ ป้ายทองบิลแรกของวันกับทุก 50 แก้ว
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const now = () => new Date().toISOString();
const bill = (inv, qty, extra) => Object.assign({ invoice: inv, timestamp: now(), status: 'completed', items: [{ sku: 'LAT', qty }] }, extra || {});

function cafe() {
  const h = loadController({});
  h.sandbox.document.documentElement.classList.add('look-cafe');
  h.C.history = [];
  h.C.syncQueue = [];
  return h;
}

test('the first bill of the day gets the opening ribbon', () => {
  const { C } = cafe();
  const b = bill('A', 2);
  C.syncQueue = [b];
  assert.equal(C.paidRibbon(b), 'บิลแรกของวัน · เปิดร้านแล้ว!');
});

test('the bill that crosses 50 cups today gets the milestone ribbon, the next one does not', () => {
  const { C } = cafe();
  C.history = [bill('A', 30), bill('B', 18), bill('X', 9, { status: 'cancelled' }), bill('Y', 9, { status: 'waste' })];
  const c = bill('C', 3);
  C.syncQueue = [c];
  assert.equal(C.paidRibbon(c), 'แก้วที่ 50 ของวันนี้!', 'บิลยกเลิกกับพนักงานดื่มไม่นับ');
  const d = bill('D', 1);
  C.syncQueue.push(d);
  assert.equal(C.paidRibbon(d), '');
});

test('yesterday does not count toward today', () => {
  const { C } = cafe();
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  C.history = [bill('A', 60, { timestamp: old })];
  const b = bill('B', 1);
  C.syncQueue = [b];
  assert.equal(C.paidRibbon(b), 'บิลแรกของวัน · เปิดร้านแล้ว!');
});

test('the café overlay fills the receipt; the plain look keeps the tick', () => {
  const { C, el } = cafe();
  const b = bill('A', 2);
  C.syncQueue = [b];
  C.playPaidOverlay(110, 'PK07', b);
  assert.ok(el('paid-overlay').classList.contains('is-cafe'));
  assert.ok(el('paid-overlay').classList.contains('has-ribbon'));
  assert.equal(el('paid-receipt-queue').innerText, 'PK07');
  assert.equal(el('paid-receipt-total').innerText, '฿110.00');
  assert.ok(!el('paid-receipt-ribbon').classList.contains('hidden'));

  const plain = loadController({});
  plain.C.playPaidOverlay(110, 'PK07', b);
  assert.ok(!plain.el('paid-overlay').classList.contains('is-cafe'));
  assert.ok(plain.el('paid-overlay-queue').innerText.includes('PK07'));
});

test('the café receipt sits above the print question blur and never takes a tap', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'style.css'), 'utf8');
  assert.ok(/#paid-overlay\.is-cafe \{ z-index: 96;/.test(css), 'ต้องอยู่เหนือม่าน z-[95]');
  assert.ok(/#paid-overlay \{[^}]*pointer-events: none;/.test(css), 'ต้องไม่รับคลิก');
});
