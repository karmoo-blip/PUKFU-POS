// บิลกลุ่ม: หลายบิลเปิดค้างได้พร้อมกัน ทุกแก้วมีชื่อคนสั่ง จ่ายทีเดียวตอนจบ ใบสั่งพิมพ์เฉพาะแก้วใหม่
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

function setup() {
  const h = loadController({});
  const { C, sandbox } = h;
  const sweetBtn = { innerText: 'ปกติ' };
  sandbox.document.querySelector = (sel) => (sel.indexOf('data-selected') !== -1 ? sweetBtn : null);
  sandbox.document.querySelectorAll = () => [];
  C.menuData = [
    { sku: 'LAT', name: 'ลาเต้เย็น', price: 65, category: 'กาแฟ' },
    { sku: 'TEA', name: 'ชาไทย', price: 60, category: 'ชา' },
  ];
  C.soldOutItems = [];
  C.cart = [];
  C.heldOrders = [];
  C.groupBills = [];
  C.activeGroupId = null;
  C.activeCategory = 'All';
  C.ensureOrderOptionsLoaded = () => {};
  C.updateAddonButtons = () => {};
  C.updateSweetnessButtons = () => {};
  C.selectSweetness = () => {};
  C.openModal = () => {};
  C.closeModal = () => {};
  C.flyToCart = () => {};
  C.replayClass = () => {};
  C.showToast = () => {};
  h.prompts = [];
  C.showPrompt = async () => h.prompts.shift();
  C.showConfirm = async () => true;
  return h;
}

async function add(C, idx, person) {
  C.selectProduct(idx);
  if (person !== undefined) C.pickPerson(person);
  await C.addToCartFromModal();
}

test('a group bill needs a name for every drink, and the same drink for two people stays on two lines', async () => {
  const h = setup();
  const { C, alerts } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  const g = C.activeGroup();
  assert.equal(g.name, 'โต๊ะ 3');
  assert.equal(C.cart, g.items, 'ออเดอร์คือรายการของบิลกลุ่มตรงๆ');
  C.selectProduct(0);
  await C.addToCartFromModal();
  assert.equal(C.cart.length, 0, 'ยังไม่เลือกว่าของใคร ห้ามใส่');
  assert.ok(alerts.some(a => a.includes('ของใคร')));
  await add(C, 0, 'นัท');
  await add(C, 0, 'บอล');
  await add(C, 0, 'นัท');
  assert.deepEqual(JSON.parse(JSON.stringify(C.cart.map(i => [i.person, i.qty]))), [['นัท', 2], ['บอล', 1]]);
  assert.match(C.cart[0].note, /\| ของ นัท$/, 'ชื่อพิมพ์ติดไปกับ note');
  assert.deepEqual([...C.groupPersons(g)], ['นัท', 'บอล']);
});

test('the last person is picked for the next drink, and editing keeps the person', async () => {
  const h = setup();
  const { C } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  C.selectProduct(1);
  assert.equal(C.selectedPerson, 'นัท');
  await C.addToCartFromModal();
  assert.equal(C.cart[1].person, 'นัท');
  C.editCartItem(1);
  assert.equal(C.selectedPerson, 'นัท');
  C.pickPerson('โต้');
  await C.addToCartFromModal();
  assert.equal(C.cart[1].person, 'โต้');
  assert.match(C.cart[1].note, /ของ โต้$/);
});

test('several group bills stay open, and walk-in orders work in between', async () => {
  const h = setup();
  const { C } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  C.holdCurrentOrder(); // ปุ่มเก็บบิลกลุ่ม
  assert.equal(C.activeGroupId, null);
  assert.equal(C.cart.length, 0, 'กลับเป็นออเดอร์ปกติว่างๆ');
  await add(C, 1); // ลูกค้า walk-in ไม่ต้องเลือกชื่อ
  assert.equal(C.cart[0].person, undefined);
  assert.ok(!C.cart[0].note.includes('ของ '));
  h.prompts.push('โต๊ะ 5');
  await C.openNewGroup();
  assert.equal(C.heldOrders.length, 1, 'ออเดอร์ walk-in ที่ค้างอยู่ต้องไปอยู่บิลค้างชำระ ไม่ปนเข้าบิลกลุ่ม');
  await add(C, 1, 'บอล');
  assert.equal(C.groupBills.length, 2);
  const t3 = C.groupBills.find(g => g.name === 'โต๊ะ 3');
  await C.switchToGroup(t3.id);
  assert.equal(C.activeGroupId, t3.id);
  assert.equal(C.cart.length, 1);
  await add(C, 1, 'นัท');
  assert.equal(C.groupTotal(t3), 125);
  assert.equal(C.groupBills.find(g => g.name === 'โต๊ะ 5').items.length, 1, 'บิลอื่นต้องไม่ถูกแตะ');
});

test('an empty group bill closes itself when put aside, and the same name cannot be opened twice', async () => {
  const h = setup();
  const { C, alerts } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  C.holdCurrentOrder();
  assert.equal(C.groupBills.length, 0);
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  C.holdCurrentOrder();
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  assert.ok(alerts.some(a => a.includes('เปิดอยู่แล้ว')));
  assert.equal(C.groupBills.length, 1);
});

test('the order panel groups drinks by person with a subtotal each', async () => {
  const h = setup();
  const { C, el } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  await add(C, 1, 'บอล');
  await add(C, 1, 'นัท');
  C.renderCart();
  const html = el('cart-items').innerHTML;
  const nat = html.indexOf('group-person"><span data-no-translate>นัท');
  const ball = html.indexOf('group-person"><span data-no-translate>บอล');
  assert.ok(nat !== -1 && ball !== -1 && nat < ball);
  assert.match(html, /นัท<\/span><span>฿125/);
  assert.equal((html.match(/group-person/g) || []).length, 2, 'หัวคนละหนึ่งครั้ง');
  assert.match(el('group-strip').innerHTML, /โต๊ะ 3/);
  assert.equal(el('btn-hold-order').innerText, 'เก็บบิลกลุ่ม');
});

test('order slips print only drinks added since the last print, with the group name and round', async () => {
  const h = setup();
  const { C, printers } = h;
  const sent = [];
  const P = printers.ReceiptPrinter;
  P.isConnected = true;
  P.buildOrderSlip = async (order, title) => ({ title, items: C.slipItems(order).map(i => [i.name, i.qty]) });
  P.sendData = async (bytes) => { sent.push(bytes); };
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  await add(C, 0, 'นัท');
  await C.printOrderSlipNow();
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { title: 'โต๊ะ 3 · รอบที่ 1', items: [['ลาเต้เย็น', 2]] });
  await add(C, 0, 'นัท');
  await add(C, 1, 'บอล');
  await C.printOrderSlipNow();
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])), { title: 'โต๊ะ 3 · รอบที่ 2', items: [['ลาเต้เย็น', 1], ['ชาไทย', 1]] }, 'รอบสองมีแค่แก้วใหม่');
  await C.printOrderSlipNow();
  assert.equal(sent.length, 2, 'ไม่มีแก้วใหม่ ไม่ต้องพิมพ์');
  assert.equal(C.slipItems({ items: [{ name: 'x', qty: 2 }] }).length, 1, 'ออเดอร์ปกติได้ทุกแก้วเหมือนเดิม');
});

test('paying a group bill closes it and labels the bill with the group name', async () => {
  const h = setup();
  const { C } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');
  await add(C, 1, 'บอล');
  C.syncQueue = [];
  C.paymentMethods = [{ id: 'cash', name: 'เงินสด', isCash: true }];
  C.currentPaymentMethodId = 'cash';
  C.paymentMode = 'เงินสด';
  C.cashInput = '200';
  C.getQueueNumber = () => 'Q01';
  C.playBillDone = () => {};
  C.setSubmitButtonState = () => {};
  C.printAfterCheckout = async () => {};
  C.processSyncQueue = () => {};
  C.renderHistory = () => {};
  C.updateCupUI = () => {};
  await C.finalizeOrder('INV-G1');
  const bill = C.syncQueue[0];
  assert.equal(bill.total, 125);
  assert.equal(bill.note, 'บิลกลุ่ม: โต๊ะ 3');
  assert.deepEqual([...bill.items.map(i => i.person)], ['นัท', 'บอล']);
  assert.equal(C.groupBills.length, 0, 'จ่ายแล้วบิลกลุ่มต้องปิด');
  assert.equal(C.activeGroupId, null);
  assert.equal(C.cart.length, 0);
});

// ---- แยกจ่ายรายคน ----
function checkoutStubs(C) {
  C.syncQueue = [];
  C.paymentMethods = [{ id: 'cash', name: 'เงินสด', isCash: true }];
  C.currentPaymentMethodId = 'cash';
  C.paymentMode = 'เงินสด';
  C.cashInput = '500';
  C.getQueueNumber = () => 'Q01';
  C.playBillDone = () => {};
  C.setSubmitButtonState = () => {};
  C.printAfterCheckout = async () => {};
  C.processSyncQueue = () => {};
  C.renderHistory = () => {};
  C.updateCupUI = () => {};
  C.renderCheckoutPaymentMethods = () => {};
  C.updateCashUI = () => {};
}

async function tableOf3(h) {
  const { C } = h;
  h.prompts.push('โต๊ะ 3');
  await C.openNewGroup();
  await add(C, 0, 'นัท');   // 65
  await add(C, 1, 'นัท');   // 60
  await add(C, 0, 'บอล');   // 65
  await add(C, 1, 'โต้');   // 60
  checkoutStubs(C);
  return C.activeGroup();
}

test('ชำระเงิน on a group bill asks first, and split pay charges only the ticked people', async () => {
  const h = setup();
  const { C, el } = h;
  const g = await tableOf3(h);
  await C.openCheckout();
  assert.match(el('group-pay-body').innerHTML, /จ่ายทั้งบิล ฿250/);
  C.openSplitPicker();
  C.toggleSplitPerson('บอล');
  C.toggleSplitPerson('โต้');
  assert.match(el('group-pay-body').innerHTML, /ชำระ ฿125/);
  C.paySplit();
  assert.equal(C.getCartSubtotal(), 125, 'หน้าชำระเงินเห็นเฉพาะของบอลกับโต้');
  assert.match(el('checkout-for').innerText, /โต๊ะ 3 · บอล, โต้/);
  await C.finalizeOrder('INV-S1');
  const bill = C.syncQueue[0];
  assert.equal(bill.total, 125);
  assert.equal(bill.note, 'บิลกลุ่ม: โต๊ะ 3 · บอล, โต้');
  assert.deepEqual([...bill.items.map(i => i.person)], ['บอล', 'โต้']);
  assert.ok(C.groupBills.includes(g), 'ยังมีคนค้างจ่าย บิลกลุ่มต้องยังอยู่');
  assert.equal(C.activeGroupId, g.id);
  assert.equal(C.cart, g.items);
  assert.deepEqual([...C.groupPersons(g)], ['นัท']);
  assert.equal(C.groupTotal(g), 125);
  assert.equal(g.paid[0].total, 125);
  C.renderGroupStrip();
  assert.match(el('group-strip').innerHTML, /จ่ายแล้ว: บอล, โต้/);
  assert.match(el('group-strip').innerHTML, /เหลือ ฿125/);
});

test('when the last person pays, the group bill closes by itself', async () => {
  const h = setup();
  const { C } = h;
  await tableOf3(h);
  C.openSplitPicker();
  C.toggleSplitPerson('นัท');
  C.paySplit();
  await C.finalizeOrder('INV-S1');
  await C.openCheckout(); // เหลือสองคน ยังถาม
  C.payWholeGroup();
  assert.equal(C.getCartSubtotal(), 125);
  await C.finalizeOrder('INV-S2');
  assert.equal(C.groupBills.length, 0);
  assert.equal(C.activeGroupId, null);
  assert.equal(C.syncQueue.reduce((s, b) => s + b.total, 0), 250, 'สองบิลรวมกันเท่ายอดทั้งโต๊ะ');
});

test('ticking everyone in split pay is the same as paying the whole bill', async () => {
  const h = setup();
  const { C } = h;
  await tableOf3(h);
  C.openSplitPicker();
  ['นัท', 'บอล', 'โต้'].forEach(p => C.toggleSplitPerson(p));
  C.paySplit();
  assert.equal(C.splitCheckout, null);
  await C.finalizeOrder('INV-S1');
  assert.equal(C.syncQueue[0].note, 'บิลกลุ่ม: โต๊ะ 3');
  assert.equal(C.groupBills.length, 0);
});

test('group bills survive midnight, show a label when left from an earlier day, and need a PIN to delete when unpaid', async () => {
  const h = setup();
  const { C, el, store } = h;
  await tableOf3(h);
  const g = C.activeGroup();
  g.createdAt = new Date(Date.now() - 86400000).toISOString();
  C.renderGroupStrip();
  assert.match(el('group-strip').innerHTML, /ค้างจากวันก่อน/);
  // จำลองเปิดแอปวันใหม่: ล้างประวัติวันก่อน แต่บิลกลุ่มต้องไม่หาย
  store.set('pos_lastClearDate', 'วันก่อน');
  C.syncQueue = [];
  C.checkAndClearDailyCache && C.checkAndClearDailyCache();
  assert.ok(JSON.parse(store.get('pos_groupBills')).length === 1, 'ข้ามวันแล้วบิลกลุ่มต้องยังอยู่');
  let pinAsked = false;
  C.requireActionPin = async () => { pinAsked = true; return null; };
  await C.deleteGroup();
  assert.equal(pinAsked, true);
  assert.equal(C.groupBills.length, 1, 'ไม่ใส่ PIN ห้ามลบ');
  C.requireActionPin = async () => ({ employee: { name: 'บอน' }, employeeId: 'E1', pin: '1' });
  C.logPinAttempt = () => {};
  await C.deleteGroup();
  assert.equal(C.groupBills.length, 0);
  assert.equal(C.cart.length, 0);
});

test('ปิดยอดประจำวัน warns about unpaid group bills first', async () => {
  const h = setup();
  const { C, calls } = h;
  await tableOf3(h);
  C.setBtnLoading = () => {};
  let asked = '';
  C.showConfirm = async (msg) => { asked = msg; return false; };
  await C.closeDayCashManual({ dataset: {} });
  assert.match(asked, /บิลกลุ่มค้างจ่าย 1 บิล \(โต๊ะ 3 · ฿250\)/);
  assert.equal(calls.filter(c => c.fn === 'closeDayCash').length, 0, 'ตอบไม่ ต้องไม่ปิดยอด');
  C.showConfirm = async () => true;
  await C.closeDayCashManual({ dataset: {} });
  assert.equal(calls.filter(c => c.fn === 'closeDayCash').length, 1);
});
