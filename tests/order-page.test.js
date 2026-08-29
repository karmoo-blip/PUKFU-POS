// รันโค้ดจริงของ order.js ในกล่องจำลอง (vm) พร้อม DOM ปลอมเล็กๆ
// จุดที่ต้องเฝ้าคือ: หน้าลูกค้าถามเซิร์ฟเวอร์ทุก 12 วินาที และได้คำตอบเดิมเป็นส่วนใหญ่
// อนิเมชันตอนเปลี่ยนสถานะจึงต้องเล่นเฉพาะตอนค่าเปลี่ยนจริง ไม่ใช่ทุกครั้งที่ถาม
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
    this.disabled = false;
    this.offsetWidth = 0;
    this.offsetLeft = 0;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
      contains: (c) => self.classes.has(c),
    };
  }
  get className() {
    return Array.from(this.classes).join(' ');
  }
  set className(v) {
    this.classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

// โหลด order.js เข้ากล่องใหม่ทุกครั้ง จะได้ไม่มีสถานะค้างข้ามเทสต์
function loadOrderPage(opts) {
  const reduced = !!(opts && opts.reducedMotion);
  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, new FakeEl(id));
      return els.get(id);
    },
    querySelector: (sel) => {
      if (sel === '#order-categories-track button.is-active-cat') return document._activeCatBtn || null;
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => new FakeEl(tag),
    body: { appendChild() {} },
  };
  const store = new Map();
  const sandbox = {
    document,
    window: {
      matchMedia: () => ({ matches: reduced }),
      location: { search: '' },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    location: { search: '' },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: () => Promise.reject(new Error('no network in tests')),
    console,
    escAttr: (v) => String(v),
    escHtml: (v) => String(v),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'order.js'), 'utf8');
  // OrderPage ประกาศด้วย const จึงไม่ไปโผล่บน global เอง ต้องต่อท้ายให้หยิบออกมาได้
  vm.runInContext(code + '\nglobalThis.__OrderPage = OrderPage;', sandbox, { filename: 'order.js' });
  return { OrderPage: sandbox.__OrderPage, el: (id) => document.getElementById(id), doc: document, sandbox };
}

test('applyStatus animates once per real change, not on every poll', () => {
  const { OrderPage } = loadOrderPage();
  const seen = [];
  OrderPage.animateStatusChange = (s) => seen.push(s);

  // ร้านกดรับแล้ว จากนั้นถามซ้ำอีกสามรอบ ได้คำตอบเดิม
  OrderPage.applyStatus('confirmed', '', { queueAhead: 1, etaLow: 4, etaHigh: 8 });
  OrderPage.applyStatus('confirmed', '', { queueAhead: 1, etaLow: 4, etaHigh: 8 });
  OrderPage.applyStatus('confirmed', '', { queueAhead: 1, etaLow: 4, etaHigh: 8 });
  assert.deepEqual(seen, ['confirmed']);

  // พอเครื่องดื่มเสร็จจริง ต้องเล่นอีกครั้ง
  OrderPage.applyStatus('ready', '', null);
  assert.deepEqual(seen, ['confirmed', 'ready']);
});

test('good news gets the ring, bad news only gets the pop', () => {
  const { OrderPage, el } = loadOrderPage();

  OrderPage.applyStatus('confirmed', '', null);
  assert.ok(el('submitted-status-icon').classList.contains('status-pop'));
  assert.ok(el('submitted-status-icon').classList.contains('status-ring'));
  assert.ok(el('submitted-status-card').classList.contains('status-lift'));
  assert.ok(el('submitted-status-text').classList.contains('status-rise'));

  const { OrderPage: O2, el: el2 } = loadOrderPage();
  O2.applyStatus('rejected', 'ของหมดครับ', null);
  assert.ok(el2('submitted-status-icon').classList.contains('status-pop'));
  assert.ok(!el2('submitted-status-icon').classList.contains('status-ring'));
  assert.ok(!el2('submitted-status-card').classList.contains('status-lift'));
});

test('reduced motion applies no status animation classes', () => {
  const { OrderPage, el } = loadOrderPage({ reducedMotion: true });
  OrderPage.applyStatus('confirmed', '', null);
  // สีและไอคอนยังต้องเปลี่ยนตามปกติ ที่ต้องไม่มีคืออนิเมชัน
  assert.match(el('submitted-status-icon').className, /emerald/);
  for (const cls of ['status-pop', 'status-ring', 'status-lift', 'status-rise']) {
    assert.ok(!el('submitted-status-icon').classList.contains(cls));
    assert.ok(!el('submitted-status-card').classList.contains(cls));
    assert.ok(!el('submitted-status-text').classList.contains(cls));
  }
});

test('queue number pops only when the number actually moves', () => {
  const { OrderPage, el } = loadOrderPage();
  const line = el('submitted-queue-line');

  OrderPage.renderQueue({ queueAhead: 2, etaLow: 8, etaHigh: 12 });
  assert.match(line.innerHTML, /queue-num-pop/);

  // ถามซ้ำ ได้เลขเดิม ต้องไม่เด้งอีก
  OrderPage.renderQueue({ queueAhead: 2, etaLow: 8, etaHigh: 12 });
  assert.doesNotMatch(line.innerHTML, /queue-num-pop/);
  assert.match(line.innerHTML, /2/);

  // คิวลดลงจริง เด้งได้
  OrderPage.renderQueue({ queueAhead: 1, etaLow: 4, etaHigh: 8 });
  assert.match(line.innerHTML, /queue-num-pop/);
});

test('returning to a saved order does not replay the celebration', () => {
  const { OrderPage } = loadOrderPage();
  const seen = [];
  OrderPage.animateStatusChange = (s) => seen.push(s);

  // เลียนแบบ restoreSavedOrder: เข้าหน้าสถานะ แล้วบอกระบบว่าสถานะนี้รู้อยู่แล้ว
  OrderPage.cart = [];
  OrderPage.showSubmittedView();
  OrderPage._lastStatus = 'confirmed';
  OrderPage.applyStatus('confirmed', '', { queueAhead: 0 });
  assert.deepEqual(seen, []);

  // ของใหม่จริงยังเล่นได้ตามปกติ
  OrderPage.applyStatus('ready', '', null);
  assert.deepEqual(seen, ['ready']);
});

test('renderCartItems marks only the row whose quantity changed', () => {
  const { OrderPage, el } = loadOrderPage();
  OrderPage.cart = [
    { name: 'ลาเต้เย็น', price: 55, qty: 1, note: 'หวานน้อย' },
    { name: 'ชาไทยเย็น', price: 45, qty: 3, note: 'หวานปกติ' },
  ];
  OrderPage.renderCartItems({ popIdx: 1 });
  const html = el('order-cart-items').innerHTML;
  const rows = html.split('data-cart-idx=').slice(1);
  assert.equal(rows.length, 2);
  assert.ok(!rows[0].includes('cart-qty-pop'));
  assert.ok(rows[1].includes('cart-qty-pop'));
});

test('cart bar rises only the first time it appears', () => {
  const { OrderPage, el } = loadOrderPage();
  const bar = el('order-cart-bar');
  bar.classList.add('hidden');

  OrderPage.cart = [{ name: 'ลาเต้เย็น', price: 55, qty: 1, note: '' }];
  OrderPage.renderCartBar({ bump: true });
  assert.ok(bar.classList.contains('is-rising'));

  bar.classList.remove('is-rising');
  OrderPage.cart.push({ name: 'ชาไทยเย็น', price: 45, qty: 1, note: '' });
  OrderPage.renderCartBar({ bump: true });
  assert.ok(!bar.classList.contains('is-rising'));
});

test('renderCategories fills the track, not the wrapper, and moves the indicator', () => {
  const { OrderPage, el, doc } = loadOrderPage();
  OrderPage.categories = ['All', 'กาแฟ', 'ชา'];
  OrderPage.activeCategory = 'ชา';
  doc._activeCatBtn = { offsetWidth: 88, offsetLeft: 150 };

  OrderPage.renderCategories();

  // ตัวชี้อยู่นอก track ถ้าเผลอเขียนลง wrapper ตัวชี้จะโดนล้างทุกครั้งที่เปลี่ยนหมวด
  assert.equal(el('order-categories').innerHTML, '');
  assert.match(el('order-categories-track').innerHTML, /กาแฟ/);
  assert.match(el('order-categories-track').innerHTML, /is-active-cat/);
  assert.ok(!el('order-categories').classList.contains('hidden'));

  const ind = el('order-cat-indicator');
  assert.equal(ind.style.width, '88px');
  assert.equal(ind.style.transform, 'translateX(150px)');
  assert.ok(ind.classList.contains('is-ready'));
});

test('tapping start hides the welcome screen, and never stacks a spinner on it', async () => {
  const { OrderPage, el } = loadOrderPage();
  OrderPage._dataLoaded = true;
  el('loading-overlay').classList.add('hidden');

  await OrderPage.startOrdering();

  // ยังไม่ใส่ hidden ทันที ต้องปล่อยให้จางออกก่อน (order.js ใส่ให้เองหลัง 300ms)
  assert.ok(el('view-welcome').classList.contains('is-leaving'));
  // เมนูพร้อมแล้ว ไม่มีเหตุให้เอาวงกลมหมุนมาบัง
  assert.ok(el('loading-overlay').classList.contains('hidden'));
});

test('reduced motion closes the welcome screen with no leave animation', async () => {
  const { OrderPage, el } = loadOrderPage({ reducedMotion: true });
  OrderPage._dataLoaded = true;

  await OrderPage.startOrdering();

  assert.ok(el('view-welcome').classList.contains('hidden'));
  assert.ok(!el('view-welcome').classList.contains('is-leaving'));
});

test('a returning customer with a live order never sees the welcome screen', async () => {
  const { OrderPage, el, sandbox } = loadOrderPage({ reducedMotion: true });
  sandbox.localStorage.setItem('pukfu_order_id', 'ORD-1');
  sandbox.callApi = async () => ({ success: true, status: 'confirmed', queueAhead: 0 });

  await OrderPage.restoreSavedOrder();

  assert.equal(OrderPage.currentOrderId, 'ORD-1');
  assert.ok(el('view-welcome').classList.contains('hidden'));
  assert.ok(!el('view-submitted').classList.contains('hidden'));
});

test('the welcome canvas is skipped where there is no real canvas to draw on', () => {
  const { OrderPage } = loadOrderPage();
  // DOM ปลอมไม่มี getContext ถ้าไม่กันไว้ หน้านี้จะพังทั้งหน้าตั้งแต่ init
  assert.doesNotThrow(() => OrderPage.startWelcomeAnimation());
  assert.equal(OrderPage._welcomeRaf, null);
});

test('the welcome screen keeps its leave transition in the stylesheet', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  // จังหวะจางออกใน CSS ต้องคู่กับ setTimeout 300ms ใน order.js ไม่งั้นหน้าจะหายวับ
  assert.match(css, /#view-welcome\.is-leaving/);
  assert.match(css, /#view-welcome > div > \*,/);   // อยู่ในบล็อก prefers-reduced-motion
});
