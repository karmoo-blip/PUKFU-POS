'use strict';

// หน้าตาคาเฟ่ ขั้นที่ 3: แถวที่ลบถูกขยำ (ลบทันที ไม่รอ) ลิ้นชักตอนเงินสด ป้าย QR แบงก์ตามสีจริง กล่องเงินทอนสามสี
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

function setup(classes) {
  const h = loadController({});
  (classes || []).forEach(c => h.sandbox.document.documentElement.classList.add(c));
  const { C } = h;
  C.menuData = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, category: 'กาแฟ' }];
  C.soldOutItems = [];
  C.cart = [];
  C.heldOrders = [];
  C.history = [];
  C.syncQueue = [];
  C.replayClass = () => {};
  C.paymentMethods = [{ id: 'cash', name: 'เงินสด', enabled: true, isCash: true }, { id: 'qr', name: 'QR', enabled: true }, { id: 'tr', name: 'โอน', enabled: true }];
  return h;
}

test('in the café look a removed line is gone at once; the crumple never holds it up', async () => {
  const { C, sandbox } = setup(['look-cafe']);
  const row = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 60 }), classList: { add() {} } };
  sandbox.document.querySelector = (sel) => (sel.includes('data-cart-idx') ? row : null);
  let crumpled = 0;
  C.crumpleCartLine = () => { crumpled++; };
  let waited = false;
  const t = setTimeout(() => { waited = true; }, 50);
  await C.animateCartLineOut(0);
  clearTimeout(t);
  assert.equal(crumpled, 1);
  assert.equal(waited, false, 'ต้องไม่รอให้อนิเมชันจบ');
});

test('cash opens the till drawer, QR shows the stand, other methods show neither', () => {
  const { C, el } = setup(['look-cafe']);
  C.setSubmitButtonState = () => {};
  C.updateCashUI = () => {};
  el('checkout-total').innerText = '฿175.00';
  C.setPaymentMode('cash');
  assert.ok(el('modal-checkout').classList.contains('is-cash'));
  assert.ok(el('checkout-stand').classList.contains('hidden'));
  C.setPaymentMode('qr');
  assert.ok(!el('modal-checkout').classList.contains('is-cash'));
  assert.ok(!el('checkout-stand').classList.contains('hidden'));
  assert.ok(el('checkout-stand').innerHTML.includes('฿175.00'));
  assert.ok(el('checkout-stand').innerHTML.includes('ยังไม่ได้ตั้งรูป QR ของร้าน'), 'ยังไม่มีรูป QR ต้องบอกตรงๆ');
  assert.ok(!el('checkout-stand').innerHTML.includes('<rect x="7"'), 'ห้ามมีลายที่ดูเหมือน QR จริง');
  C.setPaymentMode('tr');
  assert.ok(el('checkout-stand').classList.contains('hidden'), 'โอนไม่ใช่ QR ไม่ต้องมีป้าย');
});

test('the stand shows the shop\'s real payment QR when one is saved', () => {
  const { C, el } = setup(['look-cafe']);
  C.setSubmitButtonState = () => {};
  C.updateCashUI = () => {};
  C.shopInfo = { paymentQrImage: 'data:image/png;base64,QUJD' };
  el('checkout-total').innerText = '฿60.00';
  C.setPaymentMode('qr');
  const html = el('checkout-stand').innerHTML;
  assert.ok(html.includes('<img src="data:image/png;base64,QUJD"'), html);
  assert.ok(html.includes('ให้ลูกค้าสแกนจ่าย'));
  assert.ok(html.includes('฿60.00'));
});

test('the change box is plain before cash, red while short, green once enough', () => {
  const { C, el } = setup(['look-cafe']);
  C.setSubmitButtonState = () => {};
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: '' }];
  C.checkoutDiscount = 0;
  C.cashInput = '0';
  C.updateCashUI(true);
  assert.ok(!el('cash-change-box').classList.contains('is-short'));
  assert.ok(!el('cash-change-box').classList.contains('is-enough'));
  C.cashInput = '20';
  C.updateCashUI(true);
  assert.ok(el('cash-change-box').classList.contains('is-short'));
  C.cashInput = '100';
  C.updateCashUI(true);
  assert.ok(el('cash-change-box').classList.contains('is-enough'));
  assert.ok(!el('cash-change-box').classList.contains('is-short'));
});

test('bank notes carry their value for the café colours, and the drawer is hidden in the plain look', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const v of [20, 50, 100, 500, 1000]) assert.ok(html.includes(`addCash(${v})" class="cash-note is-n${v}"`), String(v));
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.ok(css.includes('.checkout-till, .checkout-stand { display: none; }'), 'หน้าเรียบไม่มีลิ้นชักหรือป้าย');
});
