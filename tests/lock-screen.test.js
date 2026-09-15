// ล็อกจอแล้วคนถัดไปต้องเริ่มที่หน้าขาย ไม่ใช่หน้าที่คนก่อนเปิดค้างไว้
// บั๊กเดิม: เจ้าของเปิดหน้าตั้งค่าแล้วล็อกจอ พนักงานใส่ PIN ตัวเองแล้วเห็นหน้าตั้งค่าต่อได้เลย
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadController } = require('./helpers/load-controller');

const OWNER = { id: 'e1', name: 'เจ้าของ', role: 'Owner', active: true };

function openOwnerSettings(C, el) {
  C.loggedInEmployee = OWNER;
  C.currentSettingsUser = OWNER;
  C.switchView('settings');
  el('settings-shell').classList.remove('is-home');
  el('settings-shell').classList.add('is-page');
  el('settings-nav').innerHTML = '<button>สำรองข้อมูล</button>';
  el('settings-user-label').innerText = 'เข้าสู่ระบบในฐานะ: เจ้าของ (Owner)';
  C.currentSettingsTab = 'backup';
}

test('locking from Settings sends the next person to the selling screen', async () => {
  const { C, el } = loadController({ views: ['pos', 'settings'] });
  openOwnerSettings(C, el);
  await C.lockApp();

  assert.ok(el('view-settings').classList.contains('hidden'), 'หน้าตั้งค่าต้องถูกซ่อน');
  assert.ok(!el('view-pos').classList.contains('hidden'), 'ต้องกลับมาหน้าขาย');
  assert.equal(C.currentSettingsTab, null);
  assert.ok(el('settings-shell').classList.contains('is-home'));
  assert.equal(el('settings-nav').innerHTML, '', 'เมนูตั้งค่าของคนก่อนต้องไม่ค้าง');
  assert.equal(el('settings-user-label').innerText, '');
  assert.equal(C.loggedInEmployee, null);
});

test('the auto-lock does the same reset', () => {
  const { C, el } = loadController({ views: ['pos', 'settings'] });
  openOwnerSettings(C, el);
  C.autoLockNow();
  assert.ok(el('view-settings').classList.contains('hidden'));
  assert.ok(!el('view-pos').classList.contains('hidden'));
  assert.equal(C.currentSettingsTab, null);
});

test('cancelling the lock leaves the page alone', async () => {
  const { C, el } = loadController({ views: ['pos', 'settings'] });
  openOwnerSettings(C, el);
  C.showConfirm = () => Promise.resolve(false);
  await C.lockApp();
  assert.ok(!el('view-settings').classList.contains('hidden'));
  assert.equal(C.currentSettingsTab, 'backup');
  assert.equal(C.loggedInEmployee, OWNER);
});

test('the cart survives the lock so a half-rung order is not lost', async () => {
  const { C, el } = loadController({ views: ['pos', 'settings'] });
  C.cart = [{ name: 'ลาเต้', qty: 1, price: 60 }];
  openOwnerSettings(C, el);
  await C.lockApp();
  assert.equal(C.cart.length, 1);
});
