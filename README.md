# PUKFU-POS
ระบบ POS หน้าร้าน — frontend โฮสต์บน GitHub Pages, backend เป็น Google Apps Script + Google Sheets

สิทธิ์เข้าใช้งาน: https://karmoo-blip.github.io/PUKFU-POS/

## สถาปัตยกรรม

- index.html — หน้าเว็บ POS ทั้งหมดในไฟล์เดียว (HTML + Tailwind CDN + JS)
- API bridge ที่อยู่ใน index.html จะตรวจอัตโนมัติว่ากำลังรันที่ไหน
  - รันบน Apps Script: ใช้ google.script.run ตัวจริง
  - รันบน GitHub Pages: สวมรอยแล้วยิง POST ไปที่ Web App /exec
- ฝั่ง Apps Script (อยู่ในโปรเจกต์ Run Pos ไม่ได้ commit มาที่นี่)
  - Code.gs — ลอจิกหลัก อ่าน/เขียน Google Sheets, backup, archive, trigger
  - Api.gs — doPost เป็นจุดเข้าเดียวของ API + whitelist ฯลฯ

## การติดตั้ง

1. ที่ Apps Script: Run ฟังก์ชัน setupApiToken() หนี่งครั้ง แล้วคัดค่าจาก Execution log
2. Deploy > New deployment > Web app  (Execute as: Me, Who has access: Anyone) เก็บ URL ที่ลงท้ายด้วย /exec
3. เปิดหน้า GitHub Pages ครั้งแรก ระบบจะถาม URL และ token ให้กรอก
4. ค่าทั้งสองจะเก็บใน localStorage ของเครื่องนั้น ไม่อยู่ใน repo

ตั้งค่าใหม่ได้โดยพิมพ์ posApiSetup() ที่ console ของเบราว์เซอร์

## ข้อควรระวัง

- repo นี้เป็น public ห้าม commit SHEET_ID, URL ของ Web App หรือ API_TOKEN ลงมา
- กุญแจเก็บใน Script Properties ฝั่งเซิร์ฟเวอร์เท่านั้น
- หากสงสัยว่ากุญแจหลุด ให้ Run resetApiToken() แล้วกรอกค่าใหม่ทุกเครื่อง
