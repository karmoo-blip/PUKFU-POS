// แท็บราคาพนักงาน: ทุกแก้วคิดราคาพนักงาน (ค่าเริ่มต้น 50) ใช้ sku เดิม ไม่แตะราคาในเมนูจริง
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

function setup(shopInfo) {
  const h = loadController({});
  const { C, sandbox } = h;
  // ปุ่มความหวานที่ถูกเลือกไว้ ให้ addToCartFromModal ผ่านด่านถามความหวาน
  const sweetBtn = { innerText: 'ปกติ' };
  sandbox.document.querySelector = (sel) => (sel.indexOf('data-selected') !== -1 ? sweetBtn : null);
  sandbox.document.querySelectorAll = () => [];
  C.menuData = [
    { sku: 'LAT', name: 'ลาเต้เย็น', price: 65, category: 'กาแฟ' },
    { sku: 'WTR', name: 'น้ำเปล่า', price: 15, category: 'อื่นๆ' },
  ];
  C.soldOutItems = [];
  C.cart = [];
  C.shopInfo = shopInfo || {};
  C.ensureOrderOptionsLoaded = () => {};
  C.updateAddonButtons = () => {};
  C.updateSweetnessButtons = () => {};
  C.selectSweetness = () => {};
  C.openModal = () => {};
  C.closeModal = () => {};
  C.renderCart = () => {};
  C.flyToCart = () => {};
  C.replayClass = () => {};
  return h;
}

async function add(C, category, idx) {
  C.activeCategory = category;
  C.selectProduct(idx);
  await C.addToCartFromModal();
}

test('the staff tab adds a drink at the staff price without touching the menu', async () => {
  const { C } = setup();
  await add(C, '__staff__', 0);
  assert.equal(C.cart.length, 1);
  assert.equal(C.cart[0].price, 50);
  assert.equal(C.cart[0].sku, 'LAT', 'ต้องใช้ sku เดิม รายงานกับต้นทุนจะได้ไม่เพี้ยน');
  assert.match(C.cart[0].note, /^ราคาพนักงาน \| /);
  assert.equal(C.menuData[0].price, 65, 'ราคาในเมนูจริงต้องไม่เปลี่ยน');
});

test('a drink already under the staff price keeps its own price', async () => {
  const { C } = setup();
  await add(C, '__staff__', 1);
  assert.equal(C.cart[0].price, 15);
});

test('staff and normal cups of the same drink stay on separate lines', async () => {
  const { C } = setup();
  await add(C, '__staff__', 0);
  await add(C, '__staff__', 0);
  await add(C, 'All', 0);
  assert.equal(C.cart.length, 2);
  assert.deepEqual(C.cart.map(i => [i.price, i.qty]), [[50, 2], [65, 1]]);
  assert.equal(C.getCartSubtotal(), 165);
});

test('editing a staff line keeps the staff price', async () => {
  const { C } = setup();
  await add(C, '__staff__', 0);
  C.activeCategory = 'All';
  C.editCartItem(0);
  await C.addToCartFromModal();
  assert.equal(C.cart.length, 1);
  assert.equal(C.cart[0].price, 50);
});

test('the staff price comes from shop settings, and a bad value falls back to 50', async () => {
  const { C } = setup({ staffPrice: '45' });
  await add(C, '__staff__', 0);
  assert.equal(C.cart[0].price, 45, 'shop_info ส่งกลับมาเป็น string ต้องแปลงเป็นตัวเลขได้');
  C.shopInfo = { staffPrice: '0' };
  assert.equal(C.staffPriceSetting(), 50);
  C.shopInfo = { staffPrice: 'abc' };
  assert.equal(C.staffPriceSetting(), 50);
});

test('saving the staff price from the add-ons tab sends only that value', async () => {
  const { C, calls, el } = setup({ vatRate: 7 });
  C.showToast = () => {};
  el('shop-staff-price').value = '45';
  await C.saveStaffPrice(Object.assign(el('btn'), { dataset: {} }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(C.shopInfo.staffPrice, 45);
  assert.equal(C.shopInfo.vatRate, 7, 'ค่าอื่นในข้อมูลร้านต้องอยู่ครบ');
  const sent = calls.filter(c => c.fn === 'saveShopInfo');
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].args[0])), { staffPrice: 45, staffTabIdleSeconds: 60 });
});

test('an empty staff price saves the default 50', async () => {
  const { C, el } = setup();
  C.showToast = () => {};
  el('shop-staff-price').value = '';
  await C.saveStaffPrice(Object.assign(el('btn'), { dataset: {} }));
  assert.equal(C.shopInfo.staffPrice, 50);
});

test('a zero or negative staff price is refused and nothing is sent', async () => {
  for (const bad of ['0', '-5']) {
    const { C, calls, alerts, el } = setup({ staffPrice: 50 });
    el('shop-staff-price').value = bad;
    await C.saveStaffPrice(Object.assign(el('btn'), { dataset: {} }));
    assert.equal(C.shopInfo.staffPrice, 50);
    assert.equal(calls.filter(c => c.fn === 'saveShopInfo').length, 0);
    assert.ok(alerts.some(a => a.includes('ราคาพนักงานต้องมากกว่า 0')));
  }
});

// ---- แท็บพนักงานกลับหน้าทั้งหมดเองเมื่อไม่มีใครแตะ ----
function setupTimer(shopInfo) {
  const h = setup(shopInfo);
  h.C.renderCategories = () => {};
  h.C.renderMenu = () => {};
  return h;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('the staff tab goes back to All after the idle time', async () => {
  const { C } = setupTimer({ staffTabIdleSeconds: 0.03 });
  C.selectCategory('__staff__');
  assert.equal(C.activeCategory, '__staff__');
  await wait(60);
  assert.equal(C.activeCategory, 'All');
});

test('activity restarts the staff tab countdown', async () => {
  const { C } = setupTimer({ staffTabIdleSeconds: 0.05 });
  C.selectCategory('__staff__');
  await wait(30);
  C.resetStaffTabTimer(); // แตะจอ
  await wait(30);
  assert.equal(C.activeCategory, '__staff__', 'แตะแล้วต้องนับใหม่ ยังไม่ควรเด้งกลับ');
  await wait(50);
  assert.equal(C.activeCategory, 'All');
});

test('staff cups already in the cart keep the staff price after going back', async () => {
  const { C } = setupTimer({ staffTabIdleSeconds: 0.03 });
  C.selectCategory('__staff__');
  C.selectProduct(0);
  await C.addToCartFromModal();
  await wait(60);
  assert.equal(C.activeCategory, 'All');
  assert.equal(C.cart[0].price, 50);
  await add(C, 'All', 0);
  assert.equal(C.cart[1].price, 65, 'แก้วใหม่หลังกลับหน้าทั้งหมดต้องเป็นราคาปกติ');
});

test('idle time 0 keeps the staff tab open, and empty means 60 seconds', () => {
  const { C } = setupTimer({ staffTabIdleSeconds: '0' });
  C.selectCategory('__staff__');
  assert.equal(C.staffTabTimer, null, 'ตั้ง 0 ต้องไม่นับถอยหลัง');
  C.shopInfo = {};
  assert.equal(C.staffTabIdleSeconds(), 60);
  C.shopInfo = { staffTabIdleSeconds: '90' };
  assert.equal(C.staffTabIdleSeconds(), 90);
  C.leaveStaffTab();
});

test('waking up after the idle time goes straight back to All', () => {
  const { C } = setupTimer({ staffTabIdleSeconds: 60 });
  C.selectCategory('__staff__');
  C.staffTabLastActive = Date.now() - 61 * 1000; // จอดับไปนานกว่าเวลาที่ตั้ง
  C.checkStaffTabOnResume();
  assert.equal(C.activeCategory, 'All');
});

test('a negative idle time is refused', async () => {
  const { C, calls, alerts, el } = setup();
  el('shop-staff-price').value = '50';
  el('shop-staff-idle').value = '-1';
  await C.saveStaffPrice(Object.assign(el('btn'), { dataset: {} }));
  assert.equal(calls.filter(c => c.fn === 'saveShopInfo').length, 0);
  assert.ok(alerts.some(a => a.includes('ติดลบไม่ได้')));
});

// ---- สามโหมดของแท็บพนักงาน + ตารางพนักงานและของเสีย ----
const { staffBreakdown } = require('../pure-helpers.js');

function setupModes() {
  const h = setupTimer({});
  h.C.syncQueue = [];
  h.C.history = [];
  h.C.processSyncQueue = () => {};
  h.C.renderHistory = () => {};
  h.C.updateSyncQueueBadge = () => {};
  h.C.saveLocalState = () => {};
  h.C.loggedInEmployee = { name: 'บอน' };
  return h;
}

test('staff drink and waste modes save one ฿0 cup straight away, without touching the order', () => {
  const { C } = setupModes();
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 1, note: 'ความหวาน: ปกติ' }];
  C.selectCategory('__staff__');
  C.setStaffMode('drink');
  C.selectProduct(0);
  C.setStaffMode('waste');
  C.selectProduct(1);
  assert.equal(C.cart.length, 1, 'ออเดอร์ของลูกค้าต้องไม่ถูกแตะ');
  assert.equal(C.freePending.length, 2);
  const [drink, waste] = C.freePending;
  assert.equal(drink.status, 'waste');
  assert.equal(drink.total, 0);
  assert.equal(drink.items[0].price, 0);
  assert.equal(drink.items[0].note, 'พนักงานดื่ม');
  assert.equal(waste.items[0].note, 'ของเสีย');
  assert.equal(waste.items[0].sku, 'WTR');
  assert.equal(C.freeRecordKind(drink), 'drink');
  assert.equal(C.freeRecordKind(waste), 'waste');
  assert.equal(C.syncQueue.length, 0, 'ยังอยู่ในช่วงกดยกเลิกได้ ห้ามเข้าคิวซิงก์');
  C.flushFreeCups();
  assert.equal(C.syncQueue.length, 2, 'หมดเวลาเอากลับแล้วต้องเข้าคิวซิงก์');
  assert.equal(C.freePending.length, 0);
  C.leaveStaffTab();
});

test('− removes the latest just-tapped cup one at a time, with no PIN', async () => {
  const { C } = setupModes();
  let pinAsked = false;
  C.requireActionPin = async () => { pinAsked = true; return null; };
  C.selectCategory('__staff__');
  C.setStaffMode('waste');
  C.selectProduct(0);
  C.selectProduct(0);
  assert.equal(C.freeCupGroups()[0].records.length, 2);
  await C.removeFreeCup('waste|LAT');
  assert.equal(C.freePending.length, 1);
  await C.removeFreeCup('waste|LAT');
  assert.equal(C.freePending.length, 0);
  assert.equal(pinAsked, false, 'ยังไม่พ้นห้าวินาที ไม่ต้องใส่ PIN');
  C.flushFreeCups();
  assert.equal(C.syncQueue.length, 0, 'ลบหมดแล้วต้องไม่มีอะไรไปถึงเซิร์ฟเวอร์');
  C.leaveStaffTab();
});

test('the staff sale mode still goes through the order, and the tab always opens on it', async () => {
  const { C } = setupModes();
  C.selectCategory('__staff__');
  C.setStaffMode('waste');
  C.selectCategory('All');
  C.selectCategory('__staff__');
  assert.equal(C.staffMode, 'sale', 'เข้าแท็บใหม่ต้องเริ่มที่โหมดขาย');
  C.selectProduct(0);
  await C.addToCartFromModal();
  assert.equal(C.cart[0].price, 50);
  assert.equal((C.freePending || []).length, 0);
  C.setStaffMode('drink');
  C.leaveStaffTab();
  assert.equal(C.staffMode, 'sale', 'กลับหน้าทั้งหมดเองแล้วโหมดต้องกลับเป็นขาย');
});

test('a bill marked as waste from history is not a free record, so it cannot be cancelled', () => {
  const { C } = setupModes();
  assert.equal(C.freeRecordKind({ status: 'waste', items: [{ note: 'ความหวาน: ปกติ' }] }), null);
  assert.equal(C.freeRecordKind({ status: 'active', items: [{ note: 'ของเสีย' }] }), null);
  assert.equal(C.freeRecordKind({ status: 'waste', items: [{ note: 'ของเสีย' }, { note: 'พนักงานดื่ม' }] }), null);
});

const BREAKDOWN_LINES = [
  { sku: 'LAT', note: 'ราคาพนักงาน | ความหวาน: ปกติ', qty: 2, price: 50, cost: 18, isWasteBill: false },
  { sku: 'LAT', note: 'ความหวาน: ปกติ', qty: 3, price: 65, cost: 18, isWasteBill: false },
  { sku: 'TEA', note: 'พนักงานดื่ม', qty: 1, price: 0, cost: 12, isWasteBill: true },
  { sku: 'LAT', note: 'ของเสีย', qty: 1, price: 0, cost: 18, isWasteBill: true },
  { sku: 'TEA', note: 'ความหวาน: น้อย', qty: 2, price: 60, cost: 12, isWasteBill: true }, // บิลที่กดบันทึกของเสียจากประวัติ
];

test('the staff and waste table adds up cups, money and cost per kind', () => {
  const b = staffBreakdown(BREAKDOWN_LINES);
  assert.deepEqual(b.sale, { cups: 2, amount: 100, cost: 36 });
  assert.deepEqual(b.drink, { cups: 1, amount: 0, cost: 12 });
  assert.deepEqual(b.waste, { cups: 3, amount: 0, cost: 42 }, 'ของเสียจากหน้าขาย 1 + บิลของเสียจากประวัติ 2 ไม่นับเงิน');
});

test('the server adds up the staff and waste table the same way as the app', async () => {
  const sales = BREAKDOWN_LINES.filter(l => !l.isWasteBill).map(l => ({ ...l, bkk_date: '2026-10-25', invoice: 'A' }));
  const waste = BREAKDOWN_LINES.filter(l => l.isWasteBill).map(l => ({ ...l, invoice: 'W' }));
  const MENU = [{ sku: 'LAT', cost: 18 }, { sku: 'TEA', cost: 12 }];
  const db = {
    prepare(text) {
      const stmt = {
        bind() { return stmt; },
        async run() { return { success: true }; },
        async first() { return /schema_version/.test(text) ? { value: '999' } : null; },
        async all() {
          if (/FROM menu/.test(text)) return { results: MENU };
          if (/FROM sales WHERE/.test(text) && /NOT IN/.test(text)) return { results: sales };
          if (/FROM sales WHERE/.test(text) && /= 'waste'/.test(text)) return { results: waste };
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch() { return []; },
  };
  const mod = await import('../worker/worker.js?staff=' + Date.now());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn: 'getSummaryByRange', args: ['2026-10-25', '2026-10-25'] }),
  }), { DB: db, API_TOKEN: 'staff-token' });
  const r = (await res.json()).result;
  assert.deepEqual(r.staffBreakdown, staffBreakdown(BREAKDOWN_LINES));
});

// ---- รายการบันทึกวันนี้ในออเดอร์ + ยกเลิกของที่ถึงเซิร์ฟเวอร์แล้ว ----
function serverFree(invoice, note, sku) {
  return { invoice, timestamp: new Date().toISOString(), total: 0, paymentType: note, status: 'waste', cancelReason: '',
    items: [{ sku: sku || 'LAT', name: 'ลาเต้เย็น', qty: 1, price: 0, note }] };
}

test('the order panel lists today\'s free cups and the cards show the count, without touching the bill', () => {
  const { C, el } = setupModes();
  C.cart = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65, qty: 2, note: 'ความหวาน: ปกติ' }];
  C.history = [serverFree('W1', 'ของเสีย'), serverFree('W2', 'ของเสีย'), serverFree('D1', 'พนักงานดื่ม', 'WTR'),
    { invoice: 'OLD', timestamp: new Date().toISOString(), total: 0, status: 'waste', items: [{ sku: 'LAT', name: 'ลาเต้เย็น', qty: 1, price: 65, note: 'ความหวาน: ปกติ' }] }];
  C.activeCategory = '__staff__';
  C.renderFreeList();
  const box = el('cart-free-box');
  assert.ok(!box.classList.contains('hidden'));
  assert.match(box.innerHTML, /×2/);
  assert.match(box.innerHTML, /ของเสีย 2 · พนักงานดื่ม 1/);
  assert.match(box.innerHTML, /3 แก้ว/, 'บิลที่กดของเสียจากประวัติไม่ใช่รายการจากหน้าขาย ไม่อยู่ในกล่องนี้');
  assert.equal(C.getCartSubtotal(), 130, 'ยอดบิลของลูกค้าต้องไม่เปลี่ยน');
  C.history = [];
  C.renderFreeList();
  assert.ok(box.classList.contains('hidden'), 'ไม่มีแก้วฟรีวันนี้ต้องไม่แสดงกล่อง');
});

test('the waste-mode cards show today\'s count for that drink', () => {
  const { loadController } = require('./helpers/load-controller');
  const { C, el } = loadController({});
  C.menuData = [{ sku: 'LAT', name: 'ลาเต้เย็น', price: 65 }, { sku: 'WTR', name: 'น้ำเปล่า', price: 15 }];
  C.soldOutItems = []; C.syncQueue = []; C.freePending = [];
  C.history = [serverFree('W1', 'ของเสีย'), serverFree('W2', 'ของเสีย'), serverFree('D1', 'พนักงานดื่ม')];
  C.activeCategory = '__staff__';
  C.staffMode = 'waste';
  C.renderMenu({ noStagger: true });
  const html = el('menu-grid').innerHTML;
  assert.equal((html.match(/pos-free-badge/g) || []).length, 1, 'ป้ายเฉพาะเมนูที่มีของเสีย');
  assert.match(html, /pos-free-badge is-waste">×2/);
  C.staffMode = 'sale';
  C.renderMenu({ noStagger: true });
  assert.ok(!el('menu-grid').innerHTML.includes('pos-free-badge'), 'โหมดขายไม่มีป้าย');
});

test('− on a cup already on the server asks for a PIN only, then cancels it', async () => {
  const { C, calls } = setupModes();
  let prompted = false;
  C.showPrompt = async () => { prompted = true; return 'x'; };
  C.requireActionPin = async () => ({ employee: { name: 'บอน' }, employeeId: 'E1', pin: '1234' });
  C.statusQueue = [];
  const rec = serverFree('W1', 'ของเสีย');
  C.history = [rec];
  C.serverCupCount = 10;
  await C.removeFreeCup('waste|LAT');
  assert.equal(prompted, false, 'ไม่ต้องพิมพ์เหตุผล');
  assert.equal(rec.status, 'cancelled');
  assert.equal(C.serverCupCount, 10, 'ของเสียไม่เคยนับเป็นแก้วที่ขาย ห้ามหักยอดแก้ว');
  const sent = calls.filter(c => c.fn === 'updateOrderStatus');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args[0].status, 'cancelled');
  assert.equal(sent[0].args[0].reason, 'ลบจากหน้าขาย');
  assert.equal(C.freeCupGroups().length, 0);
});

test('ยกเลิกบิล in bill history really cancels a free cup (the version of the function that actually runs)', async () => {
  const { C, calls } = setupModes();
  let prompted = false;
  C.showPrompt = async () => { prompted = true; return 'กดผิด'; };
  C.requireActionPin = async () => ({ employee: { name: 'บอน' }, employeeId: 'E1', pin: '1234' });
  C.statusQueue = [];
  const rec = serverFree('W1', 'พนักงานดื่ม');
  C.history = [rec];
  await C.updateOrderStatus('W1', 'cancelled');
  assert.equal(prompted, true, 'ต้องถามเหตุผลเหมือนยกเลิกบิลปกติ');
  assert.equal(rec.status, 'cancelled');
  assert.equal(calls.filter(c => c.fn === 'updateOrderStatus').length, 1);
  // บิลที่กดของเสียจากประวัติ ยังเปลี่ยนอะไรไม่ได้เหมือนเดิม
  prompted = false;
  const oldWaste = { invoice: 'OLD', timestamp: new Date().toISOString(), status: 'waste', items: [{ sku: 'LAT', qty: 1, price: 65, note: 'ความหวาน: ปกติ' }] };
  C.history = [oldWaste];
  await C.updateOrderStatus('OLD', 'cancelled');
  assert.equal(prompted, false);
  assert.equal(oldWaste.status, 'waste');
});

test('the free-cup box only shows on the staff tab, and the cups are still there', () => {
  const { C, el } = setupModes();
  C.history = [serverFree('W1', 'ของเสีย')];
  const box = el('cart-free-box');
  C.selectCategory('All');
  assert.ok(box.classList.contains('hidden'), 'แท็บอื่นต้องไม่เห็นกล่อง');
  C.selectCategory('__staff__');
  assert.ok(!box.classList.contains('hidden'), 'กลับมาแท็บพนักงานต้องเห็นอีก');
  assert.match(box.innerHTML, /×1/);
  C.leaveStaffTab();
  assert.ok(box.classList.contains('hidden'), 'กลับหน้าทั้งหมดเองก็ต้องซ่อน');
  assert.equal(C.freeCupGroups().length, 1, 'ซ่อนอย่างเดียว ข้อมูลยังอยู่');
});
