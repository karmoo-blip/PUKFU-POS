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
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].args[0])), { staffPrice: 45 });
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
