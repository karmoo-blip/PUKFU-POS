// รายงานใช้ต้นทุนจากสูตรก่อน (รวมค่าอื่นๆ ต่อแก้ว) ถ้าราคาวัตถุดิบครบ ไม่งั้นใช้ต้นทุนที่กรอกเอง
// worker คิดเองแยกจาก pure-helpers.js (PeePukFu import ข้ามไม่ได้) เทสต์นี้กันไม่ให้สองฝั่งคิดไม่ตรงกัน
const test = require('node:test');
const assert = require('node:assert/strict');
const { recipeCost } = require('../pure-helpers.js');

const MENU = [
  { sku: 'LATTE', cost: 12 },   // สูตรครบ + น้ำแข็ง หลอด → ใช้สูตร
  { sku: 'TEA', cost: 9 },      // สูตรมีวัตถุดิบที่ยังไม่ใส่ราคา → ใช้ที่กรอก
  { sku: 'COCOA', cost: 15 },   // ไม่มีสูตร → ใช้ที่กรอก
  { sku: 'WATER', cost: 0 },    // ไม่มีอะไรเลย → 0
  { sku: 'SODA', cost: 7 },     // สูตรมีแต่ค่าอื่นที่ถูกลบไปแล้ว + วัตถุดิบครบ
];
const INVENTORY = [
  { id: 'MILK', name: 'นมสด', purchase_price: 60, purchase_factor: 1000 },
  { id: 'BEAN', name: 'เมล็ดกาแฟ', purchase_price: 450, purchase_factor: 1000 },
  { id: 'TEA', name: 'ผงชา', purchase_price: 0, purchase_factor: 500 },
  { id: 'SYRUP', name: 'น้ำเชื่อม', purchase_price: 40, purchase_factor: 0 },
];
const EXTRAS = JSON.stringify([{ id: 'ice', name: 'น้ำแข็ง', price: 1 }, { id: 'straw', name: 'หลอด', price: 0.3 }]);
const RECIPES = [
  { menu_sku: 'LATTE', inventory_item_id: 'BEAN', qty: 18 },
  { menu_sku: 'LATTE', inventory_item_id: 'MILK', qty: 150 },
  { menu_sku: 'LATTE', inventory_item_id: 'extra:ice', qty: 1 },
  { menu_sku: 'LATTE', inventory_item_id: 'extra:straw', qty: 1 },
  { menu_sku: 'TEA', inventory_item_id: 'TEA', qty: 15 },
  { menu_sku: 'TEA', inventory_item_id: 'extra:ice', qty: 1 },
  { menu_sku: 'SODA', inventory_item_id: 'SYRUP', qty: 0.05 },
  { menu_sku: 'SODA', inventory_item_id: 'extra:gone', qty: 1 },
];
const SALES = [
  { sku: 'LATTE', name: 'ลาเต้', qty: 2, price: 60, bkk_date: '2026-09-25', invoice: 'A' },
  { sku: 'TEA', name: 'ชา', qty: 1, price: 50, bkk_date: '2026-09-25', invoice: 'B' },
  { sku: 'COCOA', name: 'โกโก้', qty: 1, price: 55, bkk_date: '2026-09-25', invoice: 'C' },
];

function fakeDb() {
  const db = {
    prepare(text) {
      const stmt = {
        bind() { return stmt; },
        async run() { return { success: true }; },
        async first() {
          if (/schema_version/.test(text)) return { value: '999' };
          if (/key = 'costExtras'/.test(text)) return { value: EXTRAS };
          return null;
        },
        async all() {
          if (/FROM menu/.test(text)) return { results: MENU };
          if (/FROM recipes/.test(text)) return { results: RECIPES };
          if (/FROM inventory/.test(text)) return { results: INVENTORY };
          if (/FROM sales WHERE/.test(text) && /NOT IN/.test(text)) return { results: SALES };
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch() { return []; },
  };
  return db;
}

async function call(fn) {
  const mod = await import('../worker/worker.js?cost=' + Date.now() + Math.random());
  const res = await mod.default.fetch(new Request('https://example.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'staff-token', fn, args: [] }),
  }), { DB: fakeDb(), API_TOKEN: 'staff-token' });
  assert.strictEqual(res.status, 200);
  return (await res.json()).result;
}

// กฎฝั่งหน้าจอ: สูตรครบใช้สูตร ไม่งั้นใช้ที่กรอก
function appRule(sku) {
  const byId = Object.fromEntries(INVENTORY.map(i => [i.id, i]));
  const rows = RECIPES.filter(r => r.menu_sku === sku);
  const total = rows.length ? recipeCost(rows, byId, EXTRAS).total : null;
  return total !== null ? total : MENU.find(m => m.sku === sku).cost;
}

test('the server picks the same cost per menu as the app does', async () => {
  const map = await call('getMenuCostMap');
  for (const m of MENU) {
    assert.ok(Math.abs(map[m.sku] - appRule(m.sku)) < 1e-9, `${m.sku}: เซิร์ฟเวอร์ ${map[m.sku]} หน้าจอ ${appRule(m.sku)}`);
  }
  assert.ok(Math.abs(map.LATTE - (18 * 0.45 + 150 * 0.06 + 1 + 0.3)) < 1e-9, 'ลาเต้ = กาแฟ 8.10 + นม 9 + น้ำแข็ง 1 + หลอด 0.30');
  assert.equal(map.TEA, 9, 'ผงชายังไม่มีราคา ใช้ที่กรอกไว้');
  assert.equal(map.COCOA, 15, 'ไม่มีสูตร ใช้ที่กรอกไว้');
  assert.equal(map.WATER, 0);
  assert.ok(Math.abs(map.SODA - 2) < 1e-9, 'ค่าอื่นที่ลบไปแล้วข้ามเงียบๆ เหลือน้ำเชื่อม 0.05 x 40');
});

test('the sales report counts profit with the recipe cost', async () => {
  const r = await call('getTodaySummary');
  const latte = (18 * 0.45 + 150 * 0.06 + 1 + 0.3);
  assert.ok(Math.abs(r.totalCost - (latte * 2 + 9 + 15)) < 1e-6, 'ต้นทุนรวม = ลาเต้ 2 แก้วจากสูตร + ชา 9 + โกโก้ 15 ได้ ' + r.totalCost);
  const top = r.topSellers.find(t => t.sku === 'LATTE');
  assert.ok(Math.abs(top.cost - latte * 2) < 1e-6);
  assert.equal(top.hasCost, true);
});
