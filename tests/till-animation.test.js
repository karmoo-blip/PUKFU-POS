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
