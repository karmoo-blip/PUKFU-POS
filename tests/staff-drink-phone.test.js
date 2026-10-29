'use strict';

// พนักงานดื่ม/ของเสียบนมือถือ: แก้วไม่ได้เข้าออเดอร์ แถบล่าง แท็บขอบขวา และแถบ "บันทึกแล้ว" ต้องบอกให้เห็นว่ากดติด
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const MENU = [
  { sku: 'LAT', name: 'ลาเต้เย็น', price: 40, category: 'กาแฟ' },
  { sku: 'THA', name: 'ชาไทย', price: 40, category: 'ชา' },
];

function setup() {
  const h = loadController({});
  const { C } = h;
  C.menuData = MENU.slice();
  C.soldOutItems = [];
  C.cart = [];
  C.heldOrders = [];
  C.history = [];
  C.syncQueue = [];
  C.freeUnsent = [];
  C.replayClass = () => {};
  C.canStaffSale = () => true;
  C.staffTabIdleSeconds = () => 0;
  C.activeCategory = '__staff__';
  C.staffMode = 'drink';
  return h;
}

test('tapping a drink in staff-drink mode shows the cup on the bottom bar and the edge tab', () => {
  const { C, el } = setup();
  C.selectProduct(0);
  C.selectProduct(1);
  assert.equal(C.freeUnsent.length, 2);
  assert.ok(el('pos-bottom-bar').classList.contains('is-free'));
  assert.equal(el('pos-bar-label').innerText, 'พนักงานดื่ม · ไม่เก็บเงิน');
  assert.equal(el('pos-bar-total').innerText, '2 แก้ววันนี้');
  assert.ok(!el('btn-bar-view').classList.contains('hidden'));
  assert.equal(el('btn-bar-view').innerText, 'ดูรายการ');
  assert.ok(el('btn-bar-pay').classList.contains('hidden'), 'ไม่มีอะไรให้เก็บเงิน');
  assert.ok(!el('cart-edge-tab').classList.contains('hidden'));
  assert.ok(el('cart-edge-tab').classList.contains('is-free'));
  assert.equal(el('cart-edge-count').innerText, '2');
});

test('the added bar names the cup, and undo takes that cup back', () => {
  const { C, el } = setup();
  C.selectProduct(0);
  assert.ok(!el('added-bar').classList.contains('hidden'));
  assert.equal(el('added-bar-text').innerText, 'บันทึกพนักงานดื่ม · ลาเต้เย็น');
  C.undoAdd();
  assert.equal(C.freeUnsent.length, 0);
  assert.equal(el('pos-bar-total').innerText, '0 แก้ววันนี้');
  assert.ok(el('cart-edge-tab').classList.contains('hidden'));
  assert.ok(el('btn-bar-view').classList.contains('hidden'));
});

test('waste mode counts only waste cups', () => {
  const { C, el } = setup();
  C.selectProduct(0);
  C.setStaffMode('waste');
  assert.equal(el('pos-bar-label').innerText, 'ของเสีย · ไม่เก็บเงิน');
  assert.equal(el('pos-bar-total').innerText, '0 แก้ววันนี้');
  C.selectProduct(1);
  assert.equal(el('pos-bar-total').innerText, '1 แก้ววันนี้');
});

test('leaving the mode brings back the order total and the pay button', () => {
  const { C, el } = setup();
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: '' }];
  C.renderCart();
  C.selectProduct(0);
  assert.equal(el('pos-bar-total').innerText, '1 แก้ววันนี้');
  C.setStaffMode('sale');
  assert.ok(!el('pos-bottom-bar').classList.contains('is-free'));
  assert.equal(el('pos-bar-total').innerText, '฿40.00');
  assert.ok(!el('btn-bar-pay').classList.contains('hidden'));
  assert.equal(el('btn-bar-view').innerText, 'ดูออเดอร์');
  assert.ok(!el('cart-edge-tab').classList.contains('is-free'));
});

test('the drawer stays open on an empty order while showing free cups', () => {
  const { C, sandbox } = setup();
  sandbox.window.innerWidth = 390;
  C.selectProduct(0);
  C.toggleMobileCart(true);
  C.renderCart();
  assert.equal(C.isCartOpenMobile, true);
});
