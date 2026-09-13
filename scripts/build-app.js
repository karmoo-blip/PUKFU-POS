// ประกอบไฟล์เว็บสำหรับแอป Android (Capacitor) ลงโฟลเดอร์ www/
// หน้าเว็บบน GitHub Pages ไม่ได้ใช้สคริปต์นี้ — deploy-pages.yml คัดไฟล์ของตัวเองแยกต่างหาก
//
// ต่างจากเว็บตรงไหนบ้าง:
// - ไม่ใส่ sw.js และไม่ลงทะเบียน service worker: ไฟล์อยู่ในตัวแอปอยู่แล้ว ถ้ามี SW จะคืน app.js เก่าจาก cache หลังอัปเดต APK
// - Tailwind กับฟอนต์ Sarabun ใช้สำเนาในเครื่องแทน CDN เพื่อให้หน้าตาไม่พังตอนออฟไลน์
// - ไม่ใส่ config.local.js เด็ดขาด (มี API key ของเครื่อง dev)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const TAILWIND_URL = 'https://cdn.tailwindcss.com/3.4.17';

const FILES = [
  'index.html', 'order.html', 'app.js', 'order.js', 'pure-helpers.js', 'qrcode-lib.js',
  'style.css', 'fonts-sarabun.css', 'manifest.json', 'favicon.png',
];

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700&display=swap" rel="stylesheet">';
const TAILWIND_TAG = '<script src="https://cdn.tailwindcss.com"></script>';
const CONFIG_LOCAL_TAG = '<script src="config.local.js" onerror="void 0"></script>';
const SW_REGISTER = "navigator.serviceWorker.register('sw.js')";

// แทนข้อความแบบต้องเจอจริง ถ้า index.html เปลี่ยนจนหาไม่เจอให้ build ล้มไปเลย ดีกว่าได้แอปที่แอบโหลด CDN อยู่
function replaceExactly(html, file, from, to) {
  if (!html.includes(from)) throw new Error(`${file}: หา "${from}" ไม่เจอ อัปเดต scripts/build-app.js ให้ตรงกับไฟล์`);
  return html.split(from).join(to);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });

  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) {
    if (f.endsWith('.png')) fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(OUT, 'icons', f));
  }

  const res = await fetch(TAILWIND_URL);
  if (!res.ok) throw new Error(`โหลด Tailwind ไม่สำเร็จ: HTTP ${res.status}`);
  fs.writeFileSync(path.join(OUT, 'vendor', 'tailwindcss.js'), await res.text());

  for (const file of ['index.html', 'order.html']) {
    let html = fs.readFileSync(path.join(OUT, file), 'utf8');
    html = replaceExactly(html, file, FONT_LINK, '<link href="fonts-sarabun.css" rel="stylesheet">');
    html = replaceExactly(html, file, TAILWIND_TAG, '<script src="vendor/tailwindcss.js"></script>');
    if (file === 'index.html') {
      html = replaceExactly(html, file, CONFIG_LOCAL_TAG, '');
      html = replaceExactly(html, file, SW_REGISTER, 'Promise.resolve()');
    }
    fs.writeFileSync(path.join(OUT, file), html);
  }

  console.log('www/ พร้อมแล้ว:', fs.readdirSync(OUT).join(', '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
