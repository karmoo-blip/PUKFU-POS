// จำกัด CORS ให้เรียกได้เฉพาะจากเว็บของร้านจริง แทนที่จะเปิดให้ทุกเว็บ (เดิม "*" ใครก็เรียก API นี้จากเว็บไหนก็ได้)
const ALLOWED_ORIGINS = new Set(["https://karmoo-blip.github.io"]);
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://karmoo-blip.github.io",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)),
  });
}

// ฟังก์ชันที่หน้าเว็บสั่งอาหารสาธารณะ (order.html) เรียกได้ ผ่าน PUBLIC_API_TOKEN เท่านั้น
// ต่างจาก API_TOKEN ปกติที่เรียกได้ทุกฟังก์ชัน (แอปพนักงาน) — ป้องกันไม่ให้ลูกค้าที่ scan QR เข้าถึงข้อมูล/ฟังก์ชันอื่นได้
const PUBLIC_HANDLERS = new Set([
  "getMenuData", "getShopInfo", "getAddons", "getSweetnessLevels",
  "submitPendingOrder", "getPendingOrderStatus", "uploadPaymentSlip", "cancelPendingOrder",
]);

async function ensureExtraTables(env) {
  const stmts = [
    "CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, label TEXT, data TEXT)",
    "CREATE TABLE IF NOT EXISTS archives (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, range_start TEXT, range_end TEXT, note TEXT)",
    "CREATE TABLE IF NOT EXISTS archive_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_id INTEGER, timestamp TEXT, invoice TEXT, sku TEXT, name TEXT, qty REAL, price REAL, note TEXT, payment_type TEXT, cancelled INTEGER, cancel_reason TEXT)",
    "CREATE TABLE IF NOT EXISTS archive_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_id INTEGER, timestamp TEXT, invoice TEXT, total REAL, payment_type TEXT, order_note TEXT, status TEXT, cancel_reason TEXT, cancelled_by TEXT, cancelled_at TEXT)",
    "CREATE TABLE IF NOT EXISTS sweetness_levels (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER)",
    "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, inventory_item_id TEXT, item_name TEXT, opened_at TEXT, expires_at TEXT, created_at TEXT)",
    "CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, menu_sku TEXT, inventory_item_id TEXT, qty REAL)",
    "CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, invoice TEXT, amount REAL, reason TEXT, refunded_by TEXT, created_at TEXT)",
    "CREATE TABLE IF NOT EXISTS pending_orders (id TEXT PRIMARY KEY, created_at TEXT, location TEXT, customer_name TEXT, items_json TEXT, subtotal REAL, total REAL, status TEXT, payment_slip_image TEXT, slip_uploaded_at TEXT, confirmed_by TEXT, confirmed_at TEXT, reject_reason TEXT)",
    "CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, fn TEXT, message TEXT)",
    "CREATE TABLE IF NOT EXISTS change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, actor TEXT, area TEXT, action TEXT, target TEXT, details TEXT)",
  ];
  for (const s of stmts) {
    await env.DB.prepare(s).run();
  }
}

async function ensureColumn(env, table, column, type) {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch (e) {
    // คอลัมน์มีอยู่แล้ว
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ---- Bangkok timezone helpers (UTC+7) ----
function bkkToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function dayStr(v, fallback) {
  const s = v == null ? "" : String(v);
  return s.length >= 10 ? s.slice(0, 10) : (fallback || bkkToday());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const handlers = {};

handlers.getMenuData = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM menu").all();
  return r.results.map((row) => Object.assign({}, row, { isSoldOut: !!row.is_sold_out }));
};

handlers.toggleSoldOut = async (env, args) => {
  const a = args[0] || {};
  await env.DB.prepare("UPDATE menu SET is_sold_out = ? WHERE sku = ?").bind(a.isSoldOut ? 1 : 0, a.sku).run();
  return { success: true };
};

handlers.saveMenuItem = async (env, args) => {
  await ensureExtraTables(env);
  const m = args[0] || {};
  const sku = String(m.sku || "").trim();
  const name = String(m.name || "").trim();
  if (!sku) return { success: false, error: "กรุณาระบุรหัสสินค้า (SKU)" };
  if (!name) return { success: false, error: "กรุณาระบุชื่อสินค้า" };
  const price = Number(m.price) || 0;
  const cost = Number(m.cost) || 0;
  const category = String(m.category || "").trim();
  const lang2 = String(m.lang2 || "").trim();
  const image = String(m.image || "").trim();
  const existing = await env.DB.prepare("SELECT * FROM menu WHERE sku = ?").bind(sku).first();
  if (m.isNew && existing) return { success: false, error: "มีรหัสสินค้านี้อยู่แล้ว" };
  if (existing) {
    await env.DB.prepare("UPDATE menu SET name=?, price=?, image=?, lang2=?, category=?, cost=? WHERE sku=?")
      .bind(name, price, image, lang2, category, cost, sku).run();
  } else {
    await env.DB.prepare("INSERT INTO menu (sku, name, price, image, lang2, category, cost, is_sold_out) VALUES (?,?,?,?,?,?,?,0)")
      .bind(sku, name, price, image, lang2, category, cost).run();
  }
  const actor = m.actorName || "";
  const details = existing
    ? diffFields(existing, { name, price, cost, category, lang2 }, ["name", "price", "cost", "category", "lang2"])
    : `เพิ่มสินค้าใหม่ ราคา ${price} ต้นทุน ${cost}`;
  await logChange(env, actor, "menu", existing ? "update" : "create", name || sku, details);
  return { success: true, sku };
};

handlers.deleteMenuItem = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = args[0];
  const isObj = a0 && typeof a0 === "object";
  const sku = isObj ? a0.sku : a0;
  if (!sku) return { success: false, error: "missing sku" };
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["stock"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const row = await env.DB.prepare("SELECT name FROM menu WHERE sku = ?").bind(sku).first();
  await env.DB.prepare("DELETE FROM menu WHERE sku = ?").bind(sku).run();
  await logChange(env, auth.employee.name, "menu", "delete", (row && row.name) || sku, "");
  return { success: true };
};

handlers.getInventoryData = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM inventory").all();
  return r.results.map((row) => Object.assign({}, row, { stock: row.current_stock }));
};

handlers.getInventoryStats = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM inventory").all();
  return r.results;
};

async function updateInventoryStock(env, args) {
  const raw = args[0];
  const changes = Array.isArray(raw) ? raw : [raw];
  const recordedBy = args[1] || "";
  const now = nowIso();
  for (const c of changes) {
    const id = c.id;
    const item = await env.DB.prepare("SELECT name, current_stock FROM inventory WHERE id = ?").bind(id).first();
    if (!item) continue;
    const cur = Number(item.current_stock || 0);
    const hasAbs = c.newStock !== undefined && c.newStock !== null;
    const newStock = hasAbs ? Number(c.newStock) || 0 : cur + Number(c.delta ?? c.qty ?? c.amount ?? 0);
    const delta = newStock - cur;
    await env.DB.prepare("UPDATE inventory SET current_stock = ? WHERE id = ?").bind(newStock, id).run();
    await env.DB.prepare(
      "INSERT INTO inventory_log (timestamp, item_name, change, new_stock, recorded_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(now, item.name, delta, newStock, c.user || recordedBy).run();
  }
  return { success: true };
}

function normPermission(v) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (!s || s === "{}" || s === "[]" || s === "null" || s === "undefined") return "";
  if (s.charAt(0) === "{") return "";
  if (s.charAt(0) === "[") {
    try {
      const a = JSON.parse(s);
      return Array.isArray(a) ? a.join(",") : "";
    } catch (e) {
      return "";
    }
  }
  return s;
}

// ตรวจสิทธิ์จริงที่ฝั่งเซิร์ฟเวอร์ก่อนทำรายการที่มีความเสี่ยงสูง (คืนเงิน/ยกเลิกบิล/ลบพนักงาน/ลบข้อมูล)
// เดิม API_TOKEN ตัวเดียวเรียกฟังก์ชันไหนก็ได้ และฟิลด์ "user" เป็นแค่ข้อความที่ client ส่งมาเอง ไม่มีการตรวจสอบเลย
// ฟังก์ชันนี้เช็ค employeeId + pin กับตาราง employees จริง แล้วดูสิทธิ์ (role หรือ permission) ก่อนอนุญาต
async function authorizeEmployee(env, employeeId, pin, opts) {
  opts = opts || {};
  if (!employeeId || !pin) return { ok: false, error: "กรุณายืนยันตัวตนก่อนทำรายการนี้" };
  const emp = await env.DB.prepare("SELECT * FROM employees WHERE id = ?").bind(employeeId).first();
  if (!emp || !emp.active) return { ok: false, error: "ไม่พบพนักงานหรือถูกปิดใช้งาน" };
  if (String(emp.pin).trim() !== String(pin).trim()) return { ok: false, error: "PIN ไม่ถูกต้อง" };
  const isTop = emp.role === "Owner" || emp.role === "Admin";
  if (opts.ownerOnly && !isTop) return { ok: false, error: "ต้องเป็นเจ้าของ/ผู้ดูแลระบบเท่านั้น" };
  if (opts.tabs && !isTop) {
    const perm = normPermission(emp.permission).split(",");
    if (!opts.tabs.some((t) => perm.includes(t))) return { ok: false, error: "ไม่มีสิทธิ์ทำรายการนี้" };
  }
  return { ok: true, employee: emp };
}

// เทียบฟิลด์เก่า/ใหม่ คืนข้อความสรุปเฉพาะฟิลด์ที่เปลี่ยนจริง เช่น "ราคา: 45 -> 50" ใช้กับ change_log
function diffFields(oldRow, newRow, fields) {
  const parts = [];
  for (const f of fields) {
    const ov = oldRow ? oldRow[f] : undefined;
    const nv = newRow[f];
    if (String(ov === undefined || ov === null ? "" : ov) !== String(nv === undefined || nv === null ? "" : nv)) {
      parts.push(`${f}: ${ov === undefined || ov === null || ov === "" ? "-" : ov} -> ${nv === undefined || nv === null || nv === "" ? "-" : nv}`);
    }
  }
  return parts.join(", ");
}

// บันทึกประวัติการเปลี่ยนแปลงเมนู/พนักงาน/วิธีชำระเงิน ห่อ try/catch กันไม่ให้การล็อกพังธุรกรรมจริง (เหมือน error_log)
async function logChange(env, actor, area, action, target, details) {
  try {
    await env.DB.prepare(
      "INSERT INTO change_log (created_at, actor, area, action, target, details) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(nowIso(), actor || "", area, action, target || "", details || "").run();
    // เก็บแค่ 90 วันล่าสุด ไม่งั้นตารางจะโตไม่มีที่สิ้นสุด (สุ่ม 5% ต่อครั้งพอ ไม่ต้องเช็คทุกครั้ง)
    if (Math.random() < 0.05) {
      await env.DB.prepare("DELETE FROM change_log WHERE created_at < ?")
        .bind(new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()).run();
    }
  } catch (e) {
    // ไม่ให้การล็อกที่พังไปกระทบรายการจริง
  }
}

function mapEmployeeRow(row) {
  const perm = normPermission(row.permission);
  return Object.assign({}, row, {
    permission: perm,
    permissions: perm,
    createdBy: row.created_by || "",
  });
}

handlers.getEmployees = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM employees").all();
  return r.results.map(mapEmployeeRow);
};

handlers.getEmployeesForCache = async (env) => {
  const r = await env.DB.prepare("SELECT id, name, pin, role, active, permission FROM employees").all();
  return r.results.map(mapEmployeeRow);
};

handlers.saveEmployee = async (env, args) => {
  await ensureExtraTables(env);
  await ensureColumn(env, "employees", "photo", "TEXT");
  const emp = args[0] || {};
  const id = emp.id || "EMP-" + Date.now();
  const rawPerm = emp.permissions !== undefined && emp.permissions !== null ? emp.permissions : emp.permission;
  const perm = normPermission(Array.isArray(rawPerm) ? rawPerm.join(",") : rawPerm);
  const createdBy = emp.createdBy || emp.created_by || "";
  const photo = String(emp.photo || "");
  const existing = await env.DB.prepare("SELECT * FROM employees WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE employees SET name=?, pin=?, role=?, active=?, permission=?, photo=? WHERE id=?"
    ).bind(emp.name, emp.pin, emp.role, emp.active ? 1 : 0, perm, photo, id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO employees (id, name, pin, role, active, permission, created_by, photo) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, emp.name, emp.pin, emp.role, emp.active ? 1 : 0, perm, createdBy, photo).run();
  }
  const actor = emp.actorName || "";
  const diffParts = existing
    ? diffFields(
        { name: existing.name, role: existing.role, active: existing.active ? "เปิด" : "ปิด", permission: normPermission(existing.permission) },
        { name: emp.name, role: emp.role, active: emp.active ? "เปิด" : "ปิด", permission: perm },
        ["name", "role", "active", "permission"]
      )
    : "";
  const pinChanged = existing && String(existing.pin) !== String(emp.pin);
  const details = existing
    ? [diffParts, pinChanged ? "เปลี่ยน PIN" : ""].filter(Boolean).join(", ") || "ไม่มีการเปลี่ยนแปลงข้อมูลหลัก"
    : `สร้างพนักงานใหม่ ตำแหน่ง ${emp.role || "-"}`;
  await logChange(env, actor, "employee", existing ? "update" : "create", emp.name, details);
  return { success: true, id: id };
};

handlers.deleteEmployee = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = args[0];
  const isObj = a0 && typeof a0 === "object" && !Array.isArray(a0);
  const id = isObj ? a0.id : a0;
  const name = isObj ? a0.name : args[1];
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["employees"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const blank = id === null || id === undefined || id === "" || id === "null" || id === "undefined";
  let r;
  if (blank) {
    if (!name) return { success: false, error: "missing id" };
    r = await env.DB.prepare("DELETE FROM employees WHERE id IS NULL AND name = ?").bind(name).run();
  } else {
    r = await env.DB.prepare("DELETE FROM employees WHERE id = ?").bind(id).run();
  }
  const changed = (r && r.meta && r.meta.changes) || 0;
  if (changed > 0) await logChange(env, auth.employee.name, "employee", "delete", name || id, "");
  return { success: changed > 0, deleted: changed };
};

handlers.getAddons = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM addons").all();
  return r.results;
};

handlers.saveAddon = async (env, args) => {
  const addon = args[0];
  // ถ้าไม่ได้ส่ง id มา แปลว่าเป็นการเพิ่มใหม่ ต้องสร้าง id ให้ ไม่งั้นจะไปทับแถวที่ id ว่าง
  const id = addon.id || ("ADDON-" + Date.now());
  const existing = await env.DB.prepare("SELECT id FROM addons WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare("UPDATE addons SET name=?, price=?, active=? WHERE id=?")
      .bind(addon.name, addon.price, addon.active ? 1 : 0, id).run();
  } else {
    await env.DB.prepare("INSERT INTO addons (id, name, price, active, created_by) VALUES (?,?,?,?,?)")
      .bind(id, addon.name, addon.price, addon.active ? 1 : 0, addon.created_by || "").run();
  }
  return { success: true };
};

handlers.deleteAddon = async (env, args) => {
  const id = args[0];
  await env.DB.prepare("DELETE FROM addons WHERE id = ?").bind(id).run();
  return { success: true };
};

handlers.getPaymentMethods = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM payment_methods ORDER BY sort_order").all();
  return r.results.map((m) => ({ ...m, isCash: !!m.is_cash }));
};

handlers.savePaymentMethod = async (env, args) => {
  await ensureExtraTables(env);
  const pm = args[0];
  // ถ้าไม่ได้ส่ง id มา แปลว่าเป็นการเพิ่มใหม่ ต้องสร้าง id ให้ ไม่งั้นจะไปทับแถวที่ id ว่าง
  const id = pm.id || ("PM-" + Date.now());
  const isCash = (pm.isCash ?? pm.is_cash) ? 1 : 0;
  const enabled = pm.enabled ? 1 : 0;
  const sortOrder = pm.sort_order || 0;
  const existing = await env.DB.prepare("SELECT * FROM payment_methods WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE payment_methods SET name=?, is_cash=?, enabled=?, sort_order=? WHERE id=?"
    ).bind(pm.name, isCash, enabled, sortOrder, id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO payment_methods (id, name, is_cash, enabled, sort_order, created_by) VALUES (?,?,?,?,?,?)"
    ).bind(id, pm.name, isCash, enabled, sortOrder, pm.created_by || "").run();
  }
  const actor = pm.actorName || "";
  const details = existing
    ? diffFields(
        { name: existing.name, is_cash: existing.is_cash ? "ใช่" : "ไม่ใช่", enabled: existing.enabled ? "เปิด" : "ปิด", sort_order: existing.sort_order },
        { name: pm.name, is_cash: isCash ? "ใช่" : "ไม่ใช่", enabled: enabled ? "เปิด" : "ปิด", sort_order: sortOrder },
        ["name", "is_cash", "enabled", "sort_order"]
      )
    : `เพิ่มวิธีชำระเงินใหม่: ${pm.name || "-"}`;
  await logChange(env, actor, "payment_method", existing ? "update" : "create", pm.name, details);
  return { success: true };
};

handlers.deletePaymentMethod = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = args[0];
  const isObj = a0 && typeof a0 === "object";
  const id = isObj ? a0.id : a0;
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["payment"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const row = await env.DB.prepare("SELECT name FROM payment_methods WHERE id = ?").bind(id).first();
  await env.DB.prepare("DELETE FROM payment_methods WHERE id = ?").bind(id).run();
  await logChange(env, auth.employee.name, "payment_method", "delete", (row && row.name) || id, "");
  return { success: true };
};

handlers.getSweetnessLevels = async (env) => {
  await ensureExtraTables(env);
  const countR = await env.DB.prepare("SELECT COUNT(*) AS n FROM sweetness_levels").first();
  if (!countR || !countR.n) {
    // ร้านที่ยังไม่เคยตั้งค่า ให้ seed ค่าดั้งเดิม 4 แบบไว้ก่อน จะได้ไม่กระทบพฤติกรรมเดิม
    const defaults = ["ไม่หวาน", "หวานน้อย", "หวานปกติ", "เพิ่มหวาน"];
    for (let i = 0; i < defaults.length; i++) {
      await env.DB.prepare("INSERT INTO sweetness_levels (id, name, sort_order) VALUES (?,?,?)")
        .bind("SWT-DEFAULT-" + i, defaults[i], i).run();
    }
  }
  const r = await env.DB.prepare("SELECT * FROM sweetness_levels ORDER BY sort_order").all();
  return r.results;
};

handlers.saveSweetnessLevel = async (env, args) => {
  await ensureExtraTables(env);
  const sw = args[0] || {};
  const id = sw.id || ("SWT-" + Date.now());
  const existing = await env.DB.prepare("SELECT id FROM sweetness_levels WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare("UPDATE sweetness_levels SET name=?, sort_order=? WHERE id=?")
      .bind(sw.name, sw.sort_order || 0, id).run();
  } else {
    await env.DB.prepare("INSERT INTO sweetness_levels (id, name, sort_order) VALUES (?,?,?)")
      .bind(id, sw.name, sw.sort_order || 0).run();
  }
  return { success: true, id };
};

handlers.deleteSweetnessLevel = async (env, args) => {
  await ensureExtraTables(env);
  const id = args[0];
  await env.DB.prepare("DELETE FROM sweetness_levels WHERE id = ?").bind(id).run();
  return { success: true };
};

handlers.getNotifications = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT * FROM notifications ORDER BY expires_at ASC").all();
  return r.results;
};

handlers.saveNotification = async (env, args) => {
  await ensureExtraTables(env);
  const n = args[0] || {};
  const id = n.id || ("NOTIF-" + Date.now());
  const itemName = String(n.itemName || n.item_name || "").trim();
  const existing = await env.DB.prepare("SELECT id FROM notifications WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare("UPDATE notifications SET inventory_item_id = ?, item_name = ?, opened_at = ?, expires_at = ? WHERE id = ?")
      .bind(n.inventoryItemId || n.inventory_item_id || null, itemName, n.openedAt || n.opened_at || null, n.expiresAt || n.expires_at || null, id).run();
  } else {
    await env.DB.prepare("INSERT INTO notifications (id, inventory_item_id, item_name, opened_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, n.inventoryItemId || n.inventory_item_id || null, itemName, n.openedAt || n.opened_at || null, n.expiresAt || n.expires_at || null, nowIso()).run();
  }
  return { success: true, id };
};

handlers.deleteNotification = async (env, args) => {
  await ensureExtraTables(env);
  const id = args[0];
  await env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(id).run();
  return { success: true };
};

handlers.getRecipes = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT * FROM recipes").all();
  return r.results;
};

handlers.saveRecipesForMenuItem = async (env, args) => {
  await ensureExtraTables(env);
  const a = args[0] || {};
  const menuSku = String(a.menuSku || "").trim();
  if (!menuSku) return { success: false, error: "missing menuSku" };
  const ingredients = Array.isArray(a.ingredients) ? a.ingredients : [];
  await env.DB.prepare("DELETE FROM recipes WHERE menu_sku = ?").bind(menuSku).run();
  let i = 0;
  for (const ing of ingredients) {
    const inventoryItemId = ing.inventoryItemId || ing.inventory_item_id;
    const qty = Number(ing.qty) || 0;
    if (!inventoryItemId || qty <= 0) continue;
    const id = "RCP-" + menuSku + "-" + (i++);
    await env.DB.prepare("INSERT INTO recipes (id, menu_sku, inventory_item_id, qty) VALUES (?, ?, ?, ?)")
      .bind(id, menuSku, inventoryItemId, qty).run();
  }
  return { success: true };
};

handlers.getShopInfo = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM shop_info").all();
  const obj = {};
  for (const row of r.results) {
    obj[row.key] = row.value;
  }
  return obj;
};

handlers.saveShopInfo = async (env, args) => {
  const info = args[0] || {};
  for (const key of Object.keys(info)) {
    await env.DB.prepare(
      "INSERT INTO shop_info (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).bind(key, String(info[key])).run();
  }
  return { success: true };
};

// หักสต๊อกวัตถุดิบตามสูตร (ถ้าสินค้า sku นี้มีการตั้งสูตรไว้) ปล่อยให้ติดลบได้ ไม่บล็อกการขาย
// แค่เป็นสัญญาณเตือนให้ไปเติมสต๊อก บันทึกลง inventory_log ด้วย recorded_by = "auto:<invoice>" เพื่อแยกจากการเบิกมือ
async function deductRecipeStock(env, sku, saleQty, invoice) {
  if (!sku || saleQty <= 0) return;
  const recipeR = await env.DB.prepare("SELECT * FROM recipes WHERE menu_sku = ?").bind(sku).all();
  for (const rcp of recipeR.results) {
    const item = await env.DB.prepare("SELECT name, current_stock FROM inventory WHERE id = ?").bind(rcp.inventory_item_id).first();
    if (!item) continue;
    const deduct = Number(rcp.qty || 0) * saleQty;
    const newStock = Number(item.current_stock || 0) - deduct;
    await env.DB.prepare("UPDATE inventory SET current_stock = ? WHERE id = ?").bind(newStock, rcp.inventory_item_id).run();
    await env.DB.prepare(
      "INSERT INTO inventory_log (timestamp, item_name, change, new_stock, recorded_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(nowIso(), item.name, -deduct, newStock, "auto:" + invoice).run();
  }
}

async function syncOfflineOrders(env, args) {
  await ensureExtraTables(env);
  await ensureColumn(env, "payments", "created_by", "TEXT");
  const orders = Array.isArray(args[0]) ? args[0] : [args[0]];
  let count = 0;
  for (const o of orders) {
    const invoice = o.invoice || o.id || ('INV-' + Date.now() + '-' + count);
    const timestamp = o.timestamp || nowIso();
    const total = Number(o.total || 0);
    const paymentType = o.paymentType || o.paymentMethod || o.payment_type || '';
    const status = o.status || 'completed';
    const orderNote = o.note || o.employeeId || '';
    await env.DB.prepare('INSERT INTO payments (timestamp, invoice, total, payment_type, order_note, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(timestamp, invoice, total, paymentType, orderNote, status, o.cashier || '').run();
    const items = o.items || [];
    for (const it of items) {
      const qty = Number(it.qty || 0);
      await env.DB.prepare('INSERT INTO sales (timestamp, invoice, sku, name, qty, price, note, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(timestamp, invoice, it.sku || '', it.name || '', qty, Number(it.price || 0), it.note || '', paymentType).run();
      await deductRecipeStock(env, it.sku || '', qty, invoice);
    }
    count++;
  }
  return { success: true, synced: count };
}

async function updateOrderStatus(env, args) {
  const a0 = args && args[0];
  const isObj = a0 && typeof a0 === "object" && !Array.isArray(a0);
  const invoice = isObj ? a0.invoice : a0;
  const status = (isObj ? a0.status : args[1]) || "";
  const reason = (isObj ? a0.reason : args[2]) || "";
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["history"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const user = auth.employee.name;
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE payments SET status = ?, cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE invoice = ?"
  )
    .bind(status, reason, user, now, invoice)
    .run();
  if (status === "cancelled") {
    await env.DB.prepare("UPDATE sales SET cancelled = 1, cancel_reason = ? WHERE invoice = ?")
      .bind(reason, invoice)
      .run();
  }
  return { success: true };
}


async function cancelSalesItems(env, args) {
  await ensureColumn(env, "sales", "cancelled_by", "TEXT");
  const a0 = args && args[0];
  const isObj = a0 && typeof a0 === "object" && !Array.isArray(a0);
  const invoice = isObj ? a0.invoice : a0;
  const reason = (isObj ? a0.reason : args[1]) || "";
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["history"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const cancelledBy = auth.employee.name;
  const items = isObj && Array.isArray(a0.items) ? a0.items : [];
  const now = nowIso();

  if (items.length === 0) {
    await env.DB.prepare("UPDATE sales SET cancelled = 1, cancel_reason = ?, cancelled_by = ? WHERE invoice = ?")
      .bind(reason, cancelledBy, invoice)
      .run();
  } else {
    for (const it of items) {
      const row = await env.DB.prepare(
        "SELECT id FROM sales WHERE invoice = ? AND sku = ? AND IFNULL(note, '') = ? AND IFNULL(cancelled, 0) = 0 ORDER BY id ASC LIMIT 1"
      )
        .bind(invoice, it.sku || "", it.note || "")
        .first();
      if (row) {
        await env.DB.prepare("UPDATE sales SET cancelled = 1, cancel_reason = ?, cancelled_by = ? WHERE id = ?")
          .bind(reason, cancelledBy, row.id)
          .run();
      }
    }
  }

  const remain = await env.DB.prepare(
    "SELECT IFNULL(SUM(qty * price), 0) AS total, COUNT(*) AS n FROM sales WHERE invoice = ? AND IFNULL(cancelled, 0) = 0"
  )
    .bind(invoice)
    .first();
  const newTotal = Number((remain && remain.total) || 0);
  const wholeBillCancelled = Number((remain && remain.n) || 0) === 0;

  await env.DB.prepare("UPDATE payments SET total = ? WHERE invoice = ?").bind(newTotal, invoice).run();
  if (wholeBillCancelled) {
    await env.DB.prepare(
      "UPDATE payments SET status = ?, cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE invoice = ?"
    )
      .bind("cancelled", reason, cancelledBy, now, invoice)
      .run();
  }

  return { success: true, newTotal: newTotal, wholeBillCancelled: wholeBillCancelled };
}

// คืนเงินบางส่วน/เต็มจำนวนให้บิล โดยไม่แตะ sales/payments/สต๊อกเลย (ของยังถือว่าขายไปแล้วจริง แค่คืนเงินให้)
// รองรับคืนเงินหลายครั้งต่อบิลได้ (เช่น คืน 10 บาทวันนี้ อีก 5 บาทวันหลัง) เก็บเป็นประวัติแยกแต่ละครั้ง
async function refundOrder(env, args) {
  await ensureExtraTables(env);
  const a0 = args && args[0];
  const isObj = a0 && typeof a0 === "object";
  const invoice = isObj ? a0.invoice : a0;
  const amount = Number(isObj ? a0.amount : args[1]) || 0;
  const reason = (isObj ? a0.reason : args[2]) || "";
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { tabs: ["history"] });
  if (!auth.ok) return { success: false, error: auth.error };
  const user = auth.employee.name;
  if (!invoice) return { success: false, error: "missing invoice" };
  if (amount <= 0) return { success: false, error: "จำนวนเงินคืนต้องมากกว่า 0" };

  const payment = await env.DB.prepare("SELECT total FROM payments WHERE invoice = ?").bind(invoice).first();
  if (!payment) return { success: false, error: "ไม่พบบิลนี้" };

  // เช็คยอดคงเหลือกับ insert ในสเตตเมนต์เดียวแบบ atomic กันสองคนคืนเงินบิลเดียวกันพร้อมกันแล้วผ่านเช็คทั้งคู่
  // (เดิมอ่านยอดคงเหลือแยกจากการ insert มี race window ระหว่างสอง request)
  const id = "RFD-" + invoice + "-" + Date.now();
  const ins = await env.DB.prepare(
    `INSERT INTO refunds (id, invoice, amount, reason, refunded_by, created_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE (SELECT total FROM payments WHERE invoice = ?) - (SELECT IFNULL(SUM(amount), 0) FROM refunds WHERE invoice = ?) >= ?`
  ).bind(id, invoice, amount, reason, user, nowIso(), invoice, invoice, amount).run();

  if (!ins.meta || !ins.meta.changes) {
    const refundedR = await env.DB.prepare("SELECT IFNULL(SUM(amount), 0) AS t FROM refunds WHERE invoice = ?").bind(invoice).first();
    const alreadyRefunded = Number((refundedR && refundedR.t) || 0);
    const remaining = Number(payment.total || 0) - alreadyRefunded;
    return { success: false, error: `คืนเงินได้ไม่เกิน ${remaining.toFixed(2)} บาท (คืนไปแล้ว ${alreadyRefunded.toFixed(2)} บาท)` };
  }

  const refundedR2 = await env.DB.prepare("SELECT IFNULL(SUM(amount), 0) AS t FROM refunds WHERE invoice = ?").bind(invoice).first();
  return { success: true, id, refundedTotal: Number((refundedR2 && refundedR2.t) || 0) };
}

// ===== สั่งอาหารออนไลน์ผ่าน QR (order.html) =====
// ลูกค้าสั่งแล้วเก็บใน pending_orders ก่อน ยังไม่กระทบยอดขาย/สต๊อกจนกว่าพนักงานจะกด "ยืนยัน" (confirmPendingOrder)
// ถ้าปฏิเสธ/ลูกค้ายกเลิกเอง ก็ไม่มีการสร้างบิลจริงเลย

async function submitPendingOrder(env, args) {
  await ensureExtraTables(env);
  const a = args && args[0] || {};
  const items = Array.isArray(a.items) ? a.items : [];
  if (items.length === 0) return { success: false, error: "ไม่มีรายการสินค้า" };
  const customerName = String(a.customerName || "").trim();
  if (!customerName) return { success: false, error: "กรุณาระบุชื่อผู้สั่ง" };

  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  const id = "PEND-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  await env.DB.prepare(
    "INSERT INTO pending_orders (id, created_at, location, customer_name, items_json, subtotal, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, nowIso(), String(a.location || ""), customerName, JSON.stringify(items), subtotal, subtotal, "pending").run();

  return { success: true, id };
}

async function uploadPaymentSlip(env, args) {
  await ensureExtraTables(env);
  const a = args && args[0] || {};
  const id = a.id;
  if (!id) return { success: false, error: "missing id" };
  const row = await env.DB.prepare("SELECT status FROM pending_orders WHERE id = ?").bind(id).first();
  if (!row) return { success: false, error: "ไม่พบออเดอร์นี้" };
  if (row.status !== "pending") return { success: false, error: "ออเดอร์นี้ไม่ได้อยู่ในสถานะรอดำเนินการแล้ว" };

  await env.DB.prepare("UPDATE pending_orders SET payment_slip_image = ?, slip_uploaded_at = ? WHERE id = ?")
    .bind(String(a.image || ""), nowIso(), id).run();
  return { success: true };
}

async function cancelPendingOrder(env, args) {
  await ensureExtraTables(env);
  const a0 = args && args[0];
  const id = a0 && typeof a0 === "object" ? a0.id : a0;
  if (!id) return { success: false, error: "missing id" };
  const row = await env.DB.prepare("SELECT status FROM pending_orders WHERE id = ?").bind(id).first();
  if (!row) return { success: false, error: "ไม่พบออเดอร์นี้" };
  if (row.status !== "pending") return { success: false, error: "ออเดอร์นี้ไม่ได้อยู่ในสถานะรอดำเนินการแล้ว" };

  await env.DB.prepare("UPDATE pending_orders SET status = 'cancelled' WHERE id = ?").bind(id).run();
  return { success: true };
}

async function getPendingOrderStatus(env, args) {
  await ensureExtraTables(env);
  const a0 = args && args[0];
  const id = a0 && typeof a0 === "object" ? a0.id : a0;
  const row = await env.DB.prepare(
    "SELECT status, reject_reason, slip_uploaded_at FROM pending_orders WHERE id = ?"
  ).bind(id).first();
  if (!row) return { success: false, error: "ไม่พบออเดอร์นี้" };
  return { success: true, status: row.status, rejectReason: row.reject_reason || "", hasSlip: !!row.slip_uploaded_at };
}

async function getPendingOrders(env) {
  await ensureExtraTables(env);
  const r = await env.DB.prepare(
    "SELECT * FROM pending_orders WHERE status = 'pending' ORDER BY created_at ASC"
  ).all();
  return r.results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    location: row.location,
    customerName: row.customer_name,
    items: JSON.parse(row.items_json || "[]"),
    subtotal: row.subtotal,
    total: row.total,
    paymentSlipImage: row.payment_slip_image || "",
    slipUploadedAt: row.slip_uploaded_at || "",
  }));
}

async function getOnlineOrderHistory(env) {
  await ensureExtraTables(env);
  const r = await env.DB.prepare(
    "SELECT * FROM pending_orders WHERE status != 'pending' ORDER BY created_at DESC LIMIT 50"
  ).all();
  return r.results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    location: row.location,
    customerName: row.customer_name,
    items: JSON.parse(row.items_json || "[]"),
    total: row.total,
    status: row.status,
    rejectReason: row.reject_reason || "",
    confirmedBy: row.confirmed_by || "",
    confirmedAt: row.confirmed_at || "",
  }));
}

async function confirmPendingOrder(env, args) {
  await ensureExtraTables(env);
  const a = args && args[0] || {};
  const id = a.id;
  const user = a.user || "";
  if (!id) return { success: false, error: "missing id" };
  const row = await env.DB.prepare("SELECT * FROM pending_orders WHERE id = ?").bind(id).first();
  if (!row) return { success: false, error: "ไม่พบออเดอร์นี้" };
  if (row.status !== "pending") return { success: false, error: "ออเดอร์นี้ถูกดำเนินการไปแล้ว" };

  const items = JSON.parse(row.items_json || "[]");
  const invoice = "ONL-" + row.id;
  const now = nowIso();
  await syncOfflineOrders(env, [{
    invoice, timestamp: now, total: row.total, paymentType: "QR", status: "completed",
    note: `Online: ${row.location || ""} / ${row.customer_name || ""}`.trim(),
    items,
  }]);

  await env.DB.prepare(
    "UPDATE pending_orders SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?"
  ).bind(user, now, id).run();

  return { success: true, invoice };
}

async function rejectPendingOrder(env, args) {
  await ensureExtraTables(env);
  const a = args && args[0] || {};
  const id = a.id;
  const reason = a.reason || "";
  if (!id) return { success: false, error: "missing id" };
  const row = await env.DB.prepare("SELECT status FROM pending_orders WHERE id = ?").bind(id).first();
  if (!row) return { success: false, error: "ไม่พบออเดอร์นี้" };
  if (row.status !== "pending") return { success: false, error: "ออเดอร์นี้ถูกดำเนินการไปแล้ว" };

  await env.DB.prepare("UPDATE pending_orders SET status = 'rejected', reject_reason = ? WHERE id = ?")
    .bind(reason, id).run();
  return { success: true };
}

async function posDataForDay(env, day) {
  await ensureColumn(env, "payments", "created_by", "TEXT");
  await ensureColumn(env, "payments", "edited_by", "TEXT");
  await ensureColumn(env, "payments", "edited_at", "TEXT");
  await ensureColumn(env, "sales", "cancelled_by", "TEXT");
  const today = day || bkkToday();
  const payR = await env.DB.prepare(
    "SELECT * FROM payments WHERE date(timestamp, '+7 hours') = ? ORDER BY id DESC"
  ).bind(today).all();
  const saleR = await env.DB.prepare(
    "SELECT * FROM sales WHERE date(timestamp, '+7 hours') = ? ORDER BY id ASC"
  ).bind(today).all();

  const itemsByInvoice = {};
  for (const s of saleR.results) {
    const key = s.invoice || "";
    if (!itemsByInvoice[key]) itemsByInvoice[key] = [];
    itemsByInvoice[key].push({
      id: s.id,
      sku: s.sku || "",
      name: s.name || "",
      qty: Number(s.qty || 0),
      price: Number(s.price || 0),
      note: s.note || "",
      cancelled: !!s.cancelled,
      cancelledBy: s.cancelled_by || "",
    });
  }

  const history = payR.results.map((p) => ({
    invoice: p.invoice,
    timestamp: p.timestamp,
    total: Number(p.total || 0),
    paymentType: p.payment_type || "",
    status: String(p.status || "active").toLowerCase(),
    cancelReason: p.cancel_reason || "",
    cancelledBy: p.cancelled_by || "",
    editedBy: p.edited_by || "",
    note: p.order_note || "",
    cashier: p.created_by || "",
    items: itemsByInvoice[p.invoice] || [],
  }));

  const seen = new Set(history.map((h) => h.invoice));
  for (const inv of Object.keys(itemsByInvoice)) {
    if (seen.has(inv)) continue;
    const items = itemsByInvoice[inv];
    const first = saleR.results.find((s) => s.invoice === inv) || {};
    history.push({
      invoice: inv,
      timestamp: first.timestamp,
      total: items.reduce((sum, it) => sum + (it.cancelled ? 0 : it.price * it.qty), 0),
      paymentType: first.payment_type || "",
      status: "active",
      cancelReason: "",
      cancelledBy: "",
      editedBy: "",
      note: "",
      cashier: "",
      items: items,
    });
  }

  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (history.length > 0) {
    await ensureExtraTables(env);
    const invoiceList = history.map((h) => h.invoice);
    const placeholders = invoiceList.map(() => "?").join(",");
    const refundR = await env.DB.prepare(
      `SELECT invoice, amount, refunded_by FROM refunds WHERE invoice IN (${placeholders}) ORDER BY created_at ASC`
    ).bind(...invoiceList).all();
    const refundByInvoice = {};
    const refundersByInvoice = {};
    for (const row of refundR.results) {
      refundByInvoice[row.invoice] = (refundByInvoice[row.invoice] || 0) + Number(row.amount || 0);
      if (row.refunded_by) {
        refundersByInvoice[row.invoice] = refundersByInvoice[row.invoice] || [];
        if (!refundersByInvoice[row.invoice].includes(row.refunded_by)) refundersByInvoice[row.invoice].push(row.refunded_by);
      }
    }
    for (const h of history) {
      h.refundedTotal = refundByInvoice[h.invoice] || 0;
      h.refundedBy = (refundersByInvoice[h.invoice] || []).join(', ');
    }
  }

  const voidInvoices = new Set(
    payR.results
      .filter((p) =>
        ["cancelled", "waste"].includes(String(p.status || "").toLowerCase())
      )
      .map((p) => p.invoice)
  );
  const cupCount = saleR.results.reduce(
    (sum, row) =>
      row.cancelled || voidInvoices.has(row.invoice)
        ? sum
        : sum + Number(row.qty || 0),
    0
  );
  return { history, cupCount };
}

handlers.getTodayPOSData = async (env) => posDataForDay(env, null);

handlers.getPOSDataByDate = async (env, args) => {
  const a0 = args && args[0];
  const day = a0 && typeof a0 === "object" ? a0.date : a0;
  return posDataForDay(env, day || bkkToday());
};

async function summaryByRange(env, start, end) {
  const startDay = dayStr(start);
  const endDay = dayStr(end, startDay);

  const sales = await env.DB.prepare(
    "SELECT *, date(timestamp, '+7 hours') AS bkk_date FROM sales WHERE date(timestamp, '+7 hours') BETWEEN ? AND ? AND cancelled = 0 AND invoice NOT IN (SELECT invoice FROM payments WHERE LOWER(IFNULL(status, '')) IN ('cancelled', 'waste'))"
  ).bind(startDay, endDay).all();
  const wasteSales = await env.DB.prepare(
    "SELECT * FROM sales WHERE date(timestamp, '+7 hours') BETWEEN ? AND ? AND cancelled = 0 AND invoice IN (SELECT invoice FROM payments WHERE LOWER(IFNULL(status, '')) = 'waste')"
  ).bind(startDay, endDay).all();
  const paymentsR = await env.DB.prepare(
    "SELECT *, date(timestamp, '+7 hours') AS bkk_date, strftime('%H', timestamp, '+7 hours') AS bkk_hour FROM payments WHERE date(timestamp, '+7 hours') BETWEEN ? AND ? AND (status IS NULL OR LOWER(status) NOT IN ('cancelled', 'waste'))"
  ).bind(startDay, endDay).all();
  const pmR = await env.DB.prepare("SELECT * FROM payment_methods").all();
  const cashTypes = new Set(
    pmR.results.filter((p) => p.is_cash).map((p) => String(p.name || "").trim().toLowerCase())
  );

  let total = 0, totalCost = 0, cash = 0, other = 0, cupCount = 0;
  const byType = {};
  const daily = {};
  const hourMap = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { hour: h, label: String(h).padStart(2, "0") + ":00", total: 0, bills: 0 };

  for (const p of paymentsR.results) {
    const amt = Number(p.total || 0);
    total += amt;
    if (cashTypes.has(String(p.payment_type || "").trim().toLowerCase())) cash += amt;
    else other += amt;
    const label = p.payment_type || "ไม่ระบุ";
    byType[label] = (byType[label] || 0) + amt;
    const d = (daily[p.bkk_date] = daily[p.bkk_date] || { date: p.bkk_date, total: 0, bills: 0, cups: 0 });
    d.total += amt;
    d.bills += 1;
    const hr = Number(p.bkk_hour);
    if (!isNaN(hr) && hourMap[hr]) {
      hourMap[hr].total += amt;
      hourMap[hr].bills += 1;
    }
  }
  const byHour = Object.values(hourMap).sort((a, b) => a.hour - b.hour);

  let floatCash = 0;
  try {
    const floatR = await env.DB.prepare(
      "SELECT IFNULL(SUM(CASE WHEN LOWER(action) = 'out' THEN -total_amount ELSE total_amount END), 0) AS bal FROM float_log WHERE substr(timestamp, 1, 10) <= ? AND NOT (LOWER(action) = 'close_day' AND substr(timestamp, 1, 10) BETWEEN ? AND ?)"
    )
      .bind(endDay, startDay, endDay)
      .first();
    floatCash = Number((floatR && floatR.bal) || 0);
  } catch (err) {
    floatCash = 0;
  }

  const menuR = await env.DB.prepare("SELECT sku, cost FROM menu").all();
  const costMap = {};
  for (const m of menuR.results) costMap[m.sku] = m.cost || 0;

  const topMap = {};
  for (const s of sales.results) {
    const qty = Number(s.qty || 0);
    const itemCost = costMap[s.sku] || 0;
    cupCount += qty;
    totalCost += itemCost * qty;
    const d = (daily[s.bkk_date] = daily[s.bkk_date] || { date: s.bkk_date, total: 0, bills: 0, cups: 0 });
    d.cups += qty;
    const key = s.name || s.sku || "-";
    const t = (topMap[key] = topMap[key] || { sku: s.sku, name: key, qty: 0, amount: 0, cost: 0, hasCost: false });
    t.qty += qty;
    t.amount += Number(s.price || 0) * qty;
    t.cost += itemCost * qty;
    if (itemCost > 0) t.hasCost = true;
  }

  // เพิ่มกำไร/มาร์จิ้นต่อรายการ ไว้ข้าง qty/amount เดิม เรียงลำดับตาม qty เหมือนเดิม (ยังคงเป็น "ขายดี" ไม่ใช่ re-rank ตามกำไร)
  const topSellers = Object.values(topMap)
    .map((t) => ({ ...t, profit: t.amount - t.cost, marginPct: t.amount > 0 ? ((t.amount - t.cost) / t.amount) * 100 : 0 }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  const dailyList = Object.values(daily).sort((a, b) => (a.date < b.date ? 1 : -1));

  // สรุปยอดขายเฉลี่ยตามวันในสัปดาห์ ใช้ dailyList ที่มีอยู่แล้ว ไม่ query เพิ่ม (แปลงวันที่แบบ UTC เหมือน addDays กันปัญหา timezone)
  const weekdayLabels = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const weekdayMap = {};
  for (const d of dailyList) {
    const wd = new Date(d.date + "T00:00:00Z").getUTCDay();
    const w = (weekdayMap[wd] = weekdayMap[wd] || { weekday: wd, label: weekdayLabels[wd], total: 0, cups: 0, days: 0 });
    w.total += d.total;
    w.cups += d.cups;
    w.days += 1;
  }
  const byWeekday = Object.values(weekdayMap)
    .map((w) => ({ ...w, avgPerDay: w.days ? w.total / w.days : 0 }))
    .sort((a, b) => a.weekday - b.weekday);

  let wasteCost = 0;
  for (const s of wasteSales.results) {
    wasteCost += (costMap[s.sku] || 0) * Number(s.qty || 0);
  }

  await ensureExtraTables(env);
  const refundR = await env.DB.prepare(
    "SELECT IFNULL(SUM(amount), 0) AS t FROM refunds WHERE date(created_at, '+7 hours') BETWEEN ? AND ?"
  ).bind(startDay, endDay).first();
  const refundedTotal = Number((refundR && refundR.t) || 0);

  const billCount = paymentsR.results.length;
  const totalProfit = total - totalCost - wasteCost - refundedTotal;
  const avgPerBill = billCount ? total / billCount : 0;
  return {
    success: true, total, totalProfit, billCount, cupCount, totalCost, wasteCost, refundedTotal,
    avgPerBill, cash, other, qr: other, byType, topSellers, daily: dailyList, byWeekday, byHour, floatCash,
  };
}

handlers.getSummaryByRange = async (env, args) => {
  const [start, end] = args;
  return summaryByRange(env, start, end);
};

// สถิติวัน/เดือนขายดีที่สุดตลอดกาล รวมข้อมูลจาก archive_payments ด้วย (ไม่งั้นพอ archive ข้อมูลเก่าไป สถิติจะหายไปเงียบๆ)
handlers.getSalesRecords = async (env) => {
  await ensureExtraTables(env);
  const activeFilter = "(status IS NULL OR LOWER(status) NOT IN ('cancelled', 'waste'))";
  const dayR = await env.DB.prepare(`
    SELECT day, SUM(total) AS total FROM (
      SELECT date(timestamp, '+7 hours') AS day, total, status FROM payments
      UNION ALL
      SELECT date(timestamp, '+7 hours') AS day, total, status FROM archive_payments
    ) WHERE ${activeFilter}
    GROUP BY day ORDER BY total DESC LIMIT 1
  `).first();
  const monthR = await env.DB.prepare(`
    SELECT month, SUM(total) AS total FROM (
      SELECT strftime('%Y-%m', timestamp, '+7 hours') AS month, total, status FROM payments
      UNION ALL
      SELECT strftime('%Y-%m', timestamp, '+7 hours') AS month, total, status FROM archive_payments
    ) WHERE ${activeFilter}
    GROUP BY month ORDER BY total DESC LIMIT 1
  `).first();
  return {
    success: true,
    bestDay: dayR ? { date: dayR.day, total: Number(dayR.total || 0) } : null,
    bestMonth: monthR ? { month: monthR.month, total: Number(monthR.total || 0) } : null,
  };
};

handlers.getTodaySummary = async (env) => {
  const today = bkkToday();
  return summaryByRange(env, today, today);
};

handlers.getBestSellers = async (env, args) => {
  let period = "all";
  let limit = 10;
  const a = args && args[0];
  if (typeof a === "number") limit = a;
  else if (typeof a === "string" && a) period = a;
  if (args && typeof args[1] === "number") limit = args[1];
  limit = Number(limit) || 10;

  const today = bkkToday();
  let start = null;
  if (period === "today") start = today;
  else if (period === "week") start = addDays(today, -6);
  else if (period === "month") start = today.slice(0, 8) + "01";

  let sql = "SELECT sku, name, SUM(qty) AS qty, SUM(qty * price) AS amount FROM sales WHERE cancelled = 0 AND invoice NOT IN (SELECT invoice FROM payments WHERE LOWER(IFNULL(status, '')) IN ('cancelled', 'waste'))";
  const binds = [];
  if (start) {
    sql += " AND date(timestamp, '+7 hours') >= ?";
    binds.push(start);
  }
  sql += " GROUP BY name ORDER BY qty DESC LIMIT " + limit;

  const stmt = env.DB.prepare(sql);
  const r = await (binds.length ? stmt.bind(...binds) : stmt).all();
  return r.results.map((row) => ({
    sku: row.sku,
    name: row.name,
    qty: Number(row.qty || 0),
    amount: Number(row.amount || 0),
  }));
};

async function syncFloatCashLogs(env, args) {
  const raw = args[0];
  const logs = Array.isArray(raw) ? raw : [raw];
  const num = (a, b) => Number(a ?? b ?? 0) || 0;
  for (const l of logs) {
    const d = l.denominations || {};
    await env.DB.prepare(
      "INSERT INTO float_log (timestamp, user, action, total_amount, note, b1000,b500,b100,b50,b20,c10,c5,c2,c1) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
      .bind(
        l.timestamp || nowIso(),
        l.user || "",
        l.action || "",
        num(l.total_amount ?? l.totalAmount, l.total),
        l.note || "",
        num(l.b1000, d.B1000),
        num(l.b500, d.B500),
        num(l.b100, d.B100),
        num(l.b50, d.B50),
        num(l.b20, d.B20),
        num(l.c10, d.C10),
        num(l.c5, d.C5),
        num(l.c2, d.C2),
        num(l.c1, d.C1)
      )
      .run();
  }
  return { success: true };
}

handlers.closeDayCash = async (env) => {
  const today = bkkToday();
  const s = await summaryByRange(env, today, today);
  const amount = s.cash;
  await env.DB.prepare(
    "INSERT INTO float_log (timestamp, user, action, total_amount, note) VALUES (?,?,?,?,?)"
  ).bind(nowIso(), "system", "close_day", amount, "auto close day").run();
  return { success: true, amount, message: "closed" };
};

handlers.getAccessLogs = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM access_log ORDER BY id DESC LIMIT 500").all();
  return r.results;
};

handlers.getErrorLogs = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT * FROM error_log ORDER BY id DESC LIMIT 100").all();
  return r.results;
};

handlers.getChangeLogs = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT * FROM change_log ORDER BY id DESC LIMIT 200").all();
  return r.results;
};

handlers.syncAccessLogs = async (env, args) => {
  const snapshot = args[0] || [];
  for (const log of snapshot) {
    // กันซ้ำ กรณีเครื่องที่เน็ตกระตุกส่งชุดเดิมมาซ้ำ (ส่งสำเร็จฝั่งเซิร์ฟเวอร์แล้วแต่เครื่องไม่รู้ผลเพราะ timeout เลยลองใหม่เรื่อยๆ)
    const existing = await env.DB.prepare(
      "SELECT id FROM access_log WHERE timestamp = ? AND context = ? AND result = ? AND IFNULL(name, '') = ? LIMIT 1"
    ).bind(log.timestamp, log.context, log.result, log.name || '').first();
    if (existing) continue;
    await env.DB.prepare(
      "INSERT INTO access_log (timestamp, context, result, name) VALUES (?,?,?,?)"
    ).bind(log.timestamp, log.context, log.result, log.name).run();
  }
  // เก็บแค่ 90 วันล่าสุด ไม่งั้นตารางจะโตไม่มีที่สิ้นสุด (สุ่ม 5% ต่อครั้งพอ ไม่ต้องเช็คทุกครั้ง)
  if (Math.random() < 0.05) {
    await env.DB.prepare("DELETE FROM access_log WHERE timestamp < ?")
      .bind(new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()).run();
  }
  return { success: true };
};

handlers.clearAccessLogs = async (env, args) => {
  const a0 = (args && args[0]) || {};
  const auth = await authorizeEmployee(env, a0.employeeId, a0.pin, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };
  await env.DB.prepare("DELETE FROM access_log").run();
  return { success: true };
};

handlers.clearErrorLogs = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = (args && args[0]) || {};
  const auth = await authorizeEmployee(env, a0.employeeId, a0.pin, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };
  await env.DB.prepare("DELETE FROM error_log").run();
  return { success: true };
};

handlers.clearChangeLogs = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = (args && args[0]) || {};
  const auth = await authorizeEmployee(env, a0.employeeId, a0.pin, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };
  await env.DB.prepare("DELETE FROM change_log").run();
  return { success: true };
};

handlers.getBackupList = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT id, created_at, label FROM backups ORDER BY id DESC").all();
  return r.results;
};

handlers.createBackup = async (env, args) => {
  await ensureExtraTables(env);
  const label = (args && args[0]) || nowIso();
  // ตั้งใจไม่รวม access_log/inventory_log/float_log (log ไม่มีวันจบ กู้คืนแล้วไม่มีประโยชน์มาก แค่ทำให้ backup ใหญ่)
  // และไม่รวม archives/archive_sales/archive_payments (เป็น backup ของข้อมูลเก่าอยู่แล้วจากฟีเจอร์ archive)
  const tables = [
    "menu", "employees", "addons", "payment_methods", "shop_info", "inventory",
    "sales", "payments", "refunds", "pending_orders", "sweetness_levels", "recipes",
  ];
  const data = {};
  for (const t of tables) {
    const r = await env.DB.prepare("SELECT * FROM " + t).all();
    data[t] = r.results;
  }
  await env.DB.prepare("INSERT INTO backups (created_at, label, data) VALUES (?,?,?)")
    .bind(nowIso(), label, JSON.stringify(data)).run();
  return { success: true, label, data };
};

handlers.getBackupData = async (env, args) => {
  await ensureExtraTables(env);
  const id = args && args[0];
  const r = await env.DB.prepare("SELECT data FROM backups WHERE id = ?").bind(id).first();
  if (!r) return { success: false, error: "not found" };
  return { success: true, data: JSON.parse(r.data) };
};

// กู้คืนข้อมูลจาก backup กลับเข้าตารางจริง เขียนทับข้อมูลปัจจุบันในตารางที่ backup ไว้ทั้งหมด (ไม่แตะ log ต่างๆ)
// สำรองสถานะปัจจุบันไว้ก่อนเขียนทับเสมอ กันพลาดกู้คืนผิดตัวแล้วย้อนกลับไม่ได้
handlers.restoreBackup = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = (args && args[0]) || {};
  const auth = await authorizeEmployee(env, a0.employeeId, a0.pin, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };
  const id = a0.id;
  if (!id) return { success: false, error: "missing id" };

  const row = await env.DB.prepare("SELECT data FROM backups WHERE id = ?").bind(id).first();
  if (!row) return { success: false, error: "ไม่พบ backup นี้" };
  const data = JSON.parse(row.data);

  await handlers.createBackup(env, ["ก่อนกู้คืนจาก backup #" + id + " (อัตโนมัติ)"]);

  const tables = [
    "menu", "employees", "addons", "payment_methods", "shop_info", "inventory",
    "sales", "payments", "refunds", "pending_orders", "sweetness_levels", "recipes",
  ];
  const statements = [];
  for (const t of tables) {
    statements.push(env.DB.prepare("DELETE FROM " + t));
    const rows = Array.isArray(data[t]) ? data[t] : [];
    for (const r of rows) {
      const cols = Object.keys(r);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(",");
      statements.push(
        env.DB.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${placeholders})`).bind(...cols.map((c) => r[c]))
      );
    }
  }
  await env.DB.batch(statements);
  return { success: true };
};

handlers.deleteBackup = async (env, args) => {
  await ensureExtraTables(env);
  const a0 = args && args[0];
  const isObj = a0 && typeof a0 === "object";
  const id = isObj ? a0.id : a0;
  const auth = await authorizeEmployee(env, isObj ? a0.employeeId : null, isObj ? a0.pin : null, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };
  if (!id) return { success: false, error: "missing id" };
  await env.DB.prepare("DELETE FROM backups WHERE id = ?").bind(id).run();
  return { success: true };
};

handlers.cleanupOldBackups = async (env) => {
  await ensureExtraTables(env);
  const cutoff = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM backups WHERE created_at < ?").bind(cutoff).run();
  return { success: true };
};

// เรียกจาก Cron Trigger (ดู scheduled() ด้านล่าง) วันละครั้ง แต่จะสร้าง backup ใหม่จริง
// ก็ต่อเมื่อ backup ล่าสุดผ่านไปแล้ว >= 30 วัน (หรือยังไม่เคยมี backup เลย)
// ใช้การเทียบเวลาที่ผ่านไปแทน cron expression เพราะ cron ปกติกำหนด "ทุก 30 วัน" ตรงๆ ไม่ได้
handlers.autoBackupIfDue = async (env) => {
  await ensureExtraTables(env);
  const last = await env.DB.prepare("SELECT created_at FROM backups ORDER BY id DESC LIMIT 1").first();
  const dueMs = 30 * 24 * 3600 * 1000;
  if (!last || (Date.now() - new Date(last.created_at).getTime()) >= dueMs) {
    await handlers.createBackup(env, ["auto-30day"]);
  }
  await handlers.cleanupOldBackups(env);
  return { success: true };
};

handlers.getArchiveList = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT id, created_at, range_start, range_end, note FROM archives ORDER BY id DESC").all();
  return r.results;
};

// เดิมรับ start/end ตรงๆ แต่หน้าเว็บ (manualArchiveNow) ไม่เคยส่ง start/end มาเลย ปุ่มจึงพังมาตลอด
// เปลี่ยนเป็น auto-detect ปีเก่าที่มีข้อมูลอยู่ (เก่ากว่าปีปัจจุบันตามเวลาไทย) แล้ว archive ทีละปีให้เอง ตรงกับข้อความบนปุ่มที่สัญญาไว้
handlers.archiveOldData = async (env, args) => {
  await ensureExtraTables(env);
  const a = (args && args[0]) || {};
  const auth = await authorizeEmployee(env, a.employeeId, a.pin, { ownerOnly: true });
  if (!auth.ok) return { success: false, error: auth.error };

  const currentYear = Number(bkkToday().slice(0, 4));
  const yearsR = await env.DB.prepare(`
    SELECT yr FROM (
      SELECT strftime('%Y', timestamp, '+7 hours') AS yr FROM payments
      UNION
      SELECT strftime('%Y', timestamp, '+7 hours') AS yr FROM sales
    ) WHERE yr IS NOT NULL AND CAST(yr AS INTEGER) < ? ORDER BY yr
  `).bind(currentYear).all();

  const archivedYears = [];
  let totalArchivedRows = 0;
  for (const row of yearsR.results) {
    const yr = row.yr;
    const archiveRes = await env.DB.prepare(
      "INSERT INTO archives (created_at, range_start, range_end, note) VALUES (?,?,?,?)"
    ).bind(nowIso(), `${yr}-01-01`, `${yr}-12-31`, `auto: ${yr}`).run();
    const archiveId = archiveRes.meta.last_row_id;

    const sales = await env.DB.prepare("SELECT * FROM sales WHERE strftime('%Y', timestamp, '+7 hours') = ?").bind(yr).all();
    for (const s of sales.results) {
      await env.DB.prepare(
        `INSERT INTO archive_sales (archive_id, timestamp, invoice, sku, name, qty, price, note, payment_type, cancelled, cancel_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(archiveId, s.timestamp, s.invoice, s.sku, s.name, s.qty, s.price, s.note, s.payment_type, s.cancelled, s.cancel_reason).run();
    }

    const payments = await env.DB.prepare("SELECT * FROM payments WHERE strftime('%Y', timestamp, '+7 hours') = ?").bind(yr).all();
    for (const p of payments.results) {
      await env.DB.prepare(
        `INSERT INTO archive_payments (archive_id, timestamp, invoice, total, payment_type, order_note, status, cancel_reason, cancelled_by, cancelled_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(archiveId, p.timestamp, p.invoice, p.total, p.payment_type, p.order_note, p.status, p.cancel_reason, p.cancelled_by, p.cancelled_at).run();
    }

    await env.DB.prepare("DELETE FROM sales WHERE strftime('%Y', timestamp, '+7 hours') = ?").bind(yr).run();
    await env.DB.prepare("DELETE FROM payments WHERE strftime('%Y', timestamp, '+7 hours') = ?").bind(yr).run();

    archivedYears.push(yr);
    totalArchivedRows += sales.results.length + payments.results.length;
  }

  return { success: true, archivedYears, totalArchivedRows };
};

handlers.updateInventoryStock = updateInventoryStock;
handlers.syncOfflineOrders = syncOfflineOrders;
handlers.updateOrderStatus = updateOrderStatus;
handlers.cancelSalesItems = cancelSalesItems;
handlers.refundOrder = refundOrder;
handlers.syncFloatCashLogs = syncFloatCashLogs;
handlers.submitPendingOrder = submitPendingOrder;
handlers.uploadPaymentSlip = uploadPaymentSlip;
handlers.cancelPendingOrder = cancelPendingOrder;
handlers.getPendingOrderStatus = getPendingOrderStatus;
handlers.getPendingOrders = getPendingOrders;
handlers.getOnlineOrderHistory = getOnlineOrderHistory;
handlers.confirmPendingOrder = confirmPendingOrder;
handlers.rejectPendingOrder = rejectPendingOrder;


handlers.saveInventoryItem = async (env, args) => {
  await ensureColumn(env, "inventory", "photo", "TEXT");
  await ensureColumn(env, "inventory", "purchase_unit", "TEXT");
  await ensureColumn(env, "inventory", "purchase_factor", "REAL");
  const it = args[0] || {};
  const name = String(it.name || "").trim();
  if (!name) return { success: false, error: "missing name" };
  const unit = String(it.unit || "").trim();
  const stock = Number(it.stock ?? it.current_stock ?? 0) || 0;
  const photo = String(it.photo || "");
  const purchaseUnit = String(it.purchaseUnit || it.purchase_unit || "").trim();
  const purchaseFactor = Number(it.purchaseFactor ?? it.purchase_factor) || 0;
  const id = it.id || "ITM-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const existing = await env.DB.prepare("SELECT id FROM inventory WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare("UPDATE inventory SET name = ?, unit = ?, current_stock = ?, photo = ?, purchase_unit = ?, purchase_factor = ? WHERE id = ?")
      .bind(name, unit, stock, photo, purchaseUnit, purchaseFactor, id).run();
  } else {
    await env.DB.prepare("INSERT INTO inventory (id, name, current_stock, unit, photo, purchase_unit, purchase_factor) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, stock, unit, photo, purchaseUnit, purchaseFactor).run();
  }
  return { success: true, id: id };
};

handlers.deleteInventoryItem = async (env, args) => {
  const a0 = args[0];
  const id = a0 && typeof a0 === "object" ? a0.id : a0;
  if (id === null || id === undefined || id === "") return { success: false, error: "missing id" };
  const r = await env.DB.prepare("DELETE FROM inventory WHERE id = ?").bind(id).run();
  const changed = (r && r.meta && r.meta.changes) || 0;
  return { success: changed > 0, deleted: changed };
};

handlers.updateOrderDetails = async (env, args) => {
  await ensureColumn(env, "payments", "edited_by", "TEXT");
  await ensureColumn(env, "payments", "edited_at", "TEXT");
  const a0 = args[0] || {};
  const invoice = a0.invoice;
  if (!invoice) return { success: false, error: "missing invoice" };

  // ป้องกันสองคนแก้บิลเดียวกันพร้อมกันแล้วคนหลังเผลอทับข้อมูลคนแรกเงียบๆ
  // เช็คว่ายอดรวมบิลตอนนี้ยังตรงกับที่ client อ่านตอนเปิดหน้าแก้ไข ก่อนจะแตะแถวไหนเลย
  if (a0.expectedTotal !== undefined && a0.expectedTotal !== null) {
    const cur = await env.DB.prepare("SELECT total FROM payments WHERE invoice = ?").bind(invoice).first();
    if (!cur) return { success: false, error: "ไม่พบบิลนี้" };
    if (Math.abs(Number(cur.total || 0) - Number(a0.expectedTotal)) > 0.01) {
      return { success: false, error: "บิลนี้ถูกแก้ไขไปแล้วโดยคนอื่น กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง" };
    }
  }

  const items = Array.isArray(a0.items) ? a0.items : [];
  for (const it of items) {
    const qty = Number(it.qty || 0);
    const price = Number(it.price || 0);
    if (it.remove || qty <= 0) {
      await env.DB.prepare("DELETE FROM sales WHERE id = ? AND invoice = ?").bind(it.id, invoice).run();
    } else {
      await env.DB.prepare("UPDATE sales SET qty = ?, price = ?, note = ? WHERE id = ? AND invoice = ?").bind(qty, price, it.note || "", it.id, invoice).run();
    }
  }
  const sumR = await env.DB.prepare(
    "SELECT IFNULL(SUM(qty * price), 0) AS t FROM sales WHERE invoice = ? AND cancelled = 0"
  ).bind(invoice).first();
  const total = Number((sumR && sumR.t) || 0);
  const sets = ["total = ?"];
  const binds = [total];
  if (a0.paymentType) {
    sets.push("payment_type = ?");
    binds.push(a0.paymentType);
    await env.DB.prepare("UPDATE sales SET payment_type = ? WHERE invoice = ?").bind(a0.paymentType, invoice).run();
  }
  if (a0.note !== undefined && a0.note !== null) {
    sets.push("order_note = ?");
    binds.push(a0.note);
  }
  if (a0.editedBy) {
    sets.push("edited_by = ?");
    binds.push(a0.editedBy);
    sets.push("edited_at = ?");
    binds.push(nowIso());
  }
  binds.push(invoice);
  await env.DB.prepare("UPDATE payments SET " + sets.join(", ") + " WHERE invoice = ?").bind(...binds).run();
  return { success: true, total: total };
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method === "GET") {
      return json({ ok: true, message: "Pukfu POS API" }, 200, origin);
    }
    if (request.method === "POST") {
      let fn;
      try {
        const body = await request.json();
        ({ fn } = body);
        const { token, args } = body;
        const isPublicToken = env.PUBLIC_API_TOKEN && token === env.PUBLIC_API_TOKEN;
        const isStaffToken = env.API_TOKEN && token === env.API_TOKEN;
        if (isPublicToken) {
          if (!PUBLIC_HANDLERS.has(fn)) {
            return json({ ok: false, error: "Unauthorized" }, 401, origin);
          }
        } else if (!isStaffToken) {
          return json({ ok: false, error: "Unauthorized" }, 401, origin);
        }
        const handler = handlers[fn];
        if (!handler) {
          return json({ ok: false, error: "Unknown function: " + fn }, 400, origin);
        }
        const result = await handler(env, args || []);
        return json({ ok: true, result }, 200, origin);
      } catch (err) {
        // บันทึกข้อผิดพลาดไว้ดูย้อนหลังใน Settings > Log ไม่ให้ตกหล่นเงียบๆ เหมือนเดิม
        try {
          await ensureExtraTables(env);
          await env.DB.prepare("INSERT INTO error_log (created_at, fn, message) VALUES (?, ?, ?)")
            .bind(nowIso(), fn || "", String((err && err.message) || err)).run();
          if (Math.random() < 0.05) {
            await env.DB.prepare("DELETE FROM error_log WHERE created_at < ?")
              .bind(new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()).run();
          }
        } catch (logErr) { /* ไม่ให้การบันทึก log ล้มเหลว มาบัง error response จริง */ }
        return json({ ok: false, error: err.message }, 500, origin);
      }
    }
    return json({ ok: false, error: "Method not allowed" }, 405, origin);
  },

  // ต้องเพิ่ม Cron Trigger เองที่ Cloudflare dashboard (Workers & Pages > pukfu-pos-api > Triggers)
  // แนะนำตั้งวันละครั้ง เช่น "0 20 * * *" (20:00 UTC = 03:00 เวลาไทย) โค้ดข้างในจะเช็คเองว่าถึงรอบ 30 วันหรือยัง
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handlers.autoBackupIfDue(env));
  },
};
