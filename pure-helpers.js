/* สั่งอาหารออนไลน์: ปิดอยู่ชั่วคราวตามที่เจ้าของร้านสั่ง
   ตั้งไว้ที่เดียวตรงนี้เพราะทั้ง app.js (ฝั่งร้าน) และ order.js (ฝั่งลูกค้า) โหลดไฟล์นี้เหมือนกัน
   ถ้าแยกไปตั้งคนละไฟล์ มีโอกาสเปิดฝั่งหนึ่งลืมอีกฝั่ง แล้วออเดอร์จะเข้ามาโดยไม่มีใครเห็น
   เปิดใหม่: เปลี่ยนเป็น true แล้ว deploy */
const ONLINE_ORDER_ENABLED = false;

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

// ---- ค่าอื่นๆ ต่อแก้ว (น้ำแข็ง หลอด แก้ว) ----
// ของที่ไม่นับสต๊อก ตั้งชื่อกับราคาไว้ที่เดียวใน shop_info.costExtras (JSON)
// สูตรของแต่ละเมนูอ้างถึงด้วยแถว recipes ที่ inventory_item_id = "extra:<id>" จำนวน 1
const COST_EXTRA_PREFIX = 'extra:';

// shop_info เก็บทุกค่าเป็น TEXT ค่าที่ได้กลับมาจึงเป็น string JSON เสมอ รับได้ทั้ง string และ array
// ข้อมูลเสียหรือแถวไม่ครบให้ทิ้งไป ไม่โยน error ใส่หน้าต้นทุนทั้งหน้า
function parseCostExtras(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch (e) { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(x => x && x.id && String(x.name || '').trim())
    .map(x => ({ id: String(x.id), name: String(x.name).trim(), price: Math.max(0, Number(x.price) || 0) }));
}

// รวมต้นทุนของสูตรหนึ่งเมนู แยกเป็นรายวัตถุดิบ
// total เป็น null ถ้ามีวัตถุดิบตัวใดยังไม่มีราคา จะได้ไม่แสดงตัวเลขที่ดูน่าเชื่อแต่ผิด
// ค่าอื่นๆ ที่ถูกลบออกจากรายการไปแล้วให้ข้ามเงียบๆ เจ้าของตั้งใจเอาออกเอง ไม่ใช่ราคาหาย
function recipeCost(recipeRows, inventoryById, costExtras) {
  const rows = Array.isArray(recipeRows) ? recipeRows : [];
  const byId = inventoryById || {};
  const extrasById = {};
  for (const x of parseCostExtras(costExtras)) extrasById[x.id] = x;
  const lines = [];
  const missingPrice = [];
  let sum = 0;

  for (const row of rows) {
    const id = row.inventory_item_id || row.inventoryItemId || '';
    const qty = Number(row.qty) || 0;

    if (id.startsWith(COST_EXTRA_PREFIX)) {
      const extra = extrasById[id.slice(COST_EXTRA_PREFIX.length)];
      if (!extra) continue;
      const subtotal = extra.price * qty;
      lines.push({ id, name: extra.name, qty, unitCost: extra.price, subtotal, extra: true });
      sum += subtotal;
      continue;
    }

    const item = byId[id];
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

// ---- พนักงานและของเสีย ----
// แยกแก้วตามป้ายที่หน้าขายติดไว้หน้า note: ราคาพนักงาน / พนักงานดื่ม / ของเสีย
// บิลที่กด "บันทึกของเสีย" จากประวัติบิล (แก้วไม่มีป้าย) นับเป็นของเสียทั้งบิล
// worker/worker.js มีตัวคิดแบบเดียวกัน (import ข้ามไม่ได้) tests/staff-price.test.js เทียบสองฝั่งไว้
const STAFF_KIND_NOTES = { sale: 'ราคาพนักงาน', drink: 'พนักงานดื่ม', waste: 'ของเสีย' };

function staffKindOf(note, isWasteBill) {
  const head = String(note || '').split('|')[0].trim();
  if (isWasteBill) return head === STAFF_KIND_NOTES.drink ? 'drink' : 'waste';
  return head === STAFF_KIND_NOTES.sale ? 'sale' : null;
}

// lines: [{ note, qty, price, cost (ต่อแก้ว), isWasteBill }]
function staffBreakdown(lines) {
  const out = { sale: { cups: 0, amount: 0, cost: 0 }, drink: { cups: 0, amount: 0, cost: 0 }, waste: { cups: 0, amount: 0, cost: 0 } };
  (lines || []).forEach(l => {
    const kind = staffKindOf(l.note, l.isWasteBill);
    if (!kind) return;
    const qty = Number(l.qty) || 0;
    const row = out[kind];
    row.cups += qty;
    // ของเสียกับพนักงานดื่มไม่ได้เงิน ต่อให้บิลเก่าที่ถูกกดเป็นของเสียทีหลังจะมีราคาค้างอยู่ก็ตาม
    if (kind === 'sale') row.amount += (Number(l.price) || 0) * qty;
    row.cost += (Number(l.cost) || 0) * qty;
  });
  return out;
}

// ขายราคาพนักงานแยกตามคนขาย lines เหมือน staffBreakdown + seller (คนคิดเงิน) และ fullPrice (ราคาปกติต่อแก้ว)
// flag = ขายเกินสองเท่าของค่าเฉลี่ยคนอื่น และอย่างน้อย 10 แก้ว (มีคนขายคนเดียวไม่มีอะไรให้เทียบ ไม่ขึ้นป้าย)
// worker/worker.js คิดแบบเดียวกัน
function staffSellers(lines) {
  const by = {};
  (lines || []).forEach(l => {
    if (staffKindOf(l.note, l.isWasteBill) !== 'sale') return;
    const qty = Number(l.qty) || 0;
    const key = l.seller || '';
    const r = (by[key] = by[key] || { seller: key, cups: 0, amount: 0, discount: 0, flag: false });
    r.cups += qty;
    r.amount += (Number(l.price) || 0) * qty;
    r.discount += Math.max(0, (Number(l.fullPrice) || 0) - (Number(l.price) || 0)) * qty;
  });
  const rows = Object.values(by);
  rows.forEach(r => {
    const others = rows.filter(o => o !== r);
    if (!others.length) return;
    const avg = others.reduce((s, o) => s + o.cups, 0) / others.length;
    r.flag = r.cups >= 10 && r.cups > 2 * avg;
  });
  return rows.sort((a, b) => b.cups - a.cups);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ONLINE_ORDER_ENABLED, escAttr, escHtml, bufToHex, sha256Hex, hashPinWithSalt, calcVatBreakdown, unitCost, recipeCost, parseCostExtras, COST_EXTRA_PREFIX, queueEtaRange, STAFF_KIND_NOTES, staffKindOf, staffBreakdown, staffSellers };
}
