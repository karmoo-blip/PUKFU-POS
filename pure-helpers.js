function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ใช้ครอบข้อความที่ผู้ใช้พิมพ์เอง (ชื่อสินค้า/พนักงาน/หมายเหตุ) ก่อนใส่ลง innerHTML
   กัน < > & " ' ทำให้หน้าจอเพี้ยนหรือถูกฉีดแท็กเข้ามา */
function escHtml(str) {
  return escAttr(str === null || str === undefined ? '' : str);
}

// ---- PIN hashing (salted SHA-256 via Web Crypto — เหมือนกับ worker.js เป๊ะ ต้อง hash ตรงกัน) ----
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(str) {
  return bufToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
}
async function hashPinWithSalt(pin, saltHex) {
  return sha256Hex(saltHex + String(pin).trim());
}

function calcVatBreakdown(total, rate) {
  const r = Number(rate) || 0;
  const vatAmount = total * (r / (100 + r));
  const exVat = total - vatAmount;
  return { exVat, vatAmount, rate: r };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escAttr, escHtml, bufToHex, sha256Hex, hashPinWithSalt, calcVatBreakdown };
}
