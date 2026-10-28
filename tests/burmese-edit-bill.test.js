'use strict';

// คำใหม่ของแก้ไขบิลกับกล่องยืนยันของเจ้าของ ต้องขึ้นเป็นพม่าทั้งหมดเมื่อเลือกภาษาพม่า
// ตัวที่มีเลขคิว/ยอดเงิน/ชื่อแทรก แปลในโค้ดด้วย tf() ส่วนข้อความเดี่ยวๆ ตัวแปล DOM แปลจากพจนานุกรม
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadController } = require('./helpers/load-controller');

const THAI = /[฀-฾เ-๿]/;

function burmese() {
  const h = loadController({});
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lang-my.js'), 'utf8'), sandbox);
  h.sandbox.LANG_MY = sandbox.window.LANG_MY;
  h.C.lang = 'my';
  h.C.editingBill = { invoice: 'INV-12', queue: 'PK12', timestamp: '', expectedTotal: 110, lineSum: 115, paymentType: 'QR', note: '', refundedTotal: 200 };
  h.C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 60, qty: 2, note: '' }];
  return h;
}

test('the edit bar, chip and old total read in Burmese', () => {
  const { C, el } = burmese();
  C.renderBillEditBar(120);
  for (const id of ['edit-bill-bar-title', 'cart-edit-chip', 'cart-edit-was']) {
    assert.ok(!THAI.test(el(id).innerText), id + ' ยังเป็นไทย: ' + el(id).innerText);
  }
  assert.ok(el('edit-bill-bar-title').innerText.includes('PK12'));
  assert.ok(el('cart-edit-was').innerText.includes('110.00'));
});

test('every Thai text on the save sheet has a Burmese entry', () => {
  const h = burmese();
  let sheet = null;
  h.sandbox.document.body.appendChild = (w) => { sheet = w; };
  h.C.paymentMethods = [{ name: 'QR' }];
  h.C.openBillEditSave();
  const dict = h.sandbox.LANG_MY;
  const texts = (sheet.innerHTML.match(/>([^<]+)</g) || []).map(t => t.slice(1, -1).trim()).filter(t => THAI.test(t));
  assert.ok(texts.length >= 8, 'ต้องเจอข้อความบนหน้าต่างจริง ได้ ' + texts.length);
  const missing = texts.filter(t => !h.C.lookup(dict, t));
  assert.deepEqual(missing, []);
});

test('the owner confirm box has no Thai left', async () => {
  const { C, sandbox } = burmese();
  sandbox.hashPinWithSalt = async (pin, salt) => pin + salt;
  C.employees = [{ id: 'E1', name: 'Ko Aung', role: 'Owner', active: true, pinSalt: 's', pinHash: '1234s' }];
  C.loggedInEmployee = C.employees[0];
  C.actionPin = '1234';
  const asked = [];
  C.showConfirm = async (msg) => { asked.push(msg); return true; };
  await C.requireActionPin(C.tf('ใส่รหัส PIN เพื่อยืนยันการแก้ไขบิล {x}:', 'PK12'), { ask: C.tf('ยืนยันการแก้ไขบิล {x}?', 'PK12') });
  await C.requireActionPin('ใส่รหัส PIN เพื่อสำรองข้อมูล:', { ask: C.t('สำรองข้อมูล?') });
  await C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการคืนเงิน ฿20.00:', { ask: C.tf('ยืนยันการคืนเงิน ฿{x}?', '20.00') });
  asked.forEach(msg => assert.ok(!THAI.test(msg), 'ยังเป็นไทย: ' + msg));
  assert.equal(asked.length, 3);
});

test('the date on the edit bar uses Burmese months, with 0-9 digits', () => {
  const { C, el } = burmese();
  C.editingBill.timestamp = '2026-10-28T12:54:00.000Z';
  C.renderBillEditBar(120);
  const sub = el('edit-bill-bar-sub').innerText;
  assert.ok(!THAI.test(sub), 'ยังเป็นเดือนไทย: ' + sub);
  assert.ok(/\d/.test(sub), 'ตัวเลขต้องเป็น 0-9 เหมือนส่วนอื่นของแอป: ' + sub);
});

test('every Thai error the server can send has a Burmese entry', () => {
  const { C, sandbox } = burmese();
  const worker = fs.readFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), 'utf8');
  const errors = [...worker.matchAll(/(?:error|message): (["`])((?:(?!\1).)*)\1/g)]
    .map(m => m[2].replace(/\$\{[^}]+\}/g, '{n}'))
    .filter(t => THAI.test(t));
  assert.ok(errors.length >= 20, 'ต้องเจอข้อความจากเซิร์ฟเวอร์จริง ได้ ' + errors.length);
  const missing = [...new Set(errors)].filter(t => !sandbox.LANG_MY[t] && !C.lookup(sandbox.LANG_MY, t));
  assert.deepEqual(missing, []);
});
