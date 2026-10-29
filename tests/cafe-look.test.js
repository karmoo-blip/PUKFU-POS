'use strict';

// หน้าตาแบบคาเฟ่ ขั้นที่ 1: เปิดเป็นค่าเริ่มต้น สลับกลับเป็นหน้าเรียบได้ในตั้งค่า หน้าล็อกไม่เปลี่ยน และใช้ได้ตอนออฟไลน์
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadController } = require('./helpers/load-controller');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the café look is on by default, and เรียบ switches it off on this device', () => {
  const { C, sandbox } = loadController({});
  const root = sandbox.document.documentElement;
  C.renderSettingsNav = () => {};
  C.applyLook();
  assert.ok(root.classList.contains('look-cafe'), 'เครื่องที่ยังไม่เคยเลือกต้องได้หน้าคาเฟ่');
  C.setLook('plain');
  assert.ok(!root.classList.contains('look-cafe'));
  assert.equal(sandbox.localStorage.getItem('pos_look'), 'plain');
  C.setLook('cafe');
  assert.ok(root.classList.contains('look-cafe'));
});

test('ลดการเคลื่อนไหว toggles the calm class and is remembered', () => {
  const { C, sandbox } = loadController({});
  const root = sandbox.document.documentElement;
  C.renderSettingsNav = () => {};
  C.applyLook();
  assert.ok(!root.classList.contains('calm'));
  C.toggleCalm();
  assert.ok(root.classList.contains('calm'));
  assert.equal(sandbox.localStorage.getItem('pos_calm'), '1');
  C.toggleCalm();
  assert.ok(!root.classList.contains('calm'));
});

test('the look card sits at the top of the settings menu and shows the current choice', () => {
  const { C, el } = loadController({});
  C.currentSettingsUser = null;
  C.renderUpdateCard = () => {};
  C.renderInstallCard = () => {};
  C.renderSettingsNav();
  const html = el('settings-nav').innerHTML;
  assert.ok(html.startsWith('<div class="look-card">'), 'การ์ดหน้าตาต้องอยู่บนสุด');
  assert.ok(/<button[^>]*class="is-on"[^>]*>คาเฟ่<\/button>/.test(html));
  assert.ok(html.includes('ลดการเคลื่อนไหว'));
});

test('the class is set before the first paint, so the plain look never flashes', () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  const early = head.indexOf("classList.add('look-cafe')");
  assert.ok(early !== -1, 'ต้องมีสคริปต์ตั้งคลาสใน <head>');
  assert.ok(early < head.indexOf('style.css'), 'ต้องตั้งก่อนโหลดสไตล์');
});

test('the login screen keeps its own colours', () => {
  const css = read('style.css');
  assert.ok(/html\.look-cafe #pin-lock-screen \{[^}]*--color-primary: #1f4d3a/.test(css), 'หน้าล็อกต้องคืนสีเดิม');
});

test('the handwriting font ships with the app and works offline', () => {
  assert.ok(read('fonts-mali.css').includes('data:font/woff2;base64,'), 'ฟอนต์ต้องฝังในไฟล์ ไม่โหลดจากเน็ต');
  assert.ok(read('index.html').includes('href="fonts-mali.css"'));
  assert.ok(read('sw.js').includes("'./fonts-mali.css'"), 'เว็บออฟไลน์ต้องมีฟอนต์ในแคช');
  assert.ok(read('scripts/build-app.js').includes("'fonts-mali.css'"), 'แอป Android ต้องมีไฟล์ฟอนต์');
  const yml = read('.github/workflows/deploy-pages.yml');
  assert.ok(yml.includes("'fonts-mali.css'") && yml.includes('fonts-mali.css sw.js'), 'ต้องขึ้นเว็บและปลุก deploy ได้');
});

test('the new Settings words have Burmese', () => {
  const vm = require('node:vm');
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(read('lang-my.js'), sb);
  for (const k of ['หน้าตา', 'หน้าตาแอป', 'เฉพาะเครื่องนี้', 'คาเฟ่', 'เรียบ', 'ลดการเคลื่อนไหว', 'ปิดภาพเคลื่อนไหว เหมาะกับเครื่องช้า']) {
    assert.ok(sb.window.LANG_MY[k], k);
  }
});
