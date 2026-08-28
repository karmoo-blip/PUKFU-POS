// งานสร้างโครงตารางต้องรันครั้งเดียวต่อ isolate ไม่ใช่ทุก request
// เดิม ALTER TABLE กับ CREATE INDEX ถูกยิงจริงทุกครั้งที่เรียก handler แล้วล้มเงียบๆ เพราะของมีอยู่แล้ว
// ตัวจับสถิติข้างล่างเป็นตัวเดียวที่กันไม่ให้ของแบบนั้นแอบกลับเข้ามาอีก
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKER_PATH = path.join(__dirname, '..', 'worker', 'worker.js');

// D1 ปลอม: จำทุกคำสั่งที่ถูกส่งมา แล้วตอบค่าว่างพอให้ handler เดินจนจบ
function fakeDb(opts) {
  const o = opts || {};
  const sql = [];
  const db = {
    sql,
    prepare(text) {
      sql.push(text);
      const stmt = {
        bind() { return stmt; },
        async run() { return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return o.storedVersion ? { value: o.storedVersion } : null;
          return null;
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return db;
}

function post(fn) {
  return new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn, args: [] }),
  });
}

const ddl = (sql) => sql.filter(s => /^\s*(CREATE|ALTER)\b/i.test(s));

test('the worker builds its schema once per isolate, not once per request', async () => {
  const mod = await import('../worker/worker.js');
  const db = fakeDb({});
  const env = { DB: db, API_TOKEN: 'staff-token' };

  const first = await mod.default.fetch(post('getSweetnessLevels'), env);
  assert.strictEqual(first.status, 200);
  const firstDdl = ddl(db.sql);
  assert.ok(firstDdl.length > 20, 'ฐานที่ยังไม่มีเลขเวอร์ชันต้องสร้างโครงให้ครบ ได้ ' + firstDdl.length);

  const before = db.sql.length;
  await mod.default.fetch(post('getSweetnessLevels'), env);
  const secondRequest = db.sql.slice(before);
  assert.strictEqual(ddl(secondRequest).length, 0,
    'request ที่สองต้องไม่แตะโครงตารางเลย ได้ ' + ddl(secondRequest).join(' | '));
  assert.ok(!secondRequest.some(x => /schema_version/.test(x)),
    'request ที่สองไม่ต้องถามเลขเวอร์ชันซ้ำ ธงในตัวโมดูลจำไว้แล้ว');
});

test('the one-time migration still covers every column and index the handlers rely on', async () => {
  // โมดูลจำสถานะไว้ในตัวแปรระดับไฟล์ จึงต้อง import ใหม่ให้เหมือน isolate ที่เพิ่งตื่น
  const mod = await import('../worker/worker.js?fresh=' + Date.now());
  const db = fakeDb({});
  await mod.default.fetch(post('getSweetnessLevels'), { DB: db, API_TOKEN: 'staff-token' });
  const all = db.sql.join('\n');

  const columns = [
    ['employees', 'photo'],
    ['inventory', 'photo'], ['inventory', 'purchase_unit'],
    ['inventory', 'purchase_factor'], ['inventory', 'purchase_price'],
    ['payments', 'created_by'], ['payments', 'edited_by'], ['payments', 'edited_at'],
    ['sales', 'cancelled_by'],
    ['pending_orders', 'ready_at'], ['pending_orders', 'ready_by'],
  ];
  for (const [table, column] of columns) {
    assert.ok(all.includes(`ALTER TABLE ${table} ADD COLUMN ${column}`),
      `ขาดคอลัมน์ ${table}.${column} ที่เดิม handler เพิ่มให้เอง`);
  }

  for (const name of ['idx_payments_invoice', 'idx_sales_invoice', 'idx_sales_timestamp',
    'idx_payments_timestamp', 'idx_pending_orders_status']) {
    assert.ok(all.includes(name), 'ขาด index ' + name);
  }

  assert.ok(/INSERT OR REPLACE INTO shop_info \(key, value\) VALUES \('schema_version'/.test(all),
    'ต้องบันทึกเลขเวอร์ชันไว้ ไม่งั้น isolate หน้าจะรันรายการเต็มซ้ำอีก');
});

test('an isolate whose database already matches the version skips the whole list', async () => {
  const src = fs.readFileSync(WORKER_PATH, 'utf8');
  const version = (src.match(/const SCHEMA_VERSION = "([^"]+)"/) || [])[1];
  assert.ok(version, 'ต้องมี SCHEMA_VERSION ไว้เทียบ');

  const mod = await import('../worker/worker.js?fresh=' + Date.now() + 'b');
  const db = fakeDb({ storedVersion: version });
  await mod.default.fetch(post('getSweetnessLevels'), { DB: db, API_TOKEN: 'staff-token' });

  assert.strictEqual(ddl(db.sql).length, 0, 'เลขเวอร์ชันตรงแล้วต้องไม่ยิงคำสั่งสร้างอะไรอีก');
  assert.strictEqual(db.sql[0], "SELECT value FROM shop_info WHERE key = 'schema_version'",
    'คำสั่งแรกต้องเป็นการเทียบเลขเวอร์ชันคำสั่งเดียว แล้วข้ามรายการทั้งชุด');
});

test('no handler creates tables, columns or indexes on its own again', () => {
  const src = fs.readFileSync(WORKER_PATH, 'utf8');
  const afterSchema = src.slice(src.indexOf('async function ensurePinsHashed'));

  assert.ok(!/ensureColumn|ensureUniqueIndex|ensureExtraTables/.test(afterSchema),
    'ตัวช่วยเดิมถูกยุบรวมไปแล้ว ถ้าโผล่มาอีกแปลว่ามีคนเอา DDL กลับไปไว้ใน handler');
  assert.ok(!/(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)/.test(afterSchema),
    'งานสร้างโครงตารางต้องอยู่ใน ensureSchema ที่เดียว');
  assert.ok(/await ensureSchema\(env\);/.test(src.slice(src.indexOf('export default'))),
    'ทางเข้า fetch ต้องเรียก ensureSchema ก่อนส่งงานให้ handler');
});

test('checking a PIN reads only the employees whose PIN is not hashed yet', () => {
  const src = fs.readFileSync(WORKER_PATH, 'utf8');
  assert.ok(src.includes("SELECT id, pin FROM employees WHERE pin IS NOT NULL AND pin NOT LIKE '%:%'"),
    'ปกติต้องได้ศูนย์แถว ไม่ใช่อ่านพนักงานทั้งตารางทุกครั้งที่มีคนกรอก PIN');
});
