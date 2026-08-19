PUKFU-POS

ระบบ POS หน้าร้าน — frontend โฮสต์บน GitHub Pages, backend เป็น Cloudflare Workers + D1 (SQLite)

สถาปัตยกรรม

index.html คือหน้าเว็บ POS ทั้งหมดในไฟล์เดียว (HTML + Tailwind CDN + JS) รองรับการทำงานออฟไลน์บางส่วนผ่าน Service Worker (sw.js) และคิวซิงค์อัตโนมัติ ครอบคลุมออเดอร์ เงินสดหน้าร้าน access log และสถานะ/ยกเลิกบิล

API bridge ที่อยู่ใน index.html จะยิง POST ไปที่ Cloudflare Worker เสมอ โดยแนบ token, fn, args ไปใน body ของ request

worker/worker.js คือโค้ด Cloudflare Worker ที่ deploy จริงอยู่ที่ pukfu-pos-api.karmoo1133.workers.dev เป็นจุดเข้าเดียวของ API ตรวจ token แล้วเรียกฟังก์ชันตามชื่อที่ส่งมา เช่น เมนู สต็อกสินค้า พนักงาน แอดออน วิธีชำระเงิน ข้อมูลร้าน สรุปยอดขาย ปิดยอดเงินสด access log backup/archive และออเดอร์ออฟไลน์

ฐานข้อมูลคือ Cloudflare D1 ชื่อ pukfu-pos ผูกกับ Worker ผ่าน binding ชื่อ DB

หมายเหตุ: เดิมระบบเคยใช้ Google Apps Script และ Google Sheets เป็น backend แต่ได้ย้ายมาใช้ Cloudflare Workers และ D1 แล้วทั้งหมด ไม่ได้ใช้งาน Apps Script ต่อ


เปิดหน้า GitHub Pages ครั้งแรก ระบบจะถาม URL และ token ให้กรอก ค่าทั้งสองจะเก็บไว้ใน localStorage ของเครื่องนั้นเท่านั้น ไม่อยู่ใน repo

ตั้งค่าใหม่ได้โดยพิมพ์ posApiSetup() ที่ console ของเบราว์เซอร์

สำรองข้อมูลอัตโนมัติ

Worker มีฟังก์ชัน scheduled() ที่จะสร้าง backup ให้เองทุก 30 วัน (นับจาก backup ล่าสุด) และลบ backup ที่เก่ากว่า 180 วันทิ้งอัตโนมัติ Cron Trigger ตั้งไว้แล้วใน wrangler.toml (`0 20 * * *` = 20:00 UTC = 03:00 เวลาไทย) และ deploy ผ่าน CI อัตโนมัติ ไม่ต้องไปตั้งเองที่ Cloudflare dashboard อีก โค้ดจะเช็คเองว่าถึงรอบ 30 วันหรือยังก่อนสร้าง backup ใหม่จริง ไม่ต้องกังวลว่าจะสร้างซ้ำทุกวัน

การทำงานออฟไลน์

Service Worker (sw.js) แคชหน้าเว็บและไฟล์สไตล์ไว้ ทำให้เปิดแอปได้แม้ไม่มีเน็ต คำสั่งที่ยิงตอนไม่มีเน็ต เช่น สั่งออเดอร์ เงินสดหน้าร้าน access log ยกเลิกหรือ void บิล จะถูกเก็บไว้ในคิวใน localStorage แล้วซิงค์อัตโนมัติเมื่อเน็ตกลับมา หรือทุก 20 วินาที

ข้อควรระวัง

repo นี้เป็น public ห้าม commit URL ของ Worker หรือ API_TOKEN ลงมาเด็ดขาด กุญแจ API_TOKEN ให้เก็บเป็น secret ฝั่ง Cloudflare Worker เท่านั้น หากสงสัยว่ากุญแจหลุด ให้เปลี่ยนค่า secret API_TOKEN ใหม่ใน Cloudflare แล้วกรอกค่าใหม่ทุกเครื่องที่ใช้งาน
