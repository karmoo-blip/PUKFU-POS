'use strict';

// เจ้าของ/ผู้ดูแลที่ปลดล็อกด้วย PIN แล้ว กดยืนยันอย่างเดียว ไม่ต้องพิมพ์ PIN ซ้ำ
// พนักงานทั่วไป กู้คืนข้อมูล และ archive ยังต้องพิมพ์ PIN ทุกครั้ง
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

function setup(role) {
  const h = loadController({});
  const { C, sandbox } = h;
  sandbox.hashPinWithSalt = async (pin, salt) => 'h:' + pin + ':' + salt;
  C.employees = [{ id: 'E1', name: 'สมชาย', role, active: true, pinSalt: 's1', pinHash: 'h:1234:s1' }];
  h.prompts = [];
  h.confirms = [];
  C.showPrompt = async (msg) => { h.prompts.push(msg); return '1234'; };
  C.showConfirm = async (msg) => { h.confirms.push(msg); return true; };
  // ปลดล็อกหน้าจอแบบเดียวกับที่คนกด PIN จริง
  C.loggedInEmployee = C.employees[0];
  C.actionPin = '1234';
  return h;
}

test('owner who unlocked with a PIN only confirms, and the remembered PIN goes to the server', async () => {
  const h = setup('Owner');
  const auth = await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h.prompts.length, 0, 'ต้องไม่ถาม PIN');
  assert.equal(h.confirms.length, 1);
  assert.ok(h.confirms[0].startsWith('ยืนยันการลบสินค้า?'), 'ได้ ' + h.confirms[0]);
  assert.ok(h.confirms[0].includes('สมชาย (Owner)'), 'ต้องบอกว่าทำในชื่อใคร');
  assert.equal(auth.employeeId, 'E1');
  assert.equal(auth.pin, '1234');
});

test('admin pressing cancel on the confirm stops the action', async () => {
  const h = setup('Admin');
  h.C.showConfirm = async () => false;
  assert.equal(await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:'), null);
});

test('a caller that already asked does not ask the owner twice', async () => {
  const h = setup('Owner');
  const auth = await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบพนักงาน:', { confirmed: true });
  assert.equal(h.confirms.length + h.prompts.length, 0);
  assert.equal(auth.pin, '1234');
});

test('restore and archive always ask the owner for the PIN', async () => {
  const h = setup('Owner');
  await h.C.requireActionPin('ใส่รหัส PIN ของเจ้าของ/ผู้ดูแลระบบเพื่อยืนยันการกู้คืนข้อมูล:', { alwaysPin: true });
  assert.equal(h.prompts.length, 1);
  assert.equal(h.confirms.length, 0);
});

test('staff still type their PIN every time', async () => {
  const h = setup('Staff');
  const auth = await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h.prompts.length, 1);
  assert.equal(h.confirms.length, 0);
  assert.equal(auth.employeeId, 'E1');
});

test('after an app restart the owner types the PIN once, then only confirms', async () => {
  const h = setup('Owner');
  h.C.actionPin = null;
  await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h.prompts.length, 1, 'ครั้งแรกต้องถาม PIN');
  await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h.prompts.length, 1, 'ครั้งต่อไปไม่ต้องถามอีก');
  assert.equal(h.confirms.length, 1);
});

test('a changed PIN or a lost Owner role falls back to the PIN box', async () => {
  const h = setup('Owner');
  h.C.employees[0] = Object.assign({}, h.C.employees[0], { pinHash: 'h:9999:s1' });
  h.C.showPrompt = async (msg) => { h.prompts.push(msg); return null; };
  await h.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h.prompts.length, 1);
  assert.equal(h.C.actionPin, null, 'PIN เก่าที่ใช้ไม่ได้แล้วต้องถูกลืม');

  const h2 = setup('Owner');
  h2.C.employees[0] = Object.assign({}, h2.C.employees[0], { role: 'Staff' });
  await h2.C.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
  assert.equal(h2.prompts.length, 1);
});

test('locking the screen forgets the PIN', async () => {
  const h = setup('Owner');
  h.C.resetViewForNextUser = () => {};
  h.C.showPinLockScreen = () => {};
  h.C.updateLoggedInUserLabel = () => {};
  h.C.logPinAttempt = () => {};
  await h.C.lockApp();
  assert.equal(h.C.actionPin, null);

  const h2 = setup('Owner');
  Object.assign(h2.C, { resetViewForNextUser() {}, showPinLockScreen() {}, updateLoggedInUserLabel() {}, logPinAttempt() {} });
  h2.C.autoLockNow();
  assert.equal(h2.C.actionPin, null);
});

test('the PIN is never written to the device', async () => {
  const h = setup('Owner');
  h.C.saveLocalState && h.C.saveLocalState();
  const stored = JSON.stringify(h.store || {});
  assert.ok(!stored.includes('1234'), 'PIN หลุดลง localStorage');
});

test('restore and archive are the call sites that keep the PIN', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  const always = src.match(/requireActionPin\([^\n]*alwaysPin: true/g) || [];
  assert.equal(always.length, 2);
  assert.ok(always.some(l => l.includes('กู้คืนข้อมูล')));
  assert.ok(always.some(l => l.includes('archive')));
});
