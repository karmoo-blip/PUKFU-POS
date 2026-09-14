// เครื่องพิมพ์ในแอป Android: รัน app.js ตัวจริงในกล่องจำลอง แล้วแทนปลั๊กอิน native ด้วยของปลอม
// คุมว่าเว็บยังใช้ Web Bluetooth เหมือนเดิม และในแอปงานพิมพ์ไปถึงเครื่องพิมพ์ LAN/บลูทูธครบทุกไบต์
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const LAN = { type: 'lan', host: '192.168.1.50', port: 9100 };
const BT = { type: 'bt', address: '66:22:B3:10:00:01', name: 'ES-8803BA' };

test('the website keeps using Web Bluetooth and never opens the Android printer sheet', async () => {
  const { C, el, printers } = loadController({});
  await C.connectBTPrinter('receipt');
  assert.ok(!el('modal-printer-connect').classList.contains('modal-opening'), 'แผ่นต่อเครื่องพิมพ์ต้องไม่เปิดบนเว็บ');
  assert.equal(printers.ReceiptPrinter.nativeTarget, null);
  C.updatePrinterStatusUI('receipt');
  assert.ok(el('printer-native-sub').classList.contains('hidden'));
  assert.ok(el('btn-printer-change-receipt').classList.contains('hidden'));
});

test('in the app, a saved printer is restored on launch and shown on the card', () => {
  const { C, el, printers } = loadController({ native: {}, saved: { receipt: LAN, kitchen: BT } });
  assert.equal(printers.ReceiptPrinter.isConnected, true);
  assert.equal(printers.KitchenPrinter.nativeTarget.address, BT.address);
  C.updatePrinterStatusUI();
  assert.ok(el('bt-printer-status-receipt').innerHTML.includes('LAN · 192.168.1.50'));
  assert.ok(el('bt-printer-status-kitchen').innerHTML.includes('บลูทูธ · ES-8803BA'));
  assert.ok(!el('btn-printer-change-receipt').classList.contains('hidden'));
  assert.ok(!el('printer-native-sub').classList.contains('hidden'));
});

test('receipt bytes go to the LAN printer in one piece, byte for byte', async () => {
  const { calls, printers } = loadController({ native: {}, saved: { receipt: LAN } });
  const bytes = [0x1B, 0x40, 0xE0, 0xB8, 0x81, 0x0A, 0x1D, 0x56, 0x42, 0x00];
  await printers.ReceiptPrinter.sendData(bytes);
  const sent = calls.filter((c) => c.fn === 'PukfuPrinter.lanSend');
  assert.equal(sent.length, 1, 'LAN ส่งครั้งเดียว ไม่หั่นเป็นก้อนแบบ BLE');
  assert.equal(sent[0].args[0].host, '192.168.1.50');
  assert.equal(sent[0].args[0].port, 9100);
  assert.deepEqual([...Buffer.from(sent[0].args[0].data, 'base64')], bytes);
});

test('kitchen slips go to the Bluetooth printer by address', async () => {
  const { calls, printers } = loadController({ native: {}, saved: { kitchen: BT } });
  await printers.KitchenPrinter.sendData(new Uint8Array([1, 2, 3]));
  const sent = calls.find((c) => c.fn === 'PukfuPrinter.btSend');
  assert.ok(sent, 'ต้องส่งผ่าน btSend');
  assert.equal(sent.args[0].address, BT.address);
  assert.equal(Buffer.from(sent.args[0].data, 'base64').length, 3);
});

test('a printer error reaches the caller instead of pretending it printed', async () => {
  const { printers } = loadController({
    native: { lanSend: () => Promise.reject(new Error('ส่งไปเครื่องพิมพ์ที่ 192.168.1.50 ไม่ได้')) },
    saved: { receipt: LAN },
  });
  await assert.rejects(printers.ReceiptPrinter.sendData([1]), /192\.168\.1\.50/);
});

test('saving a LAN printer checks it first, then remembers it', async () => {
  const { C, el, calls, store, printers } = loadController({ native: {} });
  C.openPrinterSheet('receipt');
  assert.equal(el('printer-sheet-title').innerText, 'ต่อเครื่องพิมพ์ใบเสร็จ');
  el('printer-sheet-ip').value = ' 192.168.1.50 ';
  await C.savePrinterSheet();
  assert.ok(calls.some((c) => c.fn === 'PukfuPrinter.lanCheck' && c.args[0].host === '192.168.1.50'));
  assert.deepEqual(JSON.parse(store.get('pos_nativePrinter_receipt')), LAN);
  assert.equal(printers.ReceiptPrinter.deviceName, '192.168.1.50');
});

test('an unreachable IP is not saved and says what to check', async () => {
  const { C, el, store, printers } = loadController({
    native: { lanCheck: () => Promise.reject(new Error('timeout')) },
  });
  C.openPrinterSheet('receipt');
  el('printer-sheet-ip').value = '192.168.1.99';
  await C.savePrinterSheet();
  assert.equal(store.has('pos_nativePrinter_receipt'), false);
  assert.equal(printers.ReceiptPrinter.isConnected, false);
  assert.ok(el('printer-sheet-note').innerText.includes('Wi-Fi'));
});

test('a half-typed IP is refused before touching the network', async () => {
  const { C, el, calls } = loadController({ native: {} });
  C.openPrinterSheet('kitchen');
  el('printer-sheet-ip').value = '192.168.1';
  await C.savePrinterSheet();
  assert.equal(calls.filter((c) => c.fn.startsWith('PukfuPrinter.lan')).length, 0);
  assert.ok(el('printer-sheet-note').innerText.includes('192.168.1.50'));
});

test('picking a paired Bluetooth printer saves it for the kitchen', async () => {
  const { C, store, printers } = loadController({
    native: { btList: () => Promise.resolve({ devices: [{ name: 'Galaxy Buds', address: 'AA:AA' }, BT] }) },
  });
  C.openPrinterSheet('kitchen');
  C.setPrinterSheetTab('bt');
  await new Promise((r) => setTimeout(r, 0));
  C.pickBluetoothPrinter(1);
  await C.savePrinterSheet();
  assert.deepEqual(JSON.parse(store.get('pos_nativePrinter_kitchen')), BT);
  assert.equal(printers.KitchenPrinter.deviceName, 'ES-8803BA');
});

test('disconnecting forgets the saved printer', async () => {
  const { C, store, printers } = loadController({ native: {}, saved: { receipt: LAN } });
  await C.disconnectBTPrinter('receipt');
  assert.equal(store.has('pos_nativePrinter_receipt'), false);
  assert.equal(printers.ReceiptPrinter.isConnected, false);
});
