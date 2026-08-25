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

// ---- ต้นทุนวัตถุดิบ ----
// ราคาที่กรอกเป็นราคาต่อหน่วยที่ซื้อ (ต่อถุง/ขวด/แพ็ค) เหมือนกับตอนกรอกสต๊อก
// สูตรอาหารเก็บจำนวนเป็นหน่วยย่อย (G/ML/ชิ้น) จึงต้องหารด้วย purchase_factor ก่อน
// คืน null เมื่อยังไม่ได้กรอกราคา ไม่ใช่ 0 — "ยังไม่รู้ราคา" กับ "ของฟรี" ต้องไม่ปนกัน
function unitCost(item) {
  if (!item) return null;
  const price = Number(item.purchase_price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const factor = Number(item.purchase_factor);
  return price / (Number.isFinite(factor) && factor > 0 ? factor : 1);
}

// รวมต้นทุนของสูตรหนึ่งเมนู แยกเป็นรายวัตถุดิบ
// total เป็น null ถ้ามีวัตถุดิบตัวใดยังไม่มีราคา จะได้ไม่แสดงตัวเลขที่ดูน่าเชื่อแต่ผิด
function recipeCost(recipeRows, inventoryById) {
  const rows = Array.isArray(recipeRows) ? recipeRows : [];
  const byId = inventoryById || {};
  const lines = [];
  const missingPrice = [];
  let sum = 0;

  for (const row of rows) {
    const id = row.inventory_item_id || row.inventoryItemId || '';
    const item = byId[id];
    const qty = Number(row.qty) || 0;
    const cost = unitCost(item);
    const subtotal = cost === null ? null : cost * qty;

    lines.push({ id, name: (item && item.name) || id, qty, unitCost: cost, subtotal });
    if (cost === null) missingPrice.push({ id, name: (item && item.name) || id });
    else sum += subtotal;
  }

  return { total: missingPrice.length > 0 ? null : sum, lines, missingPrice };
}

// ---- คิวออเดอร์ออนไลน์ ----
// ประเมินเวลารอจากจำนวน "แก้ว" ที่อยู่คิวก่อนหน้า ไม่ใช่จำนวนออเดอร์
// ออเดอร์เดียวสั่ง 5 แก้วใช้เวลานานกว่าออเดอร์เดียวสั่งแก้วเดียว นับเป็นแก้วจึงตรงกว่า
// คืน null เมื่อไม่มีคิวก่อนหน้าเลย ให้หน้าจอบอกว่า "กำลังทำให้แล้ว" แทนที่จะขึ้น "0 นาที"
function queueEtaRange(drinksAhead, minutesPerDrink) {
  const drinks = Number(drinksAhead) || 0;
  const perDrink = Number(minutesPerDrink) || 0;
  if (drinks <= 0 || perDrink <= 0) return null;
  const low = Math.round(drinks * perDrink);
  if (low <= 0) return null;
  // ช่วงบน = เผื่ออีกหนึ่งแก้ว กันบอกเวลาเป๊ะเกินจริงทั้งที่ไม่มีข้อมูลเวลาชงจริงสักตัว
  return { low: low, high: low + Math.round(perDrink) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escAttr, escHtml, bufToHex, sha256Hex, hashPinWithSalt, calcVatBreakdown, unitCost, recipeCost, queueEtaRange };
}
