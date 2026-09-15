// อัปเดตแอป Android ผ่านปุ่ม: รัน app.js ตัวจริงกับปลั๊กอิน CapacitorUpdater ปลอม
// คุมสามเรื่อง: ไม่รับไฟล์ที่ไม่มีลายเซ็น, ไม่อัปเดตข้าม APK ที่ยังไม่รองรับ, และไม่ reload ทิ้งตะกร้าโดยไม่ถาม
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadController } = require('./helpers/load-controller');
const { encryptBundle } = require('../scripts/build-update');

const APP = { build: 240, nativeApi: 1, version: '1.1.240', builtAt: '2026-09-15T03:00:00.000Z' };

function manifest(overrides) {
  return {
    build: 241,
    version: '1.1.241',
    minNativeApi: 1,
    builtAt: '2026-09-16T03:00:00.000Z',
    url: 'https://karmoo-blip.github.io/PUKFU-POS/app-update/241.zip',
    sessionKey: 'AAAAAAAAAAAAAAAAAAAAAA==:' + 'B'.repeat(344),
    checksum: 'a'.repeat(512),
    apkUrl: 'https://github.com/karmoo-blip/PUKFU-POS/releases/download/android-app/PUKFU-POS.apk',
    ...overrides,
  };
}

function load(opts) {
  const o = opts || {};
  return loadController({
    app: o.app === undefined ? APP : o.app,
    fetch: o.fetch || (() => Promise.resolve({ ok: true, json: () => Promise.resolve(o.manifest || manifest()) })),
    updater: {
      getBuiltinVersion: () => Promise.resolve({ version: o.builtin || '1.1.230' }),
      list: () => Promise.resolve({ bundles: o.bundles || [] }),
      download: (opt) => Promise.resolve({ id: 'b-' + opt.version, version: opt.version, status: 'success' }),
      next: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      ...(o.updater || {}),
    },
  });
}
const called = (calls, method) => calls.filter((c) => c.fn === 'CapacitorUpdater.' + method);

test('the website never shows the update card or calls the updater', async () => {
  const { C, calls, el } = loadController({});
  C.renderSettingsNav();
  assert.ok(!el('settings-nav').innerHTML.includes('app-update-card'));
  await C.checkNativeUpdate(true);
  assert.equal(calls.filter((c) => c.fn.startsWith('CapacitorUpdater')).length, 0);
});

test('the app tells the updater it started, so a broken update rolls back', () => {
  const { C, calls } = load();
  C.startNativeUpdater();
  assert.equal(called(calls, 'notifyAppReady').length, 1);
});

test('already on the latest build: nothing is downloaded and the card says so', async () => {
  const { C, calls, el } = load({ manifest: manifest({ build: 240, version: '1.1.240' }) });
  C.renderSettingsNav();
  await C.checkNativeUpdate(true);
  assert.equal(C.appUpdate.state, 'idle');
  assert.equal(called(calls, 'download').length, 0);
  assert.ok(el('app-update-card').innerHTML.includes('ล่าสุดแล้ว'));
  assert.ok(el('app-update-card').innerHTML.includes('เวอร์ชัน 1.1.240'));
});

test('a newer build downloads with its signature, is queued for next launch, and shows the green bar', async () => {
  const { C, calls, el } = load();
  C.renderSettingsNav();
  await C.checkNativeUpdate(true);
  const dl = called(calls, 'download');
  assert.equal(dl.length, 1);
  assert.equal(dl[0].args[0].version, '1.1.241');
  assert.ok(dl[0].args[0].sessionKey.includes(':'));
  assert.equal(dl[0].args[0].checksum.length, 512);
  assert.equal(called(calls, 'next')[0].args[0].id, 'b-1.1.241');
  assert.equal(C.appUpdate.state, 'ready');
  assert.ok(!el('app-update-banner').classList.contains('hidden'));
  assert.ok(el('app-update-card').innerHTML.includes('อัปเดตตอนนี้'));
});

test('an update file without a signature is refused before download', async () => {
  for (const bad of [{ sessionKey: '' }, { sessionKey: undefined }, { checksum: 'abc' }, { url: 'https://evil.example/241.zip' }]) {
    const { C, calls } = load({ manifest: manifest(bad) });
    await C.checkNativeUpdate(true);
    assert.equal(called(calls, 'download').length, 0, JSON.stringify(bad));
    assert.equal(C.appUpdate.state, 'error');
  }
});

test('an update that needs newer Android code asks for a new APK instead of downloading', async () => {
  const { C, calls, el } = load({ manifest: manifest({ minNativeApi: 2 }) });
  C.renderSettingsNav();
  await C.checkNativeUpdate(true);
  assert.equal(C.appUpdate.state, 'native');
  assert.equal(called(calls, 'download').length, 0);
  assert.ok(el('app-update-card').innerHTML.includes('ต้องติดตั้งแอปใหม่'));
});

test('a bundle already downloaded earlier is reused, not fetched again', async () => {
  const { C, calls } = load({ bundles: [{ id: 'old-dl', version: '1.1.241', status: 'success' }] });
  await C.checkNativeUpdate(true);
  assert.equal(called(calls, 'download').length, 0);
  assert.equal(called(calls, 'next')[0].args[0].id, 'old-dl');
});

test('offline shows the offline state and no download', async () => {
  const { C, calls, el } = load({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  C.renderSettingsNav();
  await C.checkNativeUpdate(true);
  assert.equal(C.appUpdate.state, 'offline');
  assert.equal(called(calls, 'download').length, 0);
  assert.ok(el('app-update-card').innerHTML.includes('ไม่มีอินเทอร์เน็ต'));
});

test('a failed download says why and can be retried', async () => {
  const { C, el } = load({ updater: { download: () => Promise.reject(new Error('Checksum failed')) } });
  C.renderSettingsNav();
  await C.checkNativeUpdate(true);
  assert.equal(C.appUpdate.state, 'error');
  assert.ok(el('app-update-card').innerHTML.includes('Checksum failed'));
  assert.ok(el('app-update-card').innerHTML.includes('ลองอีกครั้ง'));
});

test('the automatic check stays quiet and runs at most every 30 minutes', async () => {
  let fetches = 0;
  const { C } = load({ fetch: () => { fetches++; return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest({ build: 240, version: '1.1.240' })) }); } });
  await C.checkForAppUpdate();
  await C.checkForAppUpdate();
  assert.equal(fetches, 1);
  C.appUpdate.checkedAt -= 31 * 60 * 1000;
  await C.checkForAppUpdate();
  assert.equal(fetches, 2);
});

test('updating with items in the cart asks first, and cancelling keeps the cart', async () => {
  const { C, calls, store } = load();
  await C.checkNativeUpdate(true);
  C.cart = [{ name: 'ลาเต้', qty: 1 }];
  store.set('pos_loggedInUserId', 'e1');
  C.showConfirm = () => Promise.resolve(false);
  await C.applyNativeUpdate();
  assert.equal(called(calls, 'set').length, 0);
  assert.equal(store.get('pos_loggedInUserId'), 'e1');
});

test('updating now switches bundles and asks for a PIN again', async () => {
  const { C, calls, store } = load();
  await C.checkNativeUpdate(true);
  store.set('pos_loggedInUserId', 'e1');
  await C.applyAppUpdate(); // green bar button
  assert.equal(called(calls, 'set')[0].args[0].id, 'b-1.1.241');
  assert.equal(store.has('pos_loggedInUserId'), false);
});

test('the new-APK button only opens the project release link', async () => {
  const { C, sandbox } = load({ manifest: manifest({ minNativeApi: 2 }) });
  sandbox.location.href = 'http://localhost/';
  await C.checkNativeUpdate(true);
  C.openNewApkDownload();
  assert.equal(sandbox.location.href, manifest().apkUrl);
  C.appUpdate.latest.apkUrl = 'https://evil.example/app.apk';
  sandbox.location.href = 'http://localhost/';
  C.openNewApkDownload();
  assert.equal(sandbox.location.href, 'http://localhost/');
});

test('update files are signed the way the updater plugin checks them', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const zip = crypto.randomBytes(5000);
  const out = encryptBundle(zip, privateKey);
  const [ivB64, keyB64] = out.sessionKey.split(':');
  const verify = (buf) => crypto.publicDecrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, buf);
  const aesKey = verify(Buffer.from(keyB64, 'base64'));
  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, Buffer.from(ivB64, 'base64'));
  assert.deepEqual(Buffer.concat([decipher.update(out.data), decipher.final()]), zip);
  assert.equal(Buffer.from(out.checksum, 'hex').length, 256, 'ปลั๊กอินรับเฉพาะ checksum ที่เซ็นด้วย RSA-2048');
  assert.equal(verify(Buffer.from(out.checksum, 'hex')).toString('hex'), crypto.createHash('sha256').update(zip).digest('hex'));

  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'pkcs1', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  assert.throws(() => crypto.publicDecrypt({ key: other.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(keyB64, 'base64')), 'กุญแจอื่นต้องถอดไม่ได้');
});
