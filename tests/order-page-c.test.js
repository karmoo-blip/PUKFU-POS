'use strict';

// หน้าขายแบบ C: การ์ดช่องใหญ่ ขายดีวันนี้ แถบล่างบนมือถือ และออเดอร์ที่เลื่อนเข้ามาจากขวา
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

const MENU = [
  { sku: 'LAT', name: 'ลาเต้เย็น', price: 40, category: 'กาแฟ' },
  { sku: 'AME', name: 'อเมริกาโน่', price: 45, category: 'กาแฟ' },
  { sku: 'THA', name: 'ชาไทย', price: 40, category: 'ชา' },
];

function setup() {
  const h = loadController({});
  const { C } = h;
  C.menuData = MENU.slice();
  C.soldOutItems = [];
  C.activeCategory = 'All';
  C.cart = [];
  C.heldOrders = [];
  C.history = [];
  C.syncQueue = [];
  C.replayClass = () => {};
  return h;
}

test('best sellers count today\'s bills, skipping cancelled bills, cancelled lines and staff cups', () => {
  const { C } = setup();
  C.history = [
    { status: 'completed', items: [{ sku: 'THA', qty: 3 }, { sku: 'LAT', qty: 1 }] },
    { status: 'cancelled', items: [{ sku: 'AME', qty: 9 }] },
    { status: 'waste', items: [{ sku: 'AME', qty: 9 }] },
    { status: 'completed', items: [{ sku: 'AME', qty: 5, cancelled: true }, { sku: 'GONE', qty: 4 }] },
  ];
  C.syncQueue = [{ items: [{ sku: 'LAT', qty: 1 }] }];
  const list = C.todaysBestSellers(6);
  assert.equal(list.map(x => x.sku + ':' + x.qty).join(','), 'THA:3,LAT:2', 'เมนูที่ถูกลบไปแล้วไม่ต้องโผล่');
});

test('the best-seller row hides until something sells, and opens the same sweetness picker', () => {
  const { C, el } = setup();
  C.renderMenu();
  assert.ok(el('menu-best').classList.contains('hidden'), 'เช้าที่ยังไม่มีขายต้องไม่มีแถวว่างๆ');
  C.history = [{ status: 'completed', items: [{ sku: 'AME', qty: 2 }] }];
  C.renderMenu();
  assert.ok(!el('menu-best').classList.contains('hidden'));
  assert.ok(el('menu-best').innerHTML.includes('Controller.selectProduct(1)'));
  assert.ok(el('menu-best').innerHTML.includes('ขายดีวันนี้'));
});

test('a tile shows how many of that drink are already in the order', () => {
  const { C, el } = setup();
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 2, note: 'หวานน้อย' }, { sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: 'ปกติ' }];
  C.renderMenu();
  const html = el('menu-grid').innerHTML;
  assert.ok(html.includes('<span class="pos-qty-badge">3</span>'), 'สองความหวานรวมเป็นเลขเดียว');
  assert.equal((html.match(/pos-qty-badge/g) || []).length, 1, 'เมนูที่ยังไม่ได้สั่งไม่มีเลข');
});

test('the phone bottom bar shows the total, and pay works without opening the order', () => {
  const { C, el } = setup();
  C.renderCart();
  assert.equal(el('pos-bar-label').innerText, 'ออเดอร์ว่าง');
  assert.ok(el('btn-bar-view').classList.contains('hidden'));
  assert.ok(el('btn-bar-pay').classList.contains('is-off'));
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 2, note: '' }, { sku: 'THA', name: 'ชาไทย', price: 40, qty: 1, note: '' }];
  C.renderCart();
  assert.equal(el('pos-bar-label').innerText, 'ออเดอร์ · 3 แก้ว');
  assert.equal(el('pos-bar-total').innerText, '฿120.00');
  assert.ok(!el('btn-bar-view').classList.contains('hidden'));
  assert.ok(!el('btn-bar-pay').classList.contains('is-off'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/id="btn-bar-pay"[^>]*onclick="Controller.openCheckout\(\)"/.test(html), 'ปุ่มจ่ายบนแถบล่างใช้ทางเดียวกับปุ่มในออเดอร์');
});

test('editing a bill turns the bottom bar and the edge tab into edit mode', () => {
  const { C, el } = setup();
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 1, note: '' }];
  C.editingBill = { invoice: 'INV-12', queue: 'PK12', expectedTotal: 40, lineSum: 40, paymentType: 'QR', note: '', refundedTotal: 0 };
  C.renderCart();
  assert.equal(el('pos-bar-label').innerText, 'แก้บิล PK12');
  assert.equal(el('btn-bar-pay').innerText, 'บันทึกการแก้ไข');
  assert.ok(el('btn-bar-pay').classList.contains('is-edit'));
  assert.ok(el('cart-edge-tab').classList.contains('is-edit'));
});

test('the edge tab shows the cup count only while the order is closed and has drinks', () => {
  const { C, el, sandbox } = setup();
  sandbox.innerWidth = 390;
  C.renderCart();
  assert.ok(el('cart-edge-tab').classList.contains('hidden'), 'ออเดอร์ว่างไม่มีแท็บ');
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 40, qty: 4, note: '' }];
  C.renderCart();
  assert.ok(!el('cart-edge-tab').classList.contains('hidden'));
  assert.equal(el('cart-edge-count').innerText, '4');
  C.toggleMobileCart(true);
  assert.ok(el('cart-container').classList.contains('is-open'));
  assert.ok(el('cart-scrim').classList.contains('is-on'));
  assert.ok(el('cart-edge-tab').classList.contains('hidden'), 'เปิดออเดอร์อยู่ แท็บต้องหลบ');
  C.toggleMobileCart(false);
  assert.ok(!el('cart-container').classList.contains('is-open'));
  assert.ok(!el('cart-edge-tab').classList.contains('hidden'));
});

test('on a phone the order slides in from the right, not up from the bottom', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 1023.98px) {\n      /* ออเดอร์เป็นแผ่น'));
  assert.match(phone, /#cart-container \{[^}]*right: 0;[^}]*transform: translateX\(105%\)/, 'ปิดอยู่ต้องซ่อนนอกจอทางขวา');
  assert.match(phone, /#cart-container\.is-open \{ transform: none; \}/);
  assert.ok(!css.includes('h-[65vh]'), 'แบบเลื่อนขึ้นจากล่างต้องไม่เหลือ');
});
