'use strict';

// วันที่บนหน้าจอตามภาษาที่เลือก: พม่าได้ชื่อเดือนพม่า เลข 0-9 ส่วนที่พิมพ์ออกกระดาษยังเป็นไทย
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

const THAI = /[฀-฾เ-๿]/;

test('dateLocale follows the chosen language, with 0-9 digits in Burmese', () => {
  const { C } = loadController({});
  C.lang = 'th';
  assert.equal(C.dateLocale(), 'th-TH');
  C.lang = 'my';
  const shown = new Date('2026-10-29T08:30:00Z').toLocaleDateString(C.dateLocale(), { day: 'numeric', month: 'short' });
  assert.ok(!THAI.test(shown), 'ยังเป็นเดือนไทย: ' + shown);
  assert.ok(/29/.test(shown), 'ตัวเลขต้องเป็น 0-9: ' + shown);
});

test('only the printed receipt and printed report still fix dates to Thai', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fixed = src.split('\n').filter(l => l.includes("'th-TH'") && !l.includes('dateLocale') && !l.includes("this.lang === 'my'"));
  assert.equal(fixed.length, 3, fixed.join('\n'));
  assert.ok(fixed.every(l => l.includes('R.text(doc') || l.includes('พิมพ์เมื่อ')), 'ที่เหลือต้องเป็นของที่พิมพ์ออกกระดาษเท่านั้น');
});
