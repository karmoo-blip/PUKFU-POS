// โหลด Controller ตัวจริงจาก app.js ในกล่องจำลอง ใช้ร่วมกันหลายไฟล์เทสต์
// options: { native: fake PukfuPrinter plugin (ไม่ใส่ทั้ง native และ updater = รันแบบเว็บ), updater: fake CapacitorUpdater plugin,
//            fetch: fetch ปลอม, app: window.PUKFU_APP, saved: { receipt, kitchen } ปลายทางเครื่องพิมพ์ที่เคยบันทึกไว้,
//            views: ['pos', 'settings'] หน้าที่มี element .view อยู่ในหน้าจำลอง,
//            replies: { ชื่อฟังก์ชันฝั่งเซิร์ฟเวอร์: ค่าที่ให้ตอบกลับ หรือฟังก์ชัน(args) }
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
  querySelector(sel) { this._q = this._q || {}; return this._q[sel] || (this._q[sel] = new FakeEl(this.id + ' ' + sel)); }
  appendChild() {}
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  getContext() {
    return { fillRect() {}, drawImage() {}, set fillStyle(v) {}, get fillStyle() { return ''; } };
  }
  // ต้องเคารพ mime ที่ขอมาจริง ไม่งั้นเทสต์ PNG จะผ่านทั้งที่โค้ดยังขอ JPEG อยู่
  toDataURL(mime) { return 'data:' + (mime || 'image/png') + ';base64,' + 'A'.repeat(2000); }
}

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
    querySelectorAll: (sel) => {
      if (sel === '.view') return (o.views || []).map((v) => document.getElementById('view-' + v));
      return [];
    },
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
            // o.replies: ค่าที่อยากให้เซิร์ฟเวอร์ปลอมตอบกลับต่อชื่อฟังก์ชัน
            if (o.replies && Object.prototype.hasOwnProperty.call(o.replies, fn)) {
              const reply = o.replies[fn];
              return state.ok && state.ok(typeof reply === 'function' ? reply(args) : reply);
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
    parseCostExtras: () => [],
    COST_EXTRA_PREFIX: 'extra:',
    hashPinWithSalt: async () => '',
    sha256Hex: async () => '',
    bufToHex: () => '',
    qrcode: () => ({ addData() {}, make() {}, createDataURL: () => '' }),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  if (o.native || o.updater) {
    const listeners = {};
    sandbox.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: (plugin, method, options) => {
        calls.push({ fn: plugin + '.' + method, args: [options] });
        const impl = (plugin === 'CapacitorUpdater' ? o.updater : o.native) || {};
        return impl[method] ? impl[method](options) : Promise.resolve({});
      },
      nativeCallback: (plugin, method, options, callback) => {
        if (method === 'addListener') listeners[plugin + '.' + options.eventName] = callback;
        return 'cb';
      },
      __emit: (plugin, eventName, data) => listeners[plugin + '.' + eventName] && listeners[plugin + '.' + eventName](data),
    };
  }
  if (o.fetch) sandbox.fetch = o.fetch;
  if (o.app) sandbox.PUKFU_APP = o.app;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
  vm.runInContext(code + '\nglobalThis.__Controller = Controller; globalThis.__printers = { ReceiptPrinter, KitchenPrinter, createPrinterConnection };', sandbox, { filename: 'app.js' });

  const C = sandbox.__Controller;
  const alerts = [];
  C.showAlert = (msg) => { alerts.push(String(msg)); return Promise.resolve(true); };
  C.showConfirm = () => Promise.resolve(true);
  C.showLoading = () => {};
  C.hideLoading = () => {};
  C.shopInfo = C.shopInfo || {};
  return { C, calls, alerts, store, sandbox, printers: sandbox.__printers, el: (id) => document.getElementById(id) };
}


module.exports = { loadController, FakeEl };
