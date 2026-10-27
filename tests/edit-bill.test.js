// แก้ไขบิลย้อนหลัง: ปุ่มในประวัติย้ายบิลกลับไปหน้าขาย แก้ด้วยเมนูกับปุ่มเดิม แล้วบันทึกทับบิลเดิม
// ต้องมีสิทธิ์ "แก้ไขบิล" (editbill) ทั้งฝั่งปุ่มและฝั่งเซิร์ฟเวอร์
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadController } = require('./helpers/load-controller');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), 'utf8');
const CREATES = [...SRC.matchAll(/"(CREATE TABLE IF NOT EXISTS \w+ \([^"]+\))"/g)].map(m => m[1]);

// D1 บางๆ ทับ SQLite จริง แบบเดียวกับ schema-real-db.test.js
function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); return stmt; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        _sql: sql, _args: () => args,
      };
      return stmt;
    },
    async batch(stmts) { for (const s of stmts) db.prepare(s._sql).run(...s._args()); return []; },
  };
}

function shopDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of CREATES) db.exec(sql);
  const emp = db.prepare('INSERT INTO employees (id, name, pin, role, active, permission) VALUES (?, ?, ?, ?, 1, ?)');
  emp.run('E1', 'มิ้น', '1111', 'Staff', 'history,editbill');
  emp.run('E2', 'ต้น', '2222', 'Staff', 'history');
  emp.run('E3', 'บอน', '3333', 'Owner', '');
  const ts = '2026-10-27T07:05:00.000Z';
  db.prepare("INSERT INTO payments (timestamp, invoice, total, payment_type, order_note, status) VALUES (?, 'INV-12', 110, 'QR', '', 'active')").run(ts);
  const sale = db.prepare('INSERT INTO sales (timestamp, invoice, sku, name, qty, price, note, payment_type, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  sale.run(ts, 'INV-12', 'LAT', 'ลาเต้เย็น', 1, 60, 'ความหวาน: น้อย', 'QR', 0);
  sale.run(ts, 'INV-12', 'COC', 'โกโก้เย็น', 1, 50, '', 'QR', 0);
  sale.run(ts, 'INV-12', 'AME', 'อเมริกาโน่', 1, 45, '', 'QR', 1);
  return db;
}

async function call(db, args) {
  const mod = await import('../worker/worker.js?editbill=' + Date.now() + Math.random());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn: 'replaceOrderItems', args: [args] }),
  }), { DB: d1(db), API_TOKEN: 'staff-token' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.result;
}

const NEW_ITEMS = [
  { sku: 'LAT', name: 'ลาเต้เย็น', qty: 1, price: 60, note: 'ความหวาน: น้อย' },
  { sku: 'THA', name: 'ชาไทย', qty: 2, price: 45, note: '' },
];

test('saving replaces the bill lines, keeps its day, and keeps cancelled lines', async () => {
  const db = shopDb();
  const r = await call(db, { invoice: 'INV-12', items: NEW_ITEMS, expectedTotal: 110, paymentType: 'เงินสด', note: 'เพิ่มชาไทย', employeeId: 'E1', pin: '1111' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.total, 150);
  const live = db.prepare('SELECT sku, qty, price, timestamp, payment_type FROM sales WHERE invoice = ? AND cancelled = 0 ORDER BY sku').all('INV-12');
  assert.equal(live.map(x => x.sku + 'x' + x.qty).join(','), 'LATx1,THAx2', 'โกโก้ต้องหายไป ชาไทยต้องเข้ามา');
  assert.ok(live.every(x => x.timestamp === '2026-10-27T07:05:00.000Z'), 'บิลต้องอยู่วันเดิม');
  assert.ok(live.every(x => x.payment_type === 'เงินสด'));
  const cancelled = db.prepare('SELECT sku FROM sales WHERE invoice = ? AND cancelled = 1').all('INV-12');
  assert.equal(cancelled.length, 1, 'รายการที่ยกเลิกไปแล้วต้องเก็บไว้เป็นหลักฐาน');
  const pay = db.prepare('SELECT total, payment_type, order_note, edited_by FROM payments WHERE invoice = ?').get('INV-12');
  assert.equal(pay.total, 150);
  assert.equal(pay.payment_type, 'เงินสด');
  assert.equal(pay.order_note, 'เพิ่มชาไทย');
  assert.equal(pay.edited_by, 'มิ้น', 'ชื่อคนแก้มาจาก PIN ไม่ใช่จากที่ส่งมา');
});

test('an employee without the แก้ไขบิล permission is refused by the server', async () => {
  const db = shopDb();
  const r = await call(db, { invoice: 'INV-12', items: NEW_ITEMS, expectedTotal: 110, employeeId: 'E2', pin: '2222' });
  assert.equal(r.success, false);
  assert.equal(db.prepare('SELECT total FROM payments WHERE invoice = ?').get('INV-12').total, 110, 'บิลต้องไม่ถูกแตะ');
});

test('the owner can edit without ticking the permission', async () => {
  const r = await call(shopDb(), { invoice: 'INV-12', items: NEW_ITEMS, expectedTotal: 110, employeeId: 'E3', pin: '3333' });
  assert.equal(r.success, true, r.error);
});

test('a wrong PIN or a bill changed meanwhile is refused', async () => {
  const db = shopDb();
  assert.equal((await call(db, { invoice: 'INV-12', items: NEW_ITEMS, expectedTotal: 110, employeeId: 'E1', pin: '9999' })).success, false);
  const r = await call(db, { invoice: 'INV-12', items: NEW_ITEMS, expectedTotal: 95, employeeId: 'E1', pin: '1111' });
  assert.equal(r.success, false);
  assert.match(r.error, /ถูกแก้ไขไปแล้ว/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE invoice = ? AND cancelled = 0').get('INV-12').n, 2);
});

test('an empty bill is refused, so cancelling stays with ยกเลิกบิล', async () => {
  const r = await call(shopDb(), { invoice: 'INV-12', items: [], expectedTotal: 110, employeeId: 'E1', pin: '1111' });
  assert.equal(r.success, false);
});

// ---- ฝั่งหน้าจอ ----
function setup(user) {
  const h = loadController({ replies: { replaceOrderItems: { success: true, total: 155 } } });
  const { C } = h;
  C.menuData = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 60, category: 'กาแฟ' }];
  C.loggedInEmployee = user || { name: 'มิ้น', role: 'Staff', permissions: 'history,editbill' };
  C.cart = [];
  C.syncQueue = [];
  C.heldOrders = [];
  C.history = [{
    invoice: 'INV-12', queue: 'PK12', total: 110, paymentType: 'QR', note: '', timestamp: '2026-10-27T07:05:00.000Z',
    items: [
      { sku: 'LAT', name: 'ลาเต้เย็น', qty: 1, price: 60, note: 'ความหวาน: น้อย' },
      { sku: 'COC', name: 'โกโก้เย็น', qty: 1, price: 50, note: '' },
      { sku: 'AME', name: 'อเมริกาโน่', qty: 1, price: 45, note: '', cancelled: true },
    ],
  }];
  C.switchView = () => {};
  C.toggleMobileCart = () => {};
  C.replayClass = () => {};
  return h;
}

test('แก้ไขบิล moves the bill into the order and turns the pay button into บันทึกการแก้ไข', async () => {
  const { C, el } = setup();
  await C.openEditBill('INV-12');
  assert.equal(C.cart.map(i => i.sku).join(','), 'LAT,COC', 'รายการที่ยกเลิกแล้วไม่ต้องกลับมา');
  assert.equal(C.cart[0].category, 'กาแฟ', 'ของที่ยังอยู่ในเมนูได้ข้อมูลเมนูมาด้วย แก้ตัวเลือกต่อได้');
  assert.equal(C.editingBill.invoice, 'INV-12');
  assert.equal(el('btn-checkout').innerText, 'บันทึกการแก้ไข');
  assert.ok(!el('edit-bill-bar').classList.contains('hidden'));
  assert.match(el('edit-bill-bar-title').innerText, /PK12/);
  assert.equal(el('cart-edit-was').innerText, 'เดิม ฿110.00');
  assert.ok(el('btn-hold-order').classList.contains('hidden'), 'ระหว่างแก้ต้องพักบิลไม่ได้');
});

test('ยกเลิกการแก้ไข empties the order and the pay button comes back', async () => {
  const { C, el } = setup();
  await C.openEditBill('INV-12');
  await C.cancelBillEdit();
  assert.equal(C.editingBill, null);
  assert.equal(C.cart.length, 0);
  assert.equal(el('btn-checkout').innerText, 'ชำระเงิน');
  assert.ok(el('edit-bill-bar').classList.contains('hidden'));
});

test('the pay button opens the save sheet, not the payment window, while editing', async () => {
  const { C } = setup();
  let paid = false;
  C.startCheckout = () => { paid = true; };
  let sheet = false;
  C.openBillEditSave = () => { sheet = true; };
  await C.openEditBill('INV-12');
  await C.openCheckout();
  assert.equal(paid, false);
  assert.equal(sheet, true);
});

test('saving sends the whole order with the PIN and ends edit mode', async () => {
  const { C, calls } = setup();
  C.requireActionPin = async () => ({ employeeId: 'E1', pin: '1111', employee: C.loggedInEmployee });
  C.logPinAttempt = () => {};
  C.showToast = () => {};
  C.backToHistoryAfterEdit = () => {};
  await C.openEditBill('INV-12');
  C.cart.push({ sku: 'THA', name: 'ชาไทย', qty: 1, price: 45, note: '' });
  await C.saveBillEdit();
  await new Promise(r => setTimeout(r, 0));
  const sent = calls.find(c => c.fn === 'replaceOrderItems');
  assert.ok(sent, 'ต้องเรียกเซิร์ฟเวอร์');
  assert.equal(sent.args[0].items.map(i => i.sku).join(','), 'LAT,COC,THA');
  assert.equal(sent.args[0].expectedTotal, 110);
  assert.equal(sent.args[0].employeeId, 'E1');
  assert.equal(C.editingBill, null);
  assert.equal(C.cart.length, 0);
});

test('a bill still waiting to sync cannot be edited', async () => {
  const { C, alerts } = setup();
  C.syncQueue = [{ invoice: 'INV-12' }];
  await C.openEditBill('INV-12');
  assert.equal(C.editingBill, null);
  assert.match(alerts[0], /ยังไม่ขึ้นเซิร์ฟเวอร์/);
});

test('without the permission the button is hidden and opening is refused', async () => {
  const { C, alerts } = setup({ name: 'ต้น', role: 'Staff', permissions: 'history' });
  assert.equal(C.canEditBill(C.loggedInEmployee), false);
  assert.equal(C.canEditBill({ role: 'Admin' }), true);
  await C.openEditBill('INV-12');
  assert.equal(C.editingBill, null);
  assert.match(alerts[0], /ไม่มีสิทธิ์/);
});

test('the employee form offers แก้ไขบิล in the หน้าขาย group', () => {
  const { C, el } = setup();
  C.renderEmployeePermissionGrid(['editbill']);
  const html = el('emp-perm-groups').innerHTML;
  assert.match(html, /value="editbill" checked/);
  assert.match(html, /แก้ไขบิล/);
});

test('an edit in progress survives a reload instead of becoming a new sale', async () => {
  const { C, store } = setup();
  await C.openEditBill('INV-12');
  const saved = JSON.parse(store.get('pos_editingBill'));
  assert.equal(saved.bill.invoice, 'INV-12');
  assert.equal(saved.cart.length, 2);
  await C.cancelBillEdit();
  assert.equal(store.has('pos_editingBill'), false);
});

test('the edit bar and save sheet styles exist', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  for (const sel of ['.edit-bill-bar', '.btn-till.is-edit', '.bill-edit-diff.is-more', '.bill-edit-diff.is-back']) {
    assert.ok(css.includes(sel), sel);
  }
});
