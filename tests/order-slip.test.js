// ใบสั่งทำเครื่องดื่ม (บาริสต้า/ห้องครัว) ต้องออกทันทีที่ปิดบิลเมื่อติ๊กไว้
// ของเดิมใบนี้ออกได้ทางเดียวคือตอบว่าพิมพ์ใบเสร็จ พนักงานตอบว่าไม่แล้วครัวไม่ได้ออเดอร์เลย
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const ORDER = { items: [{ name: 'ลาเต้เย็น', qty: 1, price: 55 }], invoice: 'INV-1', timestamp: '2026-09-20T03:00:00.000Z' };

// จับว่าใครถูกสั่งพิมพ์บ้าง โดยไม่ต้องมีเครื่องพิมพ์จริง
function spy(C) {
  const printed = [];
  C.printReceipt = (order, q, opts) => { printed.push({ what: 'receipt', q, opts: opts || null }); };
  C.printOrderSlipFor = (order, q) => { printed.push({ what: 'slip', q }); };
  return printed;
}

test('ตอบว่าไม่เอาใบเสร็จ ใบบาริสต้ายังต้องออก', async () => {
  const { C } = loadController({});
  C.receiptSettings = { autoPrint: false, printOrderSlip: true };
  const printed = spy(C);
  C.showConfirm = () => Promise.resolve(false);

  await C.printAfterCheckout(ORDER, 'Q07');

  assert.deepEqual(printed.map(p => p.what), ['slip'], 'ต้องมีแต่ใบบาริสต้า ไม่มีใบเสร็จ');
  assert.equal(printed[0].q, 'Q07', 'เลขคิวต้องติดไปกับใบสั่งด้วย');
});

test('ตอบว่าเอาใบเสร็จ ใบบาริสต้าต้องไม่ออกซ้ำสองใบ', async () => {
  const { C } = loadController({});
  C.receiptSettings = { autoPrint: false, printOrderSlip: true };
  const printed = spy(C);
  C.showConfirm = () => Promise.resolve(true);

  await C.printAfterCheckout(ORDER, 'Q07');

  assert.deepEqual(printed.map(p => p.what), ['slip', 'receipt']);
  assert.equal(printed[1].opts.skipOrderSlip, true, 'ใบเสร็จต้องไม่พ่วงใบสั่งครัวมาอีกใบ');
});

test('ไม่ได้ติ๊กใบบาริสต้า ก็ไม่มีอะไรออกถ้าตอบว่าไม่', async () => {
  const { C } = loadController({});
  C.receiptSettings = { autoPrint: false, printOrderSlip: false };
  const printed = spy(C);
  C.showConfirm = () => Promise.resolve(false);

  await C.printAfterCheckout(ORDER, 'Q07');

  assert.deepEqual(printed, []);
});

test('พิมพ์ใบเสร็จอัตโนมัติ: ของเดิมไม่เปลี่ยน ไม่ถาม และใบสั่งครัวไปกับใบเสร็จตามเดิม', async () => {
  const { C } = loadController({});
  C.receiptSettings = { autoPrint: true, printOrderSlip: true };
  const printed = spy(C);
  let asked = false;
  C.showConfirm = () => { asked = true; return Promise.resolve(true); };

  await C.printAfterCheckout(ORDER, 'Q07');

  assert.equal(asked, false, 'ติ๊กพิมพ์อัตโนมัติไว้ ต้องไม่ถามอะไรอีก');
  assert.deepEqual(printed.map(p => p.what), ['receipt']);
  assert.equal(printed[0].opts, null, 'ใบเสร็จต้องพ่วงใบสั่งครัวมาเองเหมือนเดิม');
});

test('ใบบาริสต้าออกที่เครื่องพิมพ์ครัวถ้าต่ออยู่', async () => {
  const { C, printers } = loadController({});
  const sent = [];
  printers.KitchenPrinter.isConnected = true;
  printers.KitchenPrinter.buildOrderSlip = async () => new Uint8Array([1, 2, 3]);
  printers.KitchenPrinter.sendData = async (b) => sent.push(['kitchen', Array.from(b)]);
  printers.ReceiptPrinter.isConnected = true;
  printers.ReceiptPrinter.sendData = async () => sent.push(['receipt']);

  await C.printOrderSlipFor(ORDER, 'Q07');

  assert.deepEqual(sent, [['kitchen', [1, 2, 3]]]);
});

test('ไม่มีเครื่องพิมพ์ครัว ใบบาริสต้าไปออกเครื่องใบเสร็จแทน', async () => {
  const { C, printers } = loadController({});
  const sent = [];
  printers.KitchenPrinter.isConnected = false;
  printers.ReceiptPrinter.isConnected = true;
  printers.ReceiptPrinter.buildOrderSlip = async () => new Uint8Array([9]);
  printers.ReceiptPrinter.sendData = async (b) => sent.push(Array.from(b));

  await C.printOrderSlipFor(ORDER, 'Q07');

  assert.deepEqual(sent, [[9]]);
});

// กลางจังหวะรับเงิน ห้ามมีหน้าต่างเตือนโผล่มาขวางเพราะเครื่องพิมพ์ไม่ได้ต่อ ทางใบเสร็จเตือนให้อยู่แล้ว
test('ไม่ได้ต่อเครื่องพิมพ์เลย ต้องเงียบ ไม่เด้งเตือนคาหน้าคนจ่ายเงิน', async () => {
  const { C, printers, alerts } = loadController({});
  printers.KitchenPrinter.isConnected = false;
  printers.ReceiptPrinter.isConnected = false;

  await C.printOrderSlipFor(ORDER, 'Q07');

  assert.deepEqual(alerts, []);
});
