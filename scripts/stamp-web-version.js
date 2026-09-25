// ติดเลขเวอร์ชันให้หน้าเว็บบน GitHub Pages ใช้เลขเดียวกับไฟล์อัปเดตของแอป Android ที่เพิ่งสร้างในรอบ deploy เดียวกัน
// deploy-pages.yml เรียกหลัง build-update.js:
//
//   node scripts/stamp-web-version.js dist
//
// เขียน dist/app-version.js แล้วใส่ <script src="app-version.js"> ก่อน app.js ใน dist/index.html
// ปุ่ม "ตรวจหาอัปเดต" บนเว็บเทียบเลข build ตัวนี้กับ app-update/latest.json
const fs = require('fs');
const path = require('path');

const APP_SCRIPT_TAG = '<script src="app.js"></script>';

function stampWebVersion(distDir) {
  const latest = JSON.parse(fs.readFileSync(path.join(distDir, 'app-update', 'latest.json'), 'utf8'));
  if (!Number.isInteger(latest.build) || typeof latest.version !== 'string') throw new Error('latest.json ไม่มีเลขเวอร์ชัน');
  const version = { build: latest.build, nativeApi: latest.minNativeApi, version: latest.version, builtAt: latest.builtAt };
  fs.writeFileSync(path.join(distDir, 'app-version.js'), 'window.PUKFU_APP = ' + JSON.stringify(version) + ';\n');

  const indexPath = path.join(distDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  // หาไม่เจอให้ deploy ล้มไปเลย ดีกว่าได้เว็บที่ไม่รู้เวอร์ชันตัวเองแล้วปุ่มอัปเดตเงียบไปเฉยๆ
  if (html.split(APP_SCRIPT_TAG).length !== 2) throw new Error('index.html: ต้องมี ' + APP_SCRIPT_TAG + ' หนึ่งที่พอดี');
  fs.writeFileSync(indexPath, html.replace(APP_SCRIPT_TAG, '<script src="app-version.js"></script>\n  ' + APP_SCRIPT_TAG));
  return version;
}

module.exports = { stampWebVersion };

if (require.main === module) {
  try {
    const v = stampWebVersion(path.resolve(process.argv[2] || 'dist'));
    console.log('เว็บเวอร์ชัน', v.version);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
