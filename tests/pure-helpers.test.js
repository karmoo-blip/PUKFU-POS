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
