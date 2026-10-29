'use strict';

// หน้าตาคาเฟ่ ขั้นที่ 2: การ์ดยุบ แก้วบินลงออเดอร์ แก้วหลับ/ตื่นบนแถบล่าง แก้วล้มตอนหมด
// ท่าขยับเล่นเฉพาะหน้าคาเฟ่ และหยุดหมดเมื่อเปิดลดการเคลื่อนไหว
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
  return h;
}

test('moves only in the café look, and never with ลดการเคลื่อนไหว on', () => {
  assert.equal(setup(['look-cafe']).C.cafeMotion(), true);
  assert.equal(setup([]).C.cafeMotion(), false, 'หน้าเรียบคงท่าเดิม');
  const calm = setup(['look-cafe', 'calm']).C;
  assert.equal(calm.cafeMotion(), false);
  assert.equal(calm.reducedMotion(), true, 'สวิตช์ในตั้งค่าต้องหยุดท่าเดิมของแอปด้วย');
});

test('the bar cup sleeps while the order is empty and wakes when a drink goes in', () => {
  const { C, el } = setup(['look-cafe']);
  C.renderCart();
  assert.ok(el('pos-bar-mascot').innerHTML.includes('>z</text>'), 'ออเดอร์ว่าง แก้วหลับ');
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: '' }];
  C.renderCart();
  assert.ok(!el('pos-bar-mascot').innerHTML.includes('>z</text>'), 'มีของแล้วต้องตื่น');
  assert.ok(el('pos-bar-mascot').innerHTML.includes('<circle'), 'ตาเปิด');
});

test('the empty order page has the sleepy cup for the café look', () => {
  const { C, el } = setup(['look-cafe']);
  C.renderCart();
  assert.ok(el('cart-items').innerHTML.includes('cart-empty-mascot'));
  assert.ok(el('cart-items').innerHTML.includes('cart-empty-icon'), 'หน้าเรียบยังมีไอคอนเดิม');
});

test('a sold-out drink still does not open the sweetness sheet', () => {
  const { C } = setup(['look-cafe']);
  C.soldOutItems = ['ลาเต้เย็น'];
  let opened = false;
  C.openModal = () => { opened = true; };
  C.selectProduct(0);
  assert.equal(opened, false);
  assert.equal(C.activeProduct, null);
});

test('the café cup flight gives way to the old one when the card is not on screen', () => {
  const { C } = setup(['look-cafe']);
  assert.equal(C.flyCupToOrder({ sku: 'LAT' }), false, 'หาการ์ดไม่เจอต้องไม่พัง');
});

test('the sold-out cup lies down and the plain look keeps its own markers', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.ok(/html\.look-cafe \.pos-card\.is-out \.pos-art \{[^}]*rotate: -82deg/.test(css));
  assert.ok(/\.pos-bar-mascot, \.cart-empty-mascot \{ display: none; \}/.test(css), 'หน้าเรียบไม่มีแก้วการ์ตูน');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="pos-bar-mascot"') < html.indexOf('id="pos-bar-total"'), 'แก้วอยู่ซ้ายของยอด');
});

test('tapping the bar total opens the order only when there is something in it', () => {
  const { C } = setup(['look-cafe']);
  const calls = [];
  C.toggleMobileCart = (v) => calls.push(v);
  C.openOrderFromBar();
  assert.deepEqual(calls, [], 'ออเดอร์ว่างไม่ต้องเปิด');
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: '' }];
  C.openOrderFromBar();
  assert.deepEqual(calls, [true]);
});
