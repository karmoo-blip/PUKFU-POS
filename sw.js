// Service Worker สำหรับ PUKFU-POS
// เก็บหน้าเว็บหลัก (app shell) ไว้ในเครื่อง เพื่อให้เปิดใช้งานได้แม้ไม่มีอินเทอร์เน็ต
// หมายเหตุ: ไม่แคช request ที่เป็น POST (การยิง API ไปบันทึกออเดอร์/ข้อมูล) เด็ดขาด

const CACHE_NAME = 'pukfu-pos-shell-v84';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './pure-helpers.js',
  './app.js',
  './app-version.js',
  './lang-my.js',
  './fonts-myanmar.css',
  './manifest.json',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
  ];

const CROSS_ORIGIN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700&display=swap',
  'https://cdn.tailwindcss.com'
  ];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})));
    await Promise.all(CROSS_ORIGIN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        await cache.put(url, res);
      } catch (e) {}
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
                       )
    );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

                      if (req.method !== 'GET') return;

                      // หน้าเว็บ เลขเวอร์ชัน และโค้ดที่เปลี่ยนทุก deploy ถามเน็ตก่อน ของที่เก็บไว้ใช้ตอนออฟไลน์เท่านั้น
                      // ถ้าตอบจากของเก็บก่อนเหมือนไฟล์อื่น เปิดแอปมาจะได้เลขเวอร์ชันเก่า แถบอัปเดตขึ้นค้างทั้งที่อัปเดตแล้ว
                      // หรือได้เลขใหม่แต่โค้ดเก่าไปหนึ่งรอบ รูป ไอคอน ฟอนต์ ยังตอบจากของเก็บก่อนเหมือนเดิม
                      const url = new URL(req.url);
                      const freshFirst = url.origin === self.location.origin
                        && (req.mode === 'navigate' || /\/(index\.html|app-version\.js|app\.js|pure-helpers\.js|lang-my\.js|style\.css)?$/.test(url.pathname));
                      if (freshFirst) {
                        event.respondWith(
                          fetch(req, { cache: 'no-cache' })
                          .then((res) => {
                            if (res && res.ok) {
                              const resClone = res.clone();
                              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                            }
                            return res;
                          })
                          .catch(() => caches.match(req, { ignoreSearch: true }))
                          );
                        return;
                      }

                      event.respondWith(
                        caches.match(req).then((cached) => {
                          const networkFetch = fetch(req)
                          .then((res) => {
                            if (res && (res.ok || res.type === 'opaque')) {
                              const resClone = res.clone();
                              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                            }
                            return res;
                          })
                          .catch(() => cached);

                                               return cached || networkFetch;
                        })
                        );
});
