// สร้างไฟล์อัปเดตของแอป Android ให้ปุ่ม "ตรวจหาอัปเดต" ดาวน์โหลดไปใช้ โดยไม่ต้องติดตั้ง APK ใหม่
// deploy-pages.yml เรียกตอน merge เข้า main แล้ววางไว้บน GitHub Pages ที่ /app-update/
//
//   node scripts/build-update.js <โฟลเดอร์ปลายทาง>   (ต้องมี APP_UPDATE_PRIVATE_KEY ใน environment)
//
// ได้สองไฟล์:
//   <build>.zip   ไฟล์ www/ ทั้งชุด เข้ารหัส AES แล้ว
//   latest.json   บอกเลขเวอร์ชัน ที่อยู่ไฟล์ และกุญแจที่ใช้ถอดรหัส
//
// การป้องกันการปลอมไฟล์: กุญแจ AES และ checksum ถูกเซ็นด้วย RSA private key ที่อยู่ใน GitHub secrets เท่านั้น
// แอปถือ public key (capacitor.config.json) ถ้าไฟล์ไม่ได้มาจากกุญแจนี้ ปลั๊กอินจะถอดรหัสไม่ผ่านและไม่ติดตั้ง
// รูปแบบตรงกับที่ @capgo/capacitor-updater ถอด: ดู CryptoCipher.decryptFile / decryptChecksum ในปลั๊กอิน
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PAGES_URL = 'https://karmoo-blip.github.io/PUKFU-POS/app-update/';
const APK_URL = 'https://github.com/karmoo-blip/PUKFU-POS/releases/download/android-app/PUKFU-POS.apk';

// zip = ไฟล์ zip ดิบ, privateKeyPem = RSA private key แบบ PKCS#1
// คืน { data: zip ที่เข้ารหัสแล้ว, sessionKey: "iv:กุญแจที่เซ็นแล้ว" (base64), checksum: sha256 ที่เซ็นแล้ว (hex) }
function encryptBundle(zip, privateKeyPem) {
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
  const data = Buffer.concat([cipher.update(zip), cipher.final()]);
  const sign = (buf) => crypto.privateEncrypt({ key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, buf);
  const sha = crypto.createHash('sha256').update(zip).digest();
  return {
    data,
    sessionKey: iv.toString('base64') + ':' + sign(aesKey).toString('base64'),
    checksum: sign(sha).toString('hex'),
  };
}

async function main() {
  // zip รันจากในโฟลเดอร์ www/ ต้องแปลงเป็น path เต็มก่อน ไม่งั้น "dist/app-update" จะไปชี้ใน www/ แทน
  const outDir = process.argv[2] && path.resolve(process.argv[2]);
  const privateKey = process.env.APP_UPDATE_PRIVATE_KEY;
  if (!outDir) throw new Error('ใส่โฟลเดอร์ปลายทาง เช่น node scripts/build-update.js dist/app-update');
  if (!privateKey) throw new Error('ไม่มี APP_UPDATE_PRIVATE_KEY');

  const { buildApp, OUT } = require('./build-app');
  const version = await buildApp();

  fs.mkdirSync(outDir, { recursive: true });
  const plainZip = path.join(outDir, 'bundle-plain.zip');
  fs.rmSync(plainZip, { force: true });
  // index.html ต้องอยู่ที่รากของ zip ปลั๊กอินถึงจะหาเจอ
  execFileSync('zip', ['-q', '-r', '-X', plainZip, '.'], { cwd: OUT });
  const zip = fs.readFileSync(plainZip);
  fs.rmSync(plainZip);

  const bundle = encryptBundle(zip, privateKey);
  const zipName = version.build + '.zip';
  fs.writeFileSync(path.join(outDir, zipName), bundle.data);

  const manifest = {
    build: version.build,
    version: version.version,
    minNativeApi: version.nativeApi,
    builtAt: version.builtAt,
    url: PAGES_URL + zipName,
    sessionKey: bundle.sessionKey,
    checksum: bundle.checksum,
    apkUrl: APK_URL,
  };
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('ไฟล์อัปเดตพร้อมแล้ว:', version.version, '(' + Math.round(bundle.data.length / 1024) + ' KB)');
}

module.exports = { encryptBundle, PAGES_URL, APK_URL };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
