// รัน Controller ตัวจริงจาก app.js ในกล่องจำลอง เพื่อคุมบั๊กที่ทำให้รูป QR ไม่เคยถูกบันทึก
// ของเดิมเขียน localStorage ก่อนยิง API พอพื้นที่ในเครื่องเต็ม setItem โยน error
// แล้วโค้ดที่ส่งรูปขึ้นเซิร์ฟเวอร์ไม่เคยได้ทำงาน
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
      toggle: () => {},
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

// options: { storageFull: bool, saveFails: bool, serverForgets: bool }
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
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => store.delete(k),
    setItem: (k, v) => {
      if (o.storageFull && k === 'pos_shopInfo' && String(v).length > 1000) {
        const err = new Error("Setting the value of 'pos_shopInfo' exceeded the quota.");
        err.name = 'QuotaExceededError';
        throw err;
      }
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
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(code + '\nglobalThis.__Controller = Controller;', sandbox, { filename: 'app.js' });

  const C = sandbox.__Controller;
  const alerts = [];
  C.showAlert = (msg) => { alerts.push(String(msg)); return Promise.resolve(true); };
  C.showConfirm = () => Promise.resolve(true);
  C.showLoading = () => {};
  C.hideLoading = () => {};
  C.shopInfo = C.shopInfo || {};
  return { C, calls, alerts, store, el: (id) => document.getElementById(id) };
}

function fakeUploadEvent() {
  return { target: { files: [{ name: 'qr.png', type: 'image/png' }], value: 'C:\\qr.png' } };
}

test('a full localStorage no longer stops the QR reaching the server', async () => {
  const { C, calls, alerts } = loadController({ storageFull: true });
  await C.handlePaymentQrUpload(fakeUploadEvent());

  const saved = calls.filter((c) => c.fn === 'saveShopInfo');
  assert.equal(saved.length, 1, 'saveShopInfo ต้องถูกเรียกถึงแม้เครื่องจะเก็บแคชไม่ได้');
  assert.ok(saved[0].args[0].paymentQrImage.startsWith('data:image/png'));
  assert.ok(alerts.some((a) => a.includes('เรียบร้อย')), 'ต้องบอกว่าสำเร็จ');
  assert.ok(!alerts.some((a) => a.includes('ไม่สำเร็จ')));
});

test('the QR is stored as PNG, not re-encoded as JPEG', async () => {
  const { C, calls } = loadController({});
  await C.handlePaymentQrUpload(fakeUploadEvent());
  const sent = calls.find((c) => c.fn === 'saveShopInfo').args[0].paymentQrImage;
  assert.ok(sent.startsWith('data:image/png;base64,'));
});

test('a failed save reports the real reason and never claims success', async () => {
  const { C, alerts } = loadController({ saveFails: true });
  await C.handlePaymentQrUpload(fakeUploadEvent());
  assert.ok(!alerts.some((a) => a.includes('เรียบร้อย')), 'ห้ามบอกว่าสำเร็จตอนที่ล้มเหลว');
  assert.ok(alerts.some((a) => a.includes('เน็ตหลุด')), 'ต้องบอกสาเหตุจริง');
});

test('success is only claimed after reading the value back from the server', async () => {
  const { C, alerts, calls } = loadController({ serverForgets: true });
  await C.handlePaymentQrUpload(fakeUploadEvent());
  assert.ok(calls.some((c) => c.fn === 'getShopInfo'), 'ต้องอ่านกลับมายืนยัน');
  assert.ok(!alerts.some((a) => a.includes('เรียบร้อย')));
});

test('an unreadable image gives advice, not a blank error', async () => {
  const { C, alerts, calls } = loadController({ badImage: true });
  await C.handlePaymentQrUpload(fakeUploadEvent());
  assert.equal(calls.filter((c) => c.fn === 'saveShopInfo').length, 0);
  assert.ok(alerts.some((a) => a.includes('JPG') || a.includes('PNG')));
  assert.ok(!alerts.some((a) => a.includes('undefined')));
});

test('cacheShopInfo keeps the small settings when the image will not fit', () => {
  const { C, store } = loadController({ storageFull: true });
  C.shopInfo = { address: 'สาขาหลัก', vatRate: 7, paymentQrImage: 'data:image/png;base64,' + 'A'.repeat(3000) };
  const ok = C.cacheShopInfo();
  assert.equal(ok, false);
  const cached = JSON.parse(store.get('pos_shopInfo'));
  assert.equal(cached.address, 'สาขาหลัก');
  assert.equal(cached.paymentQrImage, undefined);
});
