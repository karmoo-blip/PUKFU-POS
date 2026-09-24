// ร้านตัดสต๊อกเองด้วยมือ การขายต้องไม่แตะสต๊อกวัตถุดิบเลย แม้เมนูนั้นจะตั้งสูตรไว้
const test = require('node:test');
const assert = require('node:assert/strict');

// D1 ปลอม: มีสูตรกับวัตถุดิบอยู่จริง ถ้าโค้ดหักสต๊อกจะเจอข้อมูลให้หักได้
function fakeDb() {
  const sql = [];
  const stmtFor = (text) => {
    const stmt = {
      text,
      bind() { return stmt; },
      async run() { sql.push(text); return { success: true }; },
      async first() {
        sql.push(text);
        if (/FROM inventory/.test(text)) return { name: 'เมล็ดกาแฟ', current_stock: 1000 };
        return null;
      },
      async all() {
        sql.push(text);
        if (/FROM recipes/.test(text)) return { results: [{ menu_sku: 'LATTE', inventory_item_id: 'INV-1', qty: 18 }] };
        return { results: [] };
      },
    };
    return stmt;
  };
  return {
    sql,
    prepare(text) { return stmtFor(text); },
    async batch(stmts) { for (const s of stmts) sql.push(s.text); return []; },
  };
}

test('a sale with a recipe leaves ingredient stock alone', async () => {
  const mod = await import('../worker/worker.js?stock=' + Date.now());
  const db = fakeDb();
  const req = new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn: 'syncOfflineOrders', args: [[{
      invoice: 'INV-1', total: 120, paymentType: 'cash',
      items: [{ sku: 'LATTE', name: 'ลาเต้', qty: 2, price: 60 }],
    }]] }),
  });
  const res = await mod.default.fetch(req, { DB: db, API_TOKEN: 'staff-token' });
  assert.strictEqual(res.status, 200);
  assert.ok(db.sql.some(s => /INSERT INTO sales/.test(s)), 'บิลต้องลงตามปกติ');
  assert.ok(!db.sql.some(s => /UPDATE inventory/.test(s)), 'การขายต้องไม่ไปแก้ยอดสต๊อก');
  assert.ok(!db.sql.some(s => /INSERT INTO inventory_log/.test(s)), 'การขายต้องไม่เขียนบันทึกสต๊อก');
});
