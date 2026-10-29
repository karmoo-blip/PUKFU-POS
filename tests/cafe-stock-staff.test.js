'use strict';

// หน้าตาคาเฟ่ ขั้นที่ 6: โหลวัตถุดิบตามหน่วยซื้อ ของใกล้หมด และตรา "ฟรี!" บนแท็บพนักงาน
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

// ค่าที่ได้มาจากในกล่อง vm เป็นอ็อบเจ็กต์คนละโลก เทียบผ่าน JSON
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

test('jars fill against two purchase units, and less than one unit is low', () => {
  const { C } = loadController({});
  const bag = { stock: 2000, unit: 'g', purchase_unit: 'ถุง', purchase_factor: 1000 };
  same(C.stockJar(bag), { pct: 100, low: false });
  same(C.stockJar({ ...bag, stock: 1500 }), { pct: 75, low: false });
  same(C.stockJar({ ...bag, stock: 300 }), { pct: 15, low: true });
  same(C.stockJar({ ...bag, stock: 5000 }), { pct: 100, low: false }, 'ไม่ล้นโหล');
});

test('without a purchase unit a jar is full while there is stock, and empty and low at zero', () => {
  const { C } = loadController({});
  same(C.stockJar({ stock: 3, unit: 'ชิ้น' }), { pct: 100, low: false });
  same(C.stockJar({ stock: 0, unit: 'ชิ้น' }), { pct: 0, low: true });
  same(C.stockJar({ stock: -2, unit: 'ชิ้น' }), { pct: 0, low: true });
});

test('the stock list marks low rows and the note names them', () => {
  const { C, el } = loadController({});
  C.inventoryData = [
    { id: '1', name: 'นมสด', stock: 4000, unit: 'ml', purchase_unit: 'ขวด', purchase_factor: 2000 },
    { id: '2', name: 'ไข่มุก', stock: 200, unit: 'g', purchase_unit: 'ถุง', purchase_factor: 1000 }
  ];
  C.renderInventory();
  const html = el('inventory-list').innerHTML;
  assert.equal((html.match(/ inv-low"/g) || []).length, 1);
  assert.ok(html.includes('<span class="inv-low-tag">ใกล้หมด</span>'));
  assert.equal(el('inventory-low-note').innerText, 'ใกล้หมด 1 อย่าง: ไข่มุก');
  assert.ok(!el('inventory-low-note').classList.contains('hidden'));
});

test('the free stamp only shows in the café look and is cleared away', () => {
  const plain = loadController({});
  let added = 0;
  plain.C.stampFree({ appendChild: () => { added++; } }, 'drink');
  assert.equal(added, 0, 'หน้าเรียบไม่มีตรา');
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.ok(css.includes('.inv-jar, .inv-low-tag, .inv-low-note { display: none; }'), 'หน้าเรียบไม่มีโหล');
});
