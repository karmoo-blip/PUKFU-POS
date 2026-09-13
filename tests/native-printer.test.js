// เครื่องพิมพ์ในแอป Android: รัน app.js ตัวจริงในกล่องจำลอง แล้วแทนปลั๊กอิน native ด้วยของปลอม
// คุมว่าเว็บยังใช้ Web Bluetooth เหมือนเดิม และในแอปงานพิมพ์ไปถึงเครื่องพิมพ์ LAN/บลูทูธครบทุกไบต์
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEl {
  constructor(id) {
    this.id = id;
    this.classes = new Set();
    this.style = {};
    this.innerHTML = '';
    this.innerText = '';
    this.value = '';
    this.src = '';
    this.checked = false;
    this.files = [];
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
      contains: (c) => self.classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !self.classes.has(c) : !!force; if (on) self.classes.add(c); else self.classes.delete(c); return on; },
    };
  }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  addEventListener() {}
  removeEventListener() {}
  appendChild() {}
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  getContext() {
    return { fillRect() {}, drawImage() {}, set fillStyle(v) {}, get fillStyle() { return ''; } };
  }
  // ต้องเคารพ mime ที่ขอมาจริง ไม่งั้นเทสต์ PNG จะผ่านทั้งที่โค้ดยังขอ JPEG อยู่
  toDataURL(mime) { return 'data:' + (mime || 'image/png') + ';base64,' + 'A'.repeat(2000); }
}

// options: { native: fake PukfuPrinter plugin (ไม่ใส่ = รันแบบเว็บ), saved: { receipt, kitchen } ปลายทางที่เคยบันทึกไว้ }
function loadController(options) {
  const o = options || {};
  const els = new Map();
  const calls = [];

  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, new FakeEl(id));
      return els.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => new FakeEl(tag),
    addEventListener() {},
    body: new FakeEl('body'),
    documentElement: new FakeEl('html'),
    readyState: 'complete',
  };

  const store = new Map();
  Object.entries(o.saved || {}).forEach(([role, target]) => store.set('pos_nativePrinter_' + role, JSON.stringify(target)));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => store.delete(k),
    setItem: (k, v) => {
      store.set(k, v);
    },
  };

  // google.script.run ปลอม: ถ้ามีตัวนี้อยู่แล้ว shim ใน app.js จะข้ามตัวเองไปทั้งก้อน
  let savedQr = null;
  function makeChain() {
    const state = { ok: null, fail: null };
    const chain = new Proxy({}, {
      get(_t, name) {
        if (name === 'withSuccessHandler') return (cb) => { state.ok = cb; return chain; };
        if (name === 'withFailureHandler') return (cb) => { state.fail = cb; return chain; };
        if (name === 'withUserObject') return () => chain;
        return (...args) => {
          const fn = String(name);
          calls.push({ fn, args });
          queueMicrotask(() => {
            if (fn === 'saveShopInfo') {
              if (o.saveFails) return state.fail && state.fail(new Error('เน็ตหลุด'));
              if (args[0] && 'paymentQrImage' in args[0]) savedQr = args[0].paymentQrImage;
              return state.ok && state.ok({ success: true });
            }
            if (fn === 'getShopInfo') {
              return state.ok && state.ok({ paymentQrImage: o.serverForgets ? '' : savedQr });
            }
            return state.ok && state.ok({});
          });
        };
      },
    });
    return chain;
  }
  const google = { script: { get run() { return makeChain(); }, host: {} } };

  class FakeFileReader {
    readAsDataURL() { this.onload({ target: { result: 'data:image/png;base64,AAA' } }); }
  }
  class FakeImage {
    constructor() { this.width = 800; this.height = 800; }
    set src(v) { this.__src = v; queueMicrotask(() => { if (o.badImage) this.onerror(new Event('error')); else this.onload(); }); }
    get src() { return this.__src; }
  }

  const sandbox = {
    document,
    localStorage,
    google,
    console,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    queueMicrotask,
    FileReader: FakeFileReader,
    Image: FakeImage,
    Event: class { constructor(t) { this.type = t; } },
    Proxy, Promise, JSON, Math, Date, Number, String, Object, Array,
    fetch: () => Promise.reject(new Error('no network in tests')),
    URLSearchParams,
    navigator: { onLine: true, userAgent: 'node' },
    location: { search: '', pathname: '/', origin: 'http://localhost', href: 'http://localhost/' },
    crypto: require('node:crypto').webcrypto,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    escAttr: (v) => String(v),
    escHtml: (v) => String(v),
    calcVatBreakdown: () => ({ exVat: 0, vatAmount: 0, rate: 0 }),
    unitCost: () => null,
    recipeCost: () => ({ total: null, lines: [], missingPrice: [] }),
    hashPinWithSalt: async () => '',
    sha256Hex: async () => '',
    bufToHex: () => '',
    qrcode: () => ({ addData() {}, make() {}, createDataURL: () => '' }),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  if (o.native) {
    sandbox.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: (plugin, method, options) => {
        calls.push({ fn: plugin + '.' + method, args: [options] });
        return o.native[method] ? o.native[method](options) : Promise.resolve({});
      },
    };
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(code + '\nglobalThis.__Controller = Controller; globalThis.__printers = { ReceiptPrinter, KitchenPrinter, createPrinterConnection };', sandbox, { filename: 'app.js' });

  const C = sandbox.__Controller;
  const alerts = [];
  C.showAlert = (msg) => { alerts.push(String(msg)); return Promise.resolve(true); };
  C.showConfirm = () => Promise.resolve(true);
  C.showLoading = () => {};
  C.hideLoading = () => {};
  C.shopInfo = C.shopInfo || {};
  return { C, calls, alerts, store, printers: sandbox.__printers, el: (id) => document.getElementById(id) };
}


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
