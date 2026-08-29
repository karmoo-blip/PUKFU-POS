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

// ---- ข้อความทั้งหน้า สองภาษา ----
// หน้านี้ลูกค้าทั่วไปเปิดเอง บางคนอ่านไทยไม่ออก ทุกข้อความที่เป็นของหน้าเว็บเองอยู่ในตารางนี้
// ส่วนชื่อสินค้า/หมวด/ส่วนเสริม มาจากฐานข้อมูลร้าน (เมนูมีช่อง lang2 เป็นชื่ออังกฤษอยู่แล้ว)
//
// ข้อสำคัญ: โน้ตที่แนบไปกับออเดอร์ยังเป็นภาษาไทยเสมอ ไม่ว่าลูกค้าจะเลือกภาษาไหน
// เพราะปลายทางคือหน้าจอพนักงานที่เคาน์เตอร์ ไม่ใช่ลูกค้า
const ORDER_TEXT = {
  th: {
    tagline: 'สั่งอาหารได้เลย ไม่ต้องต่อคิว',
    start: 'เริ่มสั่งอาหาร',
    locPrefix: 'โต๊ะ/จุดรับ: ',
    yourName: 'ชื่อผู้สั่ง',
    namePlaceholder: 'เช่น คุณเอ',
    catAll: 'ทั้งหมด',
    catOther: 'อื่นๆ',
    menuEmpty: 'ยังไม่มีเมนูให้สั่งตอนนี้',
    itemsSuffix: ' รายการ',
    viewCart: 'ดูตะกร้า',
    sweetness: 'ความหวาน',
    addons: 'ส่วนเสริม',
    addonsHint: '(เลือกกี่อย่างก็ได้)',
    noAddons: 'ไม่มีส่วนเสริม',
    note: 'หมายเหตุ',
    noteHint: '(ถ้ามี)',
    notePlaceholder: 'เช่น แยกน้ำแข็ง, เพิ่มมุก...',
    cancel: 'ยกเลิก',
    addToCart: 'เพิ่มลงตะกร้า',
    cartTitle: 'ตะกร้าของคุณ',
    cartEmpty: 'ยังไม่มีสินค้าในตะกร้า',
    total: 'รวม',
    placeOrder: 'สั่งอาหาร',
    needSweetness: 'กรุณาเลือกระดับความหวานก่อนครับ',
    needName: 'กรุณาระบุชื่อผู้สั่งก่อนครับ',
    cartEmptyAlert: 'ยังไม่มีสินค้าในตะกร้าเลยครับ',
    statusSent: 'ส่งออเดอร์แล้ว รอร้านยืนยัน',
    statusSentSub: 'ไม่ต้องปิดหน้านี้ สถานะจะอัปเดตเอง',
    statusConfirmed: 'ร้านยืนยันออเดอร์แล้ว!',
    statusMaking: 'กำลังเตรียมเครื่องดื่มให้ครับ',
    statusReady: 'เครื่องดื่มพร้อมรับแล้ว',
    statusCollect: 'รับที่เคาน์เตอร์ได้เลยครับ',
    statusRejected: 'ร้านไม่สามารถรับออเดอร์นี้ได้',
    statusCancelled: 'ยกเลิกออเดอร์แล้ว',
    queueYourTurn: 'ถึงคิวคุณแล้ว กำลังทำให้อยู่ครับ',
    queueAheadPre: 'มีอีก ',
    queueAheadPost: ' คิวก่อนหน้าคุณ',
    queueEtaPre: 'รออีกประมาณ ',
    queueEtaPost: ' นาที',
    summary: 'สรุปออเดอร์',
    scanToPay: 'สแกนเพื่อชำระเงิน',
    afterTransfer: 'โอนเงินแล้วอัพโหลดสลิปด้านล่างเพื่อแจ้งร้าน',
    uploadSlip: 'อัพโหลดสลิปโอนเงิน',
    slipSent: 'ส่งสลิปแล้ว รอร้านยืนยัน ✓',
    cancelOrder: 'ยกเลิกออเดอร์',
    confirmCancel: 'ต้องการยกเลิกออเดอร์นี้ใช่หรือไม่?',
    backToMenu: 'กลับไปหน้าเมนู',
    ok: 'ตกลง',
    confirm: 'ยืนยัน',
    loadFail: 'โหลดเมนูไม่สำเร็จ กรุณาลองรีเฟรชหน้าใหม่',
    serverFail: 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ',
    submitFail: 'ส่งออเดอร์ไม่สำเร็จ',
    uploadFail: 'อัพโหลดสลิปไม่สำเร็จ',
    cancelFail: 'ยกเลิกไม่สำเร็จ',
  },
  en: {
    tagline: 'Order here. No queue.',
    start: 'Start order',
    locPrefix: 'Table / pickup: ',
    yourName: 'Your name',
    namePlaceholder: 'e.g. Alex',
    catAll: 'All',
    catOther: 'Other',
    menuEmpty: 'Nothing on the menu right now',
    itemsSuffix: ' items',
    viewCart: 'View cart',
    sweetness: 'Sweetness',
    addons: 'Add-ons',
    addonsHint: '(choose any)',
    noAddons: 'No add-ons',
    note: 'Note',
    noteHint: '(optional)',
    notePlaceholder: 'e.g. ice on the side, extra pearls...',
    cancel: 'Cancel',
    addToCart: 'Add to cart',
    cartTitle: 'Your cart',
    cartEmpty: 'Your cart is empty',
    total: 'Total',
    placeOrder: 'Place order',
    needSweetness: 'Please choose a sweetness level first',
    needName: 'Please enter your name first',
    cartEmptyAlert: 'Your cart is empty',
    statusSent: 'Order sent. Waiting for the shop',
    statusSentSub: 'Keep this page open, it updates itself',
    statusConfirmed: 'The shop confirmed your order',
    statusMaking: 'Your drinks are being made',
    statusReady: 'Your order is ready',
    statusCollect: 'Collect it at the counter',
    statusRejected: 'The shop could not take this order',
    statusCancelled: 'Order cancelled',
    queueYourTurn: "You're next. Making it now",
    queueAheadPre: '',
    queueAheadPost: ' orders ahead of you',
    queueEtaPre: 'About ',
    queueEtaPost: ' min to wait',
    summary: 'Your order',
    scanToPay: 'Scan to pay',
    afterTransfer: 'After paying, upload the slip below so the shop knows',
    uploadSlip: 'Upload payment slip',
    slipSent: 'Slip sent. Waiting for the shop ✓',
    cancelOrder: 'Cancel order',
    confirmCancel: 'Cancel this order?',
    backToMenu: 'Back to the menu',
    ok: 'OK',
    confirm: 'Confirm',
    loadFail: 'Could not load the menu. Please refresh the page',
    serverFail: 'Could not reach the shop. Please try again',
    submitFail: 'Could not send your order',
    uploadFail: 'Could not upload the slip',
    cancelFail: 'Could not cancel the order',
  },
};

// ---- รูปอาหารสำหรับหน้าต้อนรับ ----
// วาดด้วย path ล้วน ไม่โหลดรูปจากที่ไหน หน้านี้ลูกค้าเปิดผ่าน 4G กลางร้าน ยิ่งไฟล์น้อยยิ่งดี
// สีทุกตัวมาจากชุดสีเดียวกับ style.css (เขียนตรงๆ เพราะ canvas อ่าน CSS variable ไม่ได้)
const WELCOME_SHAPES = [
  // แก้วชาไข่มุก
  function (c, s) {
    const w = s * 0.62, h = s;
    c.fillStyle = '#e8f0e4';
    c.beginPath();
    c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2);
    c.lineTo(w * 0.34, h / 2); c.lineTo(-w * 0.34, h / 2);
    c.closePath(); c.fill();
    c.fillStyle = '#163828';
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.arc(-w * 0.16 + i * w * 0.16, h * 0.28, s * 0.055, 0, 6.2832); c.fill();
    }
    c.strokeStyle = '#d2743f'; c.lineWidth = s * 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(w * 0.1, -h * 0.42); c.lineTo(w * 0.32, -h * 0.86); c.stroke();
    c.fillStyle = '#1f4d3a';
    c.beginPath(); c.rect(-w * 0.58, -h * 0.58, w * 1.16, h * 0.16); c.fill();
  },
  // แก้วกาแฟร้อน
  function (c, s) {
    const w = s * 0.6, h = s;
    c.fillStyle = '#d2743f';
    c.beginPath();
    c.moveTo(-w / 2, -h * 0.36); c.lineTo(w / 2, -h * 0.36);
    c.lineTo(w * 0.36, h / 2); c.lineTo(-w * 0.36, h / 2);
    c.closePath(); c.fill();
    c.fillStyle = '#fbfaf4';
    c.beginPath(); c.rect(-w * 0.47, -h * 0.14, w * 0.94, h * 0.24); c.fill();
    c.fillStyle = '#1f4d3a';
    c.beginPath(); c.rect(-w * 0.56, -h * 0.5, w * 1.12, h * 0.16); c.fill();
  },
  // ชามร้อนๆ
  function (c, s) {
    const r = s * 0.5;
    c.fillStyle = '#1f4d3a';
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI); c.closePath(); c.fill();
    c.fillStyle = '#dfe6d8';
    c.beginPath(); c.rect(-r * 1.12, -r * 0.16, r * 2.24, r * 0.24); c.fill();
    c.strokeStyle = '#e0a03a'; c.lineWidth = s * 0.07; c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(i * r * 0.44, -r * 0.34);
      c.quadraticCurveTo(i * r * 0.44 + r * 0.2, -r * 0.62, i * r * 0.44, -r * 0.9);
      c.stroke();
    }
  },
  // ซาลาเปา
  function (c, s) {
    const r = s * 0.48;
    c.fillStyle = '#dfe6d8';
    c.beginPath(); c.arc(0, 0, r, 0, 6.2832); c.fill();
    c.strokeStyle = '#1f4d3a'; c.lineWidth = s * 0.055; c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.arc(0, r * 0.5, r * 0.95, -2.2 + i * 0.42, -1.9 + i * 0.42); c.stroke();
    }
    c.fillStyle = '#d2743f';
    c.beginPath(); c.arc(0, -r * 0.52, r * 0.16, 0, 6.2832); c.fill();
  },
  // ใบไม้
  function (c, s) {
    const h = s * 0.52, w = s * 0.34;
    c.fillStyle = '#1f4d3a';
    c.beginPath();
    c.moveTo(0, -h);
    c.quadraticCurveTo(w, -h * 0.2, 0, h);
    c.quadraticCurveTo(-w, -h * 0.2, 0, -h);
    c.fill();
    c.strokeStyle = '#e8f0e4'; c.lineWidth = s * 0.05;
    c.beginPath(); c.moveTo(0, -h * 0.75); c.lineTo(0, h * 0.72); c.stroke();
  },
];

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
  isSubmittingOrder: false,
  pollTimer: null,
  _alertResolve: null,
  // จำสถานะ/จำนวนคิวล่าสุดที่แสดงไปแล้ว หน้านี้ถามเซิร์ฟเวอร์ทุก 12 วินาที
  // ถ้าไม่จำไว้ อนิเมชันตอนเปลี่ยนสถานะจะเล่นซ้ำทุกรอบที่ถาม ทั้งที่ไม่มีอะไรเปลี่ยน
  _lastStatus: null,
  _lastQueue: null,
  // หน้าต้อนรับ: Promise ของการโหลดเมนู กับตัวจับ requestAnimationFrame ไว้สั่งหยุด
  _dataReady: null,
  _dataLoaded: false,
  // 'th' หรือ 'en' — เดาจากภาษาเครื่องครั้งแรก หลังจากนั้นจำที่ลูกค้าเลือกไว้
  lang: 'th',
  _welcomeRaf: null,
  _welcomeResize: null,

  async init() {
    const params = new URLSearchParams(location.search);
    this.location = (params.get('loc') || '').trim();

    // เลือกภาษาก่อนวาดอะไรทั้งนั้น ลูกค้าจะได้ไม่เห็นภาษาไทยวาบแล้วค่อยเปลี่ยนเป็นอังกฤษ
    this.lang = this.detectLang();

    const badge = document.getElementById('order-location-badge');
    if (this.location) {
      badge.classList.remove('hidden');
      const welcomeLoc = document.getElementById('welcome-location');
      welcomeLoc.classList.remove('hidden');
    }
    this.applyLang();

    // หน้าต้อนรับขึ้นอยู่แล้วตั้งแต่ HTML แค่เริ่มอนิเมชัน แล้วโหลดเมนูอยู่ข้างหลังมัน
    // ไม่ต้องโชว์วงกลมหมุนซ้อน หน้าต้อนรับทำหน้าที่ปิดช่วงรอให้แล้ว
    this.startWelcomeAnimation();
    this._dataReady = this.loadShopData();
    await this._dataReady;
    this.restoreSavedOrder();
  },

  // แยกออกจาก init เพื่อให้ปุ่ม "เริ่มสั่งอาหาร" รอ Promise ก้อนเดียวกันนี้ได้
  // ถ้าลูกค้ากดเร็วกว่าเน็ต จะได้รอด้วยวงกลมหมุน ไม่ใช่เจอเมนูเปล่า
  async loadShopData() {
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
      if (this.shopInfo.shopName) {
        document.getElementById('shop-name').innerText = this.shopInfo.shopName;
        document.getElementById('welcome-shop-name').innerText = this.shopInfo.shopName;
      }
      this.extractCategories();
      this.renderCategories();
      this.renderMenu();
    } catch (e) {
      this.showAlert(this.t('loadFail') + ': ' + e.message, '', 'warning');
    }
    this._dataLoaded = true;
  },

  // ปุ่มเดียวบนหน้าต้อนรับ
  async startOrdering() {
    this.hideWelcome();
    if (this._dataLoaded) return;
    this.showLoading();
    try { await this._dataReady; } catch (e) { /* loadShopData เตือนเองแล้ว */ }
    this.hideLoading();
  },

  // ลูกค้ารีเฟรชหรือปิดแล้วเปิดใหม่ ให้กลับมาดูสถานะออเดอร์เดิมต่อได้
  async restoreSavedOrder() {
    let saved;
    try { saved = localStorage.getItem('pukfu_order_id'); } catch (e) { return; }
    if (!saved) return;
    try {
      const r = await callApi('getPendingOrderStatus', [saved]);
      // ออเดอร์จบไปแล้วหรือหาไม่เจอ ลืมมันไปเลย ไม่ต้องเด้งหน้าสถานะเก่าค้างไว้
      if (!r.success || ['rejected', 'cancelled', 'ready'].includes(r.status)) {
        this.clearSavedOrder();
        return;
      }
      this.currentOrderId = saved;
      // กลับมาทั้งที่ออเดอร์ยังไม่จบ เขาอยากรู้สถานะ ไม่ใช่มาทักทายใหม่
      this.hideWelcome();
      this.showSubmittedView();
      // กลับเข้ามาดูของเดิม ไม่ใช่ข่าวใหม่ ปิดอนิเมชันฉลองรอบนี้ไว้ก่อน
      this._lastStatus = r.status;
      this.applyStatus(r.status, r.rejectReason, r);
      this.startPolling();
    } catch (e) { /* เน็ตไม่ดี ไว้รอบหน้า */ }
  },

  extractCategories() {
    // คีย์ยังเป็นไทยเสมอ (ตรงกับค่าที่เก็บในฐาน) ที่แปลคือตอนโชว์เท่านั้น
    const set = new Set(this.menuData.map(m => m.category || 'อื่นๆ'));
    this.categories = ['All', ...set];
  },

  renderCategories() {
    const container = document.getElementById('order-categories');
    const track = document.getElementById('order-categories-track');
    if (this.categories.length <= 2) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    track.innerHTML = this.categories.map(cat => {
      const isActive = cat === this.activeCategory;
      // ปุ่มที่เลือกอยู่ทำพื้นใส ปล่อยให้ตัวชี้ที่เลื่อนมาเป็นพื้นหลังแทน (วิธีเดียวกับหน้าขายของพนักงาน)
      const style = isActive
        ? 'is-active-cat text-white border border-transparent'
        : 'bg-white text-secondary border border-sand';
      return `<button onclick="OrderPage.selectCategory('${escAttr(cat)}')" class="whitespace-nowrap px-5 min-h-[2.75rem] inline-flex items-center justify-center rounded-full font-bold text-sm active:scale-95 transition-all ${style}">${escHtml(this.categoryLabel(cat))}</button>`;
    }).join('');
    this.moveCatIndicator();
  },

  // เลื่อนตัวชี้ไปใต้ปุ่มที่เลือก ตัวชี้อยู่นอก track จึงไม่โดน innerHTML ข้างบนล้างทิ้ง
  moveCatIndicator() {
    const ind = document.getElementById('order-cat-indicator');
    const active = document.querySelector('#order-categories-track button.is-active-cat');
    if (!ind || !active) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
    ind.classList.add('is-ready');
  },

  selectCategory(cat) {
    this.activeCategory = cat;
    this.renderCategories();
    this.renderMenu();
    const activeBtn = document.querySelector('#order-categories-track button.is-active-cat');
    if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
    grid.innerHTML = items.map((item, gridIdx) => {
      const idx = this.menuData.indexOf(item);
      // หยุดหน่วงที่ใบที่ 13 ไม่งั้นเมนูยาวๆ ใบท้ายรอนานเกินจนดูเหมือนค้าง
      const stagger = Math.min(gridIdx, 12);
      return `
        <div onclick="OrderPage.selectProduct(${idx})" style="--i:${stagger}" class="bg-white rounded-3xl shadow-md border border-sand cursor-pointer overflow-hidden flex flex-col active:scale-[0.98] transition-all">
          <div class="h-28 bg-gradient-to-br from-accent to-sand w-full relative overflow-hidden">
            ${item.image
              ? `<div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${item.image}');"></div>`
              : `<div class="absolute inset-0 flex items-center justify-center text-primary/25"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:2.5rem;height:2.5rem"><path d="M6 8h12l-1.2 11a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></div>`
            }
          </div>
          <div class="p-3 flex flex-col justify-between flex-1">
            <p class="font-bold text-secondary text-sm leading-tight line-clamp-2">${escHtml(this.menuName(item))}</p>
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-sand">
              <p class="text-primary font-black">฿${item.price}</p>
              <div class="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">+</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // reflow ก่อนใส่คลาสใหม่ ไม่งั้นอนิเมชันเล่นแค่ครั้งแรกครั้งเดียว
    grid.classList.remove('is-entering');
    void grid.offsetWidth;
    grid.classList.add('is-entering');
  },

  selectProduct(idx) {
    this.activeProduct = this.menuData[idx];
    this.selectedAddons = [];
    this._selectedSweetnessId = null;
    document.getElementById('modal-product-name').innerText = this.menuName(this.activeProduct);
    document.getElementById('modal-note').value = '';
    this.updateSweetnessButtons();
    this.updateAddonButtons();
    this.openModal('modal-product');
  },

  updateSweetnessButtons() {
    const container = document.getElementById('modal-sweetness-container');
    // เก็บ id ไว้บนปุ่ม เพราะโน้ตที่ส่งขึ้นบิลต้องใช้ชื่อไทยเสมอ ไม่ใช่ตัวหนังสือที่โชว์อยู่
    const selectedId = this._selectedSweetnessId;
    container.innerHTML = this.sweetnessLevels.map(sw => {
      const on = sw.id === selectedId;
      const cls = on
        ? 'bg-gradient-to-b from-primary to-secondary text-white border-primary'
        : 'border-sand text-slate-500';
      const mark = on ? ' data-selected="true"' : '';
      return `<button class="mod-btn border px-4 min-h-[2.75rem] inline-flex items-center justify-center rounded-full text-sm font-bold active:scale-95 transition-all ${cls}"${mark} data-sw-id="${escAttr(sw.id)}" onclick="OrderPage.selectSweetness(this)">${escHtml(this.sweetnessLabel(sw))}</button>`;
    }).join('');
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
    // จำไว้ด้วย ไม่งั้นสลับภาษาแล้วปุ่มที่เลือกไว้หลุด
    this._selectedSweetnessId = btn.getAttribute('data-sw-id');
  },

  updateAddonButtons() {
    const container = document.getElementById('modal-addons-container');
    const active = this.addons.filter(a => a.active);
    if (active.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-sm">' + escHtml(this.t('noAddons')) + '</p>';
      return;
    }
    container.innerHTML = active.map(addon => {
      const isSelected = this.selectedAddons.some(a => a.id === addon.id);
      const cls = isSelected ? 'bg-gradient-to-b from-primary to-secondary text-white border-primary' : 'border-sand text-slate-500';
      const priceDisplay = this.addonPrice(addon);
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
    if (!selectedBtn) return this.showAlert(this.t('needSweetness'), '', 'warning');
    const swId = selectedBtn.getAttribute('data-sw-id');
    const sw = this.sweetnessLevels.find(x => x.id === swId);
    // ชื่อไทยเท่านั้นที่ลงบิล ปลายทางคือจอพนักงาน ไม่ใช่ลูกค้า
    const sweetness = sw ? sw.name : selectedBtn.innerText;
    const textNote = document.getElementById('modal-note').value.trim();

    let finalNote = `ความหวาน: ${sweetness}`;
    let additionalPrice = 0;
    this.selectedAddons.forEach(addon => {
      finalNote += ` | ${addon.name} (${this.addonPrice(addon)})`;
      additionalPrice += addon.price;
    });
    if (textNote) finalNote += ` | ${textNote}`;

    const finalPrice = Math.max(0, Number(this.activeProduct.price) + additionalPrice);
    this.cart.push({
      sku: this.activeProduct.sku, name: this.activeProduct.name,
      price: finalPrice, qty: 1, note: finalNote,
      // ชิ้นส่วนของโน้ต เอาไว้ประกอบข้อความให้ลูกค้าอ่านใหม่ตอนสลับภาษา
      opts: {
        sweetnessId: swId, sweetnessName: sweetness,
        addonIds: this.selectedAddons.map(a => a.id), text: textNote,
      },
    });
    // ลำดับสำคัญ: โชว์แถบตะกร้าก่อน (ไม่งั้นวัดตำแหน่งปลายทางไม่ได้)
    // แล้วค่อยยิงของลอยตอนหน้าต่างสินค้ายังเปิดอยู่ (closeModal ใช้ display:none วัดขนาดไม่ได้อีก)
    this.renderCartBar({ bump: true });
    this.flyToCart(document.getElementById('modal-product'));
    this.closeModal('modal-product');
    this._selectedSweetnessId = null;
  },

  // ---- ภาษา ----

  t(key) {
    const table = ORDER_TEXT[this.lang] || ORDER_TEXT.th;
    // คีย์ที่ยังไม่ได้แปลให้ตกกลับไปใช้ไทย ดีกว่าโชว์ชื่อคีย์ให้ลูกค้าเห็น
    return table[key] !== undefined ? table[key] : (ORDER_TEXT.th[key] !== undefined ? ORDER_TEXT.th[key] : key);
  },

  // เครื่องที่ตั้งภาษาไทยเปิดมาเป็นไทย เครื่องอื่นเปิดมาเป็นอังกฤษ
  // แต่ถ้าเคยกดเลือกเองแล้ว ความจำนั้นชนะการเดาเสมอ
  detectLang() {
    try {
      const saved = localStorage.getItem('pukfu_order_lang');
      if (saved === 'th' || saved === 'en') return saved;
    } catch (e) { /* โหมดส่วนตัวอ่าน localStorage ไม่ได้ ไม่เป็นไร */ }
    const nav = typeof navigator === 'undefined' ? '' :
      ((navigator.languages && navigator.languages[0]) || navigator.language || '');
    return /^th\b|^th-/i.test(String(nav)) ? 'th' : 'en';
  },

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'th';
    try { localStorage.setItem('pukfu_order_lang', this.lang); } catch (e) { /* ไม่จำก็ยังใช้ได้ */ }
    if (document.documentElement) document.documentElement.lang = this.lang;
    this.applyLang();
  },

  // วาดทุกอย่างที่มีตัวหนังสือใหม่ทั้งหน้า ลูกค้ากดสลับภาษาตอนไหนของขั้นตอนก็ได้
  applyLang() {
    const all = document.querySelectorAll('[data-i18n]');
    Array.prototype.forEach.call(all, el => { el.innerText = this.t(el.getAttribute('data-i18n')); });

    const phs = document.querySelectorAll('[data-i18n-ph]');
    Array.prototype.forEach.call(phs, el => { el.placeholder = this.t(el.getAttribute('data-i18n-ph')); });

    const pills = document.querySelectorAll('[data-lang-btn]');
    Array.prototype.forEach.call(pills, el => {
      const on = el.getAttribute('data-lang-btn') === this.lang;
      el.classList.toggle('is-lang-on', on);
    });

    if (this.location) {
      const badge = document.getElementById('order-location-badge');
      if (badge) badge.innerText = this.t('locPrefix') + this.location;
      const welcomeLoc = document.getElementById('welcome-location');
      if (welcomeLoc) welcomeLoc.innerText = this.t('locPrefix') + this.location;
    }

    // ส่วนที่วาดจาก JS ไม่มี data-i18n ให้เกาะ ต้องสั่งวาดใหม่เอง
    if (this._dataLoaded) {
      this.renderCategories();
      this.renderMenu();
      this.renderCartBar();
      if (this.activeProduct) {
        const nameEl = document.getElementById('modal-product-name');
        if (nameEl) nameEl.innerText = this.menuName(this.activeProduct);
        this.updateSweetnessButtons();
        this.updateAddonButtons();
      }
    }
    this.renderCartItems();
    if (this.currentOrderId) {
      this.renderOrderSummary();
      if (this._lastStatus) {
        const keep = this._lastStatus;
        this._lastStatus = null;   // วาดข้อความใหม่ได้ แต่อย่าเล่นอนิเมชันฉลองซ้ำ
        this.applyStatus(keep, '', null);
      }
    }
  },

  // ชื่อสินค้าภาษาอังกฤษอยู่ในช่อง lang2 ของเมนู ร้านกรอกไว้แล้วทุกตัว
  // ตัวไหนไม่ได้กรอกให้โชว์ชื่อไทยไปก่อน ดีกว่าโชว์ช่องว่าง
  menuName(item) {
    if (!item) return '';
    return this.lang === 'en' && item.lang2 ? item.lang2 : item.name;
  },

  // แถวในตะกร้าเก็บชื่อไทยไว้ส่งขึ้นบิล ตอนโชว์จึงต้องไปหยิบชื่อตามภาษาจากเมนูอีกที
  cartLineName(line) {
    const m = this.menuData.find(x => x.sku === line.sku);
    return m ? this.menuName(m) : line.name;
  },

  categoryLabel(cat) {
    if (cat === 'All') return this.t('catAll');
    if (cat === 'อื่นๆ') return this.t('catOther');
    return cat;
  },

  sweetnessLabel(sw) {
    if (!sw) return '';
    return this.lang === 'en' && sw.lang2 ? sw.lang2 : sw.name;
  },

  addonPrice(addon) {
    return addon.price >= 0 ? '+฿' + addon.price : '-฿' + Math.abs(addon.price);
  },

  // โน้ตที่ส่งไปครัวเป็นไทยเสมอ อันนี้คือฉบับที่ลูกค้าอ่านเองในตะกร้า
  cartNoteDisplay(line) {
    const o = line.opts;
    if (!o) return line.note || '-';
    const sw = this.sweetnessLevels.find(x => x.id === o.sweetnessId);
    const parts = [this.t('sweetness') + ': ' + (sw ? this.sweetnessLabel(sw) : o.sweetnessName)];
    (o.addonIds || []).forEach(id => {
      const addon = this.addons.find(a => a.id === id);
      if (addon) parts.push(addon.name + ' (' + this.addonPrice(addon) + ')');
    });
    if (o.text) parts.push(o.text);
    return parts.join(' | ');
  },

  // ---- หน้าต้อนรับ ----

  hideWelcome() {
    const view = document.getElementById('view-welcome');
    if (!view || view.classList.contains('hidden')) return;
    this.stopWelcomeAnimation();
    if (this.reducedMotion()) {
      view.classList.add('hidden');
      return;
    }
    // ปล่อยให้จางออกก่อนค่อยซ่อนจริง ใช้ท่าเดียวกับหน้าล็อกของพนักงาน
    view.classList.add('is-leaving');
    setTimeout(() => {
      view.classList.add('hidden');
      view.classList.remove('is-leaving');
    }, 300);
  },

  // ขบวนอาหารกระโดดข้ามท้ายจอไปเรื่อยๆ ตำแหน่งคิดจากเวลาที่ผ่านไปล้วน
  // ไม่ได้บวกทีละเฟรม เฟรมตกไปกี่เฟรมขบวนก็ยังอยู่ตรงจังหวะเดิม
  startWelcomeAnimation() {
    const canvas = document.getElementById('welcome-canvas');
    // กล่องทดสอบไม่มี canvas จริง และเครื่องเก่าบางรุ่นก็ไม่มี 2d context
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0, h = 0;
    const fit = () => {
      w = canvas.clientWidth || 390;
      h = canvas.clientHeight || 844;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();

    const SPEED = 62, HOP = 1.05;
    const items = [0, 1, 2, 3, 4].map((kind, i) => ({
      kind,
      size: 50 + (i % 3) * 6,
      lead: i / 5,
      lean: (i % 2 ? 1 : -1) * 0.06,
    }));

    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      const ground = h * 0.76;
      const span = w + 150;
      items.forEach(o => {
        const x = ((o.lead * span + t * SPEED) % span) - 75;
        const phase = ((t + o.lead * span / SPEED) % HOP) / HOP;
        const lift = Math.sin(phase * Math.PI);
        // ยุบตอนแตะพื้น ยืดตอนลอยสุด ให้ดูมีน้ำหนัก
        const land = Math.max(0, 1 - Math.abs(phase - 0.02) * 14);

        const shadowW = o.size * (0.4 - lift * 0.14);
        const shadowA = 0.13 - lift * 0.07;
        if (shadowW > 0.5 && shadowA > 0.005) {
          ctx.save();
          ctx.globalAlpha = shadowA;
          ctx.fillStyle = '#1f4d3a';
          ctx.beginPath();
          ctx.ellipse(x, ground + o.size * 0.5, shadowW, shadowW * 0.22, 0, 0, 6.2832);
          ctx.fill();
          ctx.restore();
        }

        ctx.save();
        ctx.translate(x, ground - lift * 62);
        ctx.rotate(o.lean + lift * o.lean * 3);
        ctx.scale(1 + land * 0.22 - lift * 0.05, 1 - land * 0.22 + lift * 0.05);
        WELCOME_SHAPES[o.kind](ctx, o.size);
        ctx.restore();
      });
    };

    const raf = window.requestAnimationFrame;
    if (this.reducedMotion() || !raf) {
      draw(0);
      return;
    }

    this._welcomeResize = () => { fit(); };
    if (window.addEventListener) window.addEventListener('resize', this._welcomeResize);

    let t0 = 0;
    const loop = (now) => {
      if (!t0) t0 = now;
      draw((now - t0) / 1000);
      this._welcomeRaf = raf.call(window, loop);
    };
    this._welcomeRaf = raf.call(window, loop);
  },

  stopWelcomeAnimation() {
    if (this._welcomeRaf && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(this._welcomeRaf);
    }
    this._welcomeRaf = null;
    if (this._welcomeResize && window.removeEventListener) {
      window.removeEventListener('resize', this._welcomeResize);
    }
    this._welcomeResize = null;
  },

  // เครื่องที่ตั้งค่าลดการเคลื่อนไหวไว้ ต้องเช็คเองสำหรับอนิเมชันที่สั่งจาก JS
  // ตัวที่เขียนด้วย CSS ล้วนมี @media คุมให้อยู่แล้ว
  reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  },

  // ของลอยจากหน้าต่างสินค้าไปที่แถบตะกร้า ยืนยันให้เห็นว่ากดติดแล้วโดยไม่ต้องละสายตา
  // ใช้ transform กับ opacity ล้วน ไม่แตะ layout และลบทิ้งเมื่อจบ
  flyToCart(sourceEl) {
    if (!sourceEl) return;
    if (this.reducedMotion()) return;

    const target = document.getElementById('order-cart-total');
    if (!target) return;

    const from = sourceEl.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;

    const size = Math.min(96, Math.max(48, from.width * 0.25));
    const ghost = document.createElement('div');
    ghost.className = 'cart-fly';
    ghost.style.width = size + 'px';
    ghost.style.height = size + 'px';
    ghost.style.left = (from.left + from.width / 2 - size / 2) + 'px';
    ghost.style.top = (from.top + from.height / 2 - size / 2) + 'px';
    document.body.appendChild(ghost);

    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);

    const done = () => ghost.remove();
    if (typeof ghost.animate !== 'function') { done(); return; }
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(.7)`, opacity: .95, offset: .55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.18)`, opacity: 0 }
    ], { duration: 300, easing: 'cubic-bezier(.35,.6,.3,1)' });
    anim.onfinish = done;
    anim.oncancel = done;
  },

  renderCartBar(opts) {
    const o = opts || {};
    const bar = document.getElementById('order-cart-bar');
    const count = this.cart.reduce((s, i) => s + i.qty, 0);
    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    if (count === 0) { bar.classList.add('hidden'); return; }

    // แถบนี้เป็นลูกของ body แบบ flex การโชว์ครั้งแรกจึงดันเนื้อหาขึ้น ให้มันเลื่อนขึ้นมาแทนที่จะโผล่ตูม
    const wasHidden = bar.classList.contains('hidden');
    bar.classList.remove('hidden');
    if (wasHidden && !this.reducedMotion()) {
      bar.classList.remove('is-rising');
      void bar.offsetWidth;
      bar.classList.add('is-rising');
    }

    const bumpCls = o.bump ? ' class="cart-qty-pop"' : '';
    document.getElementById('order-cart-count').innerHTML = `<span${bumpCls}>${count}</span>${escHtml(this.t('itemsSuffix'))}`;
    document.getElementById('order-cart-total').innerHTML = `<span${bumpCls}>฿${total.toFixed(2)}</span>`;
  },

  openCartReview() {
    this.renderCartItems();
    this.openModal('modal-cart');
  },

  // o.popIdx = แถวที่จำนวนเพิ่งเปลี่ยน ทำแบบเจาะจงแถว
  // ไม่งั้นทั้งรายการกระพริบใหม่ทุกครั้งที่กดบวกลบ
  renderCartItems(opts) {
    const o = opts || {};
    const container = document.getElementById('order-cart-items');
    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    if (this.cart.length === 0) {
      container.innerHTML = '<p class="text-center text-slate-400 py-6">' + escHtml(this.t('cartEmpty')) + '</p>';
    } else {
      container.innerHTML = this.cart.map((item, idx) => `
        <div data-cart-idx="${idx}" class="flex justify-between items-start bg-white p-3 rounded-2xl border border-sand shadow-sm gap-2">
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm text-secondary truncate">${escHtml(this.cartLineName(item))}</p>
            <p class="text-xs text-slate-400 mt-0.5">${escHtml(this.cartNoteDisplay(item))}</p>
            <p class="font-black text-sm text-primary mt-1">฿${(item.price * item.qty).toFixed(2)}</p>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <div class="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-100">
              <button onclick="OrderPage.updateQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full active:scale-95 font-bold text-slate-600 shadow-sm">-</button>
              <span class="w-6 text-center font-bold text-sm"><span class="${idx === o.popIdx ? 'cart-qty-pop' : ''}">${item.qty}</span></span>
              <button onclick="OrderPage.updateQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full active:scale-95 font-bold text-slate-600 shadow-sm">+</button>
            </div>
          </div>
        </div>
      `).join('');
    }
    document.getElementById('order-cart-modal-total').innerText = '฿' + total.toFixed(2);
  },

  // ให้แถวเลื่อนออกก่อนแล้วค่อยวาดใหม่ ไม่งั้นแถวหายวับทันที
  animateCartLineOut(idx) {
    const row = document.querySelector(`#order-cart-items [data-cart-idx="${idx}"]`);
    if (!row || this.reducedMotion()) return Promise.resolve();
    row.classList.add('cart-line-out');
    return new Promise(resolve => setTimeout(resolve, 140));
  },

  async updateQty(idx, delta) {
    const item = this.cart[idx];
    if (!item) return;
    if (item.qty + delta <= 0) {
      await this.animateCartLineOut(idx);
      this.cart.splice(idx, 1);
      this.renderCartItems();
      this.renderCartBar();
      return;
    }
    item.qty += delta;
    this.renderCartItems({ popIdx: idx });
    this.renderCartBar();
  },

  async submitOrder() {
    // กันกดรัว เลข PEND- ถูกสร้างฝั่งเซิร์ฟเวอร์ กดสองทีได้ออเดอร์คนละใบ แล้วร้านยืนยันเป็นบิลจริงได้ทั้งคู่
    if (this.isSubmittingOrder) return;
    const name = document.getElementById('customer-name-input').value.trim();
    if (!name) return this.showAlert(this.t('needName'), '', 'warning');
    if (this.cart.length === 0) return this.showAlert(this.t('cartEmptyAlert'), '', 'warning');

    this.isSubmittingOrder = true;
    const submitBtn = document.getElementById('btn-place-order');
    if (submitBtn) submitBtn.disabled = true;
    const release = () => {
      this.isSubmittingOrder = false;
      if (submitBtn) submitBtn.disabled = false;
    };

    this.showLoading();
    try {
      const result = await callApi('submitPendingOrder', [{
        location: this.location, customerName: name, items: this.cart,
      }]);
      this.hideLoading();
      if (!result.success) {
        release();
        return this.showAlert(result.error || this.t('submitFail'), '', 'warning');
      }
      this.currentOrderId = result.id;
      this.saveOrderId(result.id);
      this.closeModal('modal-cart');
      this.showSubmittedView();
      this.startPolling();
      release();
    } catch (e) {
      this.hideLoading();
      release();
      this.showAlert(this.t('serverFail') + ': ' + e.message, '', 'warning');
    }
  },

  showSubmittedView() {
    const view = document.getElementById('view-submitted');
    view.classList.remove('hidden');
    // เริ่มนับสถานะใหม่ทุกครั้งที่เข้าหน้านี้ ออเดอร์ใบใหม่ต้องได้เห็นจังหวะร้านกดรับเหมือนกัน
    this._lastStatus = null;
    this._lastQueue = null;
    // รีเซ็ตสถานะ UI กลับเป็นค่าเริ่มต้น เผื่อเป็นการสั่งออเดอร์รอบใหม่ต่อจากออเดอร์ก่อนหน้าที่ยืนยัน/ปฏิเสธ/ยกเลิกไปแล้ว
    const icon = document.getElementById('submitted-status-icon');
    icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-amber-100 text-amber-500';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:2rem;height:2rem"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    document.getElementById('submitted-status-text').innerText = this.t('statusSent');
    document.getElementById('submitted-status-sub').innerText = this.t('statusSentSub');
    document.getElementById('btn-cancel-order').classList.remove('hidden');
    const uploadBtn = document.getElementById('btn-upload-slip');
    uploadBtn.classList.remove('hidden');
    uploadBtn.disabled = false;
    uploadBtn.innerText = this.t('uploadSlip');
    document.getElementById('submitted-payment-box').classList.add('hidden');

    // กลับเข้ามาใหม่หลังรีเฟรช ตะกร้าว่างแล้ว ซ่อนกล่องสรุปไปเลยดีกว่าโชว์กล่องเปล่า
    const summaryBox = document.getElementById('submitted-order-summary');
    if (this.cart.length === 0) {
      summaryBox.classList.add('hidden');
    } else {
      summaryBox.classList.remove('hidden');
    }

    this.renderOrderSummary();
    if (this.shopInfo && this.shopInfo.paymentQrImage) {
      document.getElementById('submitted-payment-qr').src = this.shopInfo.paymentQrImage;
      document.getElementById('submitted-payment-box').classList.remove('hidden');
    }

    // ใส่คลาสหลังจัดเนื้อหาครบแล้ว การ์ดจะได้ไล่กันขึ้นมาตามที่ตั้งไว้ใน style.css
    view.classList.remove('view-enter');
    void view.offsetWidth;
    view.classList.add('view-enter');
  },

  // แยกออกมาเพราะต้องวาดใหม่ทุกครั้งที่ลูกค้าสลับภาษา ไม่ใช่แค่ตอนเข้าหน้านี้ครั้งแรก
  renderOrderSummary() {
    const summaryBox = document.getElementById('submitted-order-summary');
    if (!summaryBox) return;
    const total = this.cart.reduce((s, i) => s + i.qty * i.price, 0);
    summaryBox.innerHTML = `
      <p class="font-bold text-secondary mb-3">${escHtml(this.t('summary'))}</p>
      ${this.cart.map(i => `
        <div class="flex justify-between text-sm mb-2">
          <span class="text-slate-600">${i.qty}x ${escHtml(this.cartLineName(i))}</span>
          <span class="font-bold text-secondary">฿${(i.qty * i.price).toFixed(2)}</span>
        </div>
      `).join('')}
      <div class="flex justify-between font-black text-lg mt-3 pt-3 border-t border-sand">
        <span>${escHtml(this.t('total'))}</span><span class="text-primary">฿${total.toFixed(2)}</span>
      </div>
    `;
  },

  backToMenu() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.currentOrderId = null;
    this.clearSavedOrder();
    this.cart = [];
    this._lastStatus = null;
    this._lastQueue = null;
    this.renderCartBar();
    const view = document.getElementById('view-submitted');
    view.classList.add('hidden');
    view.classList.remove('view-enter');
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollStatus(), 12000);
  },

  async pollStatus() {
    if (!this.currentOrderId) return;
    try {
      const r = await callApi('getPendingOrderStatus', [this.currentOrderId]);
      if (!r.success) {
        // ออเดอร์หายไปจากระบบแล้ว (เช่นถูกล้างข้อมูล) เลิกตามต่อ
        this.clearSavedOrder();
        clearInterval(this.pollTimer);
        return;
      }
      this.applyStatus(r.status, r.rejectReason, r);
    } catch (e) { /* เงียบไว้ ลองใหม่รอบหน้า */ }
  },

  applyStatus(status, rejectReason, queue) {
    // หน้านี้ถามเซิร์ฟเวอร์ทุก 12 วินาที และได้คำตอบเดิมเป็นส่วนใหญ่
    // ถ้าไม่เทียบกับของเดิมก่อน อนิเมชันจะเล่นซ้ำทุก 12 วินาทีตลอดเวลาที่ลูกค้ารอ
    const changed = status !== this._lastStatus;
    this._lastStatus = status;

    const icon = document.getElementById('submitted-status-icon');
    const text = document.getElementById('submitted-status-text');
    const sub = document.getElementById('submitted-status-sub');
    const cancelBtn = document.getElementById('btn-cancel-order');
    const uploadBtn = document.getElementById('btn-upload-slip');

    if (status === 'confirmed') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-500';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M20 6L9 17l-5-5"/></svg>';
      text.innerText = this.t('statusConfirmed');
      sub.innerText = this.t('statusMaking');
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      // ไม่หยุด poll ตรงนี้ ช่วงนี้แหละที่ลูกค้าอยากรู้ว่าเหลืออีกกี่คิว
      // ของเดิมหยุดตั้งแต่ร้านกดรับ ทำให้หน้าจอค้างอยู่แบบนั้นจนกว่าจะปิดหน้า
      this.renderQueue(queue);
    } else if (status === 'ready') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-500';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M20 6L9 17l-5-5"/></svg>';
      text.innerText = this.t('statusReady');
      sub.innerText = this.t('statusCollect');
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      this.renderQueue(null);
      this.clearSavedOrder();
      clearInterval(this.pollTimer);
    } else if (status === 'rejected') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-red-100 text-red-500';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      text.innerText = this.t('statusRejected');
      sub.innerText = rejectReason || '';
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      this.renderQueue(null);
      this.clearSavedOrder();
      clearInterval(this.pollTimer);
    } else if (status === 'cancelled') {
      icon.className = 'w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-slate-100 text-slate-400';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:2rem;height:2rem"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      text.innerText = this.t('statusCancelled');
      sub.innerText = '';
      cancelBtn.classList.add('hidden'); uploadBtn.classList.add('hidden');
      this.renderQueue(null);
      this.clearSavedOrder();
      clearInterval(this.pollTimer);
    }

    if (changed) this.animateStatusChange(status);
  },

  // ไอคอนเด้งใช้ทุกสถานะ ส่วนวงแหวนกับการ์ดยกตัวใส่เฉพาะข่าวดี
  // ถูกปฏิเสธหรือยกเลิกจะได้ไม่ดูเหมือนกำลังฉลองให้ลูกค้า
  animateStatusChange(status) {
    if (this.reducedMotion()) return;
    if (!['confirmed', 'ready', 'rejected', 'cancelled'].includes(status)) return;

    const good = status === 'confirmed' || status === 'ready';
    const play = (el, classes) => {
      if (!el) return;
      el.classList.remove(...classes);
      void el.offsetWidth;
      el.classList.add(...classes);
    };
    play(document.getElementById('submitted-status-icon'), good ? ['status-pop', 'status-ring'] : ['status-pop']);
    play(document.getElementById('submitted-status-text'), ['status-rise']);
    if (good) play(document.getElementById('submitted-status-card'), ['status-lift']);
  },

  // แสดงจำนวนคิวก่อนหน้า + เวลาโดยประมาณ
  // ไม่มีคิวก่อนหน้า = บอกว่ากำลังทำอยู่ ไม่ขึ้น "0 คิว" หรือ "0 นาที" ซึ่งอ่านแล้วงง
  renderQueue(queue) {
    const box = document.getElementById('submitted-queue-box');
    const line = document.getElementById('submitted-queue-line');
    const eta = document.getElementById('submitted-queue-eta');
    if (!box || !line || !eta) return;
    if (!queue) { box.classList.add('hidden'); this._lastQueue = null; return; }

    const ahead = Number(queue.queueAhead) || 0;
    const low = Number(queue.etaLow) || 0;
    const high = Number(queue.etaHigh) || 0;
    // เหมือนกับสถานะ: ตัวเลขคิวถูกวาดใหม่ทุกรอบที่ถามเซิร์ฟเวอร์ ให้เด้งเฉพาะตอนที่เลขเปลี่ยนจริง
    const moved = ahead !== this._lastQueue;
    this._lastQueue = ahead;
    if (ahead <= 0) {
      line.innerText = this.t('queueYourTurn');
      eta.innerText = '';
    } else {
      const popCls = moved && !this.reducedMotion() ? ' class="queue-num-pop"' : '';
      line.innerHTML = escHtml(this.t('queueAheadPre')) + '<span' + popCls + '>' + ahead + '</span>' + escHtml(this.t('queueAheadPost'));
      eta.innerText = low > 0 ? this.t('queueEtaPre') + low + '-' + high + this.t('queueEtaPost') : '';
    }
    box.classList.remove('hidden');
  },

  // จำเลขออเดอร์ไว้ในเครื่อง เผื่อลูกค้ารีเฟรชหรือสลับแอป
  // ของเดิมเก็บไว้ใน memory อย่างเดียว รีเฟรชทีเดียวก็ตามออเดอร์ตัวเองไม่ได้อีกเลย
  saveOrderId(id) {
    try { localStorage.setItem('pukfu_order_id', id); } catch (e) { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
  },

  clearSavedOrder() {
    try { localStorage.removeItem('pukfu_order_id'); } catch (e) { /* ไม่เป็นไร */ }
  },

  async handleSlipUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    this.showLoading();
    try {
      const base64 = await resizeImageBase64(file, 800, 'image/jpeg', 0.7);
      const r = await callApi('uploadPaymentSlip', [{ id: this.currentOrderId, image: base64 }]);
      this.hideLoading();
      if (!r.success) return this.showAlert(r.error || this.t('uploadFail'), '', 'warning');
      document.getElementById('btn-upload-slip').innerText = this.t('slipSent');
      document.getElementById('btn-upload-slip').disabled = true;
    } catch (e) {
      this.hideLoading();
      this.showAlert(this.t('uploadFail') + ': ' + e.message, '', 'warning');
    }
  },

  async cancelOrder() {
    const ok = await this.showConfirm(this.t('confirmCancel'), '');
    if (!ok) return;
    this.showLoading();
    try {
      const r = await callApi('cancelPendingOrder', [this.currentOrderId]);
      this.hideLoading();
      if (!r.success) return this.showAlert(r.error || this.t('cancelFail'), '', 'warning');
      this.applyStatus('cancelled', '');
    } catch (e) {
      this.hideLoading();
      this.showAlert(this.t('cancelFail') + ': ' + e.message, '', 'warning');
    }
  },

  // อนิเมชันตอนเปิดใช้ CSS ชุดเดียวกับแอปพนักงาน (style.css) หน้านี้โหลดไฟล์เดียวกันอยู่แล้ว
  openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.remove('modal-opening');
    void el.offsetWidth;
    el.classList.add('modal-opening');
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('modal-opening');
  },
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
        this.closeModal('modal-alert');
        if (this._alertResolve) { this._alertResolve(btn.value); this._alertResolve = null; }
      };
      btnContainer.appendChild(b);
    });
    this.openModal('modal-alert');
  },

  showAlert(message, icon, type) {
    return new Promise(resolve => {
      this._openAlertModal({ message, type: type || 'info', buttons: [{ label: this.t('ok'), style: 'primary', value: true }] });
      this._alertResolve = resolve;
    });
  },

  showConfirm(message) {
    return new Promise(resolve => {
      this._openAlertModal({
        message, type: 'warning',
        buttons: [{ label: this.t('cancel'), style: 'ghost', value: false }, { label: this.t('confirm'), style: 'primary', value: true }],
      });
      this._alertResolve = resolve;
    });
  },
};

window.onload = () => OrderPage.init();
