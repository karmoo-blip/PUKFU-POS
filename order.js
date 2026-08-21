// ==============================================================================
// order.js — หน้าสั่งอาหารออนไลน์สำหรับลูกค้า (สแกน QR)
// แยกออกจาก app.js โดยตั้งใจ: ใช้โทเคนสาธารณะ (PUBLIC_API_TOKEN) ที่จำกัดสิทธิ์
// ให้เรียกได้แค่ไม่กี่ฟังก์ชัน (ดู PUBLIC_HANDLERS ใน worker.js) ไม่ใช่โทเคนพนักงาน
// เต็มสิทธิ์ — กันไม่ให้ลูกค้าที่ scan QR เข้าถึงข้อมูล/ฟังก์ชันอื่นของร้านได้
// ==============================================================================

// ตั้งค่า URL ของ Worker และ "โทเคนสาธารณะ" ตรงนี้ ต้องตรงกับ PUBLIC_API_TOKEN
// ที่ตั้งไว้ใน Cloudflare dashboard (Settings > Variables and Secrets ของ Worker)
const ORDER_API_URL = "https://pukfu-pos-api.karmoo1133.workers.dev/";
const ORDER_PUBLIC_TOKEN = "5614a45f8835548fd91ddbf3a599508864f6879e893c4147";

function resizeImageBase64(file, maxWidth, mimeType, quality) {
  mimeType = mimeType || 'image/jpeg';
  quality = quality === undefined ? 0.8 : quality;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(mimeType, quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function callApi(fn, args) {
  const res = await fetch(ORDER_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: ORDER_PUBLIC_TOKEN, fn, args: args || [] }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API error');
  return data.result;
}

const OrderPage = {
  menuData: [],
  categories: ['All'],
  activeCategory: 'All',
  cart: [],
  activeProduct: null,
  sweetnessLevels: [],
  addons: [],
  selectedAddons: [],
  location: '',
  currentOrderId: null,
  pollTimer: null,
  _alertResolve: null,

  async init() {
    const params = new URLSearchParams(location.search);
    this.location = (params.get('loc') || '').trim();
    const badge = document.getElementById('order-location-badge');
    if (this.location) {
      badge.innerText = 'โต๊ะ/จุดรับ: ' + this.location;
      badge.classList.remove('hidden');
    }

    this.showLoading();
    try {
      const [menu, addons, sweetness, shopInfo] = await Promise.all([
        callApi('getMenuData', []),
        callApi('getAddons', []).catch(() => []),
        callApi('getSweetnessLevels', []).catch(() => []),
        callApi('getShopInfo', []).catch(() => ({})),
      ]);
      this.menuData = (menu || []).filter(m => !m.isSoldOut);
      this.addons = addons || [];
      this.sweetnessLevels = sweetness || [];
      this.shopInfo = shopInfo || {};
      if (this.shopInfo.shopName) document.getElementById('shop-name').innerText = this.shopInfo.shopName;
      this.extractCategories();
      this.renderCategories();
      this.renderMenu();
    } catch (e) {
      this.showAlert('โหลดเมนูไม่สำเร็จ กรุณาลองรีเฟรชหน้าใหม่: ' + e.message, '', 'warning');
    }
    this.hideLoading();
  },

  extractCategories() {
    const set = new Set(this.menuData.map(m => m.category || 'อื่นๆ'));
    this.categories = ['All', ...set];
  },

  renderCategories() {
    const container = document.getElementById('order-categories');
    if (this.categories.length <= 2) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    container.innerHTML = this.categories.map(cat => {
      const isActive = cat === this.activeCategory;
      const style = isActive
        ? 'bg-gradient-to-b from-primary to-secondary text-white shadow-md shadow-primary/30'
        : 'bg-white text-secondary border border-sand';
      return `<button onclick="OrderPage.selectCategory('${escAttr(cat)}')" class="whitespace-nowrap px-5 min-h-[2.75rem] inline-flex items-center justify-center rounded-full font-bold text-sm active:scale-95 transition-all ${style}">${escHtml(cat)}</button>`;
    }).join('');
  },

  selectCategory(cat) {
    this.activeCategory = cat;
    this.renderCategories();
    this.renderMenu();
  },

  renderMenu() {
    const grid = document.getElementById('order-menu-grid');
    const empty = document.getElementById('order-menu-empty');
    const items = this.activeCategory === 'All' ? this.menuData : this.menuData.filter(m => (m.category || 'อื่นๆ') === this.activeCategory);
    if (items.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = items.map((item) => {
      const idx = this.menuData.indexOf(item);
      return `
        <div onclick="OrderPage.selectProduct(${idx})" class="bg-white rounded-3xl shadow-md border border-sand cursor-pointer overflow-hidden flex flex-col active:scale-[0.98] transition-all">
          <div class="h-28 bg-gradient-to-br from-accent to-sand w-full relative overflow-hidden">
            ${item.image
              ? `<div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${item.image}');"></div>`
              : `<div class="absolute inset-0 flex items-center justify-center text-primary/25"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:2.5rem;height:2.5rem"><path d="M6 8h12l-1.2 11a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></div>`
            }
          </div>
          <div class="p-3 flex flex-col justify-between flex-1">
            <p class="font-bold text-secondary text-sm leading-tight line-clamp-2">${escHtml(item.name)}</p>
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-sand">
              <p class="text-primary font-black">฿${item.price}</p>
              <div class="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">+</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  selectProduct(idx) {
    this.activeProduct = this.menuData[idx];
    this.selectedAddons = [];
    document.getElementById('modal-product-name').innerText = this.activeProduct.name;
    document.getElementById('modal-note').value = '';
    this.updateSweetnessButtons();
    this.updateAddonButtons();
    this.openModal('modal-product');
  },

  updateSweetnessButtons() {
    const container = document.getElementById('modal-sweetness-container');
    container.innerHTML = this.sweetnessLevels.map(sw =>
      `<button class="mod-btn border border-sand px-4 min-h-[2.75rem] inline-flex items-center justify-center rounded-full text-sm font-bold text-slate-500 active:scale-95 transition-all" onclick="OrderPage.selectSweetness(this)">${escHtml(sw.name)}</button>`
    ).join('');
  },

  selectSweetness(btn) {
    document.querySelectorAll('.mod-btn').forEach(b => {
      b.classList.remove('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
      b.classList.add('text-slate-500', 'border-slate-200');
      b.removeAttribute('data-selected');
    });
    btn.classList.remove('text-slate-500', 'border-slate-200');
    btn.classList.add('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
    btn.setAttribute('data-selected', 'true');
  },

  updateAddonButtons() {
    const container = document.getElementById('modal-addons-container');
    const active = this.addons.filter(a => a.active);
    if (active.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-sm">ไม่มีส่วนเสริม</p>';
      return;
    }
    container.innerHTML = active.map(addon => {
      const isSelected = this.selectedAddons.some(a => a.id === addon.id);
      const cls = isSelected ? 'bg-gradient-to-b from-primary to-secondary text-white border-primary' : 'border-sand text-slate-500';
      const priceDisplay = addon.price >= 0 ? `+฿${addon.price}` : `-฿${Math.abs(addon.price)}`;
      return `<button onclick="OrderPage.toggleAddon('${addon.id}')" class="border px-4 min-h-[2.75rem] inline-flex items-center justify-center rounded-full text-sm font-bold active:scale-95 transition-all ${cls}">${escHtml(addon.name)} (${priceDisplay})</button>`;
    }).join('');
  },

  toggleAddon(id) {
    const idx = this.selectedAddons.findIndex(a => a.id === id);
    if (idx === -1) {
      const addon = this.addons.find(a => a.id === id);
      if (addon) this.selectedAddons.push(addon);
    } else {
      this.selectedAddons.splice(idx, 1);
    }
    this.updateAddonButtons();
  },

  async addToCartFromModal() {
    const selectedBtn = document.querySelector('.mod-btn[data-selected="true"]');
    if (!selectedBtn) return this.showAlert('กรุณาเลือกระดับความหวานก่อนครับ', '', 'warning');
    const sweetness = selectedBtn.innerText;
    const textNote = document.getElementById('modal-note').value.trim();

    let finalNote = `ความหวาน: ${sweetness}`;
    let additionalPrice = 0;
    this.selectedAddons.forEach(addon => {
      const priceDisplay = addon.price >= 0 ? `+฿${addon.price}` : `-฿${Math.abs(addon.price)}`;
      finalNote += ` | ${addon.name} (${priceDisplay})`;
      additionalPrice += addon.price;
    });
    if (textNote) finalNote += ` | ${textNote}`;

    const finalPrice = Math.max(0, Number(this.activeProduct.price) + additionalPrice);
    this.cart.push({
      sku: this.activeProduct.sku, name: this.activeProduct.name,
      price: finalPrice, qty: 1, note: finalNote,
    });
    this.closeModal('modal-product');
    this.renderCartBar();
  },

  renderCartBar() {
    const bar = document.getElementById('order-cart-bar');
    const count = this.cart.reduce((s, i) => s + i.qty, 0);
    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    if (count === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    document.getElementById('order-cart-count').innerText = count + ' รายการ';
    document.getElementById('order-cart-total').innerText = '฿' + total.toFixed(2);
  },

  openCartReview() {
    this.renderCartItems();
    this.openModal('modal-cart');
  },

  renderCartItems() {
    const container = document.getElementById('order-cart-items');
    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    if (this.cart.length === 0) {
      container.innerHTML = '<p class="text-center text-slate-400 py-6">ยังไม่มีสินค้าในตะกร้า</p>';
    } else {
      container.innerHTML = this.cart.map((item, idx) => `
        <div class="flex justify-between items-start bg-white p-3 rounded-2xl border border-sand shadow-sm gap-2">
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm text-secondary truncate">${escHtml(item.name)}</p>
            <p class="text-xs text-slate-400 mt-0.5">${escHtml(item.note || '-')}</p>
            <p class="font-black text-sm text-primary mt-1">฿${(item.price * item.qty).toFixed(2)}</p>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <div class="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-100">
              <button onclick="OrderPage.updateQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full active:scale-95 font-bold text-slate-600 shadow-sm">-</button>
              <span class="w-6 text-center font-bold text-sm">${item.qty}</span>
              <button onclick="OrderPage.updateQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full active:scale-95 font-bold text-slate-600 shadow-sm">+</button>
            </div>
          </div>
        </div>
      `).join('');
    }
    document.getElementById('order-cart-modal-total').innerText = '฿' + total.toFixed(2);
  },

  updateQty(idx, delta) {
    const item = this.cart[idx];
    item.qty += delta;
    if (item.qty <= 0) this.cart.splice(idx, 1);
    this.renderCartItems();
    this.renderCartBar();
  },

  async submitOrder() {
    const name = document.getElementById('customer-name-input').value.trim();
    if (!name) return this.showAlert('กรุณาระบุชื่อผู้สั่งก่อนครับ', '', 'warning');
    if (this.cart.length === 0) return this.showAlert('ยังไม่มีสินค้าในตะกร้าเลยครับ', '', 'warning');

    this.showLoading();
    try {
      const result = await callApi('submitPendingOrder', [{
        location: this.location, customerName: name, items: this.cart,
      }]);
      this.hideLoading();
      if (!result.success) return this.showAlert(result.error || 'ส่งออเดอร์ไม่สำเร็จ', '', 'warning');
      this.currentOrderId = result.id;
      this.closeModal('modal-cart');
      this.showSubmittedView();
      this.startPolling();
    } catch (e) {
      this.hideLoading();
      this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message, '', 'warning');
    }
  },

  showSubmittedView() {
    document.getElementById('view-submitted').classList.remove('hidden');
    // รีเซ็ตสถานะ UI กลับเป็นค่าเริ่มต้น เผื่อเป็นการสั่งออเดอร์รอบใหม่ต่อจากออเดอร์ก่อนหน้าที่ยืนยัน/ปฏิเสธ/ยกเลิกไปแล้ว
    const icon = document.getElementById('submitted-status-icon');
    icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-amber-100 text-amber-500';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:2rem;height:2rem"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    document.getElementById('submitted-status-text').innerText = 'ส่งออเดอร์แล้ว รอร้านยืนยัน';
    document.getElementById('submitted-status-sub').innerText = '';
    document.getElementById('btn-cancel-order').classList.remove('hidden');
    const uploadBtn = document.getElementById('btn-upload-slip');
    uploadBtn.classList.remove('hidden');
    uploadBtn.disabled = false;
    uploadBtn.innerText = 'อัพโหลดสลิปโอนเงิน';
    document.getElementById('submitted-payment-box').classList.add('hidden');

    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    document.getElementById('submitted-order-summary').innerHTML = `
      <p class="font-bold text-secondary mb-3">สรุปออเดอร์</p>
      ${this.cart.map(i => `
        <div class="flex justify-between text-sm mb-2">
          <span class="text-slate-600">${i.qty}x ${escHtml(i.name)}</span>
          <span class="font-bold text-secondary">฿${(i.qty * i.price).toFixed(2)}</span>
        </div>
      `).join('')}
      <div class="flex justify-between font-black text-lg mt-3 pt-3 border-t border-sand">
        <span>รวม</span><span class="text-primary">฿${total.toFixed(2)}</span>
      </div>
    `;
    if (this.shopInfo && this.shopInfo.paymentQrImage) {
      document.getElementById('submitted-payment-qr').src = this.shopInfo.paymentQrImage;
      document.getElementById('submitted-payment-box').classList.remove('hidden');
    }
  },

  backToMenu() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.currentOrderId = null;
    this.cart = [];
    this.renderCartBar();
    document.getElementById('view-submitted').classList.add('hidden');
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollStatus(), 12000);
  },

  async pollStatus() {
    if (!this.currentOrderId) return;
    try {
      const r = await callApi('getPendingOrderStatus', [this.currentOrderId]);
      if (!r.success) return;
      this.applyStatus(r.status, r.rejectReason);
    } catch (e) { /* เงียบไว้ ลองใหม่รอบหน้า */ }
  },

  applyStatus(status, rejectReason) {
    const icon = document.getElementById('submitted-status-icon');
    const text = document.getElementById('submitted-status-text');
    const sub = document.getElementById('submitted-status-sub');
    const cancelBtn = document.getElementById('btn-cancel-order');
    const uploadBtn = document.getElementById('btn-upload-slip');

    if (status === 'confirmed') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-500';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M20 6L9 17l-5-5"/></svg>';
      text.innerText = 'ร้านยืนยันออเดอร์แล้ว!';
      sub.innerText = 'ขอบคุณที่สั่งกับเราครับ';
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      clearInterval(this.pollTimer);
    } else if (status === 'rejected') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-red-100 text-red-500';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      text.innerText = 'ร้านไม่สามารถรับออเดอร์นี้ได้';
      sub.innerText = rejectReason || '';
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      clearInterval(this.pollTimer);
    } else if (status === 'cancelled') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-slate-100 text-slate-400';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      text.innerText = 'ยกเลิกออเดอร์แล้ว';
      sub.innerText = '';
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      clearInterval(this.pollTimer);
    }
  },

  async handleSlipUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    this.showLoading();
    try {
      const base64 = await resizeImageBase64(file, 800, 'image/jpeg', 0.7);
      const r = await callApi('uploadPaymentSlip', [{ id: this.currentOrderId, image: base64 }]);
      this.hideLoading();
      if (!r.success) return this.showAlert(r.error || 'อัพโหลดสลิปไม่สำเร็จ', '', 'warning');
      document.getElementById('btn-upload-slip').innerText = 'ส่งสลิปแล้ว รอร้านยืนยัน ✓';
      document.getElementById('btn-upload-slip').disabled = true;
    } catch (e) {
      this.hideLoading();
      this.showAlert('อัพโหลดสลิปไม่สำเร็จ: ' + e.message, '', 'warning');
    }
  },

  async cancelOrder() {
    const ok = await this.showConfirm('ต้องการยกเลิกออเดอร์นี้ใช่หรือไม่?', '');
    if (!ok) return;
    this.showLoading();
    try {
      const r = await callApi('cancelPendingOrder', [this.currentOrderId]);
      this.hideLoading();
      if (!r.success) return this.showAlert(r.error || 'ยกเลิกไม่สำเร็จ', '', 'warning');
      this.applyStatus('cancelled', '');
    } catch (e) {
      this.hideLoading();
      this.showAlert('ยกเลิกไม่สำเร็จ: ' + e.message, '', 'warning');
    }
  },

  openModal(id) { document.getElementById(id).classList.remove('hidden'); },
  closeModal(id) { document.getElementById(id).classList.add('hidden'); },
  showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); },
  hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); },

  _alertIconVariants: {
    info: { cls: 'bg-sky-100 text-sky-500', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>' },
    warning: { cls: 'bg-amber-100 text-amber-500', svg: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>' },
  },

  _openAlertModal(cfg) {
    const iconEl = document.getElementById('alert-icon');
    const variant = this._alertIconVariants[cfg.type] || this._alertIconVariants.info;
    iconEl.className = `w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center ${variant.cls}`;
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:1.75rem;height:1.75rem">${variant.svg}</svg>`;
    document.getElementById('alert-message').innerText = cfg.message;
    const btnContainer = document.getElementById('alert-buttons');
    btnContainer.innerHTML = '';
    cfg.buttons.forEach(btn => {
      const b = document.createElement('button');
      b.innerText = btn.label;
      b.className = btn.style === 'primary'
        ? 'flex-1 py-2.5 bg-gradient-to-b from-primary to-secondary text-white rounded-xl font-bold active:scale-95 transition-all'
        : 'flex-1 py-2.5 border border-sand bg-white text-slate-500 rounded-xl font-bold active:scale-95 transition-all';
      b.onclick = () => {
        document.getElementById('modal-alert').classList.add('hidden');
        if (this._alertResolve) { this._alertResolve(btn.value); this._alertResolve = null; }
      };
      btnContainer.appendChild(b);
    });
    this.openModal('modal-alert');
  },

  showAlert(message, icon, type) {
    return new Promise(resolve => {
      this._openAlertModal({ message, type: type || 'info', buttons: [{ label: 'ตกลง', style: 'primary', value: true }] });
      this._alertResolve = resolve;
    });
  },

  showConfirm(message) {
    return new Promise(resolve => {
      this._openAlertModal({
        message, type: 'warning',
        buttons: [{ label: 'ยกเลิก', style: 'ghost', value: false }, { label: 'ยืนยัน', style: 'primary', value: true }],
      });
      this._alertResolve = resolve;
    });
  },
};

window.onload = () => OrderPage.init();
