const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  escAttr,
  escHtml,
  bufToHex,
  sha256Hex,
  hashPinWithSalt,
  calcVatBreakdown,
  unitCost,
  recipeCost,
  queueEtaRange,
} = require('../pure-helpers.js');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

test('escAttr escapes &, ", \', <, >', () => {
  assert.equal(escAttr(`&"'<>`), '&amp;&quot;&#39;&lt;&gt;');
});

test('escHtml delegates to escAttr and handles null/undefined', () => {
  assert.equal(escHtml('<b>ok</b>'), '&lt;b&gt;ok&lt;/b&gt;');
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
});

test('bufToHex converts a buffer to lowercase hex', () => {
  assert.equal(bufToHex(new Uint8Array([0, 255, 16]).buffer), '00ff10');
});

test('sha256Hex matches an independently computed SHA-256 digest', async () => {
  const input = 'pukfu-pos-test-string';
  const expected = crypto.createHash('sha256').update(input).digest('hex');
  assert.equal(await sha256Hex(input), expected);
});

test('hashPinWithSalt hashes salt+pin (trimmed) via sha256Hex', async () => {
  const salt = 'deadbeef';
  const pin = ' 1234 ';
  const expected = crypto.createHash('sha256').update(salt + '1234').digest('hex');
  assert.equal(await hashPinWithSalt(pin, salt), expected);
});

test('calcVatBreakdown computes exVat/vatAmount for a given rate', () => {
  const { exVat, vatAmount, rate } = calcVatBreakdown(107, 7);
  assertClose(vatAmount, 7);
  assertClose(exVat, 100);
  assert.equal(rate, 7);
});

test('calcVatBreakdown treats a non-numeric rate as 0', () => {
  const result = calcVatBreakdown(100, 'abc');
  assert.equal(result.rate, 0);
  assert.equal(result.vatAmount, 0);
  assert.equal(result.exVat, 100);
});

// ---- ingredient cost ----

const COFFEE = { id: 'INV01', name: 'เมล็ดกาแฟด้อยช้าง', purchase_price: 900, purchase_factor: 1000 };
const CUP = { id: 'INV13', name: 'แก้ว 20 oz', purchase_price: 150, purchase_factor: 50 };
const NO_PRICE = { id: 'INV14', name: 'ฝากระดก', purchase_factor: 50 };

test('unitCost divides the purchase price by the purchase factor', () => {
  assertClose(unitCost(COFFEE), 0.9);
  assertClose(unitCost(CUP), 3);
});

test('unitCost treats a missing or zero factor as 1', () => {
  assertClose(unitCost({ purchase_price: 25 }), 25);
  assertClose(unitCost({ purchase_price: 25, purchase_factor: 0 }), 25);
});

test('unitCost returns null when the price is unknown, not zero', () => {
  assert.equal(unitCost(NO_PRICE), null);
  assert.equal(unitCost({ purchase_price: 0, purchase_factor: 50 }), null);
  assert.equal(unitCost(null), null);
});

test('recipeCost sums each ingredient contribution', () => {
  const byId = { INV01: COFFEE, INV13: CUP };
  const r = recipeCost(
    [{ inventory_item_id: 'INV01', qty: 18 }, { inventory_item_id: 'INV13', qty: 1 }],
    byId
  );
  assertClose(r.total, 18 * 0.9 + 3);
  assert.equal(r.lines.length, 2);
  assertClose(r.lines[0].subtotal, 16.2);
  assert.equal(r.lines[0].name, 'เมล็ดกาแฟด้อยช้าง');
  assert.deepEqual(r.missingPrice, []);
});

test('recipeCost refuses a partial total when any ingredient has no price', () => {
  const byId = { INV01: COFFEE, INV14: NO_PRICE };
  const r = recipeCost(
    [{ inventory_item_id: 'INV01', qty: 18 }, { inventory_item_id: 'INV14', qty: 1 }],
    byId
  );
  assert.equal(r.total, null, 'total must be null, never a partial sum');
  assert.equal(r.missingPrice.length, 1);
  assert.equal(r.missingPrice[0].name, 'ฝากระดก');
  assert.equal(r.lines[1].subtotal, null);
});

test('recipeCost handles an ingredient missing from inventory', () => {
  const r = recipeCost([{ inventory_item_id: 'GONE', qty: 5 }], {});
  assert.equal(r.total, null);
  assert.equal(r.lines[0].name, 'GONE');
});

test('recipeCost on an empty recipe is zero, not null', () => {
  assert.equal(recipeCost([], {}).total, 0);
  assert.equal(recipeCost(null, {}).total, 0);
});

test('recipeCost accepts the camelCase key the recipe form sends', () => {
  const r = recipeCost([{ inventoryItemId: 'INV13', qty: 2 }], { INV13: CUP });
  assertClose(r.total, 6);
});

// ---- queue ETA ----

test('queueEtaRange scales with the number of drinks ahead', () => {
  assert.deepEqual(queueEtaRange(1, 3), { low: 3, high: 6 });
  assert.deepEqual(queueEtaRange(2, 3), { low: 6, high: 9 });
  assert.deepEqual(queueEtaRange(5, 4), { low: 20, high: 24 });
});

test('queueEtaRange returns null when nothing is ahead', () => {
  assert.equal(queueEtaRange(0, 3), null, 'must not render "0 minutes"');
  assert.equal(queueEtaRange(-1, 3), null);
  assert.equal(queueEtaRange(null, 3), null);
});

test('queueEtaRange returns null when the shop set no prep time', () => {
  assert.equal(queueEtaRange(3, 0), null);
  assert.equal(queueEtaRange(3, null), null);
  assert.equal(queueEtaRange(3, 'abc'), null);
});

test('queueEtaRange handles fractional drink counts', () => {
  assert.deepEqual(queueEtaRange(1.5, 3), { low: 5, high: 8 });
});
