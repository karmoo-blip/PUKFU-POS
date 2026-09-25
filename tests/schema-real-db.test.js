// รันการอัปเดตโครงตารางของ worker กับ SQLite จริง (node:sqlite) แล้วเอาทุกคำสั่ง SQL ใน worker มา prepare
// SQLite ตรวจชื่อตาราง/คอลัมน์ตอน prepare เลย ถ้า handler ไหนใช้คอลัมน์ที่การอัปเดตไม่ได้สร้าง เทสต์นี้จะล้ม
// ต้นเหตุ: menu.lang3 ถูกเพิ่มในรายการแต่ลืมบวกเลขเวอร์ชัน ฐานจริงไม่เคยได้คอลัมน์ บันทึกสินค้าล้มทุกครั้ง
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), 'utf8');

// D1 บางๆ ทับ SQLite จริง พอให้ worker เดินได้
function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); return stmt; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        _sql: sql, _args: () => args,
      };
      return stmt;
    },
    async batch(stmts) { for (const s of stmts) db.prepare(s._sql).run(...s._args()); return []; },
  };
}

async function migrate(db) {
  const mod = await import('../worker/worker.js?realdb=' + Date.now() + Math.random());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn: 'getSweetnessLevels', args: [] }),
  }), { DB: d1(db), API_TOKEN: 'staff-token' });
  assert.equal(res.status, 200);
}

const CREATES = [...SRC.matchAll(/"(CREATE TABLE IF NOT EXISTS (\w+) \([^"]+\))"/g)].map(m => ({ sql: m[1], table: m[2] }));
const ADDED = [...SRC.matchAll(/\["(\w+)", "(\w+)", "(\w+)"\]/g)].map(m => ({ table: m[1], column: m[2], type: m[3] }));

// ฐานแบบร้านเก่า: ตารางครบ แต่ยังไม่มีคอลัมน์ที่เพิ่มทีหลัง และเลขเวอร์ชันเป็นของรอบก่อน
function oldShopDb() {
  const db = new DatabaseSync(':memory:');
  for (const c of CREATES) {
    let sql = c.sql;
    for (const a of ADDED.filter(x => x.table === c.table)) sql = sql.replace(new RegExp(',\\s*' + a.column + ' ' + a.type + '\\b'), '');
    db.exec(sql);
  }
  db.prepare("INSERT INTO shop_info (key, value) VALUES ('schema_version', '2026-08-29.1')").run();
  return db;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

// ทุกข้อความ SQL ใน worker ที่ขึ้นต้นด้วย SELECT/INSERT/UPDATE/DELETE
// ส่วน ${...} ใน template แทนด้วย ? ถ้ากลายเป็นไวยากรณ์เพี้ยน (เช่นชื่อตารางแบบไดนามิก) ข้ามไป สนใจแค่ตาราง/คอลัมน์ที่ไม่มีจริง
function workerSql() {
  const out = new Set();
  const re = /(["'`])((?:SELECT|INSERT|UPDATE|DELETE|WITH)\b(?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const m of SRC.matchAll(re)) out.add(m[2].replace(/\$\{[^}]*\}/g, '?'));
  return [...out];
}

function unknownRefs(db) {
  const bad = [];
  for (const sql of workerSql()) {
    try { db.prepare(sql); } catch (e) {
      if (/no such (column|table)/.test(e.message)) bad.push(e.message + '  ←  ' + sql.slice(0, 120));
    }
  }
  return bad;
}

test('an older shop database gets every later column the moment the new server starts', async () => {
  const db = oldShopDb();
  assert.ok(!columns(db, 'menu').includes('lang3'), 'ฐานตั้งต้นต้องยังไม่มี lang3 เหมือนร้านจริง');
  await migrate(db);
  for (const a of ADDED) assert.ok(columns(db, a.table).includes(a.column), `ขาด ${a.table}.${a.column}`);
  const v = db.prepare("SELECT value FROM shop_info WHERE key = 'schema_version'").get().value;
  assert.notEqual(v, '2026-08-29.1', 'ต้องบันทึกเลขเวอร์ชันใหม่');
});

test('every SQL statement in the server works on an upgraded older shop', async () => {
  const db = oldShopDb();
  await migrate(db);
  assert.ok(workerSql().length > 80, 'ต้องเจอคำสั่ง SQL ในไฟล์ worker จำนวนมาก ได้ ' + workerSql().length);
  assert.deepEqual(unknownRefs(db), []);
});

test('every SQL statement in the server works on a brand-new database', async () => {
  const db = new DatabaseSync(':memory:');
  await migrate(db);
  assert.deepEqual(unknownRefs(db), []);
});

test('saving a product works on an upgraded older shop', async () => {
  const db = oldShopDb();
  db.prepare("INSERT INTO menu (sku, name, price, cost) VALUES ('A', 'ลาเต้', 60, 12)").run();
  const mod = await import('../worker/worker.js?realdb2=' + Date.now());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn: 'saveMenuItem', args: [{ sku: 'A', name: 'ลาเต้', price: 65, lang3: 'လာတေး' }] }),
  }), { DB: d1(db), API_TOKEN: 'staff-token' });
  const body = await res.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  const row = db.prepare("SELECT price, cost, lang3 FROM menu WHERE sku = 'A'").get();
  assert.equal(row.price, 65);
  assert.equal(row.cost, 12, 'ต้นทุนเดิมต้องไม่หาย');
  assert.equal(row.lang3, 'လာတေး');
});
