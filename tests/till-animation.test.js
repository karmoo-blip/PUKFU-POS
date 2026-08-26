// อนิเมชันฝั่งพนักงาน: คุมกฎสามข้อที่พังง่ายที่สุด
//  1) แอปถามเซิร์ฟเวอร์ทุก 8 วินาที อนิเมชันต้องเล่นเฉพาะตอนตัวเลขเพิ่มจริง
//  2) ห้ามหน่วงการใส่คลาส hidden เพราะมีโค้ดอ่านคลาสนี้เป็นสถานะจริง
//  3) ปิดบิลแล้วต้องยังปลดล็อกปุ่มและถามพิมพ์ใบเสร็จได้เหมือนเดิม
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEl {
  constructor(id, tag) {
    this.id = id; this.tag = tag || 'div';
    this.classes = new Set(); this.style = { setProperty(){}, };
    this.innerHTML = ''; this.innerText = ''; this.value = '';
    this.disabled = false; this.checked = false; this.files = [];
    this.dataset = {}; this.parentElement = null;
    this.offsetWidth = 100; this.offsetLeft = 0;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self.classes.add(x)),
      remove: (...c) => c.forEach(x => self.classes.delete(x)),
      contains: (c) => self.classes.has(c),
      toggle: (c, f) => { if (f === undefined) { self.classes.has(c) ? self.classes.delete(c) : self.classes.add(c); } else if (f) { self.classes.add(c); } else { self.classes.delete(c); } },
    };
  }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  addEventListener() {} removeEventListener() {} appendChild() {} remove() {}
  setAttribute() {} getAttribute() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  getContext() { return { fillRect(){}, drawImage(){}, set fillStyle(v){}, get fillStyle(){ return ''; } }; }
  toDataURL(m) { return 'data:' + (m || 'image/png') + ';base64,AAA'; }
  scrollIntoView() {}
}

function loadController(options) {
  const o = options || {};
  const els = new Map();
  const calls = [];
  const timers = [];
  const frames = [];

  const views = ['view-pos', 'view-summary', 'view-settings'].map(id => {
    const e = new FakeEl(id); e.classes.add('view'); els.set(id, e); return e;
  });

  const document = {
    getElementById(id) { if (!els.has(id)) els.set(id, new FakeEl(id)); return els.get(id); },
    querySelector: (sel) => document.__q[sel] || null,
    querySelectorAll: (sel) => {
      if (sel === '.view') return views;
      if (sel === '.notification-badge') return [document.getElementById('notif-badge-1')];
      if (sel === '.sum-cards') return [document.getElementById('sum-cards-1')];
      return document.__qa[sel] || [];
    },
    createElement: (t) => new FakeEl('new', t),
    addEventListener() {},
    body: new FakeEl('body'), documentElement: new FakeEl('html'),
    __q: {}, __qa: {},
  };

  const store = new Map();
  const sandbox = {
    document, console,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
    },
    google: { script: { get run() { return makeChain(); }, host: {} } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: (h) => { frames[h - 1] = null; },
    performance: { now: () => 0 },
    queueMicrotask,
    FileReader: class { readAsDataURL() { this.onload({ target: { result: 'data:image/png;base64,AAA' } }); } },
    Image: class { constructor(){ this.width = 800; this.height = 800; } set src(v){ queueMicrotask(() => this.onload()); } },
    fetch: () => Promise.reject(new Error('no network')),
    URLSearchParams, crypto: require('node:crypto').webcrypto,
    navigator: { onLine: true, userAgent: 'node' },
    location: { search: '', pathname: '/', origin: 'http://x', href: 'http://x/' },
    escAttr: (v) => String(v), escHtml: (v) => String(v),
    calcVatBreakdown: () => ({ exVat: 0, vatAmount: 0, rate: 0 }),
    unitCost: () => null, recipeCost: () => ({ total: null, lines: [], missingPrice: [] }),
    hashPinWithSalt: async () => '', sha256Hex: async () => '', bufToHex: () => '',
    qrcode: () => ({ addData(){}, make(){}, createDataURL: () => '' }),
  };
  function makeChain() {
    const state = { ok: null, fail: null };
    const chain = new Proxy({}, { get(_t, name) {
      if (name === 'withSuccessHandler') return (cb) => { state.ok = cb; return chain; };
      if (name === 'withFailureHandler') return (cb) => { state.fail = cb; return chain; };
      if (name === 'withUserObject') return () => chain;
      return (...args) => {
        const fn = String(name);
        calls.push({ fn, args, ok: state.ok });
        if (fn === 'getPendingOrders' && o.pending) queueMicrotask(() => state.ok && state.ok(o.pending()));
        else if (fn === 'toggleSoldOut') queueMicrotask(() => state.ok && state.ok({ success: true }));
      };
    }});
    return chain;
  }
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.matchMedia = () => ({ matches: !!o.reducedMotion, addEventListener() {} });
  sandbox.innerWidth = 1400;
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(code + '\nglobalThis.__Controller = Controller;', sandbox, { filename: 'app.js' });

  const C = sandbox.__Controller;
  C.showAlert = () => Promise.resolve(true);
  C.showConfirm = () => Promise.resolve(false);
  C.showLoading = () => {}; C.hideLoading = () => {};
  return { C, document, calls, timers, frames, el: (id) => document.getElementById(id), views };
}

// เดินอนิเมชันตัวนับให้จบในทีเดียว
function runFrames(frames) {
  for (let i = 0; i < frames.length; i++) { const f = frames[i]; if (f) f(1e6); }
}

test('the pending-order badge pulses on a rise, and stays still on a repeat check', () => {
  let count = 1;
  const { C, el } = loadController({ pending: () => Array.from({ length: count }, (_, i) => ({ id: 'p' + i, status: 'pending', customerName: 'A' })) });
  const badge = el('pending-order-badge');
  badge.parentElement = el('pending-btn');

  C.checkPendingOrders();
  return new Promise(r => queueMicrotask(r)).then(() => {
    assert.ok(badge.classList.contains('badge-alert'), 'ออเดอร์แรกต้องทำให้ตัวเลขเด้ง');
    badge.classList.remove('badge-alert');

    C.checkPendingOrders();               // เลขเท่าเดิม
    return new Promise(r => queueMicrotask(r)).then(() => {
      assert.ok(!badge.classList.contains('badge-alert'), 'เช็คซ้ำเลขเท่าเดิมต้องเงียบ');
      count = 3;
      C.checkPendingOrders();
      return new Promise(r => queueMicrotask(r)).then(() => {
        assert.ok(badge.classList.contains('badge-alert'), 'เลขเพิ่มต้องเด้งอีกครั้ง');
        assert.equal(badge.innerText, 3);
      });
    });
  });
});

test('switchView hides the other views immediately, with no delay', () => {
  const { C, el, views } = loadController({});
  C.switchView('settings');
  // ต้องเป็นจริงทันทีในบรรทัดถัดไป ไม่ใช่หลังอนิเมชันจบ
  assert.ok(el('view-pos').classList.contains('hidden'));
  assert.ok(!el('view-settings').classList.contains('hidden'));
  assert.ok(el('view-settings').classList.contains('view-entering'));
  assert.equal(views.filter(v => !v.classList.contains('hidden')).length, 1);
});

test('countTo lands exactly on the target and a second call cancels the first', () => {
  const { C, frames } = loadController({});
  const el = new FakeEl('x');
  C.countTo(el, 0, 250, 500, { money: true });
  C.countTo(el, 0, 999, 500, { money: true });   // ทับของเดิม
  runFrames(frames);
  assert.equal(el.innerText, '฿999.00', 'ได้ ' + el.innerText);
});

test('countTo writes the value straight out under reduced motion', () => {
  const { C } = loadController({ reducedMotion: true });
  const el = new FakeEl('x');
  C.countTo(el, 0, 120, 500, {});
  assert.equal(el.innerText, '120');
});

test('closing a bill shows the queue number and still frees the confirm button', async () => {
  const { C, el, timers } = loadController({});
  C.cart = [{ sku: 'A', name: 'ลาเต้', price: 55, qty: 2, note: '' }];
  C.paymentMethods = [{ id: 'cash', isCash: true, name: 'เงินสด' }];
  C.currentPaymentMethodId = 'cash';
  C.queueNumber = 7;
  C.syncQueue = [];
  C.receiptSettings = { autoPrint: false };
  C.processSyncQueue = () => {};
  C.saveLocalState = () => {}; C.updateSyncQueueBadge = () => {};
  C.renderHistory = () => {}; C.updateCupUI = () => {}; C.printReceipt = () => {};

  await C.finalizeOrder('INV-TEST-1');

  const chip = el('cart-queue-chip');
  assert.ok(!chip.classList.contains('hidden'), 'ป้ายเลขคิวต้องโผล่');
  assert.ok(chip.innerText.includes('PK07'), 'ได้ ' + chip.innerText);
  assert.equal(C.cart.length, 0, 'ตะกร้าต้องว่างทันที กันกดยืนยันซ้ำ');
  assert.equal(el('btn-submit-order').disabled, false, 'ปุ่มต้องกลับมากดได้');
  assert.ok(el('modal-checkout').classList.contains('hidden'), 'หน้าต่างชำระเงินต้องปิดทันที');
  assert.ok(timers.length > 0, 'ต้องหน่วงการวาดตะกร้าใหม่ไว้ให้แถวกวาดออกทัน');
});

test('marking one item sold out does not replay the whole grid entrance', () => {
  const { C, el } = loadController({});
  C.isStockMode = true;
  C.menuData = [{ sku: 'A', name: 'ลาเต้', price: 55, category: 'กาแฟ' }];
  C.soldOutItems = [];
  C.activeCategory = 'All';
  C.setIndicator = () => {};
  const grid = el('menu-grid');

  C.renderMenu();
  assert.ok(grid.classList.contains('is-entering'), 'วาดปกติต้องมีอนิเมชัน');

  C.selectProduct(0);
  return new Promise(r => queueMicrotask(r)).then(() => {
    assert.ok(!grid.classList.contains('is-entering'), 'กดสินค้าหมดต้องไม่ทำให้การ์ดทั้งกระดานไล่กันขึ้นมาใหม่');
  });
});
