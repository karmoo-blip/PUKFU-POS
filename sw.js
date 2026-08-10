// Service Worker สำหรับ PUKFU-POS
// เก็บหน้าเว็บหลัก (app shell) ไว้ในเครื่อง เพื่อให้เปิดใช้งานได้แม้ไม่มีอินเทอร์เน็ต
// หมายเหตุ: ไม่แคช request ที่เป็น POST (การยิง API ไปบันทึกออเดอร์/ข้อมูล) เด็ดขาด

const CACHE_NAME = 'pukfu-pos-shell-v1';

const APP_SHELL = [
  './',
    './index.html',
      'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700&display=swap',
        'https://cdn.tailwindcss.com'
        ];

        // ติดตั้ง: ดาวน์โหลดไฟล์หลักมาเก็บไว้ในแคชทันที (แต่ละไฟล์แยกกัน ถ้าไฟล์ไหนพลาดก็ข้ามไป ไม่ให้ล้มทั้งหมด)
        self.addEventListener('install', (event) => {
          event.waitUntil(
              caches.open(CACHE_NAME).then((cache) =>
                    Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
                        )
                          );
                            self.skipWaiting();
                            });

                            // เปิดใช้งาน: ลบแคชรุ่นเก่าทิ้ง
                            self.addEventListener('activate', (event) => {
                              event.waitUntil(
                                  caches.keys().then((keys) =>
                                        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
                                            )
                                              );
                                                self.clients.claim();
                                                });

                                                // ดักจับ request ที่เข้ามา
                                                self.addEventListener('fetch', (event) => {
                                                  const req = event.request;

                                                    // อย่ายุ่งกับ request ที่ไม่ใช่ GET (เช่น POST ไปยิง API) ปล่อยให้วิ่งตรงไปเน็ตเวิร์กเสมอ
                                                      if (req.method !== 'GET') return;

                                                        event.respondWith(
                                                            caches.match(req).then((cached) => {
                                                                  const networkFetch = fetch(req)
                                                                          .then((res) => {
                                                                                    if (res && res.ok) {
                                                                                                const resClone = res.clone();
                                                                                                            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                                                                                                                      }
                                                                                                                                return res;
                                                                                                                                        })
                                                                                                                                                .catch(() => cached);
                                                                                                                                                
                                                                                                                                                      // ถ้ามีของแคชอยู่แล้วให้ตอบกลับทันที (เปิดไว) แล้วค่อยอัปเดตแคชเบื้องหลัง
                                                                                                                                                            // ถ้ายังไม่มีแคช ให้รอผลจากเน็ตเวิร์ก (หรือ fallback เป็น cache เมื่อออฟไลน์)
                                                                                                                                                                  return cached || networkFetch;
                                                                                                                                                                      })
                                                                                                                                                                        );
                                                                                                                                                                        });
