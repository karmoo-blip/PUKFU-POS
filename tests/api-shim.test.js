// ตัวเรียกเซิร์ฟเวอร์ (google.script.run แบบของเรา) ต้องแยก "เน็ตหลุด" กับ "เซิร์ฟเวอร์ตอบว่าทำไม่สำเร็จ" ออกจากกัน
// และบั๊กในโค้ดหลังบันทึกสำเร็จต้องไม่ถูกรายงานเป็นการเชื่อมต่อล้มเหลว (ของเดิมเป็นแบบนั้น)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// บล็อกแรกของ app.js คือตัวเรียกเซิร์ฟเวอร์ ตัดมาแค่ถึงจุดที่ปิดบล็อก
const SHIM_END = APP.search(/\n {2}\}\)\(\);/) + 8;
const SHIM = APP.slice(0, SHIM_END);

function loadShim(fetchImpl) {
  const store = new Map([['pos_apiUrl', 'https://api.example/'], ['pos_apiKey', 'k']]);
  const timeouts = [];
  const sandbox = {
    localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
    location: { origin: 'http://localhost' },
    fetch: fetchImpl,
    AbortController,
    setTimeout: (fn) => { timeouts.push(fn); return 0; },
    clearTimeout: () => {},
    Proxy, Promise, JSON, Error, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SHIM, sandbox);
  return { run: () => sandbox.google.script.run, timeouts };
}

const reply = (body, status) => () => Promise.resolve({ status: status || 200, json: () => Promise.resolve(body) });
const settle = () => new Promise(r => setImmediate(r));

test('a server that answers "failed" reaches the failure handler with its reason', async () => {
  const { run } = loadShim(reply({ ok: false, error: 'D1_ERROR: no such column: lang3' }, 500));
  let got = null;
  run().withSuccessHandler(() => { throw new Error('should not succeed'); }).withFailureHandler((e) => { got = e; }).saveMenuItem({});
  await settle();
  assert.ok(got, 'ต้องเรียก failure handler');
  assert.equal(got.fromServer, true, 'ต้องบอกได้ว่าเซิร์ฟเวอร์ตอบมาแล้ว ไม่ใช่เน็ตหลุด');
  assert.match(got.message, /no such column: lang3/);
});

test('no connection reaches the failure handler without the server flag', async () => {
  const { run } = loadShim(() => Promise.reject(new TypeError('Failed to fetch')));
  let got = null;
  run().withFailureHandler((e) => { got = e; }).getMenuData();
  await settle();
  assert.ok(got);
  assert.ok(!got.fromServer);
});

test('a bug in the success handler is not reported as a connection failure', async () => {
  const { run, timeouts } = loadShim(reply({ ok: true, result: { success: true } }));
  let failed = false;
  let succeeded = false;
  run()
    .withSuccessHandler(() => { succeeded = true; throw new Error('bug after saving'); })
    .withFailureHandler(() => { failed = true; })
    .saveMenuItem({});
  await settle();
  assert.equal(succeeded, true);
  assert.equal(failed, false, 'บันทึกสำเร็จแล้ว ห้ามขึ้นว่าเชื่อมต่อไม่สำเร็จ');
  assert.throws(() => timeouts.forEach(fn => fn()), /bug after saving/, 'บั๊กต้องโผล่ใน console ไม่ใช่หายเงียบ');
});

test('the till shows the server reason instead of "can\'t connect"', () => {
  const { loadController } = require('./helpers/load-controller');
  const { C } = loadController({});
  assert.equal(C.failText({ fromServer: true, message: 'no such column: lang3' }), 'บันทึกไม่สำเร็จ เซิร์ฟเวอร์แจ้งว่า: no such column: lang3');
  assert.equal(C.failText(new TypeError('Failed to fetch')), 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
  assert.equal(C.failText(null, 'โหลดไม่สำเร็จ'), 'โหลดไม่สำเร็จ');
});
