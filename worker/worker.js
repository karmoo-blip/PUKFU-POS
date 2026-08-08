function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
  });
}

async function ensureExtraTables(env) {
  const stmts = [
    "CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, label TEXT, data TEXT)",
    "CREATE TABLE IF NOT EXISTS archives (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, range_start TEXT, range_end TEXT, note TEXT)",
    "CREATE TABLE IF NOT EXISTS archive_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_id INTEGER, timestamp TEXT, invoice TEXT, sku TEXT, name TEXT, qty REAL, price REAL, note TEXT, payment_type TEXT, cancelled INTEGER, cancel_reason TEXT)",
    "CREATE TABLE IF NOT EXISTS archive_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_id INTEGER, timestamp TEXT, invoice TEXT, total REAL, payment_type TEXT, order_note TEXT, status TEXT, cancel_reason TEXT, cancelled_by TEXT, cancelled_at TEXT)",
  ];
  for (const s of stmts) {
    await env.DB.prepare(s).run();
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
  const recordedBy = args[1] || '';
  const now = nowIso();
  for (const c of changes) {
    const id = c.id;
    const delta = Number(c.delta ?? c.qty ?? c.amount ?? 0);
    const item = await env.DB.prepare('SELECT name, current_stock FROM inventory WHERE id = ?').bind(id).first();
    if (!item) continue;
    const newStock = (item.current_stock || 0) + delta;
    await env.DB.prepare('UPDATE inventory SET current_stock = ? WHERE id = ?').bind(newStock, id).run();
    await env.DB.prepare('INSERT INTO inventory_log (timestamp, item_name, change, new_stock, recorded_by) VALUES (?, ?, ?, ?, ?)').bind(now, item.name, delta, newStock, recordedBy).run();
  }
  return { success: true };
}

handlers.getEmployees = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM employees").all();
  return r.results;
};

handlers.getEmployeesForCache = async (env) => {
  const r = await env.DB.prepare("SELECT id, name, pin, role, active, permission FROM employees").all();
  return r.results;
};

handlers.saveEmployee = async (env, args) => {
  const emp = args[0];
  const existing = await env.DB.prepare("SELECT id FROM employees WHERE id = ?").bind(emp.id).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE employees SET name=?, pin=?, role=?, active=?, permission=? WHERE id=?"
    ).bind(emp.name, emp.pin, emp.role, emp.active ? 1 : 0, JSON.stringify(emp.permission || {}), emp.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO employees (id, name, pin, role, active, permission, created_by) VALUES (?,?,?,?,?,?,?)"
    ).bind(emp.id, emp.name, emp.pin, emp.role, emp.active ? 1 : 0, JSON.stringify(emp.permission || {}), emp.created_by || "").run();
  }
  return { success: true };
};

handlers.deleteEmployee = async (env, args) => {
  const id = args[0];
  await env.DB.prepare("DELETE FROM employees WHERE id = ?").bind(id).run();
  return { success: true };
};

handlers.getAddons = async (env) => {
  const r = await env.DB.prepare("SELECT * FROM addons").all();
  return r.results;
};

handlers.saveAddon = async (env, args) => {
  const addon = args[0];
  const existing = await env.DB.prepare("SELECT id FROM addons WHERE id = ?").bind(addon.id).first();
  if (existing) {
    await env.DB.prepare("UPDATE addons SET name=?, price=?, active=? WHERE id=?")
      .bind(addon.name, addon.price, addon.active ? 1 : 0, addon.id).run();
  } else {
    await env.DB.prepare("INSERT INTO addons (id, name, price, active, created_by) VALUES (?,?,?,?,?)")
      .bind(addon.id, addon.name, addon.price, addon.active ? 1 : 0, addon.created_by || "").run();
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
  const pm = args[0];
  const existing = await env.DB.prepare("SELECT id FROM payment_methods WHERE id = ?").bind(pm.id).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE payment_methods SET name=?, is_cash=?, enabled=?, sort_order=? WHERE id=?"
    ).bind(pm.name, (pm.isCash ?? pm.is_cash) ? 1 : 0, pm.enabled ? 1 : 0, pm.sort_order || 0, pm.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO payment_methods (id, name, is_cash, enabled, sort_order, created_by) VALUES (?,?,?,?,?,?)"
    ).bind(pm.id, pm.name, (pm.isCash ?? pm.is_cash) ? 1 : 0, pm.enabled ? 1 : 0, pm.sort_order || 0, pm.created_by || "").run();
  }
  return { success: true };
};

handlers.deletePaymentMethod = async (env, args) => {
  const id = args[0];
  await env.DB.prepare("DELETE FROM payment_methods WHERE id = ?").bind(id).run();
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

async function syncOfflineOrders(env, args) {
  const orders = Array.isArray(args[0]) ? args[0] : [args[0]];
  let count = 0;
  for (const o of orders) {
    const invoice = o.invoice || o.id || ('INV-' + Date.now() + '-' + count);
    const timestamp = o.timestamp || nowIso();
    const total = Number(o.total || 0);
    const paymentType = o.paymentType || o.paymentMethod || o.payment_type || '';
    const status = o.status || 'completed';
    const orderNote = o.note || o.employeeId || '';
    await env.DB.prepare('INSERT INTO payments (timestamp, invoice, total, payment_type, order_note, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(timestamp, invoice, total, paymentType, orderNote, status).run();
    const items = o.items || [];
    for (const it of items) {
      await env.DB.prepare('INSERT INTO sales (timestamp, invoice, sku, name, qty, price, note, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(timestamp, invoice, it.sku || '', it.name || '', Number(it.qty || 0), Number(it.price || 0), it.note || '', paymentType).run();
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
  const user = (isObj ? a0.user : args[3]) || "";
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
  const a0 = args && args[0];
  const isObj = a0 && typeof a0 === "object" && !Array.isArray(a0);
  const invoice = isObj ? a0.invoice : a0;
  const reason = (isObj ? a0.reason : args[1]) || "";
  const cancelledBy = (isObj ? a0.user : args[2]) || "";
  const items = isObj && Array.isArray(a0.items) ? a0.items : [];
  const now = nowIso();

  if (items.length === 0) {
    await env.DB.prepare("UPDATE sales SET cancelled = 1, cancel_reason = ? WHERE invoice = ?")
      .bind(reason, invoice)
      .run();
  } else {
    for (const it of items) {
      const row = await env.DB.prepare(
        "SELECT id FROM sales WHERE invoice = ? AND sku = ? AND IFNULL(note, '') = ? AND IFNULL(cancelled, 0) = 0 ORDER BY id ASC LIMIT 1"
      )
        .bind(invoice, it.sku || "", it.note || "")
        .first();
      if (row) {
        await env.DB.prepare("UPDATE sales SET cancelled = 1, cancel_reason = ? WHERE id = ?")
          .bind(reason, row.id)
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

async function posDataForDay(env, day) {
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
      sku: s.sku || "",
      name: s.name || "",
      qty: Number(s.qty || 0),
      price: Number(s.price || 0),
      note: s.note || "",
      cancelled: !!s.cancelled,
    });
  }

  const history = payR.results.map((p) => ({
    invoice: p.invoice,
    timestamp: p.timestamp,
    total: Number(p.total || 0),
    paymentType: p.payment_type || "",
    status: String(p.status || "active").toLowerCase(),
    cancelReason: p.cancel_reason || "",
    note: p.order_note || "",
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
      note: "",
      items: items,
    });
  }

  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
  const paymentsR = await env.DB.prepare(
    "SELECT *, date(timestamp, '+7 hours') AS bkk_date FROM payments WHERE date(timestamp, '+7 hours') BETWEEN ? AND ? AND (status IS NULL OR LOWER(status) NOT IN ('cancelled', 'waste'))"
  ).bind(startDay, endDay).all();
  const pmR = await env.DB.prepare("SELECT * FROM payment_methods").all();
  const cashTypes = new Set(
    pmR.results.filter((p) => p.is_cash).map((p) => String(p.name || "").trim().toLowerCase())
  );

  let total = 0, totalCost = 0, cash = 0, other = 0, cupCount = 0;
  const byType = {};
  const daily = {};

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
  }

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
    cupCount += qty;
    totalCost += (costMap[s.sku] || 0) * qty;
    const d = (daily[s.bkk_date] = daily[s.bkk_date] || { date: s.bkk_date, total: 0, bills: 0, cups: 0 });
    d.cups += qty;
    const key = s.name || s.sku || "-";
    const t = (topMap[key] = topMap[key] || { sku: s.sku, name: key, qty: 0, amount: 0 });
    t.qty += qty;
    t.amount += Number(s.price || 0) * qty;
  }

  const topSellers = Object.values(topMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
  const dailyList = Object.values(daily).sort((a, b) => (a.date < b.date ? 1 : -1));

  const billCount = paymentsR.results.length;
  const totalProfit = total - totalCost;
  const avgPerBill = billCount ? total / billCount : 0;
  return {
    success: true, total, totalProfit, billCount, cupCount, totalCost,
    avgPerBill, cash, other, qr: other, byType, topSellers, daily: dailyList, floatCash,
  };
}

handlers.getSummaryByRange = async (env, args) => {
  const [start, end] = args;
  return summaryByRange(env, start, end);
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

handlers.syncAccessLogs = async (env, args) => {
  const snapshot = args[0] || [];
  for (const log of snapshot) {
    await env.DB.prepare(
      "INSERT INTO access_log (timestamp, context, result, name) VALUES (?,?,?,?)"
    ).bind(log.timestamp, log.context, log.result, log.name).run();
  }
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
  const tables = ["menu", "employees", "addons", "payment_methods", "shop_info", "inventory"];
  const data = {};
  for (const t of tables) {
    const r = await env.DB.prepare("SELECT * FROM " + t).all();
    data[t] = r.results;
  }
  await env.DB.prepare("INSERT INTO backups (created_at, label, data) VALUES (?,?,?)")
    .bind(nowIso(), label, JSON.stringify(data)).run();
  return { success: true };
};

handlers.getArchiveList = async (env) => {
  await ensureExtraTables(env);
  const r = await env.DB.prepare("SELECT id, created_at, range_start, range_end, note FROM archives ORDER BY id DESC").all();
  return r.results;
};

handlers.archiveOldData = async (env, args) => {
  await ensureExtraTables(env);
  const a = args[0] || {};
  const { start, end, note } = a;
  const archiveRes = await env.DB.prepare(
    "INSERT INTO archives (created_at, range_start, range_end, note) VALUES (?,?,?,?)"
  ).bind(nowIso(), start, end, note || "").run();
  const archiveId = archiveRes.meta.last_row_id;
  const sales = await env.DB.prepare("SELECT * FROM sales WHERE timestamp >= ? AND timestamp <= ?").bind(start, end).all();
  for (const s of sales.results) {
    await env.DB.prepare(
      `INSERT INTO archive_sales (archive_id, timestamp, invoice, sku, name, qty, price, note, payment_type, cancelled, cancel_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(archiveId, s.timestamp, s.invoice, s.sku, s.name, s.qty, s.price, s.note, s.payment_type, s.cancelled, s.cancel_reason).run();
  }
  const payments = await env.DB.prepare("SELECT * FROM payments WHERE timestamp >= ? AND timestamp <= ?").bind(start, end).all();
  for (const p of payments.results) {
    await env.DB.prepare(
      `INSERT INTO archive_payments (archive_id, timestamp, invoice, total, payment_type, order_note, status, cancel_reason, cancelled_by, cancelled_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(archiveId, p.timestamp, p.invoice, p.total, p.payment_type, p.order_note, p.status, p.cancel_reason, p.cancelled_by, p.cancelled_at).run();
  }
  await env.DB.prepare("DELETE FROM sales WHERE timestamp >= ? AND timestamp <= ?").bind(start, end).run();
  await env.DB.prepare("DELETE FROM payments WHERE timestamp >= ? AND timestamp <= ?").bind(start, end).run();
  return { success: true, archiveId };
};

handlers.updateInventoryStock = updateInventoryStock;
handlers.syncOfflineOrders = syncOfflineOrders;
handlers.updateOrderStatus = updateOrderStatus;
handlers.cancelSalesItems = cancelSalesItems;
handlers.syncFloatCashLogs = syncFloatCashLogs;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method === "GET") {
      return json({ ok: true, message: "Pukfu POS API" });
    }
    if (request.method === "POST") {
      try {
        const body = await request.json();
        const { token, fn, args } = body;
        if (!env.API_TOKEN || token !== env.API_TOKEN) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const handler = handlers[fn];
        if (!handler) {
          return json({ ok: false, error: "Unknown function: " + fn }, 400);
        }
        const result = await handler(env, args || []);
        return json({ ok: true, result });
      } catch (err) {
        return json({ ok: false, error: err.message }, 500);
      }
    }
    return json({ ok: false, error: "Method not allowed" }, 405);
  },
};
