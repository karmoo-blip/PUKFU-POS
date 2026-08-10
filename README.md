# PUKFU-POS
ระบบ POS หน้าร้าน — frontend โฮสต์บน GitHub Pages, backend เป็น Cloudflare Worker + D1 (เดิมเป็น Google Apps Script + Google Sheets — โค้ดยังรองรับอยู่เผื่อย้ายกลับ)

สิทธิ์เข้าใช้งาน: https://karmoo-blip.github.io/PUKFU-POS/

## สถาปัตยกรรม

- index.html — หน้าเว็บ POS ทั้งหมดในไฟล์เดียว (HTML + Tailwind CDN + JS)
- API bridge ที่อยู่ใน index.html จะตรวจอัตโนมัติว่ากำลังรันที่ไหน
  - รันบน Apps Script: ใช้ google.script.run ตัวจริง
  - รันบน GitHub Pages: สวมรอย google.script.run แล้วยิง POST ไปที่ URL backend ที่ตั้งค่าไว้ (Cloudflare Worker หรือ Apps Script /exec — ใช้ protocol เดียวกัน)
- ฝั่ง backend ปัจจุบัน: Cloudflare Worker (`worker/worker.js`, deploy เป็น `pukfu-pos-api`)
  - ผูก D1 database ชื่อ `pukfu-pos` (ตาราง menu, sales, payments, inventory, employees, addons, backups, archives ฯลฯ)
  - Secret `API_TOKEN` ใช้ตรวจสิทธิ์ทุก request, endpoint เดียว (`POST /`) ส่ง `{ token, fn, args }` แล้ว dispatch ไปยัง handler ตรงกับชื่อฟังก์ชัน
- ฝั่ง Apps Script (ของเดิม อยู่ในโปรเจกต์ Run Pos ไม่ได้ commit มาที่นี่ — เก็บไว้เผื่อย้ายกลับ)
  - Code.gs — ลอจิกหลัก อ่าน/เขียน Google Sheets, backup, archive, trigger
  - Api.gs — doPost เป็นจุดเข้าเดียวของ API + whitelist ฯลฯ

## การติดตั้ง

### Cloudflare Worker (ปัจจุบัน)
1. Deploy `worker/worker.js` เป็น Worker (เช่น `pukfu-pos-api`), ผูก D1 binding ชื่อ `DB` เข้ากับฐานข้อมูลที่มีตารางครบ
2. ตั้ง secret `API_TOKEN` ที่ Worker
3. เปิดหน้า GitHub Pages ครั้งแรก (หรือพิมพ์ `posApiSetup()`) แล้ววาง URL ของ Worker (เช่น `https://pukfu-pos-api.<subdomain>.workers.dev/`) และค่า `API_TOKEN`
4. ค่าทั้งสองจะเก็บใน localStorage ของเครื่องนั้น ไม่อยู่ใน repo

### Apps Script (ทางเลือกเดิม)
1. ที่ Apps Script: Run ฟังก์ชัน setupApiToken() หนี่งครั้ง แล้วคัดค่าจาก Execution log
2. Deploy > New deployment > Web app  (Execute as: Me, Who has access: Anyone) เก็บ URL ที่ลงท้ายด้วย /exec
3. ตั้งค่าเหมือนขั้นตอนข้างบน โดยวาง URL ที่ลงท้ายด้วย /exec แทน

ตั้งค่าใหม่ได้โดยพิมพ์ posApiSetup() ที่ console ของเบราว์เซอร์

## ข้อควรระวัง

- repo นี้เป็น public ห้าม commit SHEET_ID, D1 database ID, URL ของ backend หรือ API_TOKEN ลงมา
- กุญแจเก็บฝั่งเซิร์ฟเวอร์เท่านั้น (Script Properties สำหรับ Apps Script, Worker secret สำหรับ Cloudflare)
- หากสงสัยว่ากุญแจหลุด ให้หมุน/สร้าง API_TOKEN ใหม่ฝั่ง backend แล้วกรอกค่าใหม่ทุกเครื่อง
