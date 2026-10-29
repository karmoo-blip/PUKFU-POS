// พักบิลแล้วถามว่าจะพิมพ์ใบสั่งให้บาริสต้าเลยไหม แก้วที่พิมพ์ไปแล้วไม่ออกซ้ำตอนจ่ายเงิน
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

function setup({ connected = true, answer = true } = {}) {
  const h = loadController({});
  const { C, printers } = h;
  C.cart = [];
  C.heldOrders = [];
  C.activeGroupId = null;
  C.editingBill = null;
  C.showToast = () => {};
  C.receiptSettings = { ...C.receiptSettings, printOrderSlip: true };
  h.questions = [];
  C._openAlertModal = (cfg) => {
    h.questions.push({ message: cfg.message, labels: JSON.parse(JSON.stringify(cfg.buttons.map(b => b.label))) });
    Promise.resolve().then(() => C._alertResolve && C._alertResolve(answer));
  };
  const P = printers.ReceiptPrinter;
  P.isConnected = connected;
  printers.KitchenPrinter.isConnected = false;
  h.sent = [];
  P.buildOrderSlip = async (order, title) => ({ title, items: C.slipItems(order).map(i => [i.name, i.qty]) });
  P.sendData = async (bytes) => { h.sent.push(JSON.parse(JSON.stringify(bytes))); };
  return h;
}

const settle = () => new Promise(r => setTimeout(r, 0));

test('holding a bill asks to print a barista slip and prints every cup', async () => {
  const h = setup();
  const { C } = h;
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 2 }, { sku: 'TEA', name: 'ชาไทย', price: 60, qty: 1 }];
  C.holdCurrentOrder();
  await settle();
  assert.equal(C.heldOrders.length, 1, 'บิลถูกพักก่อนถาม');
  assert.equal(C.cart.length, 0);
  assert.deepEqual(h.questions, [{ message: 'พิมพ์ใบสั่งให้บาริสต้าไหม?', labels: ['ไม่พิมพ์', 'พิมพ์'] }]);
  assert.deepEqual(h.sent, [{ title: 'บิลค้างชำระ', items: [['ลาเต้เย็น', 2], ['ชาไทย', 1]] }]);
});

test('answering no holds the bill without printing', async () => {
  const h = setup({ answer: false });
  const { C } = h;
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 2 }];
  C.holdCurrentOrder();
  await settle();
  assert.equal(h.questions.length, 1);
  assert.equal(h.sent.length, 0);
  assert.equal(C.slipItems(C.heldOrders[0]).length, 1, 'ไม่ได้พิมพ์ ตอนจ่ายเงินต้องได้ใบสั่งครบ');
});

test('no printer connected means no question', async () => {
  const h = setup({ connected: false });
  const { C } = h;
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 1 }];
  C.holdCurrentOrder();
  await settle();
  assert.equal(h.questions.length, 0);
  assert.equal(C.heldOrders.length, 1);
});

test('after printing at hold, paying later prints only cups added since', async () => {
  const h = setup();
  const { C } = h;
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 2 }];
  C.holdCurrentOrder();
  await settle();
  await C.restoreHeldOrder(0);
  C.cart[0].qty += 1;
  C.cart.push({ sku: 'AME', name: 'อเมริกาโน่ร้อน', price: 50, qty: 1 });
  await C.printOrderSlipFor({ items: C.cart, timestamp: new Date().toISOString(), invoice: 'INV-1' }, 'PK14');
  assert.deepEqual(h.sent[1], { title: 'PK14', items: [['ลาเต้เย็น', 1], ['อเมริกาโน่ร้อน', 1]] });
});

test('a failed print leaves the cups unprinted so the slip still comes out at payment', async () => {
  const h = setup();
  const { C, printers, alerts } = h;
  printers.ReceiptPrinter.sendData = async () => { throw new Error('หลุด'); };
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 2 }];
  C.holdCurrentOrder();
  await settle();
  assert.ok(alerts.some(a => a.includes('พิมพ์ไม่สำเร็จ')));
  assert.equal(C.slipItems(C.heldOrders[0])[0].qty, 2);
});
