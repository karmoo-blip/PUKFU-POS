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
    this.classes = new Set(); this.styleProps = {};
    const props = this.styleProps;
    this.style = { setProperty(k, v) { props[k] = v; } };
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
  vm.runInContext(code + '\nglobalThis.__Controller = Controller; globalThis.__ReceiptPrinter = ReceiptPrinter;', sandbox, { filename: 'app.js' });

  const C = sandbox.__Controller;
  C.showAlert = () => Promise.resolve(true);
  C.showConfirm = () => Promise.resolve(false);
  C.showLoading = () => {}; C.hideLoading = () => {};
  return { C, document, calls, timers, frames, el: (id) => document.getElementById(id), views, localStorage: sandbox.localStorage, ReceiptPrinter: sandbox.__ReceiptPrinter, FakeEl };
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

test('closing the payment sheet with an exit animation still hides it in the same tick', () => {
  const { C, el } = loadController({});
  const modal = el('modal-checkout');

  C.closeModal('modal-checkout', { animated: true });

  assert.ok(modal.classList.contains('hidden'), 'คลาส hidden ต้องใส่ทันที ห้ามรอให้อนิเมชันจบ');
  assert.ok(modal.classList.contains('modal-closing'), 'ต้องมีคลาสที่ฝืนให้ยังวาดอยู่ระหว่างเล่นจังหวะออก');
});

test('reopening the payment sheet clears a half-played exit', () => {
  const { C, el } = loadController({});
  const modal = el('modal-checkout');

  C.closeModal('modal-checkout', { animated: true });
  C.openModal('modal-checkout');

  assert.ok(!modal.classList.contains('modal-closing'), 'เปิดใหม่ต้องล้างจังหวะปิดที่ค้างอยู่ ไม่งั้นหน้าต่างจางค้างกดไม่ได้');
  assert.ok(!modal.classList.contains('hidden'), 'เปิดใหม่ต้องเห็นหน้าต่างจริงๆ');
});

test('a reduced-motion machine closes the payment sheet with no exit animation at all', () => {
  const { C, el } = loadController({ reducedMotion: true });
  const modal = el('modal-checkout');

  C.closeModal('modal-checkout', { animated: true });

  assert.ok(modal.classList.contains('hidden'), 'ยังต้องปิด');
  assert.ok(!modal.classList.contains('modal-closing'), 'เครื่องที่ลดการเคลื่อนไหวต้องหายไปเลย ไม่ต้องฝืนวาดต่อ');
});

test('the paid overlay carries the queue number, and stays away under reduced motion', () => {
  const full = loadController({});
  full.C.playPaidOverlay(110, 'PK07');
  assert.ok(full.el('paid-overlay').classList.contains('is-on'), 'แผ่นฉลองต้องโผล่');
  assert.ok(full.el('paid-overlay-queue').innerText.includes('PK07'), 'ได้ ' + full.el('paid-overlay-queue').innerText);
  assert.ok(full.el('paid-overlay-total').innerText.includes('110.00'), 'ได้ ' + full.el('paid-overlay-total').innerText);

  const reduced = loadController({ reducedMotion: true });
  reduced.C.playPaidOverlay(110, 'PK07');
  assert.ok(!reduced.el('paid-overlay').classList.contains('is-on'), 'เครื่องที่ลดการเคลื่อนไหวต้องไม่เห็นแผ่นนี้');
});

test('the cash keypad writes the exact figures first, and only then animates', () => {
  const { C, el, frames } = loadController({});
  C.cart = [{ sku: 'A', name: 'ลาเต้', price: 55, qty: 2, note: '' }];
  C.checkoutDiscount = 0;

  C.cashInput = '200';
  C.updateCashUI();

  assert.equal(el('cash-received').innerText, 200, 'ยอดที่รับมาต้องตรงและขึ้นทันที');
  assert.ok(el('cash-received').classList.contains('cash-digit-pop'), 'ต้องเด้งย้ำว่ากดติด');
  runFrames(frames);
  assert.equal(el('cash-change').innerText, '90', 'เงินทอนต้องนับไปจบที่ค่าจริง ได้ ' + el('cash-change').innerText);
  assert.equal(el('btn-submit-order').disabled, false, 'จ่ายพอแล้วปุ่มต้องกดได้');
});

// ---- หน้าประวัติบิล ----
// แอปดึงข้อมูลซ้ำเป็นระยะและได้คำตอบเดิมเป็นส่วนใหญ่ กฎเดียวกับหน้าขาย: วาดใหม่เฉพาะตอนข้อมูลเปลี่ยนจริง
function billsController(bills) {
  const ctx = loadController({});
  const { C } = ctx;
  C.history = bills;
  C.syncQueue = [];
  C.historyViewData = null;
  return ctx;
}

const BILL_A = { invoice: 'INV-A', timestamp: '2026-08-27T10:00:00Z', total: 185, paymentType: 'เงินสด', items: [], status: 'active' };
const BILL_B = { invoice: 'INV-B', timestamp: '2026-08-27T10:05:00Z', total: 60, paymentType: 'พร้อมเพย์', items: [], status: 'active' };

test('the bill list is left alone when a repeat check brings back the same bills', () => {
  const { C, el } = billsController([{ ...BILL_A }]);
  C.renderHistory();

  const list = el('history-list');
  list.innerHTML = 'ของเดิมที่กางอยู่';
  C.renderHistory();

  assert.equal(list.innerHTML, 'ของเดิมที่กางอยู่', 'ข้อมูลเท่าเดิมต้องไม่วาดทับ ไม่งั้นบิลที่กางค้างไว้จะถูกพับกลับเอง');
});

test('only a bill that was not there before is marked as new', () => {
  const { C, el } = billsController([{ ...BILL_A }]);
  C.renderHistory();
  const list = el('history-list');

  const rowA = new FakeEl('row-a'); rowA.dataset.invoice = 'INV-A';
  const rowB = new FakeEl('row-b'); rowB.dataset.invoice = 'INV-B';
  rowA.querySelector = () => null;
  rowB.querySelector = () => null;
  list.children = [rowA, rowB];

  C.history = [{ ...BILL_A }, { ...BILL_B }];
  C.renderHistory();

  assert.ok(rowB.classList.contains('is-fresh'), 'บิลที่เพิ่งเข้ามาต้องถูกทำเครื่องหมาย');
  assert.ok(!rowA.classList.contains('is-fresh'), 'บิลเก่าต้องไม่ถูกนับเป็นของใหม่');
});

test('the first draw after opening the app marks nothing as new', () => {
  const { C, el } = billsController([{ ...BILL_A }, { ...BILL_B }]);
  const list = el('history-list');
  const rowA = new FakeEl('row-a'); rowA.dataset.invoice = 'INV-A'; rowA.querySelector = () => null;
  const rowB = new FakeEl('row-b'); rowB.dataset.invoice = 'INV-B'; rowB.querySelector = () => null;
  list.children = [rowA, rowB];

  C.renderHistory();

  assert.ok(!rowA.classList.contains('is-fresh') && !rowB.classList.contains('is-fresh'), 'เปิดแท็บครั้งแรกต้องไม่วาบทั้งกระดาน');
});

test('cancelling a bill flashes that row, not the whole list', () => {
  const { C, el } = billsController([{ ...BILL_A }, { ...BILL_B }]);
  C.renderHistory();
  const list = el('history-list');
  const rowA = new FakeEl('row-a'); rowA.dataset.invoice = 'INV-A'; rowA.querySelector = () => null;
  const rowB = new FakeEl('row-b'); rowB.dataset.invoice = 'INV-B'; rowB.querySelector = () => null;
  list.children = [rowA, rowB];

  C.history = [{ ...BILL_A, status: 'cancelled', cancelReason: 'ลูกค้าเปลี่ยนใจ' }, { ...BILL_B }];
  C.renderHistory();

  assert.ok(rowA.classList.contains('is-hit-cancel'), 'ใบที่เพิ่งยกเลิกต้องวาบ');
  assert.ok(!rowB.classList.contains('is-hit-cancel'), 'ใบอื่นต้องอยู่เฉยๆ');
});

test('looking at an older day clears the list first, so no stale figures are read as that day', () => {
  const { C, el } = billsController([{ ...BILL_A }]);
  C.renderHistory();
  const list = el('history-list');

  C.renderHistorySkeleton();

  assert.ok(!list.innerHTML.includes('INV-A'), 'บิลของวันนี้ต้องหายไปทันที');
  assert.ok(list.innerHTML.includes('history-skel-bar'), 'ต้องขึ้นโครงร่างเทารอ');
  assert.equal(C._historyHtml, null, 'ต้องล้างลายเซ็นไว้ ไม่งั้นข้อมูลที่โหลดมาอาจไม่ถูกวาดทับโครงร่าง');
});

test('a reduced-motion machine still gets the bills, just without the entrance', () => {
  const { C, el } = loadController({ reducedMotion: true });
  C.history = [{ ...BILL_A }];
  C.syncQueue = [];
  C.historyViewData = null;
  C.renderHistory();

  const list = el('history-list');
  assert.ok(list.innerHTML.includes('INV-A'), 'ต้องเห็นบิลครบ');
  assert.ok(!list.classList.contains('is-entering'), 'เครื่องที่ลดการเคลื่อนไหวต้องไม่เล่นจังหวะโผล่');
});

// ---- กระดิ่ง: รวมสี่ทางไว้ที่เดียว ----
function bellController(opts) {
  const o = opts || {};
  const ctx = loadController(o.harness || {});
  const { C } = ctx;
  C.notifications = o.notifications || [];
  C.pendingOrders = o.pendingOrders || [];
  C.syncQueue = o.syncQueue || [];
  C._updateAvailable = !!o.updateAvailable;
  C.dismissedNotificationIds = new Set();
  return ctx;
}

const HOUR = 3600 * 1000;
const EXPIRED_ITEM = { id: 'n1', item_name: 'นมสด', expires_at: new Date(Date.now() - HOUR).toISOString() };
const SOON_ITEM = { id: 'n2', item_name: 'วิปครีม', expires_at: new Date(Date.now() + HOUR).toISOString() };

test('the bell counts every source that needs attention, in one number', () => {
  const { C, el } = bellController({
    notifications: [EXPIRED_ITEM, SOON_ITEM],
    pendingOrders: [{ id: 'o1', status: 'pending', customerName: 'เบส' }, { id: 'o2', status: 'confirmed', customerName: 'ฝน' }],
    syncQueue: [{ invoice: 'INV-1' }],
    updateAvailable: true,
  });

  C.updateBellBadge();

  // หมดอายุ 1 + ใกล้หมดอายุ 1 + ออเดอร์ที่ยังไม่ยืนยัน 1 + บิลค้าง 1 + เวอร์ชันใหม่ 1
  assert.equal(C.bellCounts().total, 5, 'ได้ ' + C.bellCounts().total);
  assert.equal(el('bell-badge').innerText, 5);
  assert.ok(!el('bell-badge').classList.contains('hidden'), 'มีของค้างต้องเห็นตัวเลข');
});

test('an order already confirmed is not something to go and do', () => {
  const { C } = bellController({ pendingOrders: [{ id: 'o1', status: 'confirmed', customerName: 'ฝน' }] });
  assert.equal(C.bellCounts().total, 0, 'ออเดอร์ที่รับแล้วไม่ควรนับ ไม่งั้นตัวเลขค้างเตือนทั้งที่ไม่มีอะไรต้องทำ');
});

test('the bell badge hides at zero and pulses only when the number rises', () => {
  const { C, el } = bellController({ syncQueue: [{ invoice: 'INV-1' }] });
  const badge = el('bell-badge');

  C.updateBellBadge();
  assert.ok(badge.classList.contains('badge-alert'), 'ขึ้นจาก 0 เป็น 1 ต้องเด้ง');

  badge.classList.remove('badge-alert');
  C.updateBellBadge();
  assert.ok(!badge.classList.contains('badge-alert'), 'เลขเท่าเดิมต้องไม่เด้งซ้ำ ฟังก์ชันนี้ถูกเรียกทุกไม่กี่วินาที');

  C.syncQueue = [];
  C.updateBellBadge();
  assert.ok(badge.classList.contains('hidden'), 'ไม่มีอะไรค้างต้องซ่อนตัวเลข');
});

test('the bell window lists a group per source, and says so when there is nothing', () => {
  const empty = bellController({});
  empty.C.renderBellList();
  assert.ok(empty.el('bell-list').innerHTML.includes('ไม่มีอะไรต้องจัดการ'));

  const { C, el } = bellController({
    notifications: [EXPIRED_ITEM],
    pendingOrders: [{ id: 'o1', status: 'pending', customerName: 'เบส', items: [{ qty: 2 }] }],
    syncQueue: [{ invoice: 'INV-1' }],
    updateAvailable: true,
  });
  C.renderBellList();
  const html = el('bell-list').innerHTML;

  assert.ok(html.includes('ออเดอร์ออนไลน์') && html.includes('เบส'), 'ต้องมีกลุ่มออเดอร์ออนไลน์');
  assert.ok(html.includes('ของหมดอายุ') && html.includes('นมสด'), 'ต้องมีกลุ่มของหมดอายุ');
  assert.ok(html.includes('เวอร์ชันใหม่') && html.includes('ข้อมูลค้างซิงก์ 1 รายการ'), 'ต้องมีกลุ่มระบบ');
});

test('a reduced-motion machine still gets the right number, without the pulse', () => {
  const { C, el } = bellController({ harness: { reducedMotion: true }, syncQueue: [{ invoice: 'INV-1' }] });
  C.updateBellBadge();
  assert.equal(el('bell-badge').innerText, 1);
  assert.ok(!el('bell-badge').classList.contains('badge-alert'), 'เครื่องที่ลดการเคลื่อนไหวต้องไม่เด้ง');
});

// ---- หน้ายอดขาย (รวม Summary + Report) ----
test('the drawer only shows for today, and the daily chart only for a range', () => {
  const { C, el } = loadController({});
  C.fetchSummary = () => {};
  C.setReportPreset = () => {};

  C.setSalesPeriod('today');
  assert.ok(!el('sales-drawer-sec').classList.contains('hidden'), 'เงินในลิ้นชักต้องขึ้นตอนดูวันนี้');
  assert.ok(el('sales-daily-sec').classList.contains('hidden'), 'วันเดียวไม่มีกราฟรายวันให้ดู');
  assert.ok(el('sales-weekday-sec').classList.contains('hidden'), 'วันเดียวไม่มีค่าเฉลี่ยรายวันในสัปดาห์');

  C.setSalesPeriod('7d');
  assert.ok(el('sales-drawer-sec').classList.contains('hidden'), 'เงินในลิ้นชักไม่มีความหมายเมื่อดูย้อนหลัง');
  assert.ok(!el('sales-daily-sec').classList.contains('hidden'), 'ช่วงหลายวันต้องมีกราฟรายวัน');
});

test('an employee whose saved permission still says summary can open the sales tab', () => {
  const { C } = loadController({});
  const allowed = C.getAllowedTabs({ role: 'Staff', permissions: 'history,summary' });
  assert.ok(allowed.includes('sales'), 'สิทธิ์เก่าที่บันทึกไว้ในชีตต้องยังเข้าหน้ายอดขายได้ ได้ ' + allowed.join(','));
  assert.ok(!C.getAllowedTabs({ role: 'Staff', permissions: 'history' }).includes('sales'), 'คนที่ไม่เคยมีสิทธิ์ต้องยังเข้าไม่ได้');
});

test('every settings page can be granted to an employee', () => {
  const { C, el } = loadController({});
  const allTabs = C.getAllowedTabs({ role: 'Owner' });

  C.renderEmployeePermissionGrid(['sales', 'printer']);
  const html = el('emp-perm-groups').innerHTML;

  const offered = (html.match(/class="emp-perm-checkbox" value="([a-z]+)"/g) || [])
    .map(m => m.replace(/.*value="/, '').replace('"', ''));
  const missing = allTabs.filter(t => !offered.includes(t));
  assert.strictEqual(missing.join(','), '', 'ทุกหน้าที่เข้าได้ต้องติ๊กให้สิทธิ์ได้ ขาด ' + missing.join(','));
  assert.strictEqual(offered.length, allTabs.length, 'ห้ามมีช่องติ๊กที่ไม่ตรงกับหน้าไหนเลย');
  C.SETTINGS_GROUPS.forEach(g => assert.ok(html.includes(g.title), 'ต้องจัดกลุ่มตามเมนูซ้าย ขาดกลุ่ม ' + g.title));
  assert.strictEqual((html.match(/ checked/g) || []).length, 2, 'ต้องติ๊กมาให้ตรงกับสิทธิ์เดิมเท่านั้น');
});

test('table QRs are kept as a list, and the single one saved by the old build survives', () => {
  const { C, el, localStorage } = loadController({});
  localStorage.setItem('pos_lastTableQrLoc', 'โต๊ะ 1');

  assert.strictEqual(C.tableQrList().length, 1, 'QR ที่แปะไว้ที่โต๊ะแล้วต้องไม่หายตอนอัปเดต');

  C.saveTableQrList([{ loc: 'โต๊ะ 1', createdAt: '2026-08-20T03:00:00.000Z' }, { loc: 'กลับบ้าน', createdAt: '' }]);
  assert.strictEqual(localStorage.getItem('pos_lastTableQrLoc'), null, 'ย้ายเข้ารายการแล้วต้องไม่อ่านของเก่าซ้ำ');
  assert.strictEqual(C.tableQrList().length, 2, 'เก็บได้หลายโต๊ะพร้อมกัน');

  C.onlineOrderHistory = [{ location: 'โต๊ะ 1' }, { location: 'โต๊ะ 1' }, { location: 'กลับบ้าน' }];
  C.renderTableQrList();
  const html = el('table-qr-list').innerHTML;
  assert.ok(html.includes('โต๊ะ 1') && html.includes('กลับบ้าน'), 'ต้องเห็นทุกโต๊ะที่สร้างไว้');
  assert.ok(html.includes('2 ออเดอร์ใน 3 รายการล่าสุด'), 'ต้องบอกว่านับจากประวัติกี่รายการ ไม่ใช่ยอดสะสม');
});

test('the receipt preview is built from the same document that gets printed', async () => {
  const { C, ReceiptPrinter } = loadController({});
  const order = C.sampleReceiptOrder();
  const base = { paperSize: '80mm', header: 'PUKFU COFFEE', address: '123 ถนนสุขุมวิท', phone: '081-234-5678' };

  const shown = await ReceiptPrinter.buildReceiptDoc(order, 'Q07', base);
  const texts = doc => doc.ops.filter(op => op.t === 'text').map(op => op.str).join('|');
  assert.ok(texts(shown).includes('PUKFU COFFEE'), 'ชื่อร้านต้องอยู่บนใบ');
  assert.ok(texts(shown).includes('Q07'), 'ติ๊กแสดงเลขคิวแล้วต้องเห็นเลขคิว');

  const hidden = await ReceiptPrinter.buildReceiptDoc(order, '', { ...base, showAddress: false, showPhone: false });
  assert.ok(!texts(hidden).includes('123 ถนนสุขุมวิท'), 'ติ๊กที่อยู่ออกแล้วตัวอย่างต้องหายตาม');
  assert.ok(!texts(hidden).includes('Tel: 081-234-5678'), 'ติ๊กเบอร์โทรออกแล้วตัวอย่างต้องหายตาม');
  assert.ok(texts(hidden).includes('PUKFU COFFEE'), 'ช่องที่ไม่ได้ติ๊กออกต้องยังอยู่');
});

test('the lock screen draws the glass from the PIN buffer alone', () => {
  const { C, el, document, FakeEl } = loadController({});
  document.__qa['#pin-ticks i'] = Array.from({ length: 6 }, (_, i) => new FakeEl('tick' + i));
  document.__qa['#pin-count span'] = Array.from({ length: 6 }, (_, i) => new FakeEl('dot' + i));

  C.pinBuffer = '48';
  C.pinRevealIndex = 1;
  C.updatePinSlots({ popIndex: 1 });

  assert.strictEqual(el('pin-fill').style.height, '33.33%', 'สองในหกหลัก กาแฟต้องขึ้นหนึ่งในสาม');
  const ticks = document.__qa['#pin-ticks i'].map(t => t.classList.contains('is-on'));
  assert.strictEqual(ticks.join(','), 'true,true,false,false,false,false', 'ขีดต้องติดเท่าจำนวนหลักที่กรอก');
  const dots = document.__qa['#pin-count span'].map(d => d.textContent);
  assert.strictEqual(dots[0], '●', 'หลักที่กรอกไปแล้วต้องเป็นจุดทึบ');
  assert.strictEqual(dots[1], '8', 'หลักที่เพิ่งกดโชว์ตัวเลขแวบหนึ่ง');
  assert.strictEqual(dots[2], '○', 'หลักที่ยังไม่กรอกต้องเป็นจุดโปร่ง');

  C.pinBuffer = '';
  C.pinRevealIndex = -1;
  C.updatePinSlots();
  assert.strictEqual(el('pin-fill').style.height, '0.00%', 'ล้างแล้วแก้วต้องว่าง');
  assert.ok(!document.__qa['#pin-ticks i'][0].classList.contains('is-on'), 'ล้างแล้วขีดต้องดับ');
});

test('unlocking hides the lock screen at once, animation or not', () => {
  const { C, el } = loadController({});
  el('pin-lock-screen').classList.remove('hidden');
  C.playPinUnlock({ name: 'เบส' });

  assert.ok(el('pin-lock-screen').classList.contains('hidden'), 'ต้องใส่ hidden ทันที มีโค้ดอื่นอ่านคลาสนี้เป็นสถานะว่าล็อกอยู่ไหม');
  assert.ok(el('pin-lock-screen').classList.contains('is-unlocking'), 'ต้องเล่นอนิเมชันตอนเข้าได้');
  assert.ok(el('pin-hello').innerHTML.includes('เบส'), 'ต้องทักชื่อคนที่เข้ามา');

  const { C: C2, el: el2 } = loadController({ reducedMotion: true });
  el2('pin-lock-screen').classList.remove('hidden');
  C2.playPinUnlock({ name: 'เบส' });
  assert.ok(el2('pin-lock-screen').classList.contains('hidden'), 'เครื่องที่ปิดอนิเมชันก็ต้องปิดหน้าล็อก');
  assert.ok(!el2('pin-lock-screen').classList.contains('is-unlocking'), 'เครื่องที่ปิดอนิเมชันต้องเข้าตรงๆ ไม่ต้องรอ');
});

test('the redesigned menu and cart keep the hooks the rest of the app reads', () => {
  const { C, el } = loadController({});
  C.menuData = [
    { name: 'ลาเต้', lang2: 'Latte', price: 55, category: 'กาแฟ' },
    { name: 'ชาไทย', lang2: 'Thai Tea', price: 45, category: 'ชา' },
  ];
  C.soldOutItems = ['ชาไทย'];
  C.activeCategory = 'All';
  C.renderMenu();
  const menu = el('menu-grid').innerHTML;

  assert.ok(menu.includes('data-menu-idx="0"') && menu.includes('data-menu-idx="1"'), 'ทุกใบต้องมี data-menu-idx ไว้ให้ของบินเข้าตะกร้าหาเจอ');
  assert.ok(menu.includes('--i:0') && menu.includes('--i:1'), 'ต้องคงลำดับหน่วงอนิเมชันไว้');
  assert.ok(menu.includes('Controller.selectProduct(0)'), 'กดการ์ดต้องเปิดหน้าต่างเลือกความหวานเหมือนเดิม');
  assert.ok(menu.includes('หมด'), 'สินค้าหมดต้องเห็นว่าหมด');
  assert.ok(menu.includes('pos-add'), 'ของที่ยังมีต้องมีปุ่มเพิ่ม');

  C.cart = [{ name: 'ลาเต้', price: 55, qty: 2, note: 'หวานน้อย' }];
  C.heldOrders = [];
  C.renderCart({ newIdx: 0, popIdx: 0 });
  const cart = el('cart-items').innerHTML;

  assert.ok(cart.includes('data-cart-idx="0"'), 'แถวตะกร้าต้องมี data-cart-idx ไว้ให้อนิเมชันปิดบิลกวาดทีละแถว');
  assert.ok(cart.includes('cart-line-in'), 'แถวที่เพิ่งเพิ่มต้องเล่นอนิเมชันเข้า');
  assert.ok(cart.includes('cart-qty-pop'), 'จำนวนที่เพิ่งเปลี่ยนต้องเด้ง');
  assert.ok(cart.includes('Controller.updateQty(0, -1)') && cart.includes('Controller.updateQty(0, 1)'), 'ปุ่มเพิ่ม/ลดต้องยังอยู่');
  assert.strictEqual(el('cart-total').innerText, '฿110.00', 'ยอดรวมต้องถูก');
  assert.strictEqual(el('cart-cups').innerText, '2 แก้ว', 'ต้องบอกจำนวนแก้วท้ายตะกร้า');
  assert.ok(el('cart-badge-mobile').classList.contains('is-on'), 'ป้ายจำนวนบนมือถือต้องขึ้น');
});

test('an empty report renders empty states instead of throwing', () => {
  const { C, el } = loadController({});
  C.renderReport({ total: 0, totalProfit: 0, totalCost: 0, billCount: 0, cupCount: 0, avgPerBill: 0, wasteCost: 0, refundedTotal: 0, cash: 0, other: 0, byType: {}, topSellers: [], byWeekday: [], byHour: [], daily: [] });

  assert.ok(el('sales-paybar').innerHTML.includes('ไม่มีข้อมูล'));
  assert.ok(el('sales-hours').innerHTML.includes('ไม่มีข้อมูล'));
  assert.ok(el('sales-daily').innerHTML.includes('ไม่มีข้อมูล'));
  assert.equal(el('sales-margin').innerText, '-', 'ยังไม่มียอดขายก็คิดอัตรากำไรไม่ได้');
});

test('the report paints the figures, the peak hours and the margin caveat', () => {
  const { C, el, frames } = loadController({});
  C.renderReport({
    total: 4820, totalProfit: 2610, totalCost: 2210, billCount: 63, cupCount: 78, avgPerBill: 76.5,
    wasteCost: 180, refundedTotal: 120, cash: 2120, other: 2700,
    byType: { 'เงินสด': 2120, 'พร้อมเพย์': 2300 },
    topSellers: [
      { name: 'ลาเต้', qty: 26, amount: 1430, hasCost: true, marginPct: 58 },
      { name: 'โกโก้', qty: 6, amount: 530, hasCost: false, marginPct: 0 }
    ],
    byWeekday: [{ label: 'จันทร์', avgPerDay: 3180 }],
    byHour: [{ hour: 11, bills: 20, label: '11' }, { hour: 12, bills: 25, label: '12' }, { hour: 20, bills: 2, label: '20' }],
    daily: [{ date: '2026-08-26', total: 4180 }, { date: '2026-08-27', total: 4820 }]
  });
  runFrames(frames);

  assert.equal(el('sales-bills').innerText, '63');
  assert.equal(el('sales-margin').innerText, '54%');
  assert.ok(el('sales-hours').innerHTML.includes('พีค'), 'ชั่วโมงพีคต้องมีข้อความกำกับ ไม่ใช่บอกด้วยสีอย่างเดียว');
  assert.ok(el('sales-hours').innerHTML.includes('#d97706'), 'และทำสีต่างด้วย');
  assert.ok(!el('sales-cost-note').classList.contains('hidden'), 'มีเมนูที่ยังไม่ระบุต้นทุน ต้องบอกว่ากำไรเป็นค่าประมาณ');
  assert.ok(!el('sales-waste-wrap').classList.contains('hidden'), 'มีของเสียต้องโชว์');
  assert.ok(el('sales-paylegend').innerHTML.includes('เงินสด'), 'ทุกก้อนในแถบต้องมีป้ายกำกับ');
});

// ---- เมนูตั้งค่าแบบจัดกลุ่ม ----
function settingsController(user) {
  const ctx = loadController({});
  const { C, document: d } = ctx;
  C.currentSettingsUser = user || { id: 'u1', name: 'บอส', role: 'Owner', active: true };
  C.loggedInEmployee = C.currentSettingsUser;
  C.bellCounts = () => ({ expired: [], soon: [], waitingOrders: [], unsynced: 0, update: 0, total: 0 });
  d.__q['#user-menu-wrap button'] = new FakeEl('umb');
  return ctx;
}

test('the settings menu only lists what the staff member may open', () => {
  const { C, el } = settingsController({ id: 'u2', name: 'เบส', role: 'Staff', permissions: 'history,inventory' });
  C.renderSettingsNav();
  const html = el('settings-nav').innerHTML;

  assert.ok(html.includes('ประวัติบิล') && html.includes('วัตถุดิบ'), 'ต้องเห็นสองหน้าที่มีสิทธิ์');
  assert.ok(!html.includes('พนักงาน') && !html.includes('สำรองข้อมูล'), 'หน้าที่ไม่มีสิทธิ์ต้องไม่โผล่');
  assert.ok(!html.includes('คนและระบบ'), 'กลุ่มที่ไม่เหลือรายการเลยต้องหายทั้งกลุ่ม ไม่ใช่เหลือหัวข้อว่าง');
});

test('picking a page swaps the phone view, and back returns to the list', () => {
  const { C, el } = settingsController();
  C.renderHistory = () => {};

  C.switchSettingsTab('history');
  assert.ok(el('settings-shell').classList.contains('is-page'), 'เลือกหัวข้อแล้วต้องสลับไปหน้าย่อย');
  assert.ok(!el('settings-back').classList.contains('hidden'), 'ต้องมีปุ่มย้อนกลับให้กด');
  assert.equal(el('settings-title').innerText, 'ประวัติบิล', 'หัวหน้าต้องบอกว่าอยู่หน้าไหน');

  C.backToSettingsHome();
  assert.ok(el('settings-shell').classList.contains('is-home'), 'กดย้อนกลับต้องกลับไปหน้ารายการ');
  assert.ok(el('settings-back').classList.contains('hidden'), 'หน้ารายการไม่ต้องมีปุ่มย้อนกลับ');
});

test('the open page is marked in the menu', () => {
  const { C, el } = settingsController();
  C.renderHistory = () => {};
  C.switchSettingsTab('history');
  const html = el('settings-nav').innerHTML;
  const activeChunk = html.slice(html.indexOf('data-tab="history"'), html.indexOf('data-tab="history"') + 160);
  assert.ok(activeChunk.includes('is-on'), 'หน้าที่เปิดอยู่ต้องถูกไฮไลต์ในเมนู');
});

// ---- หน้ากลุ่มขายหน้าร้าน ----
test('the product list shows stock state and the buttons to change it', () => {
  const { C, el } = loadController({});
  C.menuData = [
    { sku: 'A', name: 'ลาเต้', price: 55, category: 'กาแฟ', cost: 23 },
    { sku: 'C', name: 'ชาเขียว', price: 75, category: 'ชา' }
  ];
  C.soldOutItems = ['ชาเขียว'];
  C.productSearchQuery = '';

  C.renderProductList();
  const html = el('product-list').innerHTML;

  assert.ok(html.includes('มีของ') && html.includes('หมด'), 'ต้องบอกสถานะทั้งสองแบบ');
  assert.ok(html.includes('ทำหมด') && html.includes('มีของแล้ว'), 'ต้องกดสลับได้จากแถวเลย ไม่ต้องเข้าโหมดก่อน');
  assert.ok(html.includes('ยังไม่ระบุต้นทุน'), 'สินค้าที่ไม่มีต้นทุนต้องถูกทำเครื่องหมายไว้');
});

test('an empty sweetness list warns that ordering will be blocked', () => {
  const { C, el } = loadController({});
  C.sweetnessLevels = [];
  C.renderSweetnessList();
  assert.ok(el('sweetness-list').innerHTML.includes('สั่งของไม่ได้'), 'ต้องเตือนว่าหน้าขายจะใช้ไม่ได้');
});

test('payment methods say which one counts as cash and which is switched off', () => {
  const { C, el } = loadController({});
  C.paymentMethods = [
    { id: 'cash', name: 'เงินสด', isCash: true, enabled: true },
    { id: 'card', name: 'บัตรเครดิต', isCash: false, enabled: false }
  ];
  C.renderPaymentMethodList();
  const html = el('payment-method-list').innerHTML;
  assert.ok(html.includes('นับเป็นเงินสด') && html.includes('ไม่ใช่เงินสด'));
  assert.ok(html.includes('ปิดอยู่ ไม่แสดงในหน้าชำระเงิน'), 'ตัวที่ปิดต้องบอกว่าจะไม่โผล่ในหน้าชำระเงิน');
});

test('toggling sold out from the settings row sends the same command the till uses', () => {
  const { C, calls } = loadController({});
  C.menuData = [{ sku: 'A', name: 'ลาเต้', price: 55 }];
  C.soldOutItems = [];
  C.setIndicator = () => {};

  C.toggleProductSoldOut('A');

  const sent = calls.find(c => c.fn === 'toggleSoldOut');
  assert.ok(sent, 'ต้องยิงคำสั่งเดียวกับหน้าขาย');
  // ออบเจกต์มาจาก vm คนละ realm เทียบทั้งก้อนด้วย deepEqual ไม่ผ่าน เทียบทีละช่องแทน
  assert.equal(sent.args[0].sku, 'A');
  assert.equal(sent.args[0].isSoldOut, true);
});

// ---- หน้ากลุ่มของในร้าน / ตัวเลข ----
test('expiry notifications lead with what already went off', () => {
  const { C, el } = loadController({});
  const HOUR = 3600 * 1000;
  C.notifications = [
    { id: 'n2', item_name: 'วิปครีม', expires_at: new Date(Date.now() + HOUR).toISOString() },
    { id: 'n1', item_name: 'นมสด', expires_at: new Date(Date.now() - HOUR).toISOString() }
  ];
  C.renderNotificationList();
  const html = el('notification-list').innerHTML;

  assert.ok(html.indexOf('นมสด') < html.indexOf('วิปครีม'), 'ของที่หมดอายุแล้วต้องอยู่บนสุด');
  assert.ok(html.includes('หมดอายุแล้ว') && html.includes('ใกล้หมดอายุ'), 'ต้องติดป้ายทั้งสองสถานะ');
});

test('the cost page puts menus with no recipe first, with a way to fix them', () => {
  const { C, el } = loadController({});
  C.menuData = [
    { sku: 'A', name: 'ลาเต้', price: 55, cost: 23 },
    { sku: 'D', name: 'ชานม', price: 60 }
  ];
  C.inventoryData = [{ id: 'i1', name: 'นมสด', purchase_price: 320, purchase_factor: 12, stock: 4 }];
  C.recipes = [{ menu_sku: 'A', inventory_item_id: 'i1', qty: 1 }];

  C.renderCostTable();
  const html = el('cost-list').innerHTML;

  assert.ok(html.indexOf('ชานม') < html.indexOf('ลาเต้'), 'เมนูที่ยังไม่มีสูตรต้องอยู่บนสุด');
  assert.ok(html.includes('ใส่สูตร'), 'และต้องมีปุ่มลัดไปใส่สูตร');
  assert.ok(el('cost-summary').innerText.includes('จากทั้งหมด 2 เมนู'));
});

test('the calendar marks the days that beat the month average', () => {
  const { C, el } = loadController({});
  C.calendarYear = 2026; C.calendarMonth = 7;
  C.renderCalendar({ daily: [
    { date: '2026-08-01', total: 2000, bills: 20 },
    { date: '2026-08-02', total: 6000, bills: 60 }
  ]}, '2026-08-01', '2026-08-31');

  const html = el('cal-grid').innerHTML;
  assert.equal((html.match(/is-strong/g) || []).length, 1, 'วันที่ขายดีกว่าค่าเฉลี่ยต้องถูกทำเครื่องหมายไว้วันเดียว');
  assert.ok(el('cal-month-summary').innerText.includes('2 วันที่มีขาย'));
});

// ---- หน้ากลุ่มคนและระบบ ----
test('an employee row says what they can actually open, one page per chip', () => {
  const { C, el } = loadController({});
  C.currentSettingsUser = { id: 'e1', name: 'บอส', role: 'Owner', active: true };
  C.employeeList = [
    { id: 'e1', name: 'บอส', role: 'Owner', active: true, hasPin: true, permissions: '' },
    { id: 'e2', name: 'เบส', role: 'Staff', active: true, hasPin: true, permissions: 'history,inventory' },
    { id: 'e3', name: 'ฝน', role: 'Staff', active: true, hasPin: false, permissions: '' }
  ];
  C.renderEmployeeList();
  const html = el('employee-list').innerHTML;

  assert.ok(html.includes('เข้าถึงทุกอย่าง'), 'เจ้าของร้านต้องบอกว่าเข้าได้หมด');
  assert.ok(html.includes('ประวัติบิล') && html.includes('วัตถุดิบ'), 'สิทธิ์ต้องอ่านเป็นชื่อหน้า ไม่ใช่รหัสแท็บ');
  assert.ok(html.includes('ยังไม่ได้ให้สิทธิ์หน้าไหนเลย'), 'คนที่ยังไม่มีสิทธิ์ต้องเห็นชัด');
  assert.ok(html.includes('ยังไม่ได้ตั้ง PIN เข้าระบบไม่ได้'), 'คนที่ยังไม่ตั้ง PIN ต้องบอกว่าเข้าระบบไม่ได้');
});

test('the three logs are one page with a switcher, not three stacked lists', () => {
  const { C, el } = loadController({});

  C.switchLogView('error');
  assert.ok(el('log-view-access').classList.contains('hidden'), 'อันที่ไม่ได้เลือกต้องซ่อน');
  assert.ok(!el('log-view-error').classList.contains('hidden'), 'อันที่เลือกต้องโชว์');

  C.switchLogView('change');
  assert.ok(el('log-view-error').classList.contains('hidden'));
  assert.ok(!el('log-view-change').classList.contains('hidden'));
});

test('the refresh button fetches whichever log is on screen', () => {
  const { C } = loadController({});
  const hit = [];
  C.fetchAccessLog = () => hit.push('access');
  C.fetchErrorLogs = () => hit.push('error');
  C.fetchChangeLog = () => hit.push('change');

  C.switchLogView('change');
  C.refreshCurrentLog();
  assert.deepEqual(hit, ['change'], 'ต้องดึงเฉพาะอันที่เปิดอยู่ ไม่ใช่ยิงทั้งสามชุด');
});

// เป็นบั๊กที่ตัวรัน node มองไม่เห็น (ไม่มี layout engine) แต่กันการลบกฎทิ้งโดยไม่ตั้งใจได้
test('the sales panel pins its column width, so it cannot overflow the card again', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const block = css.slice(css.indexOf('#settings-panel-sales {'));
  const rule = block.slice(0, block.indexOf('}'));

  assert.ok(rule.includes('grid-template-columns: minmax(0, 1fr)'),
    'ถ้าไม่กำหนดคอลัมน์ คอลัมน์เดียวจะกว้างตาม max-content ทะลุกรอบ แล้ว overflow:hidden จะเฉือนขอบขวาทิ้งเงียบๆ');
  assert.ok(rule.includes('overflow: hidden'), 'กฎที่ทำให้บั๊กนี้เงียบยังอยู่ ตัวบนจึงยังจำเป็น');
});

test('the printer page marks its wide cards in the markup, not by card order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const panel = html.slice(html.indexOf('id="settings-panel-printer"'), html.indexOf('id="settings-panel-onlineorder"'));
  assert.equal((panel.match(/set-card-wide/g) || []).length, 3,
    'ข้อมูลร้าน หัวข้อที่แสดงบนใบเสร็จ และแถบบันทึก ต้องกินเต็มความกว้างบนจอกว้าง');
});
