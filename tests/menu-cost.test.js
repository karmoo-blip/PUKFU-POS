// ต้นทุนที่กรอกเองย้ายจากฟอร์มสินค้าไปหน้าต้นทุนเมนู: บันทึกสินค้าต้องไม่ล้างต้นทุนเดิม และแก้ต้นทุนได้โดยไม่แตะช่องอื่น
const test = require('node:test');
const assert = require('node:assert/strict');

function fakeDb(existing) {
  const writes = [];
  const db = {
    writes,
    prepare(text) {
      let bound = [];
      const stmt = {
        bind(...a) { bound = a; return stmt; },
        async run() { writes.push({ text, bound }); return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return { value: '999' };
          if (/FROM menu WHERE sku/.test(text)) return existing;
          return null;
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
    async batch() { return []; },
  };
  return db;
}

async function call(db, fn, arg) {
  const mod = await import('../worker/worker.js?menucost=' + Date.now() + Math.random());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn, args: [arg] }),
  }), { DB: db, API_TOKEN: 'staff-token' });
  return (await res.json()).result;
}

const LATTE = { sku: 'A', name: 'ลาเต้', price: 60, cost: 12, category: 'กาแฟ', lang2: '', lang3: '', image: '' };

test('saving a product without a cost keeps the cost already typed', async () => {
  const db = fakeDb(LATTE);
  const r = await call(db, 'saveMenuItem', { sku: 'A', name: 'ลาเต้', price: 65, category: 'กาแฟ' });
  assert.equal(r.success, true);
  const update = db.writes.find(w => /UPDATE menu SET name=/.test(w.text));
  assert.equal(update.bound[1], 65, 'ราคาเปลี่ยนตามที่แก้');
  assert.equal(update.bound[6], 12, 'ต้นทุนต้องคงเป็น 12 ไม่ถูกล้างเป็น 0');
});

test('an old till that still sends a cost can still set it', async () => {
  const db = fakeDb(LATTE);
  await call(db, 'saveMenuItem', { sku: 'A', name: 'ลาเต้', price: 60, cost: 14, category: 'กาแฟ' });
  const update = db.writes.find(w => /UPDATE menu SET name=/.test(w.text));
  assert.equal(update.bound[6], 14);
});

test('the cost page saves only the cost', async () => {
  const db = fakeDb(LATTE);
  const r = await call(db, 'saveMenuCost', { sku: 'A', cost: 9.5, actorName: 'เจ้าของ' });
  assert.equal(r.success, true);
  const update = db.writes.find(w => /UPDATE menu SET cost = \?/.test(w.text));
  assert.deepEqual([...update.bound].join(','), '9.5,A');
  assert.ok(!db.writes.some(w => /UPDATE menu SET name=/.test(w.text)), 'ห้ามแตะชื่อ ราคา รูป');
});

test('the cost page refuses a negative or non-number cost', async () => {
  for (const cost of [-1, 'abc']) {
    const db = fakeDb(LATTE);
    const r = await call(db, 'saveMenuCost', { sku: 'A', cost });
    assert.equal(r.success, false);
    assert.ok(!db.writes.some(w => /UPDATE menu/.test(w.text)));
  }
});
