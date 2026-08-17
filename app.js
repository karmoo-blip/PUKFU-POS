  (function () {
    if (window.google && window.google.script && window.google.script.run) return;

    var CFG_URL = "pos_apiUrl", CFG_KEY = "pos_apiKey";

    function ask(msg, current) {
      var v = window.prompt(msg, current || "");
      return v === null ? null : v.trim();
    }

    function config(force) {
      var url = localStorage.getItem(CFG_URL);
      var key = localStorage.getItem(CFG_KEY);
      if (!force && !url && !key && window.POS_LOCAL_CONFIG) {
        url = window.POS_LOCAL_CONFIG.apiUrl;
        key = window.POS_LOCAL_CONFIG.apiKey;
        if (url) localStorage.setItem(CFG_URL, url);
        if (key) localStorage.setItem(CFG_KEY, key);
      }
      if (force || !url) {
        url = ask("วาง URL ของ backend (Cloudflare Worker หรือ Apps Script /exec)", url);
        if (url) localStorage.setItem(CFG_URL, url);
      }
      if (force || !key) {
        key = ask("วางค่า API_TOKEN ของ backend", key);
        if (key) localStorage.setItem(CFG_KEY, key);
      }
      return { url: url, key: key };
    }

    window.posApiSetup = function () { config(true); location.reload(); };

    function call(fn, args, ok, fail) {
      var c = config(false);
      if (!c.url || !c.key) {
        fail(new Error("ยังไม่ได้ตั้งค่า API : พิมพ์ posApiSetup() ใน console"));
        return;
      }
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      fetch(c.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: c.key, fn: fn, args: args }),
        signal: controller.signal
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || "API error");
          ok(d.result);
        })
        .catch(fail)
        .finally(function () { clearTimeout(timer); });
    }

    function chain(h) {
      return new Proxy({}, {
        get: function (target, name) {
          if (name === "withSuccessHandler") return function (cb) { return chain({ ok: cb, fail: h.fail, obj: h.obj }); };
          if (name === "withFailureHandler") return function (cb) { return chain({ ok: h.ok, fail: cb, obj: h.obj }); };
          if (name === "withUserObject")     return function (o)  { return chain({ ok: h.ok, fail: h.fail, obj: o }); };
          return function () {
            var args = Array.prototype.slice.call(arguments);
            call(String(name), args,
              function (res) { if (h.ok) h.ok(res, h.obj); },
              function (err) {
                if (h.fail) h.fail(err, h.obj);
                else console.error("[API] " + String(name), err);
              });
          };
        }
      });
    }

    window.google = window.google || {};
    window.google.script = window.google.script || {};
    Object.defineProperty(window.google.script, "run", { get: function () { return chain({}); } });
    window.google.script.host = window.google.script.host || {
      close: function () {}, setHeight: function () {}, origin: location.origin
    };
  })();
    // ─── ย่อรูปให้เล็กลงก่อนเก็บ (ประหยัดพื้นที่ localStorage) ───
    function resizeImageBase64(file, maxWidth, mimeType, quality) {
      mimeType = mimeType || 'image/png';
      quality = quality === undefined ? 0.85 : quality;
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

    function calcVatBreakdown(total, rate) {
      const r = Number(rate) || 0;
      const vatAmount = total * (r / (100 + r));
      const exVat = total - vatAmount;
      return { exVat, vatAmount, rate: r };
    }

    function imageToRaster(base64, targetWidthPx) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = targetWidthPx / img.width;
          const w = targetWidthPx;
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h).data;
          const bytesPerRow = Math.ceil(w / 8);
          const raster = new Uint8Array(bytesPerRow * h);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2], a = imgData[idx + 3];
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              if (a > 128 && lum < 160) {
                raster[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x % 8));
              }
            }
          }
          resolve({ width: w, height: h, bytesPerRow, data: Array.from(raster) });
        };
        img.onerror = reject;
        img.src = base64;
      });
    }
    // ==========================================================
    //  ReceiptImage — วาดใบเสร็จลง canvas แล้วพิมพ์เป็นรูปภาพ
    //    (แก้ปัญหาภาษาไทยเพี้ยน เพราะไม่พึ่ง code page ของเครื่องพิมพ์)
    // ==========================================================
    const ReceiptImage = {
        FONT: '"Sarabun","Noto Sans Thai","Leelawadee UI","Thonburi","Tahoma",sans-serif',
      PAD: 4,
      _fontReady: null,

      // โหลดฟอนต์ไทยให้พร้อมก่อนวาด (ถ้าโหลดไม่ได้จะใช้ฟอนต์ระบบแทน)
      ensureFont() {
        if (this._fontReady) return this._fontReady;
        this._fontReady = (async () => {
          try {
            if (!document.getElementById('receipt-thai-font')) {
              const link = document.createElement('link');
              link.id = 'receipt-thai-font';
              link.rel = 'stylesheet';
              link.href = 'https://fonts.googleapis.com/css2' + '?family=Noto+Sans+Thai:wght@400;700&display=swap';
              document.head.appendChild(link);
            }
            await Promise.race([
              Promise.all([
                document.fonts.load('400 24px "Noto Sans Thai"'),
                document.fonts.load('700 24px "Noto Sans Thai"')
              ]),
              new Promise(r => setTimeout(r, 3000))
            ]);
          } catch (e) { /* ใช้ฟอนต์ระบบแทน */ }
        })();
        return this._fontReady;
      },

      loadImage(src) {
        return new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
      },

      // ─── สร้างเอกสารเปล่า ───
      newDoc(paperSize) {
        const width = (paperSize === '58mm') ? 384 : 576;
        return { width, base: (width >= 576 ? 24 : 21), ops: [] };
      },
      text(doc, str, o)  { doc.ops.push(Object.assign({ t: 'text', str: String(str == null ? '' : str), size: doc.base, bold: false, align: 'left', indent: 0 }, o || {})); },
      lr(doc, l, r, o)   { doc.ops.push(Object.assign({ t: 'lr', l: String(l == null ? '' : l), r: String(r == null ? '' : r), size: doc.base, bold: false, indent: 0, boldRight: false }, o || {})); },
      // แถวรายการสินค้า: จำนวน | ชื่อ | ราคา
      row3(doc, qty, name, price, o) { doc.ops.push(Object.assign({ t: 'row3', qty: String(qty), name: String(name), price: String(price), size: doc.base, bold: false }, o || {})); },
      rule(doc)          { doc.ops.push({ t: 'gap', h: 12 }, { t: 'rule' }, { t: 'gap', h: 12 }); }, // เว้นวรรคแทนเส้นประ (ลดความลายตา)
      gap(doc, h)        { doc.ops.push({ t: 'gap', h: h || 10 }); },
      image(doc, el, w)  { doc.ops.push({ t: 'img', el: el, w: w }); },

      _font(op)  { return ((op.bold ? '700 ' : '400 ') + op.size + 'px ' + this.FONT); },
      _lineH(op) { return Math.round(op.size * 1.4); },

      // ตัดคำเป็น grapheme cluster (กันตัดกลางสระ/วรรณยุกต์ไทยจนอักษรเพี้ยนตอนขึ้นบรรทัดใหม่)
      _graphemes(str) {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
          return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(str), s => s.segment);
        }
        return Array.from(str);
      },

      // ตัดบรรทัดให้พอดีความกว้างกระดาษ
      _wrap(ctx, str, maxW) {
        const out = [];
        const paras = String(str).split(String.fromCharCode(10));
        for (const para of paras) {
          if (ctx.measureText(para).width <= maxW) { out.push(para); continue; }
          let line = '';
          for (const ch of this._graphemes(para)) {
            if (line && ctx.measureText(line + ch).width > maxW) { out.push(line); line = ch; }
            else line += ch;
          }
          out.push(line);
        }
        return out;
      },

      // ─── วาดจริงแล้วคืนค่าเป็น PNG base64 ───
      async toDataURL(doc) {
        await this.ensureFont();
        const pad = this.PAD;
        const inner = doc.width - pad * 2;
        const meas = document.createElement('canvas').getContext('2d');

        // รอบที่ 1: คำนวณความสูงรวม
        let total = pad;
        for (const op of doc.ops) {
          if (op.t === 'gap')  { total += op.h; continue; }
          if (op.t === 'rule') { total += 16; continue; }
          if (op.t === 'img') {
            const iw = Math.min(op.w || inner, inner);
            op._w = iw;
            op._h = Math.round(op.el.height * (iw / op.el.width));
            total += op._h + 8;
            continue;
          }
          meas.font = this._font(op);
          if (op.t === 'text') {
            op._lines = this._wrap(meas, op.str, inner - (op.indent || 0));
          } else if (op.t === 'lr') {
            const rw = meas.measureText(op.r).width;
            op._lines = this._wrap(meas, op.l, Math.max(24, inner - (op.indent || 0) - rw - 10));
          } else {
            const qw = Math.max(meas.measureText('99').width, meas.measureText(op.qty).width) + 14;
            const pw = meas.measureText(op.price).width;
            op._qw = qw;
            op._lines = this._wrap(meas, op.name, Math.max(30, inner - qw - pw - 12));
          }
          total += op._lines.length * this._lineH(op);
        }
        total += pad;

        // รอบที่ 2: วาด
        const cv = document.createElement('canvas');
        cv.width = doc.width;
        cv.height = Math.max(1, total);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'top';

        let y = pad;
        for (const op of doc.ops) {
          if (op.t === 'gap') { y += op.h; continue; }
          if (op.t === 'rule') {
            ctx.save();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(pad, y + 7);
            ctx.lineTo(doc.width - pad, y + 7);
            ctx.stroke();
            ctx.restore();
            y += 16;
            continue;
          }
          if (op.t === 'img') {
            ctx.drawImage(op.el, Math.round((doc.width - op._w) / 2), y, op._w, op._h);
            y += op._h + 8;
            continue;
          }
          ctx.font = this._font(op);
          const lh = this._lineH(op);
          if (op.t === 'text') {
            for (const line of op._lines) {
              const wpx = ctx.measureText(line).width;
              let x = pad + (op.indent || 0);
              if (op.align === 'center') x = (doc.width - wpx) / 2;
              else if (op.align === 'right') x = doc.width - pad - wpx;
              ctx.fillText(line, Math.round(x), y);
              y += lh;
            }
          } else if (op.t === 'lr') {
            op._lines.forEach((line, i) => {
              ctx.fillText(line, pad + (op.indent || 0), y);
              if (i === op._lines.length - 1) {
                if (op.boldRight) ctx.font = this._font({ size: op.size, bold: true });
                ctx.fillText(op.r, Math.round(doc.width - pad - ctx.measureText(op.r).width), y);
                ctx.font = this._font(op);
              }
              y += lh;
            });
          } else {
            op._lines.forEach((line, i) => {
              if (i === 0) ctx.fillText(op.qty, pad, y);
              ctx.fillText(line, pad + op._qw, y);
              if (i === op._lines.length - 1) {
                ctx.font = this._font({ size: op.size, bold: true });
                ctx.fillText(op.price, Math.round(doc.width - pad - ctx.measureText(op.price).width), y);
                ctx.font = this._font(op);
              }
              y += lh;
            });
          }
        }
        return cv.toDataURL('image/png');
      }
    };

    // =============================================
    //  BluetoothPrinter — จัดการเครื่องพิมพ์ BLE
    // =============================================
    // สร้างเป็นฟังก์ชัน factory แทน object เดี่ยว จะได้เชื่อมต่อเครื่องพิมพ์ 2 เครื่องพร้อมกันได้
    // (เครื่องเดิมมีตัวเดียวก็ยังใช้ได้ปกติ แค่เรียก factory 2 ครั้งด้านล่าง)
    function createPrinterConnection() {
      return {
      device: null,
      server: null,
      characteristic: null,
      isConnected: false,
      deviceName: '',

      // UUID ที่เครื่องพิมพ์ BLE ทั่วไปใช้ (ลองทีละชุดอัตโนมัติ)
      UUID_SETS: [
        { service: '0000ff00-0000-1000-8000-00805f9b34fb', char: '0000ff02-0000-1000-8000-00805f9b34fb' },
        { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', char: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2' },
        { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', char: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
        { service: '000018f0-0000-1000-8000-00805f9b34fb', char: '00002af1-0000-1000-8000-00805f9b34fb' },
      ],

      // ─── เชื่อมต่อเครื่องพิมพ์ ───
      async connect() {
        try {
          // เปิดหน้าต่างให้เลือกเครื่องพิมพ์
          this.device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: this.UUID_SETS.map(u => u.service)
          });

          // เชื่อมต่อ
          this.server = await this.device.gatt.connect();
          this.deviceName = this.device.name || 'Bluetooth Printer';

          // ลอง UUID ทีละชุดจนเจอตัวที่ใช้ได้
          this.characteristic = null;
          for (const uuidSet of this.UUID_SETS) {
            try {
              const service = await this.server.getPrimaryService(uuidSet.service);
              this.characteristic = await service.getCharacteristic(uuidSet.char);
              console.log(' ใช้ UUID:', uuidSet.service);
              break;
            } catch (e) { continue; }
          }

          if (!this.characteristic) throw new Error('ไม่พบ BLE Service ที่รองรับ');

          this.isConnected = true;
      this.probeChunkSize().catch(() => {}); // วัดขนาดก้อนข้อมูลล่วงหน้า ไม่ต้องรอตอนพิมพ์ใบแรก

          // ดักเหตุการณ์เครื่องพิมพ์หลุด
          this.device.addEventListener('gattserverdisconnected', () => {
            this.isConnected = false;
            this.characteristic = null;
            Controller.updatePrinterStatusUI();
          });

          return { success: true, name: this.deviceName };
        } catch (error) {
          this.isConnected = false;
          return { success: false, message: error.message };
        }
      },

      // ─── ตัดการเชื่อมต่อ ───
      async disconnect() {
        if (this.device && this.device.gatt.connected) {
          this.device.gatt.disconnect();
        }
        this.isConnected = false;
        this.characteristic = null;
        this.deviceName = '';
        this.chunkSize = 0;
      },

      // ─── ส่งข้อมูล ───
      // หาขนาดก้อนที่ใหญ่ที่สุดที่เครื่องพิมพ์รับไหวครั้งเดียวตอนเริ่มใช้งาน
      chunkSize: 0,
      chunkDelay: 0,
      onProgress: null,

      async probeChunkSize() {
        if (this.chunkSize) return this.chunkSize;
        if (/Android/i.test(navigator.userAgent)) {
          // Android เจรจา ATT MTU ผ่าน Web Bluetooth ไม่ได้ (ไม่มี API ให้เว็บขอ) เลยส่งได้ครั้งละ 20 ไบต์เท่านั้น
          // ไม่ใส่ดีเลย์เพิ่มเลย ปล่อยให้ await การเขียนแต่ละก้อนเป็นตัวหน่วงตามจริงแทน (เร็วที่สุดเท่าที่ทำได้)
          // (ถ้าเขียนข้อมูลพลาดระหว่างพิมพ์ sendData() จะ fallback กลับไปที่ 15ms ให้เองอัตโนมัติ)
          this.chunkSize = 20;
          this.chunkDelay = 0;
          return 20;
        }
        const CANDIDATES = [512, 244, 182, 100, 20];
        for (const size of CANDIDATES) {
          try {
            // ESC @ ซ้ำ ๆ เป็นคำสั่งรีเซ็ต ไม่ทำให้กระดาษเดินหรือมีหมึกออก
            const probe = new Uint8Array(size);
            for (let i = 0; i < size; i += 2) { probe[i] = 0x1B; probe[i + 1] = 0x40; }
            await this.characteristic.writeValueWithoutResponse(probe);
            this.chunkSize = size;
            this.chunkDelay = size >= 182 ? 2 : (size >= 100 ? 6 : 15);
            console.log(' ขนาดก้อนที่ใช้ได้:', size, 'bytes');
            return size;
          } catch (e) { /* ใหญ่ไป ลองขนาดถัดไป */ }
        }
        this.chunkSize = 20;
        this.chunkDelay = 15;
        return 20;
      },

      async sendData(data) {
        if (!this.characteristic) throw new Error('ไม่ได้เชื่อมต่อเครื่องพิมพ์');
        await this.probeChunkSize();
        const total = data.length;
        for (let i = 0; i < total; i += this.chunkSize) {
          const chunk = data.slice(i, i + this.chunkSize);
          try {
            await this.characteristic.writeValueWithoutResponse(new Uint8Array(chunk));
          } catch (e) {
            // ส่งก้อนใหญ่ไม่ผ่าน → ลดขนาดถาวรแล้วส่งก้อนนี้ซ้ำแบบละเอียด
            this.chunkSize = 20;
            this.chunkDelay = 15;
            for (let j = 0; j < chunk.length; j += 20) {
              await this.characteristic.writeValueWithoutResponse(new Uint8Array(chunk.slice(j, j + 20)));
              await new Promise(r => setTimeout(r, this.chunkDelay));
            }
          }
          if (this.chunkDelay) await new Promise(r => setTimeout(r, this.chunkDelay));
          if (this.onProgress) {
            try { this.onProgress(Math.min(total, i + this.chunkSize), total); } catch (e) { console.warn('onProgress callback error:', e); }
          }
        }
      },

      // ─── ESC/POS Commands ───
      ESC: 0x1B,
      GS: 0x1D,
      LF: 0x0A,

      textToBytes(text)  { return Array.from(new TextEncoder().encode(text)); },
      initPrinter()      { return [this.ESC, 0x40]; },
      centerAlign()      { return [this.ESC, 0x61, 0x01]; },
      leftAlign()        { return [this.ESC, 0x61, 0x00]; },
      boldOn()           { return [this.ESC, 0x45, 0x01]; },
      boldOff()          { return [this.ESC, 0x45, 0x00]; },
      bigText()          { return [this.GS, 0x21, 0x11]; },
      normalText()       { return [this.GS, 0x21, 0x00]; },
      feedLines(n)       { return [this.ESC, 0x64, n]; },
      cutPaper()         { return [this.GS, 0x56, 0x42, 0x00]; },
      dashedLine(w)      { return this.textToBytes('-'.repeat(w || 32)); },

      printLogoBytes(logoRaster) {
        const xL = logoRaster.bytesPerRow & 0xFF;
        const xH = (logoRaster.bytesPerRow >> 8) & 0xFF;
        const yL = logoRaster.height & 0xFF;
        const yH = (logoRaster.height >> 8) & 0xFF;
        return [this.GS, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...logoRaster.data, this.LF];
      },

      // จัดข้อความชิดซ้าย+ขวาในบรรทัดเดียว เช่น "Latte     ฿65"
      leftRight(left, right, width) {
        width = width || 32;
        const spaces = Math.max(1, width - [...left].length - [...right].length);
        return [...this.textToBytes(left), ...this.textToBytes(' '.repeat(spaces)), ...this.textToBytes(right)];
      },

      // ─── แปลงรูปเป็นคำสั่งพิมพ์ raster ───
      // ข้ามแถวที่ขาวล้วนแล้วสั่ง ESC J (เลื่อนกระดาษ) แทน ลดข้อมูลได้ราวครึ่งหนึ่ง
      async imageBytes(dataURL, targetWidthPx) {
        const ras = await imageToRaster(dataURL, targetWidthPx);
        const bpr = ras.bytesPerRow;
        const data = ras.data;
        const H = ras.height;

        // หาแถวที่ไม่มีจุดดำเลย
        const blank = new Uint8Array(H);
        for (let y = 0; y < H; y++) {
          const off = y * bpr;
          let empty = 1;
          for (let b = 0; b < bpr; b++) { if (data[off + b] !== 0) { empty = 0; break; } }
          blank[y] = empty;
        }

        const MIN_GAP = 4;   // ช่องว่างสั้นกว่านี้พิมพ์รวมไปเลย ถูกกว่าส่งคำสั่งแยก
        const MAX_BAND = 255; // เส้นสูงสุดต่อหนึ่งคำสั่ง GS v 0
        const segs = [];
        let y = 0;
        while (y < H) {
          if (blank[y]) {
            let n = 0;
            while (y + n < H && blank[y + n]) n++;
            if (n >= MIN_GAP) { segs.push({ feed: n }); y += n; continue; }
          }
          const start = y;
          while (y < H && (y - start) < MAX_BAND) {
            if (!blank[y]) { y++; continue; }
            let n = 0;
            while (y + n < H && blank[y + n]) n++;
            if (n >= MIN_GAP) break;
            y += n;
          }
          segs.push({ from: start, rows: y - start });
        }

        const out = [];
        for (const s of segs) {
          if (s.feed) {
            // พิมพ์ช่องว่างเป็นแถวขาวจริง (ESC J ของเครื่องพิมพ์บางรุ่นเลื่อนกระดาษไม่ตรง ทำให้บรรทัดชิดกัน)
            let n = s.feed;
            while (n > 0) {
              const k = Math.min(MAX_BAND, n);
              out.push(this.GS, 0x76, 0x30, 0x00,
                       bpr & 0xFF, (bpr >> 8) & 0xFF,
                       k & 0xFF, (k >> 8) & 0xFF);
              for (let i = 0; i < k * bpr; i++) out.push(0);
              n -= k;
            }
            continue;
          }
          out.push(this.GS, 0x76, 0x30, 0x00,
                   bpr & 0xFF, (bpr >> 8) & 0xFF,
                   s.rows & 0xFF, (s.rows >> 8) & 0xFF);
          const to = (s.from + s.rows) * bpr;
          for (let i = s.from * bpr; i < to; i++) out.push(data[i]);
        }
        return out;
      },

      // ─── ส่งเอกสาร (วาดเป็นรูป) ไปเครื่องพิมพ์ ───
      async docToBytes(doc) {
        const url = await ReceiptImage.toDataURL(doc);
        return [
          ...this.initPrinter(),
          ...this.leftAlign(),
          ...(await this.imageBytes(url, doc.width)),
          ...this.feedLines(2),
          ...this.cutPaper()
        ];
      },

      // ─── สร้างใบเสร็จ ───
      async buildReceipt(order, queueStr, settings) {
        const R = ReceiptImage;
        const doc = R.newDoc(settings.paperSize);
        const S = doc.base;
        const small = Math.round(S * 0.86);
        const q = queueStr || order.queue || '';
        const money = n => Number(n || 0).toFixed(2);
        const p2 = n => (n < 10 ? '0' + n : String(n));
        const dt = new Date(order.timestamp);
        const dateStr = p2(dt.getDate()) + '/' + p2(dt.getMonth() + 1) + '/' + dt.getFullYear();
        const timeStr = p2(dt.getHours()) + ':' + p2(dt.getMinutes());

        // ── เลขคิวตัวใหญ่บนสุด ──
        if (settings.showQueue && q) {
          R.text(doc, 'Queue no.', { size: small, align: 'center' });
          R.text(doc, q, { size: Math.round(S * 1.9), bold: true, align: 'center' });
          R.rule(doc);
          R.gap(doc, 6);
        }

        // ── โลโก้ ──
        if (settings.logoBase64 && settings.showLogo !== false) {
          try { R.image(doc, await R.loadImage(settings.logoBase64), Math.round(doc.width * 0.45)); }
          catch (e) { console.warn('โหลดโลโก้ไม่สำเร็จ', e); }
        }

        // ── ข้อมูลร้าน ──
        if (settings.showHeader !== false) R.text(doc, settings.header || 'Pukfu Coffee', { size: Math.round(S * 1.35), bold: true, align: 'center' });
        if (settings.branch && settings.showBranch !== false)   R.text(doc, settings.branch, { size: small, align: 'center' });
        if (settings.company && settings.showCompany !== false)  R.text(doc, settings.company, { size: small, align: 'center' });
        if (settings.branchNo && settings.showBranchNo !== false) R.text(doc, 'No. Branch: ' + settings.branchNo, { size: small, align: 'center' });
        if (settings.address && settings.showAddress !== false)  R.text(doc, settings.address, { size: small, align: 'center' });
        if (settings.taxId && settings.showTaxId !== false)    R.text(doc, 'TAX ID: ' + settings.taxId, { size: small, align: 'center' });
        if (settings.phone && settings.showPhone !== false)    R.text(doc, 'Tel: ' + settings.phone, { size: small, align: 'center' });

        // ── หัวเอกสาร ──
        R.gap(doc, 10);
        if (settings.showDocTitle !== false) R.text(doc, settings.docTitle || 'Receipt / TAX Invoice (ABB)', { size: Math.round(S * 1.05), bold: true, align: 'center' });
        if (settings.vatEnabled) R.text(doc, 'VAT Included', { size: Math.round(S * 1.05), bold: true, align: 'center' });
        R.rule(doc);

        // ── ข้อมูลบิล ──
        if (settings.posId && settings.showPosId !== false) R.text(doc, 'POS ID: ' + settings.posId, { size: small });
        if (settings.showInvoiceNo !== false) R.text(doc, 'NO.: ' + order.invoice, { size: small });
        if (q) R.text(doc, 'Queue: ' + q, { size: small });
        if (order.cashier && settings.showStaff !== false) R.text(doc, 'Staff: ' + order.cashier, { size: small });
        if (settings.showDateTime !== false) R.lr(doc, 'Date: ' + dateStr, 'Time: ' + timeStr, { size: small });
        R.rule(doc);

        // ── รายการสินค้า ──
        order.items.forEach(item => {
          if (doc._hasItem) R.gap(doc, 17);
          doc._hasItem = true;
          R.row3(doc, item.qty, item.name, money(item.price * item.qty), { size: small, bold: true });
          if (item.note && settings.showItemNote !== false) R.text(doc, item.note, { size: Math.round(S * 0.8), indent: Math.round(S * 1.7) });
        });
        R.rule(doc);

        // ── สรุปยอด ──
        const count = order.items.reduce((s, i) => s + Number(i.qty || 0), 0);
        const subtotal = order.subtotal || (order.total + (order.discount || 0));
        if (settings.showSummary !== false) R.text(doc, 'Items: ' + count, { size: small });
        if (settings.showSummary !== false) R.lr(doc, 'Subtotal:', money(subtotal), { size: small, indent: Math.round(doc.width * 0.35) });
        if (order.discount && order.discount > 0) {
          R.lr(doc, 'Discount:', order.discountLabel || ('-' + money(order.discount)), { size: small, indent: Math.round(doc.width * 0.35) });
        }
        if (settings.vatEnabled) {
          const vat = calcVatBreakdown(order.total, settings.vatRate);
          R.lr(doc, 'Before VAT:', money(vat.exVat), { size: small, indent: Math.round(doc.width * 0.35) });
          R.lr(doc, 'VAT ' + vat.rate + '%:', money(vat.vatAmount), { size: small, indent: Math.round(doc.width * 0.35) });
        }
        R.gap(doc, 10);
        R.lr(doc, 'Total:', money(order.total), { size: Math.round(S * 1.1), bold: true, indent: Math.round(doc.width * 0.32) });
        R.rule(doc);

        // ── วิธีชำระเงิน ──
        if (settings.showPayment !== false) R.lr(doc, order.paymentType || '-', money(order.total), { size: small });
        if (order.cashReceived && settings.showPayment !== false) {
          R.lr(doc, 'Received:', money(order.cashReceived), { size: small });
          R.lr(doc, 'Change:', money(order.changeAmount || 0), { size: small });
        }
        R.rule(doc);

        // ── ข้อความท้ายใบเสร็จ ──
        R.gap(doc, 6);
        if (settings.showFooter !== false) R.text(doc, settings.footer || 'Thank You', { size: small, align: 'center' });
        return await this.docToBytes(doc);
      },
      // ─── สร้างใบสั่งทำ (Order Slip) ───
      async buildOrderSlip(order, queueStr, settings) {
        const R = ReceiptImage;
        const doc = R.newDoc(settings && settings.paperSize);
        const S = doc.base;

        // ใบนี้ไว้ให้บาริสต้า/ครัวดูอย่างเดียว ไม่ใช่ใบให้ลูกค้า เลยลดขนาดกว่าใบเสร็จได้อีก
        // (ลดข้อมูลที่ต้องส่งผ่าน Bluetooth โดยไม่กระทบใบเสร็จลูกค้า) แต่คงเลขคิวไว้ใหญ่พอเห็นชัด
        if (queueStr) R.text(doc, queueStr, { size: Math.round(S * 1.8), bold: true, align: 'center' });
        R.rule(doc);

        order.items.forEach(item => {
          // ใช้ขนาดตัวอักษรเดียวกับรายการสินค้าในใบเสร็จ (S * 0.86) ให้สม่ำเสมอกัน
          R.text(doc, '- ' + item.qty + 'x ' + item.name, { size: Math.round(S * 0.86), bold: true });
          if (item.note) R.text(doc, '    ' + item.note, { size: Math.round(S * 0.8) });
        });

        R.rule(doc);
        R.text(doc, new Date(order.timestamp).toLocaleString('th-TH'), { size: Math.round(S * 0.75), align: 'center' });
        R.text(doc, 'บิล: ' + order.invoice, { size: Math.round(S * 0.75), align: 'center' });
        return await this.docToBytes(doc);
      },

      // ─── หน้าทดสอบ ───
      async buildTestPage(settings) {
        const R = ReceiptImage;
        const doc = R.newDoc(settings && settings.paperSize);
        const S = doc.base;

        R.text(doc, 'TEST PRINT', { size: Math.round(S * 1.6), bold: true, align: 'center' });
        R.text(doc, 'ทดสอบภาษาไทย ก-ฮ สระอำ ไม้เอก', { size: S, align: 'center' });
        R.text(doc, 'ปุ๊กฟู่ กาแฟ ๑๒๓๔๕๖๗๘๙๐', { size: S, align: 'center' });
        R.text(doc, 'Pukfu Coffee POS', { size: S, align: 'center' });
        R.rule(doc);
        R.lr(doc, 'ชาไทย', '45', { size: S });
        R.lr(doc, 'อเมริกาโน่เย็น', '55', { size: S });
        R.lr(doc, 'รวม', '100 บาท', { size: Math.round(S * 1.2), bold: true });
        R.rule(doc);
        R.text(doc, 'พร้อมใช้งาน', { size: S, align: 'center' });
        R.text(doc, new Date().toLocaleString('th-TH'), { size: Math.round(S * 0.85), align: 'center' });
        return await this.docToBytes(doc);
      },

      // ─── สั่งพิมพ์หลัก ───
      // kitchenPeer: เครื่องพิมพ์ครัวแยกต่างหาก (ถ้าเชื่อมต่ออยู่ ใบสั่งครัวจะไปออกที่นั่นแทน)
      // ถ้าไม่ได้เชื่อมต่อ หรือไม่ได้ส่งมา จะ fallback มาออกเครื่องเดียวกับใบเสร็จเหมือนเดิม
      async printReceipt(order, queueStr, settings, kitchenPeer) {
        await this.sendData(await this.buildReceipt(order, queueStr, settings));
        if (settings.printOrderSlip) {
          const target = (kitchenPeer && kitchenPeer.isConnected) ? kitchenPeer : this;
          await new Promise(r => setTimeout(r, 50));
          await target.sendData(await target.buildOrderSlip(order, queueStr, settings));
        }
      },

      async printTest(settings) {
        await this.sendData(await this.buildTestPage(settings));
      }
      };
    }
    const ReceiptPrinter = createPrinterConnection();
    const KitchenPrinter = createPrinterConnection();
    
    const Controller = {
      employees: [], // cache รายชื่อพนักงาน+PIN สำหรับเช็คสิทธิ์เข้า Settings แบบออฟไลน์
      menuData: [],
      categories: ['All'],    // เก็บรายชื่อหมวดหมู่
      activeCategory: 'All',  // หมวดหมู่ที่กำลังเลือกอยู่
      cart: [],
      syncQueue: [],
      isSyncing: false,
      accessLogQueue: [],
      isLogSyncing: false,
      
      history: [],          // ประวัติที่เก็บในเครื่อง (รวมบิลที่ยังไม่ได้ซิงก์)
      serverHistory: [],    // ประวัติบิลจากส่วนกลาง
      
      soldOutItems: [],
      isStockMode: false,

      isCartOpenMobile: false, // สถานะว่าตะกร้าเปิดอยู่ไหม

      toggleMobileCart(forceOpen) {
        if (window.innerWidth >= 1024) return; // ถ้าเป็นจอคอมพิวเตอร์ให้ข้ามฟังก์ชันนี้ไป

        this.isCartOpenMobile = forceOpen !== undefined ? forceOpen : !this.isCartOpenMobile;
        const container = document.getElementById('cart-container');
        const icon = document.getElementById('cart-toggle-icon');
        container.style.height = ''; // ล้างความสูงที่ตั้งเองไว้ระหว่างลาก (ถ้ามี) ให้คลาสด้านล่างคุมความสูงแทน

        if (this.isCartOpenMobile) {
          container.classList.remove('h-[72px]');
          container.classList.add('h-[65vh]'); // ดึงตะกร้าขึ้นมา 65% ของหน้าจอ
          icon.innerText = '▼';
        } else {
          container.classList.remove('h-[65vh]');
          container.classList.add('h-[72px]'); // พับเก็บเหลือ 72px
          icon.innerText = '▲';
        }
      },

      // ลากแถบหัวตะกร้าขึ้น/ลงเพื่อกาง/พับตะกร้าบนมือถือ (แตะเฉยๆ ไม่ลาก ยังคงพับ/กางผ่าน onclick เดิมตามปกติ)
      initCartDrag() {
        const header = document.getElementById('cart-mobile-header');
        const container = document.getElementById('cart-container');
        if (!header || !container || header.dataset.dragInit) return;
        header.dataset.dragInit = '1';

        let startY = 0, startHeight = 0, dragging = false, moved = false;
        const minH = 72;
        const maxH = () => window.innerHeight * 0.65;

        header.addEventListener('touchstart', (e) => {
          if (window.innerWidth >= 1024) return;
          startY = e.touches[0].clientY;
          startHeight = container.getBoundingClientRect().height;
          dragging = true;
          moved = false;
          container.style.transition = 'none';
          // เอาคลาส h-[72px]/h-[65vh] ออกชั่วคราว (มี !important ใน style.css) จะได้กำหนดความสูงเองผ่าน inline style ตอนลากได้
          container.classList.remove('h-[72px]', 'h-[65vh]');
          container.style.height = startHeight + 'px';
        }, { passive: true });

        header.addEventListener('touchmove', (e) => {
          if (!dragging) return;
          const dy = startY - e.touches[0].clientY; // ลากขึ้น = บวก
          if (Math.abs(dy) > 8) moved = true;
          if (!moved) return;
          e.preventDefault();
          const h = Math.min(maxH(), Math.max(minH, startHeight + dy));
          container.style.height = h + 'px';
        }, { passive: false });

        header.addEventListener('touchend', (e) => {
          if (!dragging) return;
          dragging = false;
          container.style.transition = '';
          if (!moved) return; // แค่แตะเฉยๆ ปล่อยให้ click ที่ตามมาสลับสถานะตามปกติ
          e.preventDefault(); // กัน click สังเคราะห์ที่ตามมาสลับสถานะซ้ำ
          const finalH = container.getBoundingClientRect().height;
          const mid = (minH + maxH()) / 2;
          this.toggleMobileCart(finalH > mid);
        }, { passive: false });
      },

      paymentMode: 'QR',
      cashInput: '0',
      activeProduct: null,
      addons: [],
      sweetnessLevels: [],
      selectedAddons: [],
      editingCartIndex: null,
      paymentMethods: [],
      currentPaymentMethodId: null,
      pinBuffer: '',
      loggedInEmployee: null,
      autoLockTimer: null,
      autoLockMinutes: 10, // ล็อกอัตโนมัติเมื่อไม่มีการใช้งานกี่นาที (ตั้งค่าได้ในหน้า Settings)
      cupCount: 0,
      serverCupCount: 0,    // ยอดรวมแก้วจากส่วนกลาง
      heldOrders: [], // ระบบพักบิล
      productSearchQuery: '',
      inventorySearchQuery: '',
      recipes: [], // สูตร: {id, menu_sku, inventory_item_id, qty}

      queueNumber: 1,       // เลขคิวของวัน
      receiptSettings: {
        header: 'Pukfu Coffee',
        footer: 'Thank You',
        autoPrint: true,
        showQueue: true,
        printOrderSlip: false,
        paperSize: '80mm'
      },
      shopInfo: { address: '', phone: '', taxId: '', vatEnabled: false, vatRate: 7 },
      checkoutDiscount: 0,
      checkoutDiscountRaw: 0,
      discountMode: 'baht',

      checkAndClearDailyCache() {
        // ดึงวันที่ของวันนี้มา
        const today = new Date().toLocaleDateString();
        // ดึงวันที่ ที่ระบบเคยล้างแคชครั้งล่าสุดมา
        const lastClearDate = localStorage.getItem('pos_lastClearDate');
        
        // ถ้าวันที่เปลี่ยนไป (แปลว่าข้ามเที่ยงคืนมาแล้ว)
        if (lastClearDate !== today) {
           //  ต้องเช็คว่า "ไม่มี" บิลค้าง Sync อยู่ (คิวเป็น 0) ถึงจะอนุญาตให้ลบได้
           if (this.syncQueue.length === 0) {
             this.history = []; // ล้างประวัติในแอป
             this.heldOrders = [];
             this.queueNumber = 1; // รีเซ็ตคิว
             localStorage.setItem('pos_history', JSON.stringify([]));
             localStorage.setItem('pos_heldOrders', JSON.stringify([]));
             localStorage.setItem('pos_queueNumber', this.queueNumber);
             
             // จดจำไว้ว่าของวันนี้ถูกล้างไปแล้ว จะได้ไม่ลบซ้ำอีกในวันเดียวกัน
             localStorage.setItem('pos_lastClearDate', today); 
             
             if (typeof this.renderHistory === 'function') {
               this.renderHistory(); // อัปเดตหน้าจอให้ว่างเปล่า
             }
           }
        }
      },

      fetchServerData(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.serverHistory = data.history || [];
            this.serverCupCount = data.cupCount || 0;
            
            this.history = this.serverHistory;
            localStorage.setItem('pos_history', JSON.stringify(this.history));
            localStorage.setItem('pos_serverCupCount', this.serverCupCount);
            localStorage.setItem('pos_serverCupDate', new Date().toLocaleDateString());
            this.renderHistory();
            this.updateCupUI();
          })
          .withFailureHandler(err => {
            this.setBtnLoading(btn, false);
            console.warn("ไม่สามารถดึงข้อมูลส่วนกลางได้ (Offline)");
          })
          .getTodayPOSData();
      },

      init() {
        this.employees = JSON.parse(localStorage.getItem('pos_employees')) || [];
        const savedLockMin = localStorage.getItem('pos_autoLockMinutes');
        if (savedLockMin !== null) this.autoLockMinutes = Number(savedLockMin);
        ReceiptImage.ensureFont(); // พรีโหลดฟอนต์ไทยล่วงหน้า บิลแรกจะพิมพ์ได้ไวขึ้น
        this.initPinLock();
        this.startAutoLockWatcher();
        this.initCartDrag();
        this.checkIosInstallBanner();

        this.switchView('pos'); // ตั้งต้นให้แสดงหน้า POS
        this.checkAndClearDailyCache();
        this.setIndicator('syncing');
        this.showLoading();
        // กันสไปเนอร์ค้างตลอดไปกรณีมีอะไรพลาดไปที่ไม่คาดคิด (ปกติ hideLoading จะถูกเรียกไวกว่านี้จาก refreshFromServer)
        setTimeout(() => this.hideLoading(), 20000);

        this.syncQueue = JSON.parse(localStorage.getItem('pos_syncQueue')) || [];
        this.queueNumber = parseInt(localStorage.getItem('pos_queueNumber')) || 1;
        
        const savedReceiptSettings = localStorage.getItem('pos_receiptSettings');
        if (savedReceiptSettings) {
          this.receiptSettings = { ...this.receiptSettings, ...JSON.parse(savedReceiptSettings) };
        }
        
        // โหลดประวัติและยอดแก้วจากเครื่อง (กรณีเปิดมาตอนเน็ตหลุด)
        const savedDate = localStorage.getItem('pos_serverCupDate');
        const today = new Date().toLocaleDateString();
        if (savedDate === today) {
          this.history = JSON.parse(localStorage.getItem('pos_history')) || [];
          this.serverCupCount = parseInt(localStorage.getItem('pos_serverCupCount')) || 0;
        } else {
          this.history = [];
          this.serverCupCount = 0;
          localStorage.setItem('pos_history', '[]');
          localStorage.setItem('pos_serverCupCount', '0');
          localStorage.setItem('pos_serverCupDate', today);
        }

        this.heldOrders = JSON.parse(localStorage.getItem('pos_heldOrders')) || [];
        this.updateSyncQueueBadge();
        this.accessLogQueue = JSON.parse(localStorage.getItem('pos_accessLogQueue')) || [];
        this.soldOutItems = JSON.parse(localStorage.getItem('pos_soldOut')) || [];
        this.menuData = JSON.parse(localStorage.getItem('pos_menuData')) || [];
        this.addons = JSON.parse(localStorage.getItem('pos_addons')) || [];
        this.sweetnessLevels = JSON.parse(localStorage.getItem('pos_sweetnessLevels')) || [];
        this.paymentMethods = JSON.parse(localStorage.getItem('pos_paymentMethods')) || [];
        this.inventoryData = JSON.parse(localStorage.getItem('pos_inventoryData')) || [];
        this.notifications = JSON.parse(localStorage.getItem('pos_notifications')) || [];
        this.recipes = JSON.parse(localStorage.getItem('pos_recipes')) || [];
        this.shopInfo = JSON.parse(localStorage.getItem('pos_shopInfo')) || { address: '', phone: '', taxId: '', vatEnabled: false, vatRate: 7 };

        // แสดงข้อมูลที่แคชไว้ในเครื่องก่อน ระหว่างรอข้อมูลใหม่จากเซิร์ฟเวอร์
        this.checkNotifications();
        this.renderHistory();
        if (this.menuData.length > 0) {
          this.extractCategories();
        }

        // สั่งดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์ทันที
        this.refreshFromServer();
      },

      // แสดงแถบแนะนำ "เพิ่มไปยังหน้าจอโฮม" เฉพาะ iOS Safari ที่ยังไม่ได้ติดตั้งเป็นแอป
      // (iOS ไม่รองรับ install prompt อัตโนมัติแบบ Android/Chrome ต้องแนะนำให้ผู้ใช้กดเองผ่านปุ่มแชร์)
      checkIosInstallBanner() {
        if (localStorage.getItem('pos_iosInstallBannerDismissed') === '1') return;
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
        const isStandalone = window.navigator.standalone === true;
        if (isIOS && isSafari && !isStandalone) {
          const banner = document.getElementById('ios-install-banner');
          if (banner) banner.classList.remove('hidden');
        }
      },

      dismissIosInstallBanner() {
        localStorage.setItem('pos_iosInstallBannerDismissed', '1');
        const banner = document.getElementById('ios-install-banner');
        if (banner) banner.classList.add('hidden');
      },

      // เช็คว่ามีเวอร์ชันใหม่ deploy ขึ้นมาหรือยัง โดยดู ETag ของ app.js เทียบกับตอนเปิดแอปครั้งนี้
      // ใส่ query string กันไทม์ให้ fetch นี้ไม่โดน service worker คืนค่าที่ cache ไว้ (ต้องยิงเน็ตจริงถึงจะรู้ค่าล่าสุด)
      // ไม่ auto-reload เอง เพราะตะกร้าปัจจุบันยังไม่ได้ persist ไว้ที่ไหน เผลอ reload กลางคันจะเสียรายการที่พิมพ์ค้างอยู่
      async checkForAppUpdate() {
        if (this._updateAvailable) return; // แจ้งไปแล้วรอบหนึ่งพอ ไม่ต้องเช็คซ้ำ
        try {
          const res = await fetch('app.js?_=' + Date.now(), { cache: 'no-store' });
          const tag = res.headers.get('etag') || res.headers.get('last-modified');
          if (!tag) return;
          if (this._appVersionTag === undefined || this._appVersionTag === null) {
            this._appVersionTag = tag; // ครั้งแรกที่เช็ค ใช้เป็นค่าฐานไว้เทียบ ไม่ถือว่าเป็นอัปเดต
            return;
          }
          if (tag !== this._appVersionTag) {
            this._updateAvailable = true;
            const banner = document.getElementById('app-update-banner');
            if (banner) banner.classList.remove('hidden');
          }
        } catch (e) {
          // ออฟไลน์หรือเน็ตมีปัญหา ข้ามไปเช็ครอบหน้า
        }
      },

      async applyAppUpdate() {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) { /* ล้าง cache ไม่สำเร็จก็ยัง reload ต่อได้ แค่ช้ากว่าปกติ */ }
        location.reload();
      },

      // ดึงข้อมูลทั้งหมดจากเซิร์ฟเวอร์ใหม่ (เมนู/พนักงาน/add-ons/วิธีชำระเงิน/ข้อมูลร้าน/ประวัติออเดอร์)
      // เรียกครั้งแรกตอนเปิดแอปใน init(), และเรียกซ้ำตอนกลับมาเปิดแอป/แท็บอีกครั้ง (ดู startOfflineSyncWatcher)
      refreshFromServer() {
        this.fetchServerData();

        // เช็คว่าเรียกครบทุกตัวหรือยัง (settle) ค่อยซ่อน loading overlay
        // กันสไปเนอร์ค้างตลอดไปถ้ามีแค่ตัวเดียวค้าง/ไม่ตอบ (ก่อนหน้านี้ผูกไว้กับ getMenuData ตัวเดียว)
        this._refreshPending = new Set(['employees', 'addons', 'sweetness', 'payment', 'inventory', 'notifications', 'recipes', 'shopInfo', 'menu']);
        this._refreshHadFailure = false;
        const settle = (key) => {
          this._refreshPending.delete(key);
          if (this._refreshPending.size === 0) this.hideLoading();
        };

        google.script.run
          .withSuccessHandler(data => {
            this.employees = data;
            localStorage.setItem('pos_employees', JSON.stringify(data));
            if (!this.loggedInEmployee) this.initPinLock();
            settle('employees');
          })
          .withFailureHandler(() => { console.warn("ใช้รายชื่อพนักงานที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('employees'); })
          .getEmployeesForCache();

        google.script.run
          .withSuccessHandler(data => {
            this.addons = data;
            localStorage.setItem('pos_addons', JSON.stringify(data));
            settle('addons');
          })
          .withFailureHandler(() => { console.warn("ใช้รายการ Add-ons ที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('addons'); })
          .getAddons();

        google.script.run
          .withSuccessHandler(data => {
            this.sweetnessLevels = data;
            localStorage.setItem('pos_sweetnessLevels', JSON.stringify(data));
            this.updateSweetnessButtons();
            settle('sweetness');
          })
          .withFailureHandler(() => { console.warn("ใช้รายการระดับความหวานที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('sweetness'); })
          .getSweetnessLevels();

        google.script.run
          .withSuccessHandler(data => {
            this.paymentMethods = data;
            localStorage.setItem('pos_paymentMethods', JSON.stringify(data));
            settle('payment');
          })
          .withFailureHandler(() => { console.warn("ใช้วิธีชำระเงินที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('payment'); })
          .getPaymentMethods();

        google.script.run
          .withSuccessHandler(data => {
            this.inventoryData = data;
            localStorage.setItem('pos_inventoryData', JSON.stringify(data));
            this.renderInventory();
            settle('inventory');
          })
          .withFailureHandler(() => { console.warn("ใช้ข้อมูลสต๊อกที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('inventory'); })
          .getInventoryData();

        google.script.run
          .withSuccessHandler(data => {
            this.notifications = data;
            localStorage.setItem('pos_notifications', JSON.stringify(data));
            this.renderNotificationList();
            this.checkNotifications();
            settle('notifications');
          })
          .withFailureHandler(() => { console.warn("ใช้รายการแจ้งเตือนที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('notifications'); })
          .getNotifications();

        google.script.run
          .withSuccessHandler(data => {
            this.recipes = data;
            localStorage.setItem('pos_recipes', JSON.stringify(data));
            settle('recipes');
          })
          .withFailureHandler(() => { console.warn("ใช้สูตรที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('recipes'); })
          .getRecipes();

        google.script.run
          .withSuccessHandler(data => {
            // Worker เก็บ shop_info เป็น key-value แบบ TEXT ทุกค่าที่ได้กลับมาจึงเป็น string เสมอ
            // (String(false) === "false" ซึ่งเป็น truthy ใน JS) ต้องแปลงกลับเป็น boolean/number เอง
            // ไม่งั้น vatEnabled จะเป็นจริงเสมอไม่ว่าจะติ๊กหรือไม่ก็ตาม
            data.vatEnabled = (data.vatEnabled === true || data.vatEnabled === 'true');
            data.vatRate = Number(data.vatRate) || 7;
            this.shopInfo = data;
            localStorage.setItem('pos_shopInfo', JSON.stringify(data));

            // ดึงการตั้งค่าเครื่องพิมพ์ที่ซิงก์มาจาก shop_info ก้อนเดียวกัน (ไม่มีตารางแยก เก็บรวมกันไว้)
            // merge ทับของเดิมในเครื่อง ไม่ replace ทั้งก้อน กันกรณีเครื่องนี้ยังไม่เคยซิงก์ค่าพวกนี้ขึ้นไปเลย
            const rsBoolKeys = ['autoPrint', 'showQueue', 'printOrderSlip', 'showLogo', 'showHeader', 'showBranch', 'showCompany', 'showBranchNo', 'showAddress', 'showTaxId', 'showPhone', 'showDocTitle', 'showPosId', 'showInvoiceNo', 'showStaff', 'showDateTime', 'showItemNote', 'showSummary', 'showPayment', 'showFooter'];
            const rsStrKeys = ['header', 'footer', 'branch', 'company', 'branchNo', 'posId', 'docTitle', 'paperSize', 'logoBase64'];
            const syncedReceiptSettings = {};
            rsStrKeys.forEach(k => { if (data[k] !== undefined) syncedReceiptSettings[k] = data[k]; });
            rsBoolKeys.forEach(k => { if (data[k] !== undefined) syncedReceiptSettings[k] = (data[k] === true || data[k] === 'true'); });
            this.receiptSettings = { ...this.receiptSettings, ...syncedReceiptSettings };
            if (this.receiptSettings.logoBase64) this.regenerateLogoRaster();
            localStorage.setItem('pos_receiptSettings', JSON.stringify(this.receiptSettings));

            settle('shopInfo');
          })
          .withFailureHandler(() => { console.warn("ใช้ข้อมูลร้านที่เซฟไว้ในเครื่อง (ออฟไลน์)"); this._refreshHadFailure = true; settle('shopInfo'); })
          .getShopInfo();

        google.script.run
          .withSuccessHandler(data => {
            this.menuData = data;
            localStorage.setItem('pos_menuData', JSON.stringify(data));

            //  ซิงก์ข้อมูลของหมดจาก Google Sheet มาอัปเดตใส่หน้าจอ
            this.soldOutItems = data.filter(item => item.isSoldOut).map(item => item.name);
            localStorage.setItem('pos_soldOut', JSON.stringify(this.soldOutItems));

            this.extractCategories(); // ดึงหมวดหมู่ใหม่หลังได้ข้อมูลล่าสุด
            this.setIndicator('synced');
            this.processSyncQueue();
            settle('menu');
          })
          .withFailureHandler(err => {
            console.warn("Offline Mode: ใช้ข้อมูลเมนูที่เซฟไว้ในเครื่อง");
            this.setIndicator('error');
            if (this.menuData.length === 0) {
              this.showAlert("ไม่สามารถดึงข้อมูลเมนูได้ และไม่มีข้อมูลเก่าอยู่ในเครื่อง กรุณาต่ออินเทอร์เน็ต", '');
            }
            this._refreshHadFailure = true;
            settle('menu');
          })
          .getMenuData();
        this.floatCashQueue = JSON.parse(localStorage.getItem('pos_floatCashQueue')) || [];
        this.processFloatCashQueue();
      },

      //  ดึงรายชื่อหมวดหมู่จากข้อมูลสินค้า
      extractCategories() {
        if (this.menuData.length === 0) return;
        
        // กรองหาชื่อหมวดหมู่ที่ไม่ซ้ำกัน ถ้าสินค้าไม่มี category ให้ตั้งว่า 'อื่นๆ'
        const cats = new Set(this.menuData.map(item => item.category || 'อื่นๆ'));
        
        this.categories = ['All', ...Array.from(cats)];
        document.getElementById('menu-categories').classList.remove('hidden');
        
        this.renderCategories();
        this.renderMenu();
      },

      //  วาดปุ่มหมวดหมู่
      renderCategories() {
        const container = document.getElementById('menu-categories');
        container.innerHTML = this.categories.map(cat => {
          const isActive = cat === this.activeCategory;
          // เปลี่ยนสีปุ่มถ้าถูกเลือกอยู่
          const btnStyle = isActive 
            ? 'bg-gradient-to-b from-primary to-secondary text-white shadow-md shadow-primary/30'
            : 'bg-white text-secondary border border-sand hover:bg-accent';
            
          return `<button onclick="Controller.selectCategory('${cat}')" class="whitespace-nowrap px-5 min-h-[2.75rem] inline-flex items-center justify-center rounded-full font-bold text-sm transition-all active:scale-95 ${btnStyle}">${cat}</button>`;
        }).join('');
        this.initScrollFade('menu-categories');
      },

      //  ฟังก์ชันเมื่อคลิกเลือกหมวดหมู่
      selectCategory(catName) {
        this.activeCategory = catName;
        this.renderCategories(); // อัปเดตสีปุ่ม
        this.renderMenu();       // อัปเดตตารางสินค้า
        const activeBtn = document.querySelector('#menu-categories button.bg-primary');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      },

      //  แถบเลื่อนแนวนอนที่ซ่อน scrollbar ไว้ (หมวดหมู่สินค้า / แท็บ Settings) : คอยอัปเดตเงาบอกใบ้ว่ายังเลื่อนได้อีกไหม
      initScrollFade(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const update = () => {
          el.classList.toggle('at-start', el.scrollLeft <= 2);
          el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
        };
        if (!el.dataset.scrollFadeInit) {
          el.dataset.scrollFadeInit = '1';
          el.addEventListener('scroll', update, { passive: true });
          window.addEventListener('resize', update);
        }
        update();
      },

      toggleStockMode() {
        this.isStockMode = !this.isStockMode;

        if (this.isStockMode) {
          document.getElementById('stock-mode-alert').classList.remove('hidden');
          this.switchView('pos');
        } else {
          document.getElementById('stock-mode-alert').classList.add('hidden');
        }

        this.renderStockPanel();
        this.renderMenu();
      },

      updateCupUI() {
        const offlineCups = this.syncQueue.reduce((sum, order) => {
           if (order.status === 'cancelled' || order.status === 'waste') return sum;
           return sum + order.items.reduce((s, i) => s + i.qty, 0);
        }, 0);
        
        const displayCups = this.serverCupCount + offlineCups;
        
        const el = document.getElementById('sum-cups');
        if (el) el.innerText = displayCups;
      },

      // เพิ่มฟังก์ชันสำหรับปุ่ม Reset ยอดแก้ว
      async resetCupCount() {
        const ok = await this.showConfirm('ต้องการรีเซ็ตยอดขายแก้วกลับเป็น 0 ใช่หรือไม่?', '');
        if (ok) {
          this.serverCupCount = 0;
          this.updateCupUI();
          localStorage.setItem('pos_serverCupCount', '0');
          this.showAlert('รีเซ็ตยอดแก้วเรียบร้อยแล้ว', '');
        }
      },

      switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`view-${viewId}`).classList.remove('hidden');
      },

      openModal(id) { document.getElementById(id).classList.remove('hidden'); },
      closeModal(id) { document.getElementById(id).classList.add('hidden'); },
      setIndicator(status) {
        const el = document.getElementById('sync-indicator');
        el.className = 'indicator w-3 h-3 rounded-full shadow-inner';
        el.classList.add(status);
      },
      
      showLoading() {
        const el = document.getElementById('loading-overlay');
        if (el) el.classList.remove('hidden');
      },

      hideLoading() {
        const el = document.getElementById('loading-overlay');
        if (el) el.classList.add('hidden');
      },

      setBtnLoading(btn, isLoading) {
        if (!btn) return;
        if (isLoading) {
          btn.dataset.oldText = btn.innerHTML; // จำข้อความเดิมไว้
          btn.innerHTML = ' Loading...'; // เปลี่ยนข้อความเป็นโหลด
          btn.classList.add('opacity-50', 'pointer-events-none'); // ทำให้ปุ่มจางและกดเบิ้ลไม่ได้
        } else {
          btn.innerHTML = btn.dataset.oldText; // คืนค่าข้อความเดิม
          btn.classList.remove('opacity-50', 'pointer-events-none');
        }
      },

      _alertResolve: null,

      showAlert(message, icon, type) {
        return new Promise(resolve => {
          this._openAlertModal({
            message, type: type || 'info', input: false,
            buttons: [{ label: 'ตกลง', style: 'primary', value: true }]
          });
          this._alertResolve = resolve;
        });
      },

      showConfirm(message, icon) {
        return new Promise(resolve => {
          this._openAlertModal({
            message, type: 'warning', input: false,
            buttons: [
              { label: 'ยกเลิก', style: 'ghost', value: false },
              { label: 'ยืนยัน', style: 'primary', value: true }
            ]
          });
          this._alertResolve = resolve;
        });
      },

      showPrompt(message, opts) {
        opts = opts || {};
        return new Promise(resolve => {
          this._openAlertModal({
            message, type: 'edit', input: true,
            inputType: opts.type || 'text', placeholder: opts.placeholder || '',
            buttons: [
              { label: 'ยกเลิก', style: 'ghost', value: null },
              { label: 'ตกลง', style: 'primary', value: '__INPUT__' }
            ]
          });
          this._alertResolve = resolve;
        });
      },

      // ไอคอนวงกลมสีตามประเภทของ dialog (info=ℹ, warning=คำถาม/ยืนยัน, edit=กรอกข้อมูล)
      // เดิม alert-icon แทบไม่เคยถูกส่งค่ามาจริง (ทุกจุดเรียกส่ง '' เกือบหมด) เลยว่างเปล่าตลอด เปลี่ยนมาผูกกับประเภท dialog แทนให้มีไอคอนเสมอ
      _alertIconVariants: {
        info: { cls: 'bg-sky-100 text-sky-500', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>' },
        warning: { cls: 'bg-amber-100 text-amber-500', svg: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>' },
        edit: { cls: 'bg-primary/15 text-primary', svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>' },
      },

      _openAlertModal(cfg) {
        const iconEl = document.getElementById('alert-icon');
        const variant = this._alertIconVariants[cfg.type] || this._alertIconVariants.info;
        iconEl.className = `w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center ${variant.cls}`;
        iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:1.75rem;height:1.75rem">${variant.svg}</svg>`;
        document.getElementById('alert-message').innerText = cfg.message;
        const inputWrap = document.getElementById('alert-input-wrap');
        const inputEl = document.getElementById('alert-input');

        if (cfg.input) {
          inputWrap.classList.remove('hidden');
          inputEl.value = '';
          inputEl.type = cfg.inputType;
          inputEl.placeholder = cfg.placeholder;
          setTimeout(() => inputEl.focus(), 100);
        } else {
          inputWrap.classList.add('hidden');
        }

        const btnContainer = document.getElementById('alert-buttons');
        btnContainer.innerHTML = '';
        cfg.buttons.forEach(btn => {
          const b = document.createElement('button');
          b.innerText = btn.label;
          b.className = btn.style === 'primary'
            ? 'flex-1 py-2.5 bg-gradient-to-b from-primary to-secondary text-white rounded-xl font-bold hover:brightness-110 transition'
            : 'flex-1 py-2.5 border border-sand bg-white text-slate-500 rounded-xl font-bold hover:bg-accent transition';
          b.onclick = () => {
            const result = btn.value === '__INPUT__' ? inputEl.value : btn.value;
            document.getElementById('modal-alert').classList.add('hidden');
            if (this._alertResolve) { this._alertResolve(result); this._alertResolve = null; }
          };
          btnContainer.appendChild(b);
        });

        document.getElementById('modal-alert').classList.remove('hidden');
      },

      updateSyncQueueBadge() {
        const badge = document.getElementById('sync-queue-badge');
        if (!badge) return;
        const count = this.syncQueue.length;
        if (count > 0) {
          badge.innerText = count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      },

      async showSyncQueueInfo() {
        if (this.syncQueue.length === 0) {
          await this.showAlert('บิลทั้งหมด sync เข้าระบบเรียบร้อยแล้ว', '');
          return;
        }
        const list = this.syncQueue.map(o => `- ${o.invoice} (฿${o.total})`).join('\n');
        const retry = await this.showConfirm(`มี ${this.syncQueue.length} บิลที่ยังไม่ได้ sync เข้า Google Sheet:\n\n${list}\n\nกดยืนยันเพื่อลอง sync ใหม่ตอนนี้`, '');
        if (retry) this.processSyncQueue();
      },

      inventoryData: [], // เก็บข้อมูลสต๊อก
      notifications: [], // เก็บรายการแจ้งเตือนหมดอายุ (แยกจากสต๊อก อ้างอิงวัตถุดิบผ่าน inventory_item_id)
      dismissedNotificationIds: new Set(), // id แจ้งเตือนที่กดปิดไว้ชั่วคราว (เคลียร์เองเมื่อแก้ไขรายการนั้นใหม่)
      _alertedNotificationIds: new Set(), // id ที่เด้ง popup แจ้งไปแล้วในเซสชันนี้ (ทั้งหมดอายุแล้ว/ใกล้หมดอายุ) กันไม่ให้เด้งซ้ำทุกรอบเช็ค (60 วิ/ครั้ง)

      pendingOrders: [], // ออเดอร์ออนไลน์ (สแกน QR) ที่รอพนักงานยืนยัน
      _alertedPendingOrderIds: new Set(), // id ออเดอร์ออนไลน์ที่เด้ง popup แจ้งไปแล้วในเซสชันนี้ กันไม่ให้เด้งซ้ำทุกรอบเช็ค

      fetchInventory(btn) {
        this.setIndicator('syncing');
        this.setBtnLoading(btn, true);
        const list = document.getElementById('inventory-list');
        if (list) list.classList.remove('opacity-50', 'pointer-events-none');
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.inventoryData = data;
            this.renderInventory();
            this.setIndicator('synced');
          })
          .withFailureHandler(() => {
             this.setBtnLoading(btn, false);
             this.showAlert('ไม่สามารถโหลดข้อมูลสต๊อกได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
             this.setIndicator('error');
          })
          .getInventoryData();
      },

      filterInventoryList(q) {
        this.inventorySearchQuery = q;
        this.renderInventory();
      },

      // แตะ chevron เพื่อกาง/พับช่องเบิกออก-เติมเข้าของวัตถุดิบแต่ละชิ้นบนมือถือ (ซ่อนไว้ก่อนให้รายการดูโปร่ง)
      // บนจอคอม (lg+) ช่องพวกนี้กางอยู่ตลอดเป็นคอลัมน์ตาราง ฟังก์ชันนี้เลยไม่ต้องทำอะไร
      toggleInventoryDetail(chevronBtn) {
        const row = chevronBtn.closest('.p-4');
        const detail = row ? row.nextElementSibling : null;
        if (!detail) return;
        detail.classList.toggle('hidden');
        const chevron = chevronBtn.querySelector('.inv-chevron');
        if (chevron) chevron.classList.toggle('rotate-180');
      },

      renderInventory() {
        const list = document.getElementById('inventory-list');
        
        // ปลดล็อกหน้าจอ (เผื่อถูกล็อกไว้ตอนกดเซฟ)
        if(list) list.classList.remove('opacity-50', 'pointer-events-none');

        if (this.inventoryData.length === 0) {
           list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>ยังไม่มีข้อมูลวัตถุดิบ กรุณาเพิ่มข้อมูลในแท็บ Inventory</div>';
           return;
        }

        // เก็บ idx เดิมไว้ (ผูกกับ id ของ input เบิกออก/เติมเข้า ที่ saveAllInventory ใช้อ้างอิง)
        // แม้กรองรายการด้วยช่องค้นหาแล้ว ก็ต้องไม่เปลี่ยนเลข idx ของแต่ละแถว
        const q = (this.inventorySearchQuery || '').trim().toLowerCase();
        const entries = this.inventoryData
          .map((item, idx) => ({ item, idx }))
          .filter(({ item }) => !q || (item.name || '').toLowerCase().includes(q));

        if (entries.length === 0) {
           list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>ไม่พบวัตถุดิบที่ค้นหา</div>';
           return;
        }

        list.innerHTML = entries.map(({ item, idx }) => `
          <div class="border-b border-slate-100 lg:grid lg:items-center lg:gap-3 lg:grid-cols-[1fr_6rem_6rem_6rem_6rem_6rem]">
            <div class="p-4 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors">
              <div class="min-w-0 flex-1 flex items-center flex-wrap gap-x-2 gap-y-1" onclick="event.stopPropagation()">
                ${item.photo ? `<img src="${escHtml(item.photo)}" class="w-8 h-8 rounded-lg object-cover">` : ''}
                <p class="font-bold text-secondary text-lg truncate">${escHtml(item.name)}</p>
                <span id="inv-stock-preview-${idx}" class="lg:hidden text-xs text-slate-400 font-bold">${
                  item.purchase_unit && Number(item.purchase_factor) > 0
                    ? this._formatStockForUnit(item.stock, Number(item.purchase_factor)) + ' ' + escHtml(item.purchase_unit) + ' คงเหลือ'
                    : item.stock + (item.unit ? ' ' + escHtml(item.unit) : '') + ' คงเหลือ'
                }</span>
                <button onclick='Controller.showInventoryItemForm(${JSON.stringify(item).replace(/'/g, "&apos;")})' class="px-2.5 min-h-[2rem] inline-flex items-center justify-center text-xs font-bold text-primary bg-primary/10 rounded-full active:scale-95 transition-all whitespace-nowrap">แก้ไข</button>
                <button onclick="Controller.deleteInventoryItemConfirm('${item.id}')" class="px-2.5 min-h-[2rem] inline-flex items-center justify-center text-xs font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ลบ</button>
                <span id="inv-changed-${idx}" class="lg:hidden hidden text-amber-500 font-bold text-xs whitespace-nowrap">● แก้ไข</span>
                ${item.purchase_unit && Number(item.purchase_factor) > 0 ? `
                  <div class="basis-full mt-1">
                    <span class="text-xs text-slate-400">หน่วยที่ป้อนเบิก/เติม:</span>
                    <select id="inv-unit-toggle-${idx}" onchange="Controller.updateInvRowStockDisplay(${idx})" class="text-xs border border-slate-200 rounded-lg px-1.5 py-0.5 ml-1">
                      <option value="${Number(item.purchase_factor)}" selected>${escHtml(item.purchase_unit)} (1 = ${Number(item.purchase_factor)} ${escHtml(item.unit)})</option>
                      <option value="1">${escHtml(item.unit)}</option>
                    </select>
                  </div>
                ` : ''}
              </div>
              <button onclick="Controller.toggleInventoryDetail(this)" class="lg:hidden shrink-0 w-11 h-11 flex items-center justify-center text-slate-300" aria-label="แสดง/ซ่อนรายละเอียด">
                <svg class="inv-chevron transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.1em;height:1.1em"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>

            <div class="inventory-detail hidden lg:contents">
              <div class="flex items-center justify-between lg:justify-center bg-slate-100 lg:bg-transparent p-2.5 lg:p-0 rounded-xl mx-4 mb-3 lg:mx-0 lg:mb-0">
                <span class="text-xs font-bold text-slate-400 lg:hidden">คงเหลือ</span>
                <span id="inv-stock-display-${idx}" class="font-black text-lg text-secondary">${
                  item.purchase_unit && Number(item.purchase_factor) > 0
                    ? this._formatStockForUnit(item.stock, Number(item.purchase_factor)) + ' ' + escHtml(item.purchase_unit)
                    : item.stock + (item.unit ? ' ' + escHtml(item.unit) : '')
                }</span>
              </div>

              <div class="flex items-center justify-between lg:justify-center bg-red-50 lg:bg-transparent p-3 lg:p-0 rounded-xl mx-4 mb-3 lg:mx-0 lg:mb-0">
                <span class="text-xs font-bold text-red-400 lg:hidden">เบิกออก (<span id="inv-withdraw-unit-${idx}">${escHtml(item.purchase_unit && Number(item.purchase_factor) > 0 ? item.purchase_unit : item.unit)}</span>)</span>
                <input type="number" min="0" id="inv-withdraw-${idx}" value="0" oninput="Controller.markInventoryChanged(${idx})" class="w-20 lg:w-16 min-h-[2.75rem] text-center font-black text-lg border border-slate-200 rounded-lg focus:outline-none focus:border-red-400 bg-white shadow-inner">
              </div>

              <div class="flex items-center justify-between lg:justify-center bg-emerald-50 lg:bg-transparent p-3 lg:p-0 rounded-xl mx-4 mb-3 lg:mx-0 lg:mb-0">
                <span class="text-xs font-bold text-emerald-500 lg:hidden">เติมเข้า (<span id="inv-restock-unit-${idx}">${escHtml(item.purchase_unit && Number(item.purchase_factor) > 0 ? item.purchase_unit : item.unit)}</span>)</span>
                <input type="number" min="0" id="inv-restock-${idx}" value="0" oninput="Controller.markInventoryChanged(${idx})" class="w-20 lg:w-16 min-h-[2.75rem] text-center font-black text-lg border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 bg-white shadow-inner">
              </div>

              <div id="inv-unit-col-${idx}" class="hidden lg:flex text-slate-500 font-bold text-sm items-center justify-center">${escHtml(item.purchase_unit && Number(item.purchase_factor) > 0 ? item.purchase_unit : item.unit)}</div>
              <div class="hidden lg:flex items-center justify-end">
                <span id="inv-changed-${idx}-desktop" class="hidden text-amber-500 font-bold text-xs">● แก้ไข</span>
              </div>
            </div>
          </div>
        `).join('');
      },

      // คืนรายการแจ้งเตือนที่หมดอายุแล้ว/ใกล้หมดอายุ (ไม่รวมที่ปิดแจ้งเตือนไว้ชั่วคราว) ใช้ทั้งเรนเดอร์แบนเนอร์และปุ่มปิดแจ้งเตือน
      _getActiveNotifications() {
        const now = Date.now();
        const twoHoursMs = 2 * 3600 * 1000;
        const expired = [];
        const soon = [];
        (this.notifications || []).forEach(n => {
          if (!n.expires_at) return;
          if (this.dismissedNotificationIds.has(n.id)) return;
          const expiresAt = new Date(n.expires_at).getTime();
          if (isNaN(expiresAt)) return;
          if (expiresAt <= now) expired.push(n);
          else if (expiresAt - now <= twoHoursMs) soon.push(n);
        });
        return { expired, soon };
      },

      dismissNotificationAlert() {
        const { expired, soon } = this._getActiveNotifications();
        [...expired, ...soon].forEach(n => this.dismissedNotificationIds.add(n.id));
        this.checkNotifications();
      },

      // เช็คแจ้งเตือนที่หมดอายุ/ใกล้หมดอายุ อัปเดตแบนเนอร์บนหน้า POS + แท็บ Notifications + จุดแดงบนปุ่มแท็บ
      // เรียกทุกครั้งที่โหลดข้อมูลแจ้งเตือนใหม่ และเป็นระยะระหว่างเปิดแอปทิ้งไว้ (ดู init()/startOfflineSyncWatcher)
      // ใช้ popup เป็นช่องทางแจ้งเตือนหลักช่องทางเดียว (ไม่มีแบนเนอร์ค้างจอแล้ว) เด้งครั้งเดียวต่อรายการต่อเซสชัน ไม่ก่อกวนทุกรอบเช็ค 60 วิ
      checkNotifications() {
        const { expired: expiredList, soon: soonList } = this._getActiveNotifications();

        const count = expiredList.length + soonList.length;
        document.querySelectorAll('.notification-badge').forEach(badge => {
          badge.innerText = count;
          badge.classList.toggle('hidden', count === 0);
        });

        const newlyExpired = expiredList.filter(n => !this._alertedNotificationIds.has(n.id));
        const newlySoon = soonList.filter(n => !this._alertedNotificationIds.has(n.id));
        if (newlyExpired.length > 0 || newlySoon.length > 0) {
          [...newlyExpired, ...newlySoon].forEach(n => this._alertedNotificationIds.add(n.id));
          const parts = [];
          if (newlyExpired.length) parts.push(`หมดอายุแล้ว: ${newlyExpired.map(n => n.item_name).join(', ')}`);
          if (newlySoon.length) parts.push(`ใกล้หมดอายุ: ${newlySoon.map(n => n.item_name).join(', ')}`);
          this.showAlert(parts.join('\n'), '', 'warning');
        }
      },

      checkPendingOrders() {
        google.script.run
          .withSuccessHandler(rows => {
            this.pendingOrders = rows || [];
            const count = this.pendingOrders.length;
            const badge = document.getElementById('pending-order-badge');
            if (badge) {
              badge.innerText = count;
              badge.classList.toggle('hidden', count === 0);
            }
            const newlyArrived = this.pendingOrders.filter(o => !this._alertedPendingOrderIds.has(o.id));
            if (newlyArrived.length > 0) {
              newlyArrived.forEach(o => this._alertedPendingOrderIds.add(o.id));
              this.showAlert(`มีออเดอร์ออนไลน์ใหม่: ${newlyArrived.map(o => o.customerName).join(', ')}`, '', 'warning');
            }
            if (!document.getElementById('modal-pending-orders').classList.contains('hidden')) {
              this.renderPendingOrdersList();
            }
          })
          .withFailureHandler(() => console.warn("เช็คออเดอร์ออนไลน์ไม่สำเร็จ"))
          .getPendingOrders();
      },

      openPendingOrdersModal() {
        this.renderPendingOrdersList();
        this.openModal('modal-pending-orders');
      },

      renderPendingOrdersList() {
        const list = document.getElementById('pending-orders-list');
        if (!list) return;
        if (this.pendingOrders.length === 0) {
          list.innerHTML = '<div class="text-center text-slate-400 font-bold py-8">ไม่มีออเดอร์ออนไลน์รอยืนยัน</div>';
          return;
        }
        list.innerHTML = this.pendingOrders.map((o, idx) => {
          const time = o.createdAt ? new Date(o.createdAt).toLocaleString('th-TH') : '';
          const itemsSummary = (o.items || []).map(i => `${i.qty}x ${i.name}`).join(', ');
          const slipHtml = o.paymentSlipImage
            ? `<button onclick="Controller.viewPendingOrderSlip(${idx})" class="flex items-center gap-2 mb-2 active:scale-95 transition-all">
                <img src="${o.paymentSlipImage}" class="w-20 h-20 object-cover rounded-lg border border-sand" alt="สลิปโอนเงิน">
                <span class="text-xs text-primary font-bold underline">แตะเพื่อดูสลิปเต็มจอ</span>
              </button>`
            : `<p class="text-xs text-amber-500 font-bold mb-2">ยังไม่ได้แนบสลิปโอนเงิน</p>`;
          return `
            <div class="py-4">
              <div class="flex justify-between items-start gap-3 mb-2">
                <div class="min-w-0">
                  <p class="font-bold text-secondary truncate">${escHtml(o.customerName)}${o.location ? ' · ' + escHtml(o.location) : ''}</p>
                  <p class="text-xs text-slate-400">${escHtml(time)}</p>
                </div>
                <p class="font-black text-primary shrink-0">฿${Number(o.total).toFixed(2)}</p>
              </div>
              <p class="text-sm text-slate-500 mb-2">${escHtml(itemsSummary)}</p>
              ${slipHtml}
              <div class="flex gap-2">
                <button onclick="Controller.rejectPendingOrderAction(${idx})" class="flex-1 bg-red-50 text-red-400 px-3 py-2 rounded-lg font-bold text-sm hover:bg-red-400 hover:text-white transition-all">ปฏิเสธ</button>
                <button onclick="Controller.confirmPendingOrderAction(${idx})" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white px-3 py-2 rounded-lg font-bold text-sm active:scale-95 transition-all">ยืนยันออเดอร์</button>
              </div>
            </div>
          `;
        }).join('');
      },

      // เดิมใช้ window.open() เปิดแท็บใหม่ แต่ใช้งานไม่ได้แน่นอนตอนแอปติดตั้งเป็น PWA แบบ standalone (ไม่มีแท็บให้เปิด)
      // เปลี่ยนมาแสดงรูปเต็มจอในหน้าเดิมแทน ใช้ได้ทุกโหมดรวมถึง standalone
      viewPendingOrderSlip(idx) {
        const o = this.pendingOrders[idx];
        if (!o || !o.paymentSlipImage) return;
        document.getElementById('slip-view-image').src = o.paymentSlipImage;
        this.openModal('modal-slip-view');
      },

      async confirmPendingOrderAction(idx) {
        const o = this.pendingOrders[idx];
        if (!o) return;
        const ok = await this.showConfirm(`ยืนยันออเดอร์ของ ${o.customerName}${o.location ? ' (' + o.location + ')' : ''} ยอด ฿${Number(o.total).toFixed(2)} ใช่หรือไม่?`, '');
        if (!ok) return;
        const userName = this.loggedInEmployee ? this.loggedInEmployee.name : 'พนักงาน';
        this.showLoading();
        google.script.run
          .withSuccessHandler(res => {
            this.hideLoading();
            if (!res.success) return this.showAlert(res.error || 'ยืนยันออเดอร์ไม่สำเร็จ', '');
            this.pendingOrders = this.pendingOrders.filter(p => p.id !== o.id);
            this.renderPendingOrdersList();
            this.checkPendingOrders();
            this.refreshFromServer();
            this.showAlert('ยืนยันออเดอร์เรียบร้อยแล้ว บันทึกเข้าระบบขายแล้ว', '');
          })
          .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่', ''); })
          .confirmPendingOrder({ id: o.id, user: userName });
      },

      async rejectPendingOrderAction(idx) {
        const o = this.pendingOrders[idx];
        if (!o) return;
        const reason = await this.showPrompt(`ระบุเหตุผลที่ปฏิเสธออเดอร์ของ ${o.customerName}:`, {});
        if (reason === null) return;
        if (reason.trim() === '') return this.showAlert('กรุณาระบุเหตุผลก่อนปฏิเสธ', '');
        this.showLoading();
        google.script.run
          .withSuccessHandler(res => {
            this.hideLoading();
            if (!res.success) return this.showAlert(res.error || 'ปฏิเสธออเดอร์ไม่สำเร็จ', '');
            this.pendingOrders = this.pendingOrders.filter(p => p.id !== o.id);
            this.renderPendingOrdersList();
            this.checkPendingOrders();
            this.showAlert('ปฏิเสธออเดอร์แล้ว', '');
          })
          .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่', ''); })
          .rejectPendingOrder({ id: o.id, reason: reason.trim() });
      },

      // แปลงจำนวนคงเหลือ (เก็บเป็นหน่วยหลักเสมอ) ให้โชว์เป็นหน่วยที่เลือกดู ปัดทศนิยมไม่เกิน 2 ตำแหน่งแล้วตัด 0 ท้ายทิ้ง
      _formatStockForUnit(baseStock, factor) {
        const val = Number(baseStock) / (factor || 1);
        return Number(val.toFixed(2)).toString();
      },

      updateInvRowStockDisplay(idx) {
        const item = this.inventoryData[idx];
        const toggle = document.getElementById(`inv-unit-toggle-${idx}`);
        const display = document.getElementById(`inv-stock-display-${idx}`);
        if (!item || !toggle || !display) return;
        const factor = Number(toggle.value) || 1;
        const unitLabel = factor === 1 ? item.unit : item.purchase_unit;
        display.textContent = this._formatStockForUnit(item.stock, factor) + (unitLabel ? ' ' + unitLabel : '');

        const withdrawUnitEl = document.getElementById(`inv-withdraw-unit-${idx}`);
        const restockUnitEl = document.getElementById(`inv-restock-unit-${idx}`);
        const unitColEl = document.getElementById(`inv-unit-col-${idx}`);
        if (withdrawUnitEl) withdrawUnitEl.textContent = unitLabel;
        if (restockUnitEl) restockUnitEl.textContent = unitLabel;
        if (unitColEl) unitColEl.textContent = unitLabel;
      },

      markInventoryChanged(idx) {
        const withdrawEl = document.getElementById(`inv-withdraw-${idx}`);
        const restockEl = document.getElementById(`inv-restock-${idx}`);
        const badgeMobile = document.getElementById(`inv-changed-${idx}`);
        const badgeDesktop = document.getElementById(`inv-changed-${idx}-desktop`);

        const withdraw = parseFloat(withdrawEl.value) || 0;
        const restock = parseFloat(restockEl.value) || 0;
        const changed = withdraw !== 0 || restock !== 0;

        withdrawEl.classList.toggle('border-amber-400', withdraw !== 0);
        withdrawEl.classList.toggle('border-slate-200', withdraw === 0);
        restockEl.classList.toggle('border-amber-400', restock !== 0);
        restockEl.classList.toggle('border-slate-200', restock === 0);

        if (badgeMobile) badgeMobile.classList.toggle('hidden', !changed);
        if (badgeDesktop) badgeDesktop.classList.toggle('hidden', !changed);
      },

      async saveAllInventory() {
        const updates = [];

        this.inventoryData.forEach((item, idx) => {
          const withdrawEl = document.getElementById(`inv-withdraw-${idx}`);
          const restockEl = document.getElementById(`inv-restock-${idx}`);
          if (!withdrawEl || !restockEl) return;

          // ถ้าตั้งหน่วยซื้อไว้ (เช่น 1 ถุง = 1000 g) แล้วเลือกป้อนเป็นหน่วยซื้อ ต้องแปลงเป็นหน่วยหลักก่อนคำนวณสต๊อก
          const unitToggle = document.getElementById(`inv-unit-toggle-${idx}`);
          const factor = unitToggle ? Number(unitToggle.value) || 1 : 1;

          const withdraw = (parseFloat(withdrawEl.value) || 0) * factor;
          const restock = (parseFloat(restockEl.value) || 0) * factor;
          if (withdraw === 0 && restock === 0) return;

          const newStock = item.stock - withdraw + restock;
          updates.push({ id: item.id, name: item.name, oldStock: item.stock, newStock, withdraw, restock });
        });

        if (updates.length === 0) return this.showAlert('ไม่มีรายการที่แก้ไขครับ', 'ℹ');

        const negativeItem = updates.find(u => u.newStock < 0);
        if (negativeItem) return this.showAlert(` "${negativeItem.name}" เบิกเกินจำนวนคงเหลือ กรุณาตรวจสอบตัวเลขอีกครั้ง`, '');

        const summary = updates.map(u => {
          const parts = [];
          if (u.withdraw) parts.push(`เบิก ${u.withdraw}`);
          if (u.restock) parts.push(`เติม ${u.restock}`);
          return `- ${u.name}: ${u.oldStock} ➜ ${u.newStock} (${parts.join(', ')})`;
        }).join('\n');
        
        const ok = await this.showConfirm(`ยืนยันบันทึกสต๊อก ${updates.length} รายการ:\n${summary}`, '');
        if (!ok) return;

        const userName = this.currentSettingsUser ? this.currentSettingsUser.name : 'พนักงาน';

        this.setIndicator('syncing');
        document.getElementById('inventory-list').classList.add('opacity-50', 'pointer-events-none');

        const payload = updates.map(u => ({ id: u.id, newStock: u.newStock, user: userName }));

        let settled = false;
        const unlock = () => {
          const list = document.getElementById('inventory-list');
          if (list) list.classList.remove('opacity-50', 'pointer-events-none');
        };

        const timeoutId = setTimeout(() => {
          if (!settled) {
            settled = true;
            unlock();
            this.setIndicator('error');
            this.showAlert('การบันทึกใช้เวลานานเกินไป กรุณากด Refresh เพื่อตรวจสอบข้อมูลอีกครั้ง', '');
          }
        }, 20000);

        google.script.run
          .withSuccessHandler(success => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            if (success) {
              this.logPinAttempt(`อัปเดตสต๊อก ${updates.length} รายการ`, true, userName);
              this.fetchInventory();
            } else {
              this.showAlert('บันทึกล้มเหลว กรุณาลองใหม่', '');
              unlock();
              this.setIndicator('synced');
            }
          })
          .withFailureHandler(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            this.showAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่', '');
            unlock();
            this.setIndicator('error');
          })
          .updateInventoryStock(payload);
      },

      // --------------------------------------------------
      // Settings
      // --------------------------------------------------

      currentSettingsUser: null,
      employeeList: [],

      checkSettingsAccess(pin) {
        return this.employees.find(e => String(e.pin).trim() === String(pin).trim() && e.active) || null;
      },

      // ใช้ก่อนทำรายการที่มีความเสี่ยงสูง (คืนเงิน/ยกเลิกบิล/ลบพนักงาน/ลบข้อมูล) ให้พนักงานใส่ PIN ยืนยันตัวตนอีกครั้ง
      // ส่ง employeeId+pin ไปให้เซิร์ฟเวอร์ตรวจสอบสิทธิ์จริงอีกที (ไม่ใช่แค่เช็คในเครื่อง) ก่อนอนุญาตให้ทำรายการ
      async requireActionPin(message) {
        const pin = await this.showPrompt(message, { type: 'password', icon: '' });
        if (pin === null) return null;
        const user = this.checkSettingsAccess(pin);
        if (!user) {
          this.showAlert('รหัส PIN ไม่ถูกต้อง', '');
          return null;
        }
        return { employeeId: user.id, pin: pin.trim(), employee: user };
      },

      getAllowedTabs(user) {
        const allTabs = ['printer', 'history', 'summary', 'report', 'inventory', 'stock', 'employees', 'log', 'addons', 'sweetness', 'payment', 'notifications', 'backup', 'onlineorder'];
        if (user.role === 'Owner' || user.role === 'Admin') return allTabs;
        return user.permissions ? user.permissions.split(',').filter(t => allTabs.includes(t)) : [];
      },

      async openSettings() {
        //  ใช้ผู้ใช้ที่ล็อกอินอยู่แล้วจากหน้า PIN Lock ไม่ต้องใส่ PIN ซ้ำ
        const user = this.loggedInEmployee;
        if (!user) {
          this.showAlert('กรุณาเข้าสู่ระบบก่อนใช้งาน', '');
          this.showPinLockScreen();
          return;
        }

        this.currentSettingsUser = user;
        const allowedTabs = this.getAllowedTabs(user);

        if (allowedTabs.length === 0) {
          this.showAlert('คุณยังไม่ได้รับสิทธิ์เข้าถึงเมนูใดๆ กรุณาติดต่อ Admin', '');
          return;
        }

        document.getElementById('settings-user-label').innerText = `เข้าสู่ระบบในฐานะ: ${user.name} (${user.role})`;

        document.querySelectorAll('button[id^="settings-tab-"]').forEach(btn => {
          const tabKey = btn.id.replace('settings-tab-', '');
          btn.classList.toggle('hidden', !allowedTabs.includes(tabKey));
        });

        this.switchView('settings');
        this.switchSettingsTab(allowedTabs[0]);
        this.initScrollFade('settings-tabs-scroll');
      },

      // เปิดเมนูตั้งค่าแบบ bottom sheet บนมือถือ (โคลนปุ่มแท็บจริงที่ไม่ถูกซ่อนไว้ ทำให้เคารพสิทธิ์การเข้าถึงตาม role อัตโนมัติ)
      openSettingsTabMenu() {
        const list = document.getElementById('settings-tab-menu-list');
        if (!list) return;
        const buttons = Array.from(document.querySelectorAll('#settings-tabs-scroll button[id^="settings-tab-"]'))
          .filter(btn => !btn.classList.contains('hidden'));
        list.innerHTML = buttons.map(btn => {
          const tab = btn.id.replace('settings-tab-', '');
          const active = tab === this.currentSettingsTab;
          return `<button onclick="Controller.selectSettingsTabFromMenu('${tab}')" class="w-full flex items-center gap-3 px-4 min-h-[3rem] rounded-xl font-bold text-sm text-left active:scale-[0.98] transition-all ${active ? 'bg-gradient-to-b from-primary to-secondary text-white' : 'text-slate-600 hover:bg-accent'}">${btn.innerHTML}</button>`;
        }).join('');
        this.openModal('modal-settings-tab-menu');
      },

      selectSettingsTabFromMenu(tab) {
        this.closeModal('modal-settings-tab-menu');
        this.switchSettingsTab(tab);
      },

      switchSettingsTab(tab) {
        if (this.currentSettingsUser && !this.getAllowedTabs(this.currentSettingsUser).includes(tab)) return;

        this.currentSettingsTab = tab;

        document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById(`settings-panel-${tab}`).classList.remove('hidden');

        document.querySelectorAll('button[id^="settings-tab-"]').forEach(btn => {
          btn.classList.remove('text-white');
          btn.classList.add('text-slate-500');
        });
        const activeTabBtn = document.getElementById(`settings-tab-${tab}`);
        activeTabBtn.classList.add('text-white');
        activeTabBtn.classList.remove('text-slate-500');
        // แถบสีลอย (liquid navigation) ไหลไปเกาะใต้แท็บที่เพิ่งเลือกแทนการสลับสีปุ่มทันที
        const indicator = document.getElementById('settings-tab-indicator');
        if (indicator) {
          indicator.style.left = activeTabBtn.offsetLeft + 'px';
          indicator.style.width = activeTabBtn.offsetWidth + 'px';
        }
        // แถบแท็บมี ~12 ปุ่มเลื่อนแนวนอน มือถือกดแท็บที่โผล่แค่ครึ่งเดียวแล้วจะงงว่าอยู่ตรงไหน เลยเลื่อนให้เข้ากลางจอเสมอ
        activeTabBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        // ซิงก์ปุ่มเปิดเมนูบนมือถือให้โชว์ไอคอน+ชื่อแท็บปัจจุบัน (โคลนจากปุ่มแท็บจริงเพื่อไม่ต้องเก็บไอคอนซ้ำสองที่)
        const triggerContent = document.getElementById('settings-mobile-tab-trigger-content');
        if (triggerContent) triggerContent.innerHTML = activeTabBtn.innerHTML;

        if (tab === 'printer') {
          document.getElementById('printer-header').value = this.receiptSettings.header || '';
          document.getElementById('printer-footer').value = this.receiptSettings.footer || '';
          document.getElementById('printer-branch').value = this.receiptSettings.branch || '';
          document.getElementById('printer-company').value = this.receiptSettings.company || '';
          document.getElementById('printer-branch-no').value = this.receiptSettings.branchNo || '';
          document.getElementById('printer-pos-id').value = this.receiptSettings.posId || '';
          document.getElementById('printer-doc-title').value = this.receiptSettings.docTitle || '';
          document.getElementById('printer-auto-print').checked = this.receiptSettings.autoPrint !== false;
          document.getElementById('printer-show-queue').checked = this.receiptSettings.showQueue !== false;
          document.getElementById('printer-print-order-slip').checked = this.receiptSettings.printOrderSlip === true;
          document.getElementById('printer-paper-size').value = this.receiptSettings.paperSize || '80mm';
          this.renderLogoPreview();
          document.getElementById('auto-lock-minutes').value = this.autoLockMinutes;
            this.applyReceiptToggles();
          document.getElementById('shop-address').value = this.shopInfo.address || '';
          document.getElementById('shop-phone').value = this.shopInfo.phone || '';
          document.getElementById('shop-tax-id').value = this.shopInfo.taxId || '';
          document.getElementById('vat-enabled').checked = this.shopInfo.vatEnabled === true;
          document.getElementById('vat-rate').value = this.shopInfo.vatRate || 7;
          this.toggleVatRateInput();
          
          const qDisplay = document.getElementById('current-queue-display');
          if (qDisplay) qDisplay.innerText = 'Q' + this.queueNumber.toString().padStart(2, '0');
        }
        if (tab === 'history') this.renderHistory();
        if (tab === 'summary') this.fetchSummary();
        if (tab === 'inventory') this.fetchInventory();
        if (tab === 'employees') this.fetchEmployeeList();
        if (tab === 'stock') { this.renderStockPanel(); this.renderProductList(); }
        if (tab === 'log') { this.fetchAccessLog(); this.fetchErrorLogs(); this.fetchChangeLog(); }
        if (tab === 'addons') { this.renderAddonList(); this.fetchAddons(); }
        if (tab === 'sweetness') { this.renderSweetnessList(); this.fetchSweetnessLevels(); }
        if (tab === 'notifications') { this.renderNotificationList(); this.fetchNotifications(); }
        if (tab === 'payment') this.fetchPaymentMethods();
        if (tab === 'report') this.initReportTab();
        if (tab === 'backup') { this.fetchBackupList(); this.fetchArchiveList(); }
        if (tab === 'onlineorder') { this.renderPaymentQrPreview(); this.loadOnlineOrderHistory(); this.restoreTableQr(); }
      },

      renderPaymentQrPreview() {
        const img = document.getElementById('payment-qr-preview');
        if (!img) return;
        if (this.shopInfo.paymentQrImage) {
          img.src = this.shopInfo.paymentQrImage;
          img.classList.remove('hidden');
        } else {
          img.classList.add('hidden');
        }
      },

      async handlePaymentQrUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.showLoading();
        try {
          const base64 = await resizeImageBase64(file, 600, 'image/jpeg', 0.85);
          this.shopInfo.paymentQrImage = base64;
          this.renderPaymentQrPreview();
          localStorage.setItem('pos_shopInfo', JSON.stringify(this.shopInfo));
          google.script.run
            .withSuccessHandler(() => {})
            .withFailureHandler(() => this.showAlert('บันทึกรูป QR ไม่สำเร็จ กรุณาลองใหม่', ''))
            .saveShopInfo({ paymentQrImage: base64 });
          this.hideLoading();
          this.showAlert('อัพโหลดรูป QR ชำระเงินเรียบร้อยแล้ว', '');
        } catch (e) {
          this.hideLoading();
          this.showAlert('อัพโหลดรูปไม่สำเร็จ: ' + e.message, '');
        }
      },

      removePaymentQr() {
        this.shopInfo.paymentQrImage = '';
        this.renderPaymentQrPreview();
        localStorage.setItem('pos_shopInfo', JSON.stringify(this.shopInfo));
        google.script.run
          .withSuccessHandler(() => {})
          .withFailureHandler(() => {})
          .saveShopInfo({ paymentQrImage: '' });
      },

      generateTableQr() {
        const loc = document.getElementById('qr-location-input').value.trim();
        if (!loc) return this.showAlert('กรุณาระบุชื่อโต๊ะหรือจุดรับสินค้าก่อน', '');
        const basePath = location.pathname.replace(/[^/]*$/, ''); // เช่น "/PUKFU-POS/" กัน path พังตอน deploy ใน subpath ของ GitHub Pages
        const url = location.origin + basePath + 'order.html?loc=' + encodeURIComponent(loc);
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        document.getElementById('table-qr-image').src = qr.createDataURL(6, 4);
        document.getElementById('table-qr-url').innerText = url;
        document.getElementById('table-qr-result').classList.remove('hidden');
        localStorage.setItem('pos_lastTableQrLoc', loc);
      },

      // เรียกตอนเปิดแท็บ Online Order ทุกครั้ง เพื่อโชว์ QR ล่าสุดที่เคยสร้างไว้ ไม่ต้องพิมพ์ชื่อโต๊ะ+กดสร้างใหม่ทุกครั้งที่รีเฟรชหน้า
      restoreTableQr() {
        const loc = localStorage.getItem('pos_lastTableQrLoc');
        if (!loc) return;
        document.getElementById('qr-location-input').value = loc;
        this.generateTableQr();
      },

      cancelTableQr() {
        localStorage.removeItem('pos_lastTableQrLoc');
        document.getElementById('qr-location-input').value = '';
        document.getElementById('table-qr-result').classList.add('hidden');
      },

      loadOnlineOrderHistory() {
        google.script.run
          .withSuccessHandler(rows => this.renderOnlineOrderHistory(rows))
          .withFailureHandler(() => {})
          .getOnlineOrderHistory();
      },

      renderOnlineOrderHistory(rows) {
        const container = document.getElementById('online-order-history-list');
        if (!container) return;
        if (!rows || rows.length === 0) {
          container.innerHTML = '<p class="text-center text-slate-400 py-6 text-sm">ยังไม่มีประวัติ</p>';
          return;
        }
        const statusMap = {
          confirmed: { label: 'ยืนยันแล้ว', cls: 'bg-emerald-100 text-emerald-600' },
          rejected: { label: 'ปฏิเสธ', cls: 'bg-red-100 text-red-500' },
          cancelled: { label: 'ยกเลิกโดยลูกค้า', cls: 'bg-slate-100 text-slate-500' },
        };
        container.innerHTML = rows.map(o => {
          const st = statusMap[o.status] || { label: o.status, cls: 'bg-slate-100 text-slate-500' };
          const itemsSummary = (o.items || []).map(i => `${i.qty}x ${i.name}`).join(', ');
          const time = o.createdAt ? new Date(o.createdAt).toLocaleString('th-TH') : '';
          return `
            <div class="py-3">
              <div class="flex justify-between items-start gap-2 mb-1">
                <div class="min-w-0">
                  <p class="font-bold text-sm text-secondary truncate">${escHtml(o.customerName)}${o.location ? ' · ' + escHtml(o.location) : ''}</p>
                  <p class="text-xs text-slate-400">${escHtml(time)}</p>
                </div>
                <span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${st.cls}">${st.label}</span>
              </div>
              <p class="text-xs text-slate-500 truncate">${escHtml(itemsSummary)}</p>
              ${o.status === 'rejected' && o.rejectReason ? `<p class="text-xs text-red-400 mt-0.5">เหตุผล: ${escHtml(o.rejectReason)}</p>` : ''}
              <p class="text-sm font-black text-primary mt-1">฿${Number(o.total).toFixed(2)}</p>
            </div>
          `;
        }).join('');
      },

      renderStockPanel() {
        const label = document.getElementById('stock-status-label');
        const btn = document.getElementById('btn-toggle-stock');
        if (!label || !btn) return;
        if (this.isStockMode) {
          label.innerText = 'กำลังเปิดโหมดจัดการสต๊อกอยู่';
          label.className = 'text-2xl font-black text-amber-500 mb-4';
          btn.innerText = 'ปิดโหมดจัดการสต๊อก';
        } else {
          label.innerText = 'ปกติ';
          label.className = 'text-2xl font-black text-secondary mb-4';
          btn.innerText = 'เปิดโหมดจัดการสต๊อก';
        }
      },

      fetchEmployeeList() {
        this.showLoading();
        google.script.run
          .withSuccessHandler(data => {
            this.employeeList = data;
            this.renderEmployeeList();
            this.hideLoading();
          })
          .withFailureHandler(() => {
            this.showAlert('โหลดรายชื่อพนักงานไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
            this.hideLoading();
          })
          .getEmployees();
      },

      renderEmployeeList() {
        const list = document.getElementById('employee-list');
        
        //  กรองเฉพาะพนักงานที่ User คนนี้มีสิทธิ์มองเห็น
        const visibleEmployees = this.employeeList.filter(emp => this.canSeeEmployee(emp));

        if (visibleEmployees.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>ยังไม่มีข้อมูลพนักงานที่คุณสามารถดูได้</div>';
          return;
        }
        
        list.innerHTML = visibleEmployees.map(emp => {
          const canManage = this.canManageEmployee(emp);
          const maskedPin = '•'.repeat(emp.pin.length);
          return `
          <div class="p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <div class="flex items-center gap-3 min-w-0">
              ${emp.photo ? `<img src="${escHtml(emp.photo)}" class="w-10 h-10 rounded-full object-cover shrink-0">` : ''}
              <div class="min-w-0 flex-1">
                <p class="font-bold text-secondary truncate">${escHtml(emp.name)} ${!emp.active ? '<span class="text-xs text-red-400 font-bold">(ปิดใช้งาน)</span>' : ''}</p>
                <p class="text-xs text-slate-400 break-words">
                  ${escHtml(emp.role)} • PIN: <span id="pin-display-${emp.id}">${maskedPin}</span>
                  ${canManage ? `<button onclick="Controller.togglePinVisibility('${emp.id}', '${emp.pin}')" class="text-primary font-bold hover:underline ml-1">ดู</button>` : ''}
                </p>
                <p class="text-xs text-slate-400 break-words mt-0.5">
                  ${(emp.role === 'Owner' || emp.role === 'Admin') ? 'เข้าถึงทุกอย่าง' : `เข้าถึง: ${escHtml((emp.permissions || 'ยังไม่กำหนด').split(',').join(', '))}`}
                </p>
              </div>
            </div>
            <div class="flex gap-2 shrink-0">
              ${canManage ? `
                <button onclick="Controller.openEmployeeForm('${emp.id}')" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-primary bg-primary/10 rounded-full active:scale-95 transition-all whitespace-nowrap">แก้ไข</button>
                <button onclick="Controller.deleteEmployeeConfirm('${emp.id}', '${escAttr(emp.name)}')" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ลบ</button>
              ` : `<span class="text-xs text-slate-300 font-bold"> ดูได้อย่างเดียว</span>`}
            </div>
          </div>
        `}).join('');
      },

      pinVisibleTimeouts: {},

      togglePinVisibility(empId, actualPin) {
        const el = document.getElementById(`pin-display-${empId}`);
        if (!el) return;

        if (this.pinVisibleTimeouts[empId]) {
          clearTimeout(this.pinVisibleTimeouts[empId]);
        }

        el.innerText = actualPin;
        this.pinVisibleTimeouts[empId] = setTimeout(() => {
          el.innerText = '•'.repeat(actualPin.length);
          delete this.pinVisibleTimeouts[empId];
        }, 5000);
      },

      isCurrentUserTopLevel() {
        return this.currentSettingsUser && (this.currentSettingsUser.role === 'Owner' || this.currentSettingsUser.role === 'Admin');
      },

      //  ระบบจัดลำดับขั้น (Rank) เพื่อเช็คสิทธิ์การมองเห็น/แก้ไข
      getRoleRank(role) {
        const ranks = { 'Owner': 100, 'Admin': 90, 'Manager': 50, 'Team Leader': 30, 'Staff': 10 };
        return ranks[role] || 0;
      },

      canSeeEmployee(emp) {
        if (this.isCurrentUserTopLevel()) return true; // Owner/Admin เห็นทุกคน
        if (emp.id === this.currentSettingsUser.id) return true; // ตัวเองต้องเห็นข้อมูลตัวเอง
        // คนอื่นจะถูกมองเห็นได้ก็ต่อเมื่อตำแหน่ง "ต่ำกว่า" ตัวเองเท่านั้น (เช่น Manager เห็น Team Leader/Staff)
        return this.getRoleRank(this.currentSettingsUser.role) > this.getRoleRank(emp.role);
      },

      canManageEmployee(emp) {
        if (this.isCurrentUserTopLevel()) return true; 
        if (emp.id === this.currentSettingsUser.id) return false; // ห้ามแก้ไขตำแหน่ง/สิทธิ์ตัวเอง (ป้องกันการแอบอัปเกรดตัวเอง)
        // จะแก้ไขได้เฉพาะคนที่ตำแหน่งต่ำกว่าตัวเอง
        return this.getRoleRank(this.currentSettingsUser.role) > this.getRoleRank(emp.role);
      },

      openEmployeeForm(id) {
        const emp = id ? this.employeeList.find(e => e.id === id) : null;

        if (emp && !this.canManageEmployee(emp)) {
          this.showAlert('คุณไม่มีสิทธิ์แก้ไขพนักงานคนนี้', '');
          return;
        }

        document.getElementById('emp-form-title').innerText = emp ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน';
        document.getElementById('emp-form-id').value = emp ? emp.id : '';
        document.getElementById('emp-form-name').value = emp ? emp.name : '';
        document.getElementById('emp-form-pin').value = emp ? emp.pin : '';
        
        let defaultRole = 'Staff';
        document.getElementById('emp-form-role').value = emp ? emp.role : defaultRole;
        document.getElementById('emp-form-active').checked = emp ? emp.active : true;

        const roleSelect = document.getElementById('emp-form-role');
        roleSelect.querySelectorAll('option').forEach(opt => {
          if (this.isCurrentUserTopLevel()) {
             opt.classList.remove('hidden'); // Owner/Admin สร้างพนักงานได้ทุกตำแหน่ง
          } else {
             // Manager/Team Leader สร้างพนักงานได้เฉพาะคนที่มีตำแหน่งต่ำกว่าตัวเองเท่านั้น
             const canAssign = this.getRoleRank(this.currentSettingsUser.role) > this.getRoleRank(opt.value);
             opt.classList.toggle('hidden', !canAssign);
          }
        });

        const permList = emp && emp.permissions ? emp.permissions.split(',') : [];
        document.querySelectorAll('.emp-perm-checkbox').forEach(cb => {
          cb.checked = permList.includes(cb.value);
        });

        this.editingEmployeePhoto = emp ? (emp.photo || '') : '';
        const photoPreview = document.getElementById('emp-form-photo-preview');
        if (photoPreview) {
          photoPreview.src = this.editingEmployeePhoto;
          photoPreview.classList.toggle('hidden', !this.editingEmployeePhoto);
        }

        this.onEmployeeRoleChange();
        this.openModal('modal-employee-form');
      },

      handleEmployeePhotoUpload(event) {
        this._handleImageFile(event, 'emp-form-photo-preview', 400, (b64) => { this.editingEmployeePhoto = b64; });
      },

      removeEmployeePhoto() {
        this.editingEmployeePhoto = '';
        this._clearImagePreview('emp-form-photo-preview');
      },

      onEmployeeRoleChange() {
        const role = document.getElementById('emp-form-role').value;
        const isFullAccess = (role === 'Owner' || role === 'Admin');
        document.getElementById('emp-form-full-access-note').classList.toggle('hidden', !isFullAccess);
        document.getElementById('emp-form-permissions-wrap').classList.toggle('hidden', isFullAccess);
      },

      async saveEmployeeForm() {
        const name = document.getElementById('emp-form-name').value.trim();
        const pin = document.getElementById('emp-form-pin').value.trim();
        if (!name || !pin) return this.showAlert('กรุณากรอกชื่อและ PIN ให้ครบ', '');

        const role = document.getElementById('emp-form-role').value;
        const isFullAccess = (role === 'Owner' || role === 'Admin');

        if (!this.isCurrentUserTopLevel()) {
          // ถ้าไม่ใช่ Owner/Admin ต้องเช็คว่าแอบตั้งตำแหน่งพนักงาน ให้เทียบเท่าหรือสูงกว่าตัวเองหรือไม่
          if (this.getRoleRank(this.currentSettingsUser.role) <= this.getRoleRank(role)) {
            return this.showAlert('คุณไม่สามารถตั้งตำแหน่งพนักงานให้เท่ากับหรือสูงกว่าตัวเองได้', '');
          }
        }

        const empId = document.getElementById('emp-form-id').value || null;

        if (empId) {
          const existing = this.employeeList.find(e => e.id === empId);
          if (existing && !this.canManageEmployee(existing)) {
            return this.showAlert('คุณไม่มีสิทธิ์แก้ไขพนักงานคนนี้', '');
          }
        }

        const permissions = isFullAccess
          ? '' 
          : Array.from(document.querySelectorAll('.emp-perm-checkbox:checked')).map(cb => cb.value).join(',');

        const emp = {
          id: empId,
          name: name,
          pin: pin,
          role: role,
          active: document.getElementById('emp-form-active').checked,
          permissions: permissions,
          photo: this.editingEmployeePhoto || '',
          createdBy: empId ? undefined : (this.currentSettingsUser ? this.currentSettingsUser.id : ''),
          actorId: this.currentSettingsUser ? this.currentSettingsUser.id : '',
          actorName: this.currentSettingsUser ? this.currentSettingsUser.name : ''
        };

        this.showLoading();
        google.script.run
          .withSuccessHandler(() => {
            this.hideLoading();
            this.logPinAttempt(empId ? `แก้ไขพนักงาน: ${name}` : `เพิ่มพนักงาน: ${name}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
            this.closeModal('modal-employee-form');
            this.fetchEmployeeList();
            google.script.run
              .withSuccessHandler(data => {
                this.employees = data;
                localStorage.setItem('pos_employees', JSON.stringify(data));
              })
              .getEmployeesForCache();
          })
          .withFailureHandler(() => {
            this.hideLoading();
            this.showAlert('บันทึกไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .saveEmployee(emp);
      },

      async deleteEmployeeConfirm(id, name) {
        const emp = this.employeeList.find(e => e.id === id) || this.employeeList.find(e => !e.id && (e.name || '') === (name || ''));
        if (emp && !this.canManageEmployee(emp)) {
          return this.showAlert('คุณไม่มีสิทธิ์ลบพนักงานคนนี้', '');
        }

        const ok = await this.showConfirm('ต้องการลบพนักงานคนนี้ใช่หรือไม่?', '');
        if (!ok) return;

        const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบพนักงาน:');
        if (!auth) return;

        this.showLoading();
        google.script.run
          .withSuccessHandler(res => {
            this.hideLoading();
            if (res && res.success) {
              this.logPinAttempt(`ลบพนักงาน: ${emp ? emp.name : name || id}`, true, auth.employee.name);
              this.fetchEmployeeList();
            } else {
              this.showAlert((res && res.error) || 'ลบไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.hideLoading();
            this.showAlert('ลบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .deleteEmployee({ id: emp ? emp.id : id, name: emp ? emp.name : name, employeeId: auth.employeeId, pin: auth.pin });
      },

       fetchAccessLog(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.renderAccessLog(data);
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดประวัติไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getAccessLogs();
      },

      renderAccessLog(data) {
        const list = document.getElementById('access-log-list');
        const pendingCount = this.accessLogQueue.length;
        const pendingHtml = pendingCount > 0
          ? `<div class="p-3 bg-amber-50 text-amber-600 text-xs font-bold text-center"> มี ${pendingCount} รายการรอ sync เข้าระบบ</div>`
          : '';

        if (data.length === 0) {
          list.innerHTML = pendingHtml + '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8 11h8M8 15h6"/></svg>ยังไม่มีประวัติการใส่ PIN</div>';
          return;
        }

        list.innerHTML = pendingHtml + data.map(log => `
          <div class="p-4 flex justify-between items-center">
            <div>
              <p class="font-bold text-secondary">${log.context} ${log.result === 'สำเร็จ' ? `— ${escHtml(log.name)}` : ''}</p>
              <p class="text-xs text-slate-400 mt-1">${new Date(log.timestamp).toLocaleString()}</p>
            </div>
            <span class="text-xs font-bold px-3 py-1 rounded-full ${log.result === 'สำเร็จ' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'}">${log.result === 'สำเร็จ' ? ' สำเร็จ' : ' ล้มเหลว'}</span>
          </div>
        `).join('');
      },

      fetchErrorLogs(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.renderErrorLogs(data);
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดข้อผิดพลาดไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getErrorLogs();
      },

      renderErrorLogs(data) {
        const list = document.getElementById('error-log-list');
        if (!list) return;
        if (!data || data.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold">ไม่มีข้อผิดพลาดที่บันทึกไว้</div>';
          return;
        }
        list.innerHTML = data.map(log => `
          <div class="p-4">
            <p class="font-bold text-red-500 text-sm">${escHtml(log.fn || 'ไม่ทราบฟังก์ชัน')}</p>
            <p class="text-xs text-slate-500 mt-1 break-words">${escHtml(log.message || '')}</p>
            <p class="text-xs text-slate-400 mt-1">${new Date(log.created_at).toLocaleString()}</p>
          </div>
        `).join('');
      },

      fetchChangeLog(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.renderChangeLog(data);
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดประวัติการเปลี่ยนแปลงไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getChangeLogs();
      },

      renderChangeLog(data) {
        const list = document.getElementById('change-log-list');
        if (!list) return;
        if (!data || data.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold">ยังไม่มีประวัติการเปลี่ยนแปลง</div>';
          return;
        }
        const areaLabel = { menu: 'เมนู', employee: 'พนักงาน', payment_method: 'วิธีชำระเงิน' };
        const actionLabel = { create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ' };
        list.innerHTML = data.map(log => `
          <div class="p-4">
            <p class="font-bold text-secondary text-sm">${actionLabel[log.action] || log.action}${areaLabel[log.area] ? ' ' + areaLabel[log.area] : ''}: ${escHtml(log.target || '')}</p>
            ${log.details ? `<p class="text-xs text-slate-500 mt-1 break-words">${escHtml(log.details)}</p>` : ''}
            <p class="text-xs text-slate-400 mt-1">${escHtml(log.actor || 'ไม่ทราบผู้ทำรายการ')} · ${new Date(log.created_at).toLocaleString()}</p>
          </div>
        `).join('');
      },

      async clearAccessLog() {
        const ok = await this.showConfirm('ต้องการล้างประวัติการใส่ PIN ทั้งหมดใช่หรือไม่? กู้คืนไม่ได้', '');
        if (!ok) return;
        const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการล้างประวัติ:');
        if (!auth) return;
        google.script.run
          .withSuccessHandler(res => {
            if (res && res.success) this.fetchAccessLog();
            else this.showAlert((res && res.error) || 'ล้างประวัติไม่สำเร็จ', '');
          })
          .withFailureHandler(() => this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''))
          .clearAccessLogs({ employeeId: auth.employeeId, pin: auth.pin });
      },

      async clearErrorLog() {
        const ok = await this.showConfirm('ต้องการล้างประวัติข้อผิดพลาดของระบบทั้งหมดใช่หรือไม่? กู้คืนไม่ได้', '');
        if (!ok) return;
        const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการล้างประวัติ:');
        if (!auth) return;
        google.script.run
          .withSuccessHandler(res => {
            if (res && res.success) this.fetchErrorLogs();
            else this.showAlert((res && res.error) || 'ล้างประวัติไม่สำเร็จ', '');
          })
          .withFailureHandler(() => this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''))
          .clearErrorLogs({ employeeId: auth.employeeId, pin: auth.pin });
      },

      async clearChangeLog() {
        const ok = await this.showConfirm('ต้องการล้างประวัติการเปลี่ยนแปลงทั้งหมดใช่หรือไม่? กู้คืนไม่ได้', '');
        if (!ok) return;
        const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการล้างประวัติ:');
        if (!auth) return;
        google.script.run
          .withSuccessHandler(res => {
            if (res && res.success) this.fetchChangeLog();
            else this.showAlert((res && res.error) || 'ล้างประวัติไม่สำเร็จ', '');
          })
          .withFailureHandler(() => this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''))
          .clearChangeLogs({ employeeId: auth.employeeId, pin: auth.pin });
      },

      fetchBestSellers(period) {
        ['today', 'week', 'month', 'all'].forEach(p => {
          const btn = document.getElementById(`bs-period-${p}`);
          if (!btn) return;
          if (p === period) {
            btn.classList.add('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white');
            btn.classList.remove('text-slate-500');
          } else {
            btn.classList.remove('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white');
            btn.classList.add('text-slate-500');
          }
        });

        this.showLoading();
        google.script.run
          .withSuccessHandler(data => {
            this.renderBestSellers(data);
            this.hideLoading();
          })
          .withFailureHandler(() => {
            this.showAlert('โหลดข้อมูลยอดขายไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
            this.hideLoading();
          })
          .getBestSellers(period);
      },

      renderBestSellers(data) {
        const container = document.getElementById('bestseller-list');
        if (!container) return;
        
        if (!data || data.length === 0) {
          container.innerHTML = '<div class="p-8 text-center text-slate-400">ยังไม่มีข้อมูลการขายในช่วงเวลานี้</div>';
          return;
        }

        let html = '';
        data.forEach((item, index) => {
          let rankIcon = `<span class="text-slate-400 font-bold text-lg">${index + 1}</span>`;
          if (index === 0) rankIcon = '';
          else if (index === 1) rankIcon = '';
          else if (index === 2) rankIcon = '';

          html += `
            <div class="flex items-center p-4 hover:bg-cream transition-colors">
              <div class="w-10 text-center text-2xl mr-4">${rankIcon}</div>
              <div class="flex-1">
                <p class="font-bold text-secondary text-lg">${escHtml(item.name)}</p>
              </div>
              <div class="text-right">
                <p class="font-bold text-primary text-xl">${item.qty} <span class="text-sm text-slate-500 font-normal">แก้ว/ชิ้น</span></p>
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      },

      fetchAddons() {
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(data => {
            this.addons = data;
            localStorage.setItem('pos_addons', JSON.stringify(data));
            this.renderAddonList();
            this.setIndicator('synced');
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ดึงข้อมูล Add-ons ล้มเหลว', '');
          })
          .getAddons();
      },

      renderAddonList() {
        const container = document.getElementById('addon-list');
        if (!container) return;
        
        if (this.addons.length === 0) {
          container.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>ยังไม่มีข้อมูล Add-on</div>';
          return;
        }

        let html = '';
        this.addons.forEach(addon => {
          const priceDisplay = addon.price >= 0 ? `+฿${addon.price}` : `-฿${Math.abs(addon.price)}`;
          const priceColor = addon.price >= 0 ? 'text-primary' : 'text-emerald-500';
          html += `
            <div class="flex items-center justify-between p-4 hover:bg-cream transition-colors">
              <div>
                <p class="font-bold text-secondary">${escHtml(addon.name)} <span class="${priceColor} ml-1">(${priceDisplay})</span></p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="w-2 h-2 rounded-full ${addon.active ? 'bg-emerald-400' : 'bg-slate-300'}"></span>
                  <span class="text-xs text-slate-500">${addon.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                </div>
              </div>
              <div class="flex gap-3">
                <button onclick="Controller.openAddonForm('${addon.id}')" class="text-sm font-bold text-primary hover:underline">แก้ไข</button>
                <button onclick="Controller.deleteAddon('${addon.id}')" class="text-sm font-bold text-red-400 hover:underline">ลบ</button>
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      },

      openAddonForm(id = null) {
        document.getElementById('addon-form-id').value = id || '';
        if (id) {
          const addon = this.addons.find(a => a.id === id);
          if (addon) {
            document.getElementById('addon-form-title').innerText = 'แก้ไข Add-on';
            document.getElementById('addon-form-name').value = addon.name;
            document.getElementById('addon-form-price').value = addon.price;
            document.getElementById('addon-form-active').checked = addon.active;
          }
        } else {
          document.getElementById('addon-form-title').innerText = 'เพิ่ม Add-on';
          document.getElementById('addon-form-name').value = '';
          document.getElementById('addon-form-price').value = '';
          document.getElementById('addon-form-active').checked = true;
        }
        this.openModal('modal-addon-form');
      },

      async saveAddonForm() {
        const id = document.getElementById('addon-form-id').value;
        const name = document.getElementById('addon-form-name').value.trim();
        const price = Number(document.getElementById('addon-form-price').value);
        const active = document.getElementById('addon-form-active').checked;

        if (!name) {
          await this.showAlert('กรุณากรอกชื่อส่วนเสริม', '');
          return;
        }

        /* กัน id ว่างแบบเดียวกับวิธีชำระเงิน */
        const addonId = id || ('ADDON-' + Date.now());
        const addon = { id: addonId, name, price, active, createdBy: this.currentSettingsUser ? this.currentSettingsUser.name : '' };
        
        this.closeModal('modal-addon-form');
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(success => {
            if (success) {
              this.logPinAttempt(id ? `แก้ไข Add-on: ${name}` : `เพิ่ม Add-on: ${name}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.fetchAddons();
            } else {
              this.setIndicator('error');
              this.showAlert('บันทึกข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .saveAddon(addon);
      },

      async deleteAddon(id) {
        const confirmDelete = await this.showConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบ Add-on นี้?', '');
        if (!confirmDelete) return;

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(success => {
            if (success) {
              const addon = this.addons.find(a => a.id === id);
              this.logPinAttempt(`ลบ Add-on: ${addon ? addon.name : id}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.fetchAddons();
            } else {
              this.setIndicator('error');
              this.showAlert('ลบข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .deleteAddon(id);
      },

      fetchSweetnessLevels() {
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(data => {
            this.sweetnessLevels = data;
            localStorage.setItem('pos_sweetnessLevels', JSON.stringify(data));
            this.renderSweetnessList();
            this.updateSweetnessButtons();
            this.setIndicator('synced');
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ดึงข้อมูลระดับความหวานล้มเหลว', '');
          })
          .getSweetnessLevels();
      },

      renderSweetnessList() {
        const container = document.getElementById('sweetness-list');
        if (!container) return;

        if (this.sweetnessLevels.length === 0) {
          container.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/></svg>ยังไม่มีข้อมูลระดับความหวาน</div>';
          return;
        }

        let html = '';
        this.sweetnessLevels.forEach(sw => {
          html += `
            <div class="flex items-center justify-between p-4 hover:bg-cream transition-colors">
              <div>
                <p class="font-bold text-secondary">${escHtml(sw.name)}</p>
                <p class="text-xs text-slate-400 mt-1">ลำดับ: ${sw.sort_order ?? 0}</p>
              </div>
              <div class="flex gap-3">
                <button onclick="Controller.openSweetnessForm('${sw.id}')" class="text-sm font-bold text-primary hover:underline">แก้ไข</button>
                <button onclick="Controller.deleteSweetnessLevel('${sw.id}')" class="text-sm font-bold text-red-400 hover:underline">ลบ</button>
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      },

      openSweetnessForm(id = null) {
        document.getElementById('sweetness-form-id').value = id || '';
        if (id) {
          const sw = this.sweetnessLevels.find(s => s.id === id);
          if (sw) {
            document.getElementById('sweetness-form-title').innerText = 'แก้ไขระดับความหวาน';
            document.getElementById('sweetness-form-name').value = sw.name;
            document.getElementById('sweetness-form-sort-order').value = sw.sort_order ?? 0;
          }
        } else {
          document.getElementById('sweetness-form-title').innerText = 'เพิ่มระดับความหวาน';
          document.getElementById('sweetness-form-name').value = '';
          document.getElementById('sweetness-form-sort-order').value = this.sweetnessLevels.length;
        }
        this.openModal('modal-sweetness-form');
      },

      async saveSweetnessForm() {
        const id = document.getElementById('sweetness-form-id').value;
        const name = document.getElementById('sweetness-form-name').value.trim();
        const sortOrder = Number(document.getElementById('sweetness-form-sort-order').value) || 0;

        if (!name) {
          await this.showAlert('กรุณากรอกชื่อระดับความหวาน', '');
          return;
        }

        const swId = id || ('SWT-' + Date.now());
        const sw = { id: swId, name, sort_order: sortOrder };

        this.closeModal('modal-sweetness-form');
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(success => {
            if (success) {
              this.logPinAttempt(id ? `แก้ไขระดับความหวาน: ${name}` : `เพิ่มระดับความหวาน: ${name}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.fetchSweetnessLevels();
            } else {
              this.setIndicator('error');
              this.showAlert('บันทึกข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .saveSweetnessLevel(sw);
      },

      async deleteSweetnessLevel(id) {
        const confirmDelete = await this.showConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบระดับความหวานนี้?', '');
        if (!confirmDelete) return;

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(success => {
            if (success) {
              const sw = this.sweetnessLevels.find(s => s.id === id);
              this.logPinAttempt(`ลบระดับความหวาน: ${sw ? sw.name : id}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.fetchSweetnessLevels();
            } else {
              this.setIndicator('error');
              this.showAlert('ลบข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .deleteSweetnessLevel(id);
      },

      initReportTab() {
        const startEl = document.getElementById('report-start');
        const endEl = document.getElementById('report-end');
        if (!startEl.value || !endEl.value) {
          this.setReportPreset('7d');
        }
        this.fetchSalesRecords();
      },

      // สถิติวัน/เดือนขายดีที่สุดตลอดกาล ไม่ขึ้นกับช่วงวันที่ที่เลือกในตัวกรองด้านบน
      fetchSalesRecords() {
        google.script.run
          .withSuccessHandler(res => { if (res && res.success) this.renderSalesRecords(res); })
          .withFailureHandler(() => {})
          .getSalesRecords();
      },

      renderSalesRecords(res) {
        const fmt = n => `฿${(n || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const dayEl = document.getElementById('rp-best-day');
        const monthEl = document.getElementById('rp-best-month');
        if (dayEl) dayEl.innerText = res.bestDay
          ? `${new Date(res.bestDay.date + 'T00:00:00').toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: '2-digit'})} · ${fmt(res.bestDay.total)}`
          : 'ยังไม่มีข้อมูล';
        if (monthEl) monthEl.innerText = res.bestMonth
          ? `${new Date(res.bestMonth.month + '-01T00:00:00').toLocaleDateString('th-TH', {month: 'long', year: 'numeric'})} · ${fmt(res.bestMonth.total)}`
          : 'ยังไม่มีข้อมูล';
      },

      toLocalDateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      },

      setReportPreset(preset) {
        const today = new Date();
        let start = new Date();

        if (preset === 'today') {
          start = today;
        } else if (preset === '7d') {
          start.setDate(today.getDate() - 6);
        } else if (preset === '30d') {
          start.setDate(today.getDate() - 29);
        } else if (preset === 'month') {
          start = new Date(today.getFullYear(), today.getMonth(), 1);
        }

        document.getElementById('report-start').value = this.toLocalDateStr(start);
        document.getElementById('report-end').value = this.toLocalDateStr(today);
        this.fetchReport();
      },

      fetchReport(btn) {
        const start = document.getElementById('report-start').value;
        const end = document.getElementById('report-end').value;
        if (!start || !end) return this.showAlert('กรุณาเลือกช่วงวันที่ให้ครบ', '');
        if (start > end) return this.showAlert('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด', '');

        this.setBtnLoading(btn, true);
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            this.setBtnLoading(btn, false);
            if (res.success) {
              this.renderReport(res);
              this.setIndicator('synced');
            } else {
              this.setIndicator('error');
              this.showAlert(res.message || 'โหลดรายงานไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ (รายงานต้องใช้อินเทอร์เน็ต)', '');
          })
          .getSummaryByRange(start, end);
      },

              readReceiptToggles() {
          const keys = ['showLogo','showHeader','showBranch','showCompany','showBranchNo','showAddress','showTaxId','showPhone','showDocTitle','showPosId','showInvoiceNo','showStaff','showDateTime','showItemNote','showSummary','showPayment','showFooter'];
          const out = {};
          keys.forEach(k => {
            const el = document.getElementById('rs-' + k);
            out[k] = el ? el.checked : this.receiptSettings[k] !== false;
          });
          return out;
        },

        applyReceiptToggles() {
          const keys = ['showLogo','showHeader','showBranch','showCompany','showBranchNo','showAddress','showTaxId','showPhone','showDocTitle','showPosId','showInvoiceNo','showStaff','showDateTime','showItemNote','showSummary','showPayment','showFooter'];
          keys.forEach(k => {
            const el = document.getElementById('rs-' + k);
            if (el) el.checked = this.receiptSettings[k] !== false;
          });
        },

        saveAutoLockSetting() {
          const el = document.getElementById('auto-lock-minutes');
          const v = Number(el ? el.value : this.autoLockMinutes);
          this.autoLockMinutes = isNaN(v) || v < 0 ? 10 : v;
          localStorage.setItem('pos_autoLockMinutes', this.autoLockMinutes);
          this.resetAutoLockTimer();
          this.showAlert('บันทึกเวลาล็อกหน้าจอแล้ว', '');
        },

        exportReportPDF() {
          const r = this.lastReport;
          if (!r) return this.showAlert('กรุณากดดูรายงานก่อน', '');
          const start = document.getElementById('report-start').value;
          const end = document.getElementById('report-end').value;
          const money = n => '฿' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const shopName = (this.receiptSettings && this.receiptSettings.header) || 'PUKFU';
          const rows = [
            ['ยอดขายรวม', money(r.total)],
            ['กำไร', money(r.totalProfit)],
            ['ต้นทุนรวม', money(r.totalCost)],
            ['ต้นทุนของเสีย', money(r.wasteCost)],
            ['คืนเงินลูกค้า', money(r.refundedTotal)],
            ['จำนวนบิล', String(r.billCount || 0)],
            ['จำนวนแก้ว', String(r.cupCount || 0)],
            ['เฉลี่ยต่อบิล', money(r.avgPerBill)],
            ['เงินสด', money(r.cash)],
            ['ช่องทางอื่น', money(r.other)]
          ];
          const byType = Object.entries(r.byType || {}).map(e => '<tr><td>' + esc(e[0]) + '</td><td class="num">' + money(e[1]) + '</td></tr>').join('');
          const top = (r.topSellers || []).map((it, i) => '<tr><td>' + (i + 1) + '. ' + esc(it.name) + '</td><td class="num">' + (it.qty || 0) + '</td><td class="num">' + money(it.amount) + '</td></tr>').join('');
          const daily = (r.daily || []).map(d => '<tr><td>' + esc(d.date) + '</td><td class="num">' + (d.bills || 0) + '</td><td class="num">' + (d.cups || 0) + '</td><td class="num">' + money(d.total) + '</td></tr>').join('');
          const doc = '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>Report ' + esc(start) + ' - ' + esc(end) + '</title>'
            + '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">'
            + '<style>*{font-family:Sarabun,Arial,sans-serif}body{margin:28px;color:#1f2937}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}p.sub{margin:0 0 18px;color:#6b7280;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:6px 4px;border-bottom:1px solid #eee;text-align:left}.num{text-align:right}@media print{body{margin:12mm}}</style></head><body>'
            + '<h1>รายงานยอดขาย - ' + esc(shopName) + '</h1>'
            + '<p class="sub">ช่วงวันที่ ' + esc(start) + ' ถึง ' + esc(end) + ' | พิมพ์เมื่อ ' + new Date().toLocaleString('th-TH') + '</p>'
            + '<h2>สรุปรวม</h2><table>' + rows.map(x => '<tr><td>' + x[0] + '</td><td class="num">' + x[1] + '</td></tr>').join('') + '</table>'
            + '<h2>แยกตามวิธีชำระเงิน</h2><table>' + (byType || '<tr><td>ไม่มีข้อมูล</td></tr>') + '</table>'
            + '<h2>เมนูขายดี</h2><table>' + (top || '<tr><td>ไม่มีข้อมูล</td></tr>') + '</table>'
            + '<h2>รายวัน</h2><table><tr><th>วันที่</th><th class="num">บิล</th><th class="num">แก้ว</th><th class="num">ยอด</th></tr>' + (daily || '<tr><td>ไม่มีข้อมูล</td></tr>') + '</table>'
            + '</body></html>';
          const w = window.open('', '_blank');
          if (!w) return this.showAlert('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต popup แล้วลองอีกครั้ง', '');
          w.document.open();
          w.document.write(doc);
          w.document.close();
          setTimeout(() => { try { w.focus(); w.print(); } catch (e) { console.warn('เปิดหน้าต่างพิมพ์ไม่สำเร็จ:', e); } }, 700);
        },

        // อ่านไฟล์รูปจาก <input type=file>, ย่อ+บีบอัด แล้วอัปเดต preview รูป (ใช้ร่วมกันสำหรับสินค้า/วัตถุดิบ/พนักงาน)
        async _handleImageFile(event, previewElId, maxWidth, applyFn) {
          const file = event.target.files[0];
          if (!file) return;
          try {
            const base64 = await resizeImageBase64(file, maxWidth, 'image/jpeg', 0.8);
            applyFn(base64);
            const img = document.getElementById(previewElId);
            if (img) { img.src = base64; img.classList.remove('hidden'); }
          } catch (e) {
            this.showAlert('อัปโหลดรูปไม่สำเร็จ: ' + e.message, '');
          }
        },

        _clearImagePreview(previewElId) {
          const img = document.getElementById(previewElId);
          if (img) { img.src = ''; img.classList.add('hidden'); }
        },

        // ISO string -> ค่าที่ input type="datetime-local" ใช้ได้ (YYYY-MM-DDTHH:mm ตามเวลาเครื่อง)
        _isoToLocalInput(iso) {
          if (!iso) return '';
          const d = new Date(iso);
          if (isNaN(d.getTime())) return '';
          const pad = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },

        showInventoryItemForm(item) {
          const old = document.getElementById('modal-inv-item');
          if (old) old.remove();
          const it = item || { id: '', name: '', unit: '', stock: 0, opened_at: '', expires_at: '' };
          const q = s => String(s == null ? '' : s).replace(/"/g, '&quot;');
          const wrap = document.createElement('div');
          wrap.id = 'modal-inv-item';
          wrap.className = 'fixed inset-0 bg-secondary/40 backdrop-blur-sm z-[90] flex items-center justify-center p-4';
          wrap.innerHTML = '<div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-xl">'
            + '<h3 class="font-bold text-lg text-secondary mb-4">' + (item ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ') + '</h3>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">ชื่อวัตถุดิบ</label>'
            + '<input id="inv-item-name" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + q(it.name) + '">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">หน่วย (สำหรับคำนวณสูตร/คงเหลือ เช่น g, ml)</label>'
            + '<input id="inv-item-unit" oninput="Controller.updateInvStockUnitToggle()" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + q(it.unit) + '">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">หน่วยซื้อ (ถ้ามี — เช่น ถุง, ขวด)</label>'
            + '<input id="inv-item-purchase-unit" oninput="Controller.updateInvStockUnitToggle()" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + q(it.purchase_unit) + '" placeholder="ไม่บังคับ">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">1 หน่วยซื้อ = กี่หน่วย (เช่น 1 ถุง = 1000)</label>'
            + '<input id="inv-item-purchase-factor" type="number" min="0" step="0.01" oninput="Controller.updateInvStockUnitToggle()" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + (Number(it.purchase_factor) || '') + '" placeholder="เช่น 1000">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">จำนวนคงเหลือ</label>'
            + '<div class="flex gap-2 mb-3">'
            + '<input id="inv-item-stock" type="number" step="0.01" class="flex-1 border border-sand rounded-xl p-2.5" value="' + (Number(it.stock) || 0) + '">'
            + '<select id="inv-item-stock-unit-toggle" class="border border-sand rounded-xl p-2.5 text-sm bg-white hidden"></select>'
            + '</div>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">รูปวัตถุดิบ (ถ้ามี)</label>'
            + '<img id="inv-item-image-preview" src="' + q(it.photo) + '" class="' + (it.photo ? '' : 'hidden ') + 'w-16 h-16 object-cover border border-sand rounded-xl bg-white mb-2">'
            + '<input type="file" accept="image/*" onchange="Controller.handleInventoryImageUpload(event)" class="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-primary/10 file:text-primary file:font-bold mb-1">'
            + '<button onclick="Controller.removeInventoryImage()" class="text-xs font-bold text-red-400 hover:underline mb-5">ลบรูป</button>'
            + '<div class="flex gap-2">'
            + '<button onclick="Controller.closeInventoryItemForm()" class="flex-1 border border-slate-200 rounded-2xl py-2.5 font-bold text-slate-500">ยกเลิก</button>'
            + '<button onclick="Controller.saveInventoryItemForm()" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white rounded-2xl py-2.5 font-bold hover:brightness-110 transition">บันทึก</button>'
            + '</div></div>';
          this.editingInventoryId = it.id || '';
          this.editingInventoryImage = it.photo || '';
          document.body.appendChild(wrap);
          this.updateInvStockUnitToggle();
        },

        // อัปเดต dropdown เลือกหน่วยข้าง "จำนวนคงเหลือ" ให้ตรงกับหน่วยซื้อ/หน่วยหลักที่เพิ่งพิมพ์
        // (เผื่อรับของเข้าครั้งแรกเป็นถุง จะได้ใส่จำนวนถุงตรงๆ ไม่ต้องคำนวณเป็นกรัมเอง)
        updateInvStockUnitToggle() {
          const unitEl = document.getElementById('inv-item-unit');
          const puEl = document.getElementById('inv-item-purchase-unit');
          const pfEl = document.getElementById('inv-item-purchase-factor');
          const toggle = document.getElementById('inv-item-stock-unit-toggle');
          if (!unitEl || !toggle) return;
          const unit = unitEl.value.trim();
          const purchaseUnit = puEl ? puEl.value.trim() : '';
          const purchaseFactor = pfEl ? Number(pfEl.value) || 0 : 0;
          if (!purchaseUnit || purchaseFactor <= 0) {
            toggle.classList.add('hidden');
            toggle.innerHTML = '';
            return;
          }
          toggle.innerHTML = '<option value="1">' + escHtml(unit || 'หน่วยหลัก') + '</option>'
            + '<option value="' + purchaseFactor + '">' + escHtml(purchaseUnit) + '</option>';
          toggle.classList.remove('hidden');
          // ถ้าสลับหน่วยหลังกรอกตัวเลขไว้แล้ว (เช่น ตอนแก้ไขรายการเดิม) ล้างค่าทิ้งกันตัวเลขเดิมถูกตีความผิดหน่วย
          toggle.onchange = () => { document.getElementById('inv-item-stock').value = 0; };
        },

        handleInventoryImageUpload(event) {
          this._handleImageFile(event, 'inv-item-image-preview', 400, (b64) => { this.editingInventoryImage = b64; });
        },

        removeInventoryImage() {
          this.editingInventoryImage = '';
          this._clearImagePreview('inv-item-image-preview');
        },

        closeInventoryItemForm() {
          const m = document.getElementById('modal-inv-item');
          if (m) m.remove();
        },

        saveInventoryItemForm() {
          const name = document.getElementById('inv-item-name').value.trim();
          const unit = document.getElementById('inv-item-unit').value.trim();
          const purchaseUnit = document.getElementById('inv-item-purchase-unit').value.trim();
          const purchaseFactor = Number(document.getElementById('inv-item-purchase-factor').value) || 0;
          const stockToggle = document.getElementById('inv-item-stock-unit-toggle');
          const stockFactor = (stockToggle && !stockToggle.classList.contains('hidden')) ? (Number(stockToggle.value) || 1) : 1;
          const stock = (Number(document.getElementById('inv-item-stock').value) || 0) * stockFactor;
          if (!name) return this.showAlert('กรุณากรอกชื่อวัตถุดิบ', '');
          const id = this.editingInventoryId || '';
          const photo = this.editingInventoryImage || '';
          this.closeInventoryItemForm();
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.fetchInventory();
                this.showAlert('บันทึกวัตถุดิบแล้ว', '');
              } else {
                this.showAlert((res && res.error) || 'บันทึกไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .saveInventoryItem({ id: id, name: name, unit: unit, stock: stock, photo: photo, purchaseUnit: purchaseUnit, purchaseFactor: purchaseFactor });
        },

        async deleteInventoryItemConfirm(id) {
          const item = (this.inventoryData || []).find(x => String(x.id) === String(id));
          const ok = await this.showConfirm('ต้องการลบ "' + (item ? item.name : id) + '" ออกจากคลังหรือไม่?', '');
          if (!ok) return;
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.logPinAttempt('ลบวัตถุดิบ: ' + (item ? item.name : id), true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
                this.fetchInventory();
                this.showAlert('ลบวัตถุดิบแล้ว', '');
              } else {
                this.showAlert('ลบไม่สำเร็จ (ไม่พบรายการนี้)', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .deleteInventoryItem(id);
        },

        fetchMenuForAdmin(btn) {
          this.setIndicator('syncing');
          this.setBtnLoading(btn, true);
          google.script.run
            .withSuccessHandler(data => {
              this.setBtnLoading(btn, false);
              this.menuData = data;
              localStorage.setItem('pos_menuData', JSON.stringify(data));
              this.soldOutItems = data.filter(item => item.isSoldOut).map(item => item.name);
              localStorage.setItem('pos_soldOut', JSON.stringify(this.soldOutItems));
              this.extractCategories();
              this.renderProductList();
              this.setIndicator('synced');
            })
            .withFailureHandler(() => {
              this.setBtnLoading(btn, false);
              this.showAlert('ไม่สามารถโหลดข้อมูลสินค้าได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
              this.setIndicator('error');
            })
            .getMenuData();
        },

        filterProductList(q) {
          this.productSearchQuery = q;
          this.renderProductList();
        },

        renderProductList() {
          const list = document.getElementById('product-list');
          if (!list) return;
          if (this.menuData.length === 0) {
            list.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">ยังไม่มีสินค้า กด "+ เพิ่มสินค้า" เพื่อเริ่มเพิ่มเมนู</div>';
            return;
          }
          const q = (this.productSearchQuery || '').trim().toLowerCase();
          const filtered = !q ? this.menuData : this.menuData.filter(item =>
            (item.name || '').toLowerCase().includes(q) ||
            (item.sku || '').toLowerCase().includes(q) ||
            (item.category || '').toLowerCase().includes(q)
          );
          if (filtered.length === 0) {
            list.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">ไม่พบสินค้าที่ค้นหา</div>';
            return;
          }
          const sorted = [...filtered].sort((a, b) => (a.category || '').localeCompare(b.category || '') || String(a.name || '').localeCompare(String(b.name || '')));
          list.innerHTML = sorted.map(item => `
            <div class="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div class="flex items-center gap-3 min-w-0">
                ${item.image ? `<img src="${escHtml(item.image)}" class="w-10 h-10 rounded-lg object-cover shrink-0">` : ''}
                <div class="min-w-0">
                  <p class="font-bold text-secondary truncate">${escHtml(item.name)} ${item.isSoldOut ? '<span class="text-xs font-bold text-red-400">(หมด)</span>' : ''}</p>
                  <p class="text-xs text-slate-400 truncate">${escHtml(item.sku)} · ${escHtml(item.category || 'ไม่มีหมวดหมู่')} · ฿${Number(item.price) || 0}</p>
                </div>
              </div>
              <div class="shrink-0 flex items-center gap-3">
                <button onclick="Controller.openRecipeForm('${escHtml(item.sku)}')" class="text-xs font-bold text-emerald-600 hover:underline">สูตร</button>
                <button onclick='Controller.showProductForm(${JSON.stringify(item).replace(/'/g, "&apos;")})' class="text-xs font-bold text-primary hover:underline">แก้ไข</button>
                <button onclick="Controller.deleteProductConfirm('${escHtml(item.sku)}')" class="text-xs font-bold text-red-400 hover:text-red-600 hover:underline">ลบ</button>
              </div>
            </div>
          `).join('');
        },

        showProductForm(item) {
          const old = document.getElementById('modal-product-item');
          if (old) old.remove();
          const it = item || { sku: '', name: '', lang2: '', price: 0, cost: 0, category: '', image: '' };
          const q = s => String(s == null ? '' : s).replace(/"/g, '&quot;');
          const wrap = document.createElement('div');
          wrap.id = 'modal-product-item';
          wrap.className = 'fixed inset-0 bg-secondary/40 backdrop-blur-sm z-[90] flex items-center justify-center p-4';
          wrap.innerHTML = '<div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-xl max-h-[90vh] overflow-y-auto">'
            + '<h3 class="font-bold text-lg text-secondary mb-4">' + (item ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า') + '</h3>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">รหัสสินค้า (SKU)</label>'
            + '<input id="prod-sku" class="w-full border border-sand rounded-xl p-2.5 mb-3' + (item ? ' bg-slate-100 text-slate-400' : '') + '" value="' + q(it.sku) + '"' + (item ? ' readonly' : '') + '>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">ชื่อสินค้า</label>'
            + '<input id="prod-name" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + q(it.name) + '">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">ชื่อภาษาอังกฤษ (ถ้ามี)</label>'
            + '<input id="prod-lang2" class="w-full border border-sand rounded-xl p-2.5 mb-3" value="' + q(it.lang2) + '">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">หมวดหมู่</label>'
            + (() => {
                const known = (this.categories || []).filter(c => c !== 'All');
                const cats = it.category && !known.includes(it.category) ? [...known, it.category] : known;
                const opts = ['<option value="">(ไม่ระบุ)</option>']
                  .concat(cats.map(c => '<option value="' + q(c) + '"' + (c === it.category ? ' selected' : '') + '>' + q(c) + '</option>'))
                  .concat(['<option value="__new__">+ หมวดหมู่ใหม่...</option>']);
                return '<select id="prod-category" onchange="Controller.toggleNewCategoryInput()" class="w-full border border-sand rounded-xl p-2.5 mb-2 bg-white">' + opts.join('') + '</select>'
                  + '<input id="prod-category-new" placeholder="ชื่อหมวดหมู่ใหม่" class="w-full border border-sand rounded-xl p-2.5 mb-3 hidden">';
              })()
            + '<div class="flex gap-3 mb-3">'
            + '<div class="flex-1"><label class="text-sm font-bold text-slate-500 mb-1 block">ราคาขาย</label>'
            + '<input id="prod-price" type="number" step="0.01" class="w-full border border-sand rounded-xl p-2.5" value="' + (Number(it.price) || 0) + '"></div>'
            + '<div class="flex-1"><label class="text-sm font-bold text-slate-500 mb-1 block">ต้นทุน (ถ้ามี)</label>'
            + '<input id="prod-cost" type="number" step="0.01" class="w-full border border-sand rounded-xl p-2.5" value="' + (Number(it.cost) || 0) + '"></div>'
            + '</div>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">รูปสินค้า (ถ้ามี)</label>'
            + '<img id="prod-image-preview" src="' + q(it.image) + '" class="' + (it.image ? '' : 'hidden ') + 'w-20 h-20 object-cover border border-sand rounded-xl bg-white mb-2">'
            + '<input type="file" accept="image/*" onchange="Controller.handleProductImageUpload(event)" class="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-primary/10 file:text-primary file:font-bold mb-1">'
            + '<button onclick="Controller.removeProductImage()" class="text-xs font-bold text-red-400 hover:underline mb-5">ลบรูป</button>'
            + '<div class="flex gap-2">'
            + '<button onclick="Controller.closeProductForm()" class="flex-1 border border-slate-200 rounded-2xl py-2.5 font-bold text-slate-500">ยกเลิก</button>'
            + '<button onclick="Controller.saveProductForm()" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white rounded-2xl py-2.5 font-bold hover:brightness-110 transition">บันทึก</button>'
            + '</div></div>';
          this.editingProductIsNew = !item;
          this.editingProductImage = it.image || '';
          document.body.appendChild(wrap);
          this.toggleNewCategoryInput();
        },

        handleProductImageUpload(event) {
          this._handleImageFile(event, 'prod-image-preview', 640, (b64) => { this.editingProductImage = b64; });
        },

        removeProductImage() {
          this.editingProductImage = '';
          this._clearImagePreview('prod-image-preview');
        },

        toggleNewCategoryInput() {
          const sel = document.getElementById('prod-category');
          const input = document.getElementById('prod-category-new');
          if (!sel || !input) return;
          const isNew = sel.value === '__new__';
          input.classList.toggle('hidden', !isNew);
          if (!isNew) input.value = '';
        },

        closeProductForm() {
          const m = document.getElementById('modal-product-item');
          if (m) m.remove();
        },

        saveProductForm() {
          const sku = document.getElementById('prod-sku').value.trim();
          const name = document.getElementById('prod-name').value.trim();
          const lang2 = document.getElementById('prod-lang2').value.trim();
          const categorySel = document.getElementById('prod-category').value;
          const category = categorySel === '__new__' ? document.getElementById('prod-category-new').value.trim() : categorySel;
          const price = Number(document.getElementById('prod-price').value) || 0;
          const cost = Number(document.getElementById('prod-cost').value) || 0;
          const image = this.editingProductImage || '';
          if (!sku) return this.showAlert('กรุณากรอกรหัสสินค้า (SKU)', '');
          if (!name) return this.showAlert('กรุณากรอกชื่อสินค้า', '');
          if (categorySel === '__new__' && !category) return this.showAlert('กรุณาระบุชื่อหมวดหมู่ใหม่', '');
          const isNew = !!this.editingProductIsNew;
          this.closeProductForm();
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.fetchMenuForAdmin();
                this.showAlert('บันทึกสินค้าแล้ว', '');
              } else {
                this.showAlert((res && res.error) || 'บันทึกไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .saveMenuItem({ sku, name, lang2, category, price, cost, image, isNew, actorId: this.currentSettingsUser ? this.currentSettingsUser.id : '', actorName: this.currentSettingsUser ? this.currentSettingsUser.name : '' });
        },

        async deleteProductConfirm(sku) {
          const item = (this.menuData || []).find(x => String(x.sku) === String(sku));
          const ok = await this.showConfirm('ต้องการลบสินค้า "' + (item ? item.name : sku) + '" ออกจากเมนูหรือไม่?', '');
          if (!ok) return;
          const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบสินค้า:');
          if (!auth) return;
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.logPinAttempt('ลบสินค้า: ' + (item ? item.name : sku), true, auth.employee.name);
                this.fetchMenuForAdmin();
                this.showAlert('ลบสินค้าแล้ว', '');
              } else {
                this.showAlert((res && res.error) || 'ลบไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .deleteMenuItem({ sku, employeeId: auth.employeeId, pin: auth.pin });
        },

        _recipeRowHtml(inventoryItemId, qty) {
          const opts = ['<option value="">-- เลือกวัตถุดิบ --</option>']
            .concat((this.inventoryData || []).map(inv => '<option value="' + inv.id + '"' + (inv.id === inventoryItemId ? ' selected' : '') + '>' + escHtml(inv.name) + ' (' + escHtml(inv.unit || '') + ')</option>'))
            .join('');
          return '<div class="recipe-row flex items-center gap-2 mb-2">'
            + '<select class="recipe-ing-select flex-1 border border-sand rounded-xl p-2 text-sm bg-white">' + opts + '</select>'
            + '<input type="number" min="0" step="0.01" class="recipe-ing-qty w-20 border border-sand rounded-xl p-2 text-sm text-center" value="' + (qty || '') + '">'
            + '<button onclick="this.closest(\'.recipe-row\').remove()" class="text-red-400 hover:text-red-600 font-bold px-2">✕</button>'
            + '</div>';
        },

        openRecipeForm(sku) {
          const item = (this.menuData || []).find(x => String(x.sku) === String(sku));
          if (!item) return this.showAlert('ไม่พบสินค้านี้', '');
          const old = document.getElementById('modal-recipe-form');
          if (old) old.remove();
          this.editingRecipeSku = sku;
          const rows = (this.recipes || []).filter(r => r.menu_sku === sku);
          const wrap = document.createElement('div');
          wrap.id = 'modal-recipe-form';
          wrap.className = 'fixed inset-0 bg-secondary/40 backdrop-blur-sm z-[90] flex items-center justify-center p-4';
          wrap.innerHTML = '<div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-xl max-h-[90vh] overflow-y-auto">'
            + '<h3 class="font-bold text-lg text-secondary mb-1">สูตร: ' + escHtml(item.name) + '</h3>'
            + '<p class="text-xs text-slate-400 mb-4">เลือกวัตถุดิบและจำนวนที่ใช้ต่อสินค้า 1 ชิ้น ระบบจะหักสต๊อกอัตโนมัติเมื่อขาย</p>'
            + '<div id="recipe-rows">' + (rows.length ? rows.map(r => this._recipeRowHtml(r.inventory_item_id, r.qty)).join('') : '') + '</div>'
            + (rows.length === 0 ? '<p id="recipe-empty-note" class="text-xs text-slate-400 mb-2">ยังไม่ได้ตั้งสูตรสำหรับสินค้านี้</p>' : '')
            + '<button onclick="Controller.addRecipeRow()" class="text-sm font-bold text-primary hover:underline mb-4">+ เพิ่มวัตถุดิบ</button>'
            + '<div class="flex gap-2">'
            + '<button onclick="Controller.closeRecipeForm()" class="flex-1 border border-slate-200 rounded-2xl py-2.5 font-bold text-slate-500">ยกเลิก</button>'
            + '<button onclick="Controller.saveRecipeForm()" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white rounded-2xl py-2.5 font-bold hover:brightness-110 transition">บันทึกสูตร</button>'
            + '</div></div>';
          document.body.appendChild(wrap);
        },

        addRecipeRow() {
          const note = document.getElementById('recipe-empty-note');
          if (note) note.remove();
          document.getElementById('recipe-rows').insertAdjacentHTML('beforeend', this._recipeRowHtml('', ''));
        },

        closeRecipeForm() {
          const m = document.getElementById('modal-recipe-form');
          if (m) m.remove();
        },

        saveRecipeForm() {
          const menuSku = this.editingRecipeSku;
          const ingredients = Array.from(document.querySelectorAll('#modal-recipe-form .recipe-row')).map(row => ({
            inventoryItemId: row.querySelector('.recipe-ing-select').value,
            qty: Number(row.querySelector('.recipe-ing-qty').value) || 0
          })).filter(ing => ing.inventoryItemId && ing.qty > 0);
          this.closeRecipeForm();
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                google.script.run
                  .withSuccessHandler(data => { this.recipes = data; localStorage.setItem('pos_recipes', JSON.stringify(data)); })
                  .withFailureHandler(() => {})
                  .getRecipes();
                this.showAlert('บันทึกสูตรแล้ว', '');
              } else {
                this.showAlert((res && res.error) || 'บันทึกไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .saveRecipesForMenuItem({ menuSku, ingredients });
        },

        fetchNotifications() {
          this.setIndicator('syncing');
          google.script.run
            .withSuccessHandler(data => {
              this.notifications = data;
              localStorage.setItem('pos_notifications', JSON.stringify(data));
              this.renderNotificationList();
              this.checkNotifications();
              this.setIndicator('synced');
            })
            .withFailureHandler(() => {
              this.setIndicator('error');
              this.showAlert('ดึงข้อมูลแจ้งเตือนล้มเหลว', '');
            })
            .getNotifications();
        },

        renderNotificationList() {
          const container = document.getElementById('notification-list');
          if (!container) return;

          if (this.notifications.length === 0) {
            container.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>ยังไม่มีการแจ้งเตือน</div>';
            return;
          }

          const now = Date.now();
          const twoHoursMs = 2 * 3600 * 1000;
          let html = '';
          this.notifications.forEach(n => {
            const expiresAt = n.expires_at ? new Date(n.expires_at).getTime() : null;
            let statusBadge = '';
            if (expiresAt && !isNaN(expiresAt)) {
              if (expiresAt <= now) statusBadge = '<span class="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">หมดอายุแล้ว</span>';
              else if (expiresAt - now <= twoHoursMs) statusBadge = '<span class="bg-orange-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">ใกล้หมดอายุ</span>';
            }
            html += `
              <div class="flex items-center justify-between p-4 hover:bg-cream transition-colors">
                <div>
                  <p class="font-bold text-secondary flex items-center gap-2">${escHtml(n.item_name)} ${statusBadge}</p>
                  <p class="text-xs text-slate-400 mt-1">
                    ${n.opened_at ? 'เปิดใช้: ' + new Date(n.opened_at).toLocaleString() : ''}
                    ${n.expires_at ? (n.opened_at ? ' | ' : '') + 'หมดอายุ: ' + new Date(n.expires_at).toLocaleString() : ''}
                  </p>
                </div>
                <button onclick="Controller.deleteNotification('${n.id}')" class="text-sm font-bold text-red-400 hover:underline shrink-0">ลบ</button>
              </div>
            `;
          });
          container.innerHTML = html;
        },

        openNotificationForm() {
          const old = document.getElementById('modal-notification-form');
          if (old) old.remove();
          const itemOptions = (this.inventoryData || [])
            .map(it => `<option value="${it.id}">${escHtml(it.name)}</option>`)
            .join('');
          const wrap = document.createElement('div');
          wrap.id = 'modal-notification-form';
          wrap.className = 'fixed inset-0 bg-secondary/40 backdrop-blur-sm z-[90] flex items-center justify-center p-4';
          wrap.innerHTML = '<div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-xl">'
            + '<h3 class="font-bold text-lg text-secondary mb-4">เพิ่มแจ้งเตือน</h3>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">วัตถุดิบ</label>'
            + '<select id="notif-item-id" class="w-full border border-sand rounded-xl p-2.5 mb-3">' + itemOptions + '</select>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">เปิดใช้เมื่อ <span class="font-normal text-slate-400">(ถ้ามี)</span></label>'
            + '<input id="notif-opened-at" type="datetime-local" class="w-full border border-sand rounded-xl p-2.5 mb-3">'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">หมดอายุเมื่อ <span class="font-normal text-slate-400">(ถ้าไม่ระบุ จะเก็บเป็นบันทึกเฉยๆ ไม่มีแจ้งเตือน)</span></label>'
            + '<input id="notif-expires-at" type="datetime-local" class="w-full border border-sand rounded-xl p-2.5 mb-5">'
            + '<div class="flex gap-2">'
            + '<button onclick="Controller.closeNotificationForm()" class="flex-1 border border-slate-200 rounded-2xl py-2.5 font-bold text-slate-500">ยกเลิก</button>'
            + '<button onclick="Controller.saveNotificationForm()" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white rounded-2xl py-2.5 font-bold hover:brightness-110 transition">บันทึก</button>'
            + '</div></div>';
          document.body.appendChild(wrap);
        },

        closeNotificationForm() {
          const m = document.getElementById('modal-notification-form');
          if (m) m.remove();
        },

        saveNotificationForm() {
          const itemSelect = document.getElementById('notif-item-id');
          const itemId = itemSelect ? itemSelect.value : '';
          const item = (this.inventoryData || []).find(it => String(it.id) === String(itemId));
          if (!item) return this.showAlert('กรุณาเพิ่มวัตถุดิบในสต๊อกก่อน จึงจะเลือกได้', '');

          const openedAtLocal = document.getElementById('notif-opened-at').value;
          const expiresAtLocal = document.getElementById('notif-expires-at').value;
          const openedAt = openedAtLocal ? new Date(openedAtLocal).toISOString() : null;
          const expiresAt = expiresAtLocal ? new Date(expiresAtLocal).toISOString() : null;
          // ไม่บังคับวันหมดอายุ: รายการที่ไม่มีวันหมดอายุจะเก็บไว้เป็นบันทึกเฉยๆ ไม่มีการแจ้งเตือน (ดู _getActiveNotifications)

          this.closeNotificationForm();
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.fetchNotifications();
                this.showAlert('บันทึกแจ้งเตือนแล้ว', '');
              } else {
                this.showAlert((res && res.error) || 'บันทึกไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .saveNotification({ inventoryItemId: item.id, itemName: item.name, openedAt: openedAt, expiresAt: expiresAt });
        },

        async deleteNotification(id) {
          const confirmDelete = await this.showConfirm('ต้องการลบแจ้งเตือนนี้หรือไม่?', '');
          if (!confirmDelete) return;

          this.dismissedNotificationIds.delete(id);
          this.setIndicator('syncing');
          google.script.run
            .withSuccessHandler(res => {
              if (res && res.success) {
                this.fetchNotifications();
              } else {
                this.setIndicator('error');
                this.showAlert('ลบไม่สำเร็จ', '');
              }
            })
            .withFailureHandler(() => {
              this.setIndicator('error');
              this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
            })
            .deleteNotification(id);
        },

        openEditBill(invoice) {
          const order = this.findOrderByInvoice(invoice);
          if (!order) return this.showAlert('ไม่พบบิลนี้', '');
          const items = (order.items || []).filter(it => !it.cancelled);
          const noId = items.some(it => it.id === undefined || it.id === null);
          this.editBillData = { invoice: order.invoice, note: order.note || '', paymentType: order.paymentType || '', expectedTotal: Number(order.total) || 0, items: items.map(it => ({ id: it.id, name: it.name, qty: it.qty, price: it.price, note: it.note || '' })) };
          const q = s => String(s == null ? '' : s).replace(/"/g, '&quot;');
          const old = document.getElementById('modal-edit-bill');
          if (old) old.remove();
          const pm = (this.paymentMethods || []).map(m => '<option value="' + q(m.name) + '"' + (m.name === order.paymentType ? ' selected' : '') + '>' + m.name + '</option>').join('');
          const rows = this.editBillData.items.map((it, i) => '<div class="flex items-center gap-2 py-2 border-b border-slate-100">'
            + '<div class="flex-1 min-w-0"><p class="font-bold text-sm truncate">' + it.name + '</p>' + (it.note ? '<p class="text-xs text-slate-400 truncate">' + it.note + '</p>' : '') + '</div>'
            + '<input type="number" min="0" id="eb-qty-' + i + '" value="' + (it.qty || 0) + '" class="w-16 border border-slate-200 rounded-lg p-1.5 text-center font-bold">'
            + '<input type="number" min="0" step="0.01" id="eb-price-' + i + '" value="' + (it.price || 0) + '" class="w-20 border border-slate-200 rounded-lg p-1.5 text-center font-bold">'
            + '</div>').join('');
          const wrap = document.createElement('div');
          wrap.id = 'modal-edit-bill';
          wrap.className = 'fixed inset-0 bg-secondary/40 backdrop-blur-sm z-[90] flex items-center justify-center p-4';
          wrap.innerHTML = '<div class="bg-white rounded-3xl w-full max-w-md p-6 shadow-xl max-h-[85vh] overflow-y-auto">'
            + '<h3 class="font-bold text-lg text-secondary mb-1">แก้ไขบิลย้อนหลัง</h3>'
            + '<p class="text-xs text-slate-400 mb-4">' + q(order.invoice) + '</p>'
            + (noId ? '<p class="text-xs text-red-500 font-bold mb-3">บิลนี้เป็นข้อมูลเก่าที่ไม่มีรหัสรายการ จะแก้ได้เฉพาะวิธีชำระเงินและหมายเหตุ</p>' : '')
            + '<div class="flex items-center gap-2 text-[11px] font-bold text-slate-400 mb-1"><div class="flex-1">รายการ</div><div class="w-16 text-center">จำนวน</div><div class="w-20 text-center">ราคา</div></div>'
            + '<div class="mb-4">' + (rows || '<p class="text-sm text-slate-400 py-3">ไม่มีรายการสินค้า</p>') + '</div>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">วิธีชำระเงิน</label>'
            + '<select id="eb-payment" class="w-full border border-sand rounded-xl p-2.5 mb-3">' + pm + '</select>'
            + '<label class="text-sm font-bold text-slate-500 mb-1 block">หมายเหตุบิล</label>'
            + '<input id="eb-note" class="w-full border border-sand rounded-xl p-2.5 mb-5" value="' + q(order.note) + '">'
            + '<div class="flex gap-2">'
            + '<button onclick="Controller.closeEditBill()" class="flex-1 border border-slate-200 rounded-2xl py-2.5 font-bold text-slate-500">ยกเลิก</button>'
            + '<button onclick="Controller.saveEditBill()" class="flex-1 bg-gradient-to-b from-primary to-secondary text-white rounded-2xl py-2.5 font-bold hover:brightness-110 transition">บันทึกการแก้ไข</button>'
            + '</div>'
            + '<p class="text-[10px] text-slate-400 mt-3">ใส่จำนวนเป็น 0 เพื่อลบรายการนั้นออกจากบิล ระบบจะคำนวณยอดรวมใหม่ให้อัตโนมัติ</p>'
            + '</div>';
          document.body.appendChild(wrap);
        },

        closeEditBill() {
          const m = document.getElementById('modal-edit-bill');
          if (m) m.remove();
        },

        async saveEditBill() {
          const data = this.editBillData;
          if (!data) return;
          const items = data.items.map((it, i) => {
            const qe = document.getElementById('eb-qty-' + i);
            const pe = document.getElementById('eb-price-' + i);
            return { id: it.id, qty: qe ? Number(qe.value) || 0 : it.qty, price: pe ? Number(pe.value) || 0 : it.price, note: it.note || '' };
          }).filter(it => it.id !== undefined && it.id !== null);
          const payEl = document.getElementById('eb-payment');
          const noteEl = document.getElementById('eb-note');
          const paymentType = payEl ? payEl.value : '';
          const note = noteEl ? noteEl.value : '';
          const ok = await this.showConfirm('ยืนยันบันทึกการแก้ไขบิล ' + data.invoice + ' หรือไม่?', '');
          if (!ok) return;
          this.closeEditBill();
          this.showLoading();
          google.script.run
            .withSuccessHandler(res => {
              this.hideLoading();
              if (res && res.success) {
                this.logPinAttempt('แก้ไขบิล: ' + data.invoice, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
                this.showAlert('บันทึกการแก้ไขแล้ว', '');
                if (this.historyViewDate) this.loadHistoryDate(this.historyViewDate);
                else this.fetchServerData();
              } else {
                this.showAlert((res && res.error) || 'แก้ไขไม่สำเร็จ', '');
                // ถ้าชนกันเพราะมีคนอื่นแก้บิลนี้ไปก่อน โหลดข้อมูลล่าสุดมาให้ ลองใหม่รอบหน้าจะได้ไม่ชนซ้ำ
                if (this.historyViewDate) this.loadHistoryDate(this.historyViewDate);
                else this.fetchServerData();
              }
            })
            .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
            .updateOrderDetails({ invoice: data.invoice, items: items, paymentType: paymentType, note: note, expectedTotal: data.expectedTotal });
        },

renderReport(r) {
          this.lastReport = r;
        const fmt = n => `฿${(n || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        document.getElementById('report-result').classList.remove('hidden');
        document.getElementById('rp-total').innerText = fmt(r.total);
        document.getElementById('rp-profit').innerText = fmt(r.totalProfit);
        document.getElementById('rp-bills').innerText = r.billCount.toLocaleString();
        document.getElementById('rp-cups').innerText = r.cupCount.toLocaleString();
        document.getElementById('rp-cost').innerText = fmt(r.totalCost);
        document.getElementById('rp-waste-cost').innerText = fmt(r.wasteCost);
        document.getElementById('rp-refund-total').innerText = fmt(r.refundedTotal);
        document.getElementById('rp-avg').innerText = fmt(r.avgPerBill);
        document.getElementById('rp-cash').innerText = fmt(r.cash);
        document.getElementById('rp-other').innerText = fmt(r.other);

        const byTypeEl = document.getElementById('rp-bytype');
        const typeEntries = Object.entries(r.byType || {});
        byTypeEl.innerHTML = typeEntries.length === 0
          ? '<p class="text-xs text-slate-300">ไม่มีข้อมูล</p>'
          : typeEntries.map(([name, amt]) => `
              <div class="flex justify-between text-sm">
                <span class="text-slate-500 font-bold">${escHtml(name)}</span>
                <span class="text-secondary font-black">${fmt(amt)}</span>
              </div>
            `).join('');

        const topEl = document.getElementById('rp-topsellers');
        topEl.innerHTML = (!r.topSellers || r.topSellers.length === 0)
          ? '<p class="text-xs text-slate-300">ไม่มีข้อมูล</p>'
          : r.topSellers.map((item, i) => `
              <div class="flex justify-between items-center text-sm">
                <span class="text-slate-600 font-bold truncate mr-2">${i + 1}. ${escHtml(item.name)}</span>
                <span class="text-secondary font-black whitespace-nowrap">
                  ${item.qty} แก้ว · ${fmt(item.amount)}
                  ${item.hasCost
                    ? `<span class="text-xs font-bold ${item.marginPct >= 50 ? 'text-emerald-500' : 'text-amber-500'} ml-1">(กำไร ${item.marginPct.toFixed(0)}%)</span>`
                    : `<span class="text-xs font-bold text-slate-300 ml-1">(ยังไม่ระบุต้นทุน)</span>`}
                </span>
              </div>
            `).join('');

        const wdEl = document.getElementById('rp-weekday');
        const maxAvg = Math.max(1, ...(r.byWeekday || []).map(w => w.avgPerDay));
        wdEl.innerHTML = (!r.byWeekday || r.byWeekday.length === 0)
          ? '<p class="text-xs text-slate-300">ไม่มีข้อมูล</p>'
          : r.byWeekday.map(w => `
              <div class="flex items-center gap-3 text-sm">
                <span class="w-16 shrink-0 text-slate-500 font-bold">${w.label}</span>
                <div class="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div class="bg-primary h-full rounded-full" style="width:${(w.avgPerDay / maxAvg * 100).toFixed(0)}%"></div>
                </div>
                <span class="w-20 shrink-0 text-right text-secondary font-black">${fmt(w.avgPerDay)}</span>
              </div>
            `).join('');

        const hourEl = document.getElementById('rp-hourly');
        const hoursWithData = (r.byHour || []).filter(h => h.bills > 0);
        const maxBills = Math.max(1, ...hoursWithData.map(h => h.bills));
        const peakHours = new Set(
          [...hoursWithData].sort((a, b) => b.bills - a.bills).slice(0, 3).map(h => h.hour)
        );
        hourEl.innerHTML = hoursWithData.length === 0
          ? '<p class="text-xs text-slate-300">ไม่มีข้อมูล</p>'
          : hoursWithData.map(h => `
              <div class="flex items-center gap-3 text-sm">
                <span class="w-14 shrink-0 text-slate-500 font-bold">${h.label}</span>
                <div class="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div class="${peakHours.has(h.hour) ? 'bg-amber-500' : 'bg-primary'} h-full rounded-full" style="width:${(h.bills / maxBills * 100).toFixed(0)}%"></div>
                </div>
                <span class="w-16 shrink-0 text-right text-secondary font-black whitespace-nowrap">${h.bills} บิล</span>
                ${peakHours.has(h.hour) ? '<span class="text-[10px] font-black text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0">พีค</span>' : '<span class="w-8 shrink-0"></span>'}
              </div>
            `).join('');

        const dailyEl = document.getElementById('rp-daily');
        dailyEl.innerHTML = (!r.daily || r.daily.length === 0)
          ? '<p class="text-xs text-slate-300">ไม่มีข้อมูลในช่วงเวลานี้</p>'
          : r.daily.map(d => `
              <div class="flex justify-between items-center text-sm py-1.5 border-b border-slate-50 last:border-0">
                <span class="text-slate-500 font-bold">${new Date(d.date + 'T00:00:00').toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: '2-digit'})}</span>
                <span class="text-xs text-slate-400">${d.bills} บิล · ${d.cups} แก้ว</span>
                <span class="text-secondary font-black whitespace-nowrap">${fmt(d.total)}</span>
              </div>
            `).join('');
      },

      fetchPaymentMethods(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.paymentMethods = data;
            localStorage.setItem('pos_paymentMethods', JSON.stringify(data));
            this.renderPaymentMethodList();
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดวิธีชำระเงินไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getPaymentMethods();
      },

      renderPaymentMethodList() {
        const container = document.getElementById('payment-method-list');
        if (!container) return;

        if (this.paymentMethods.length === 0) {
          container.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>ยังไม่มีวิธีชำระเงิน</div>';
          return;
        }

        container.innerHTML = this.paymentMethods.map(m => `
          <div class="flex items-center justify-between p-4 hover:bg-cream transition-colors">
            <div>
              <p class="font-bold text-secondary">${escHtml(m.name)} ${m.isCash ? '<span class="text-xs text-emerald-500 ml-1">(เงินสด)</span>' : ''}</p>
              <div class="flex items-center gap-2 mt-1">
                <span class="w-2 h-2 rounded-full ${m.enabled ? 'bg-emerald-400' : 'bg-slate-300'}"></span>
                <span class="text-xs text-slate-500">${m.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
              </div>
            </div>
            <div class="flex gap-3">
              <button onclick="Controller.togglePaymentMethodEnabled('${m.id}')" class="text-sm font-bold text-primary hover:underline">${m.enabled ? 'ปิด' : 'เปิด'}</button>
              <button onclick="Controller.openPaymentMethodForm('${m.id}')" class="text-sm font-bold text-primary hover:underline">แก้ไข</button>
              <button onclick="Controller.deletePaymentMethodConfirm('${m.id}')" class="text-sm font-bold text-red-400 hover:underline">ลบ</button>
            </div>
          </div>
        `).join('');
      },

      openPaymentMethodForm(id = null) {
        document.getElementById('pm-form-id').value = id || '';
        if (id) {
          const m = this.paymentMethods.find(x => x.id === id);
          if (m) {
            document.getElementById('pm-form-title').innerText = 'แก้ไขวิธีชำระเงิน';
            document.getElementById('pm-form-name').value = m.name;
            document.getElementById('pm-form-is-cash').checked = m.isCash;
            document.getElementById('pm-form-enabled').checked = m.enabled;
          }
        } else {
          document.getElementById('pm-form-title').innerText = 'เพิ่มวิธีชำระเงิน';
          document.getElementById('pm-form-name').value = '';
          document.getElementById('pm-form-is-cash').checked = false;
          document.getElementById('pm-form-enabled').checked = true;
        }
        this.openModal('modal-payment-method-form');
      },

      async savePaymentMethodForm() {
        const id = document.getElementById('pm-form-id').value;
        const name = document.getElementById('pm-form-name').value.trim();
        const isCash = document.getElementById('pm-form-is-cash').checked;
        const enabled = document.getElementById('pm-form-enabled').checked;

        if (!name) {
          await this.showAlert('กรุณากรอกชื่อวิธีชำระเงิน', '');
          return;
        }

        /* ถ้าไม่มี id แปลว่าเป็นการเพิ่มใหม่ ต้องสร้าง id ที่นี่
           ไม่งั้นจะส่ง id ว่างไปทับรายการเดิมที่ id ว่างเหมือนกัน */
        const methodId = id || ('PM-' + Date.now());
        const method = { id: methodId, name, isCash, enabled, createdBy: this.currentSettingsUser ? this.currentSettingsUser.name : '', actorId: this.currentSettingsUser ? this.currentSettingsUser.id : '', actorName: this.currentSettingsUser ? this.currentSettingsUser.name : '' };

        this.closeModal('modal-payment-method-form');
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            if (res.success) {
              this.logPinAttempt(id ? `แก้ไขวิธีชำระเงิน: ${name}` : `เพิ่มวิธีชำระเงิน: ${name}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.fetchPaymentMethods();
            } else {
              this.setIndicator('error');
              this.showAlert(res.message || 'บันทึกไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .savePaymentMethod(method);
      },

      togglePaymentMethodEnabled(id) {
        const m = this.paymentMethods.find(x => x.id === id);
        if (!m) return;
        const updated = { id: m.id, name: m.name, isCash: m.isCash, enabled: !m.enabled, actorId: this.currentSettingsUser ? this.currentSettingsUser.id : '', actorName: this.currentSettingsUser ? this.currentSettingsUser.name : '' };
        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            if (res.success) {
              this.fetchPaymentMethods();
            } else {
              this.setIndicator('error');
              this.showAlert(res.message || 'อัปเดตไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .savePaymentMethod(updated);
      },

      async deletePaymentMethodConfirm(id) {
        const ok = await this.showConfirm('ต้องการลบวิธีชำระเงินนี้ใช่หรือไม่?', '');
        if (!ok) return;

        const auth = await this.requireActionPin('ใส่รหัส PIN เพื่อยืนยันการลบวิธีชำระเงิน:');
        if (!auth) return;

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            if (res.success) {
              this.fetchPaymentMethods();
            } else {
              this.setIndicator('error');
              this.showAlert(res.message || 'ลบไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .deletePaymentMethod({ id, employeeId: auth.employeeId, pin: auth.pin });
      },

      fetchBackupList(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.renderBackupList(data);
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดรายการ backup ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getBackupList();
      },

      renderBackupList(data) {
        const list = document.getElementById('backup-list');
        if (!list) return;

        this.renderBackupStaleWarning(data);

        if (!data || data.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 13h8v6H8z"/></svg>ยังไม่มีไฟล์ backup กดปุ่ม "สำรองข้อมูลเดี๋ยวนี้" เพื่อสร้างไฟล์แรก</div>';
          return;
        }

        list.innerHTML = data.map(f => `
          <div class="p-4 flex justify-between items-center gap-3">
            <div class="min-w-0">
              <p class="font-bold text-secondary text-sm truncate">${escHtml(f.label || ('Backup #' + f.id))}</p>
              <p class="text-xs text-slate-400 mt-0.5">${new Date(f.created_at).toLocaleString()}</p>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <button onclick="Controller.exportBackupToExcel(${f.id})" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-primary bg-primary/10 rounded-full active:scale-95 transition-all whitespace-nowrap">Export Excel</button>
              <button onclick="Controller.deleteBackupConfirm(${f.id})" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ลบ</button>
            </div>
          </div>
        `).join('');
      },

      // เตือนถ้ายังไม่มี backup เลย หรือ backup ล่าสุดเก่ากว่ารอบ auto-backup (30 วัน) เผื่อ Cron ที่ Cloudflare หยุดทำงานไปเงียบๆ
      renderBackupStaleWarning(data) {
        const el = document.getElementById('backup-stale-warning');
        if (!el) return;
        const newest = data && data.length > 0 ? data[0] : null;
        const staleDays = 35;
        const isStale = !newest || (Date.now() - new Date(newest.created_at).getTime()) > staleDays * 24 * 3600 * 1000;
        if (isStale) {
          el.textContent = newest
            ? `ไม่มีการสำรองข้อมูลใหม่ในช่วง ${staleDays} วันที่ผ่านมา (ล่าสุด: ${new Date(newest.created_at).toLocaleDateString()}) ลองตรวจสอบ Cron Trigger ที่ Cloudflare หรือกด "สำรองข้อมูล + ดาวน์โหลดทันที" ด้านบน`
            : 'ยังไม่มีการสำรองข้อมูลในระบบเลย กด "สำรองข้อมูล + ดาวน์โหลดทันที" ด้านบนเพื่อสร้างไฟล์แรก';
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      },

      async deleteBackupConfirm(id) {
        const ok = await this.showConfirm('ต้องการลบไฟล์ backup นี้ใช่หรือไม่? กู้คืนไม่ได้หลังจากลบแล้ว', '');
        if (!ok) return;

        const auth = await this.requireActionPin('ใส่รหัส PIN ของเจ้าของ/ผู้ดูแลระบบเพื่อยืนยันการลบ backup:');
        if (!auth) return;

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            if (res && res.success) {
              this.setIndicator('synced');
              this.fetchBackupList();
            } else {
              this.setIndicator('error');
              this.showAlert((res && res.error) || 'ลบไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setIndicator('error');
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', '');
          })
          .deleteBackup({ id, employeeId: auth.employeeId, pin: auth.pin });
      },

      // แปลง array ของ object เป็นข้อความ CSV หนึ่งตาราง (เปิดใน Excel ได้โดยตรง)
      _rowsToCsv(rows) {
        if (!rows || rows.length === 0) return '';
        const cols = Object.keys(rows[0]);
        const esc = v => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [cols.map(esc).join(',')];
        for (const row of rows) lines.push(cols.map(c => esc(row[c])).join(','));
        return lines.join('\r\n');
      },

      _downloadTextFile(filename, content, mime) {
        const blob = new Blob(['﻿' + content], { type: mime || 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },

      // รวมข้อมูล backup หลายตาราง (object: {ชื่อตาราง: [แถว, ...]}) เป็น CSV ไฟล์เดียว คั่นแต่ละตารางด้วยหัวข้อ
      _buildBackupCsv(data) {
        const sections = [];
        for (const table of Object.keys(data)) {
          sections.push('# ' + table);
          sections.push(this._rowsToCsv(data[table]) || '(no data)');
          sections.push('');
        }
        return sections.join('\r\n');
      },

      exportBackupToExcel(id) {
        google.script.run
          .withSuccessHandler(res => {
            if (!res.success) {
              this.showAlert('ไม่พบข้อมูล backup นี้', '');
              return;
            }
            this._downloadTextFile(`pukfu-backup-${id}.csv`, this._buildBackupCsv(res.data));
          })
          .withFailureHandler(() => {
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getBackupData(id);
      },

      // สำรองข้อมูล + ดาวน์โหลดไฟล์ CSV ทันทีในคลิกเดียว (เดิมต้องกดสำรองก่อน แล้วไปหาไฟล์ในลิสต์เพื่อกด Export Excel อีกที)
      manualBackupNow(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(res => {
            this.setBtnLoading(btn, false);
            if (res.success) {
              this.logPinAttempt('สำรองข้อมูลด้วยตนเอง', true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              if (res.data) {
                this._downloadTextFile(`pukfu-backup-${res.label}.csv`, this._buildBackupCsv(res.data));
              }
              this.showAlert('สำรองข้อมูลสำเร็จแล้ว และดาวน์โหลดไฟล์ให้แล้ว: ' + res.label, '');
              this.fetchBackupList();
            } else {
              this.showAlert(res.message || 'สำรองข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .createBackup();
      },

      fetchArchiveList(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(data => {
            this.setBtnLoading(btn, false);
            this.renderArchiveList(data);
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('โหลดรายการ archive ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .getArchiveList();
      },

      renderArchiveList(data) {
        const list = document.getElementById('archive-list');
        if (!list) return;

        if (!data || data.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>ยังไม่มีข้อมูลปีเก่าที่ต้อง archive</div>';
          return;
        }

        list.innerHTML = data.map(f => `
          <div class="p-4 flex justify-between items-center gap-3">
            <div class="min-w-0">
              <p class="font-bold text-secondary text-sm truncate">${escHtml(f.name)}</p>
              <p class="text-xs text-slate-400 mt-0.5">สร้างเมื่อ ${new Date(f.createdAt).toLocaleDateString()}</p>
            </div>
            <a href="${f.url}" target="_blank" rel="noopener" class="shrink-0 text-sm font-bold text-primary hover:underline">เปิดไฟล์</a>
          </div>
        `).join('');
      },

      async manualArchiveNow(btn) {
        const ok = await this.showConfirm(
          'จะย้ายข้อมูล Sales, Payments, Log ต่างๆ ของปีเก่ากว่าปัจจุบัน ไปเก็บไว้ในไฟล์ archive แยกตามปี และลบออกจาก Sheet หลัก แนะนำให้กด "สำรองข้อมูลเดี๋ยวนี้" ไว้ก่อนเผื่อไว้ ต้องการดำเนินการต่อหรือไม่?',
          ''
        );
        if (!ok) return;

        const auth = await this.requireActionPin('ใส่รหัส PIN ของเจ้าของ/ผู้ดูแลระบบเพื่อยืนยันการ archive ข้อมูล:');
        if (!auth) return;

        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(res => {
            this.setBtnLoading(btn, false);
            if (res.success) {
              const yearsText = res.archivedYears && res.archivedYears.length > 0 ? res.archivedYears.join(', ') : 'ไม่มี';
              this.logPinAttempt(`Archive ข้อมูลปี: ${yearsText}`, true, auth.employee.name);
              this.showAlert(`เก็บข้อมูลเรียบร้อยแล้ว\nปีที่ archive: ${yearsText}\nจำนวนแถวที่ย้าย: ${res.totalArchivedRows || 0}`, '');
              this.fetchArchiveList();
              this.fetchServerData();
            } else {
              this.showAlert(res.message || res.error || 'เก็บข้อมูลไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .archiveOldData({ employeeId: auth.employeeId, pin: auth.pin });
      },

      renderMenu() {
        const grid = document.getElementById('menu-grid');
        
        const filteredItems = this.activeCategory === 'All'
          ? this.menuData
          : this.menuData.filter(item => (item.category || 'อื่นๆ') === this.activeCategory);

        grid.innerHTML = filteredItems.map((item) => {
          const originalIdx = this.menuData.indexOf(item);
          const isSoldOut = this.soldOutItems.includes(item.name);
          
          let cardStyle = "bg-white rounded-3xl shadow-md border border-sand cursor-pointer overflow-hidden flex flex-col relative group transition-all duration-200 ";
          
          if (this.isStockMode) {
             cardStyle += "border-amber-400 border-2 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] ";
          } else {
             cardStyle += "hover:shadow-lg hover:shadow-primary/10 hover:border-primary/40 hover:-translate-y-0.5 active:scale-[0.98] ";
          }

          if (isSoldOut && !this.isStockMode) {
             cardStyle += "opacity-60 grayscale ";
          }

          const soldOutBadge = isSoldOut 
            ? `<div class="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
                 <span class="bg-red-500 text-white font-black px-4 py-1.5 rounded-lg shadow-xl -rotate-6 text-xl tracking-wider border-2 border-white">SOLD OUT</span>
               </div>` 
            : ``;

          return `
            <div onclick="Controller.selectProduct(${originalIdx})" class="${cardStyle}">
              ${soldOutBadge}
              <div class="h-32 bg-gradient-to-br from-accent to-sand w-full relative overflow-hidden">
                ${item.image
                  ? `<div class="absolute inset-0 bg-cover bg-center transition-transform duration-300 ${!isSoldOut && !this.isStockMode ? 'group-hover:scale-105' : ''}" style="background-image: url('${item.image}');"></div>`
                  : `<div class="absolute inset-0 flex items-center justify-center text-primary/25"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.75rem;height:2.75rem"><path d="M6 8h12l-1.2 11a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M9.5 12.5c1 .8 2 .8 3 0s2-.8 3 0" /></svg></div>`
                }
              </div>
              <div class="p-4 flex flex-col justify-between flex-1">
                <div>
                  <p class="font-bold text-secondary text-sm leading-tight line-clamp-2">${escHtml(item.name)}</p>
                  <p class="text-xs text-slate-400 mt-1">${item.lang2 || '&nbsp;'}</p>
                </div>
                <div class="flex justify-between items-center mt-3 pt-3 border-t border-sand relative z-20">
                  <p class="text-primary font-black text-lg">฿${item.price}</p>
                  ${!this.isStockMode && !isSoldOut ? `<div class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg group-hover:bg-primary group-hover:text-white group-active:bg-primary group-active:text-white transition-colors">+</div>` : ''}
                  ${this.isStockMode ? `<div class="text-xs font-bold ${isSoldOut ? 'text-red-500' : 'text-emerald-500'}">${isSoldOut ? ' หมด' : ' มีของ'}</div>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      },

      selectProduct(idx) {
        const item = this.menuData[idx];

        if (this.isStockMode) {
          const currentlySoldOut = this.soldOutItems.includes(item.name);
          const newStatus = !currentlySoldOut;

          //  ส่งคำสั่งไปอัปเดตสถานะของหมดบน Google Sheet
          this.setIndicator('syncing');
          google.script.run
            .withSuccessHandler(res => {
              if (res.success) {
                if (newStatus) {
                  this.soldOutItems.push(item.name);
                } else {
                  this.soldOutItems = this.soldOutItems.filter(name => name !== item.name);
                }
                localStorage.setItem('pos_soldOut', JSON.stringify(this.soldOutItems));
                this.renderMenu();
                this.setIndicator('synced');
              } else {
                this.setIndicator('error');
                this.showAlert('อัปเดตสถานะสินค้าหมดล้มเหลว กรุณาลองใหม่', '');
              }
            })
            .withFailureHandler(() => {
              this.setIndicator('error');
              this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ สถานะสินค้าหมดยังไม่ถูกบันทึก กรุณาลองใหม่', '');
            })
            .toggleSoldOut({ sku: item.sku, isSoldOut: newStatus });

          return;
        }

        if (this.soldOutItems.includes(item.name)) return; 

        this.activeProduct = item;
        this.selectedAddons = [];
        this.editingCartIndex = null;
        document.getElementById('modal-product-name').innerText = this.activeProduct.name;
        document.getElementById('modal-note').value = '';
        this.updateAddonButtons();
        this.updateSweetnessButtons();

        document.querySelectorAll('.mod-btn').forEach(btn => {
          btn.classList.remove('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
          btn.classList.add('text-slate-500', 'border-slate-200');
          btn.removeAttribute('data-selected');
        });
        
        const addBtnNew = document.getElementById('btn-modal-add-cart');
        if (addBtnNew) addBtnNew.innerText = 'Add to Cart';

        this.openModal('modal-product');
      },

      selectSweetness(selectedBtn) {
        document.querySelectorAll('.mod-btn').forEach(btn => {
          btn.classList.remove('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
          btn.classList.add('text-slate-500', 'border-slate-200');
          btn.removeAttribute('data-selected');
        });
        selectedBtn.classList.remove('text-slate-500', 'border-slate-200');
        selectedBtn.classList.add('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
        selectedBtn.setAttribute('data-selected', 'true');
      },

      toggleAddon(id) {
        const index = this.selectedAddons.findIndex(a => a.id === id);
        if (index === -1) {
          const addon = this.addons.find(a => a.id === id);
          if (addon) this.selectedAddons.push(addon);
        } else {
          this.selectedAddons.splice(index, 1);
        }
        this.updateAddonButtons();
      },

      updateSweetnessButtons() {
        const container = document.getElementById('modal-sweetness-container');
        if (!container) return;
        let html = '';
        this.sweetnessLevels.forEach(sw => {
          html += `<button class="mod-btn border border-sand px-4 min-h-[2.75rem] inline-flex items-center justify-center rounded-full text-sm font-bold text-slate-500 hover:bg-accent active:scale-95 transition-all" onclick="Controller.selectSweetness(this)">${escHtml(sw.name)}</button>`;
        });
        container.innerHTML = html;
      },

      updateAddonButtons() {
        const container = document.getElementById('modal-addons-container');
        if (!container) return;
        let html = '';
        const activeAddons = this.addons.filter(a => a.active);
        if (activeAddons.length === 0) {
          html = '<p class="text-slate-400 text-sm">ไม่มีส่วนเสริม</p>';
        } else {
          activeAddons.forEach(addon => {
            const isSelected = this.selectedAddons.some(a => a.id === addon.id);
            const activeClass = isSelected ? 'bg-gradient-to-b from-primary to-secondary text-white border-primary' : 'border-sand text-slate-500 hover:bg-accent';
            const priceDisplay = addon.price >= 0 ? `+฿${addon.price}` : `-฿${Math.abs(addon.price)}`;
            html += `<button onclick="Controller.toggleAddon('${addon.id}')" class="border px-4 min-h-[2.75rem] inline-flex items-center justify-center rounded-full text-sm font-bold active:scale-95 transition-all ${activeClass}">${escHtml(addon.name)} (${priceDisplay})</button>`;
          });
        }
        container.innerHTML = html;
      },

      async addToCartFromModal() {
        const selectedSweetnessBtn = document.querySelector('.mod-btn[data-selected="true"]');
        if (!selectedSweetnessBtn) {
          await this.showAlert('กรุณาเลือกระดับความหวาน (Sweetness Level) ก่อนทำรายการครับ', '');
          return;
        }

        const sweetness = selectedSweetnessBtn.innerText;
        const textNote = document.getElementById('modal-note').value.trim();
        
        let finalNote = `ความหวาน: ${sweetness}`;
        let additionalPrice = 0;
        
        if (this.selectedAddons.length > 0) {
          this.selectedAddons.forEach(addon => {
            const priceDisplay = addon.price >= 0 ? `+฿${addon.price}` : `-฿${Math.abs(addon.price)}`;
            finalNote += ` | ${addon.name} (${priceDisplay})`;
            additionalPrice += addon.price;
          });
        }
        
        if (textNote) finalNote += ` | ${textNote}`;

        // ราคาจะต้องไม่ติดลบ (ถ้าส่วนลดเยอะกว่าค่าสินค้า ให้ราคาเป็น 0)
        const finalPrice = Math.max(0, this.activeProduct.price + additionalPrice);
        const addonIds = this.selectedAddons.map(a => a.id);

        const editIdx = this.editingCartIndex;
        const isEditing = (editIdx !== null && editIdx !== undefined && this.cart[editIdx]);

        if (isEditing) {
          const oldQty = this.cart[editIdx].qty || 1;
          this.cart[editIdx] = {
            ...this.activeProduct,
            price: finalPrice,
            qty: oldQty,
            note: finalNote,
            sweetness: sweetness,
            addonIds: addonIds,
            textNote: textNote
          };

          // ถ้าแก้ไขแล้วไปเหมือนกับอีกรายการในตะกร้า ให้ยุบรวมเป็นรายการเดียว
          const twinIdx = this.cart.findIndex((it, i) => i !== editIdx && it.sku === this.activeProduct.sku && it.note === finalNote);
          if (twinIdx !== -1) {
            this.cart[twinIdx].qty += oldQty;
            this.cart.splice(editIdx, 1);
          }
          this.editingCartIndex = null;
        } else {
          const existingItem = this.cart.find(item => item.sku === this.activeProduct.sku && item.note === finalNote);

          if (existingItem) {
            existingItem.qty += 1;
          } else {
            this.cart.push({
              ...this.activeProduct,
              price: finalPrice,
              qty: 1,
              note: finalNote,
              sweetness: sweetness,
              addonIds: addonIds,
              textNote: textNote
            });
          }
        }
        
        this.renderCart();
        this.closeModal('modal-product');
      },

      // อ่านตัวเลือกเดิมของรายการในตะกร้า (ความหวาน / ส่วนเสริม / โน้ต)
      parseCartItemOptions(item) {
        const result = { sweetness: '', addons: [], textNote: '' };
        if (!item) return result;

        // รายการที่บันทึกด้วยเวอร์ชันใหม่ จะมีข้อมูลโครงสร้างครบอยู่แล้ว
        if (Array.isArray(item.addonIds)) {
          result.sweetness = item.sweetness || '';
          result.textNote = item.textNote || '';
          result.addons = item.addonIds
            .map(id => (this.addons || []).find(a => a.id === id))
            .filter(Boolean);
          return result;
        }

        // รายการเก่า: ถอดข้อมูลย้อนหลังจากข้อความ note
        const parts = String(item.note || '').split('|').map(s => s.trim()).filter(Boolean);
        parts.forEach(part => {
          if (part.indexOf('ความหวาน:') === 0) {
            result.sweetness = part.replace('ความหวาน:', '').trim();
            return;
          }
          const addonName = part.replace(/\s*\([^)]*\)\s*$/, '').trim();
          const found = (this.addons || []).find(a => a.name === addonName);
          if (found) {
            result.addons.push(found);
          } else {
            result.textNote = result.textNote ? (result.textNote + ' | ' + part) : part;
          }
        });
        return result;
      },

      // เปิดหน้าต่างตัวเลือกอีกครั้ง เพื่อแก้ไขรายการที่อยู่ในตะกร้า
      editCartItem(idx) {
        const item = this.cart[idx];
        if (!item) return;

        const info = this.parseCartItemOptions(item);
        const baseProduct = (this.menuData || []).find(m => m.sku === item.sku);

        if (baseProduct) {
          this.activeProduct = baseProduct;
        } else {
          // ไม่เจอในเมนู (เช่นสินค้าถูกลบไปแล้ว) ให้ถอดราคาส่วนเสริมออกเพื่อหาราคาฐาน
          const addonSum = info.addons.reduce((s, a) => s + (Number(a.price) || 0), 0);
          const fallback = Object.assign({}, item, { price: Math.max(0, item.price - addonSum) });
          delete fallback.qty;
          delete fallback.note;
          delete fallback.sweetness;
          delete fallback.addonIds;
          delete fallback.textNote;
          this.activeProduct = fallback;
        }

        this.editingCartIndex = idx;
        this.selectedAddons = info.addons.slice();

        document.getElementById('modal-product-name').innerText = 'แก้ไข: ' + item.name;
        document.getElementById('modal-note').value = info.textNote || '';
        this.updateAddonButtons();
        this.updateSweetnessButtons();

        let matchBtn = null;
        document.querySelectorAll('.mod-btn').forEach(btn => {
          btn.classList.remove('bg-gradient-to-b', 'from-primary', 'to-secondary', 'text-white', 'border-primary');
          btn.classList.add('text-slate-500', 'border-slate-200');
          btn.removeAttribute('data-selected');
          if (info.sweetness && btn.innerText.trim() === info.sweetness) matchBtn = btn;
        });
        if (matchBtn) this.selectSweetness(matchBtn);

        const addBtnEdit = document.getElementById('btn-modal-add-cart');
        if (addBtnEdit) addBtnEdit.innerText = 'บันทึกการแก้ไข';

        this.openModal('modal-product');
      },

      renderCart() {
        const container = document.getElementById('cart-items');
        let total = 0;
        const btnHold = document.getElementById('btn-hold-order');
        const btnCheckout = document.getElementById('btn-checkout');
        const btnPrintSlip = document.getElementById('btn-print-order-slip');
        const btnShowHeld = document.getElementById('btn-show-held-orders');

        if (this.cart.length === 0) {
           container.innerHTML = `<div class="flex flex-col items-center justify-center gap-2 my-auto text-slate-400">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h10L20 7H6"/></svg>
             <span class="text-sm font-bold">ไม่มีสินค้าในตะกร้า</span>
           </div>`;
           if(btnHold) btnHold.classList.add('hidden');
           if(btnPrintSlip) btnPrintSlip.classList.add('hidden');
           if(btnCheckout) { btnCheckout.classList.remove('flex-[2]'); btnCheckout.classList.add('flex-1'); }
        } else {
          container.innerHTML = this.cart.map((item, idx) => {
            total += item.price * item.qty;
            return `
              <div class="flex justify-between items-start bg-white p-3 rounded-2xl border border-sand shadow-sm gap-2">
                <div class="flex-1 min-w-0">
                  <p class="font-bold text-sm text-secondary truncate">${escHtml(item.name)}</p>
                  <p class="text-xs text-slate-400 mt-0.5">${escHtml(item.note || '-')}</p>
                  <p class="font-black text-sm text-primary mt-1">฿${(item.price * item.qty).toFixed(2)}</p>
                </div>
                <div class="flex flex-col items-end gap-2 shrink-0">
                  <div class="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-100">
                    <button onclick="Controller.updateQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full hover:bg-slate-200 active:bg-slate-300 active:scale-95 font-bold text-slate-600 shadow-sm">-</button>
                    <span class="w-6 text-center font-bold text-sm">${item.qty}</span>
                    <button onclick="Controller.updateQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center bg-white rounded-full hover:bg-slate-200 active:bg-slate-300 active:scale-95 font-bold text-slate-600 shadow-sm">+</button>
                  </div>
                            <div class="flex items-center gap-1">
                                <button onclick="Controller.editCartItem(${idx})" class="text-primary text-xs font-bold underline p-2">แก้ไข</button>
                                <button onclick="Controller.removeFromCart(${idx})" class="text-red-400 hover:text-red-600 active:text-red-600 text-xs font-bold underline p-2">Remove</button>
                            </div>
                </div>
              </div>
            `;
          }).join('');
          if(btnHold) btnHold.classList.remove('hidden');
          if(btnPrintSlip) btnPrintSlip.classList.remove('hidden');
          if(btnCheckout) { btnCheckout.classList.remove('flex-1'); btnCheckout.classList.add('flex-[2]'); }
        }
        document.getElementById('cart-total').innerText = `฿${total.toFixed(2)}`;
        
        const totalMobileEl = document.getElementById('cart-total-mobile');
        if(totalMobileEl) totalMobileEl.innerText = `฿${total.toFixed(2)}`;
        
        const badge = document.getElementById('cart-badge-mobile');
        const totalItems = this.cart.reduce((s, i) => s + i.qty, 0);
        if (badge) {
          if (totalItems > 0) {
            badge.innerText = totalItems;
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
            if (this.isCartOpenMobile) this.toggleMobileCart();
          }
        }
        if(btnShowHeld) {
           if (this.heldOrders && this.heldOrders.length > 0) {
             btnShowHeld.classList.remove('hidden'); btnShowHeld.innerText = `พักไว้ (${this.heldOrders.length})`;
           } else { btnShowHeld.classList.add('hidden'); }
        }
      },

      holdCurrentOrder() {
        if (this.cart.length === 0) return;
        const total = this.cart.reduce((s, i) => s + (i.price * i.qty), 0);
        const name = this.cart.map(i => i.name).join(', ').substring(0, 30) + '...';
        this.heldOrders.push({
          id: 'HOLD-' + new Date().getTime(),
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          items: [...this.cart], total, summary: name
        });
        this.cart = []; this.saveLocalState(); this.renderCart();
        this.showAlert('พักบิลเรียบร้อยแล้วครับ', '');
      },

      openHeldOrdersModal(e) {
        if(e) e.stopPropagation();
        this.renderHeldOrders();
        this.openModal('modal-held-orders');
      },

      renderHeldOrders() {
        const list = document.getElementById('held-orders-list');
        if (this.heldOrders.length === 0) {
          list.innerHTML = '<div class="text-center text-slate-400 font-bold py-8">ไม่มีบิลที่พักไว้</div>';
          return;
        }
        list.innerHTML = this.heldOrders.map((h, idx) => `
          <div class="py-4 flex justify-between items-center gap-4">
            <div class="flex-1 min-w-0">
              <p class="font-bold text-secondary truncate">${h.summary}</p>
              <p class="text-xs text-slate-400">เวลา: ${h.time} • ยอด: ฿${h.total.toFixed(2)}</p>
            </div>
            <div class="flex gap-2">
              <button onclick="Controller.restoreHeldOrder(${idx})" class="bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-bold text-sm hover:bg-primary hover:text-white transition-all">ดึงบิล</button>
              <button onclick="Controller.deleteHeldOrder(${idx})" class="bg-red-50 text-red-400 px-3 py-1.5 rounded-lg font-bold text-sm hover:bg-red-400 hover:text-white transition-all">ลบ</button>
            </div>
          </div>
        `).join('');
      },

      async restoreHeldOrder(idx) {
        if (this.cart.length > 0) {
          const ok = await this.showConfirm('มีสินค้าค้างอยู่ในตะกร้า ต้องการ "พักบิลปัจจุบัน" แล้วดึงบิลนี้มาแทนที่ไหม?', '');
          if (!ok) return;
          this.holdCurrentOrder(); 
        }
        this.cart = [...this.heldOrders[idx].items];
        this.heldOrders.splice(idx, 1);
        this.saveLocalState(); this.renderCart(); this.closeModal('modal-held-orders');
      },

      async deleteHeldOrder(idx) {
        const ok = await this.showConfirm('ต้องการลบบิลที่พักไว้นี้ทิ้งใช่ไหม?', '');
        if (ok) {
          this.heldOrders.splice(idx, 1);
          this.saveLocalState(); this.renderHeldOrders(); this.renderCart(); 
        }
      },

      async updateQty(idx, change) {
        const item = this.cart[idx];
        
        const newQty = item.qty + change;
        
        if (newQty <= 0) {
          const ok = await this.showConfirm('ต้องการลบสินค้านี้ออกจากตะกร้าใช่ไหม?', '');
          if (ok) {
            this.cart.splice(idx, 1);
          }
        } 
        else {
          if (change > 0 && item.stock !== undefined && item.stock !== null && newQty > item.stock) {
             await this.showAlert(' ไม่สามารถบวกเพิ่มได้ สต๊อกคงเหลือไม่เพียงพอครับ', '');
             return;
          }
          item.qty = newQty;
        }
        
        this.renderCart();
      },

      async removeFromCart(idx) {
        const ok = await this.showConfirm('ต้องการลบสินค้านี้ออกจากตะกร้าใช่ไหม?', '');
        if (ok) {
          this.cart.splice(idx, 1);
          this.renderCart();
        }
      },
      
      async openCheckout() {
        if (this.cart.length === 0) return this.showAlert('ยังไม่มีสินค้าในตะกร้าเลยครับ', '');
        this.checkoutDiscount = 0;
        this.checkoutDiscountRaw = 0;
        document.getElementById('checkout-discount-input').value = '';
        this.setDiscountMode('baht');
        this.updateCheckoutTotalDisplay();
        this.renderCheckoutPaymentMethods();
        this.openModal('modal-checkout');
      },

      renderCheckoutPaymentMethods() {
        const container = document.getElementById('checkout-payment-methods');
        if (!container) return;
        const enabledMethods = this.paymentMethods.filter(m => m.enabled);

        if (enabledMethods.length === 0) {
          container.innerHTML = '<p class="text-xs text-red-400 font-bold text-center w-full">ยังไม่มีวิธีชำระเงินที่เปิดใช้งาน กรุณาไปตั้งค่าที่ Settings → Payment</p>';
          document.getElementById('btn-submit-order').disabled = true;
          return;
        }

        container.innerHTML = enabledMethods.map(m => `
          <button data-method-id="${escAttr(m.id)}" onclick="Controller.setPaymentMode(this.dataset.methodId)" class="pay-method-btn flex-1 min-w-[100px] min-h-[2.75rem] rounded-xl font-bold text-sm border-2 border-transparent transition active:scale-95 bg-accent text-secondary">${escAttr(m.name)}</button>
        `).join('');

        const defaultMethod = enabledMethods.find(m => m.id === this.currentPaymentMethodId) || enabledMethods[0];
        this.setPaymentMode(defaultMethod.id);
      },

      getCartSubtotal() {
        return this.cart.reduce((s, i) => s + (i.price * i.qty), 0);
      },

      setDiscountMode(mode) {
        this.discountMode = mode;
        const btnBaht = document.getElementById('btn-discount-baht');
        const btnPercent = document.getElementById('btn-discount-percent');
        if (mode === 'baht') {
          btnBaht.className = 'px-3 py-1 rounded-md text-xs font-bold bg-white shadow-sm text-primary transition';
          btnPercent.className = 'px-3 py-1 rounded-md text-xs font-bold text-slate-400 transition';
        } else {
          btnPercent.className = 'px-3 py-1 rounded-md text-xs font-bold bg-white shadow-sm text-primary transition';
          btnBaht.className = 'px-3 py-1 rounded-md text-xs font-bold text-slate-400 transition';
        }
        this.updateCheckoutDiscount();
      },

      updateCheckoutDiscount() {
        const subtotal = this.getCartSubtotal();
        let inputVal = Number(document.getElementById('checkout-discount-input').value) || 0;
        if (inputVal < 0) inputVal = 0;

        let discount = 0;
        if (this.discountMode === 'percent') {
          if (inputVal > 100) inputVal = 100;
          discount = subtotal * (inputVal / 100);
        } else {
          if (inputVal > subtotal) inputVal = subtotal;
          discount = inputVal;
        }

        this.checkoutDiscount = discount;
        this.checkoutDiscountRaw = inputVal;
        this.updateCheckoutTotalDisplay();
        this.updateCashUI();
      },

      updateCheckoutTotalDisplay() {
        const subtotal = this.getCartSubtotal();
        const total = Math.max(0, subtotal - this.checkoutDiscount);
        document.getElementById('checkout-total').innerText = `฿${total.toFixed(2)}`;
      },

      setPaymentMode(methodId) {
        const method = this.paymentMethods.find(m => m.id === methodId);
        if (!method) return;

        this.currentPaymentMethodId = method.id;
        this.paymentMode = method.name; // ชื่อวิธีชำระเงินจะถูกเก็บลงบิลตรงๆ

        document.querySelectorAll('.pay-method-btn').forEach(btn => {
          if (btn.dataset.methodId === method.id) {
            btn.className = 'pay-method-btn flex-1 min-w-[100px] min-h-[2.75rem] rounded-xl font-bold text-sm border-2 border-primary transition active:scale-95 bg-gradient-to-b from-primary to-secondary text-white';
          } else {
            btn.className = 'pay-method-btn flex-1 min-w-[100px] min-h-[2.75rem] rounded-xl font-bold text-sm border-2 border-transparent transition active:scale-95 bg-accent text-secondary';
          }
        });

        const numpad = document.getElementById('checkout-numpad');

        if (method.isCash) {
          numpad.classList.remove('hidden');
          this.cashInput = '0';
          this.updateCashUI();
        } else {
          numpad.classList.add('hidden');
          document.getElementById('btn-submit-order').disabled = false;
        }
      },

      numpad(val) {
        if (val === 'C') this.cashInput = '0';
        else if (val === 'back') this.cashInput = this.cashInput.slice(0, -1) || '0';
        else if (this.cashInput === '0' && val !== '00') this.cashInput = val;
        else this.cashInput += val;
        this.updateCashUI();
      },

      updateCashUI() {
        const total = Math.max(0, this.getCartSubtotal() - this.checkoutDiscount);
        const received = parseInt(this.cashInput, 10) || 0;
        document.getElementById('cash-received').innerText = received;
        
        const change = received - total;
        document.getElementById('cash-change').innerText = change >= 0 ? change : 0;
        document.getElementById('btn-submit-order').disabled = change < 0;
      },

      setExactCash() {
        const total = Math.max(0, this.getCartSubtotal() - this.checkoutDiscount);
        this.cashInput = total.toString();
        this.updateCashUI();
      },

        async submitOrder() {
        const btn = document.getElementById('btn-submit-order');
        if(btn.disabled) return;
        
        btn.disabled = true;
        btn.innerText = "Processing...";
        
        // สร้างเลขบิลจากหน้าเว็บเองเลย เช่น INV-20231026-143025-X9A
        const now = new Date();
        const dateStr = now.getFullYear().toString() + 
                        (now.getMonth()+1).toString().padStart(2, '0') + 
                        now.getDate().toString().padStart(2, '0');
        const timeStr = now.getHours().toString().padStart(2, '0') + 
                        now.getMinutes().toString().padStart(2, '0') + 
                        now.getSeconds().toString().padStart(2, '0');
        const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
        
        const newInvoiceId = `INV-${dateStr}-${timeStr}-${randomStr}`;
        
        // จบงานทันที ไม่ต้องรอเซิร์ฟเวอร์ (ระบบจะจับเข้า Sync Queue ไปเซฟหลังบ้านให้เอง)
        await this.finalizeOrder(newInvoiceId);
      },

      async finalizeOrder(invoiceId) {
        const subtotal = this.getCartSubtotal();
        const discount = this.checkoutDiscount || 0;
        const total = Math.max(0, subtotal - discount);
        const discountLabel = this.discountMode === 'percent' && discount > 0
          ? `${this.checkoutDiscountRaw}% (-${discount.toFixed(0)})`
          : (discount > 0 ? `-${discount.toFixed(0)}` : '');
        
        const qStr = this.getQueueNumber();

        const pmObj = this.paymentMethods.find(m => m.id === this.currentPaymentMethodId);
        const isCashPay = !!(pmObj && pmObj.isCash);
        const cashPaid = isCashPay ? (parseInt(this.cashInput, 10) || 0) : 0;
        const changeDue = isCashPay ? Math.max(0, cashPaid - total) : 0;

        const orderData = {
          timestamp: new Date().toISOString(),
          invoice: invoiceId,
          items: [...this.cart],
          subtotal: subtotal,
          discount: discount,
          discountLabel: discountLabel,
          total: total,
          paymentType: this.paymentMode,
          cashReceived: cashPaid,
          changeAmount: changeDue,
          status: 'active',
          queue: qStr,
          cashier: this.loggedInEmployee ? this.loggedInEmployee.name : ''
        };

        this.syncQueue.push(orderData);
        
        this.saveLocalState();
        this.updateSyncQueueBadge();
        this.renderHistory();
        this.updateCupUI();

        this.cart = [];
        this.renderCart();
        this.closeModal('modal-checkout');
        document.getElementById('btn-submit-order').disabled = false;
        document.getElementById('btn-submit-order').innerText = "Confirm Order";
        
        this.processSyncQueue();
        
        if (this.receiptSettings.autoPrint) {
          this.printReceipt(orderData, qStr);
        } else {
          // ถามลูกค้าว่าจะพิมพ์บิลหรือไม่
          const ok = await this.showConfirm('ต้องการพิมพ์ใบเสร็จสำหรับออเดอร์นี้หรือไม่?', '');
          if (ok) {
            this.printReceipt(orderData, qStr);
          }
        }
      },

      getQueueNumber() {
        const q = this.queueNumber;
        this.queueNumber++;
        localStorage.setItem('pos_queueNumber', this.queueNumber);
        return 'PK' + q.toString().padStart(2, '0');
      },

      // พิมพ์ใบสั่งครัวจากตะกร้าปัจจุบันก่อนลูกค้าจ่ายเงิน ไม่สร้างออเดอร์/บิลใดๆ ในระบบ
      // (บิลจริงยังสร้างตอน Checkout ตามปกติ เลขคิวจริงก็ยังผูกกับตอนนั้น ไม่ใช่ตอนนี้)
      async printOrderSlipNow() {
        if (this.cart.length === 0) return this.showAlert('ตะกร้าว่าง ไม่มีอะไรให้พิมพ์', '');

        const fakeOrder = {
          items: this.cart,
          timestamp: new Date().toISOString(),
          invoice: '(ยังไม่ชำระ)'
        };

        // ใบสั่งครัวออกที่เครื่องพิมพ์ครัวถ้าเชื่อมต่ออยู่ ไม่งั้น fallback ไปเครื่องพิมพ์ใบเสร็จ
        const target = KitchenPrinter.isConnected ? KitchenPrinter : ReceiptPrinter;
        if (!target.isConnected) {
          this.showAlert('กรุณาเชื่อมต่อเครื่องพิมพ์ Bluetooth ก่อนพิมพ์', '');
          return;
        }

        try {
          const bytes = await target.buildOrderSlip(fakeOrder, null, this.receiptSettings);
          await target.sendData(bytes);
        } catch (e) {
          console.warn('BT Print Error:', e.message);
          this.showAlert('พิมพ์ผ่าน Bluetooth ไม่สำเร็จ: ' + e.message, '');
        }
      },

        async printReceipt(order, queueStr) {
        if (!ReceiptPrinter.isConnected) {
          this.showAlert('กรุณาเชื่อมต่อเครื่องพิมพ์ใบเสร็จ Bluetooth ก่อนพิมพ์', '');
          return;
        }

        try {
          await ReceiptPrinter.printReceipt(order, queueStr, { ...this.receiptSettings, ...this.shopInfo }, KitchenPrinter);
        } catch (e) {
          console.warn('BT Print Error:', e.message);
          this.showAlert('พิมพ์ผ่าน Bluetooth ไม่สำเร็จ: ' + e.message, '');
        }
      },

      async savePrinterSettings() {
        const oldPaperSize = this.receiptSettings.paperSize;
        this.receiptSettings = {
          ...this.receiptSettings,
          header: document.getElementById('printer-header').value,
          footer: document.getElementById('printer-footer').value,
          branch: document.getElementById('printer-branch').value,
          company: document.getElementById('printer-company').value,
          branchNo: document.getElementById('printer-branch-no').value,
          posId: document.getElementById('printer-pos-id').value,
          docTitle: document.getElementById('printer-doc-title').value,
          autoPrint: document.getElementById('printer-auto-print').checked,
          showQueue: document.getElementById('printer-show-queue').checked,
          printOrderSlip: document.getElementById('printer-print-order-slip').checked,
          paperSize: document.getElementById('printer-paper-size').value,
            ...this.readReceiptToggles()
        };
        if (this.receiptSettings.paperSize !== oldPaperSize && this.receiptSettings.logoBase64) {
          await this.regenerateLogoRaster();
        }
        localStorage.setItem('pos_receiptSettings', JSON.stringify(this.receiptSettings));

        const lockMin = Number(document.getElementById('auto-lock-minutes').value);
        this.autoLockMinutes = isNaN(lockMin) || lockMin < 0 ? 10 : lockMin;
        localStorage.setItem('pos_autoLockMinutes', this.autoLockMinutes);
        this.resetAutoLockTimer();

        this.shopInfo = {
          ...this.shopInfo,
          address: document.getElementById('shop-address').value.trim(),
          phone: document.getElementById('shop-phone').value.trim(),
          taxId: document.getElementById('shop-tax-id').value.trim(),
          vatEnabled: document.getElementById('vat-enabled').checked,
          vatRate: Number(document.getElementById('vat-rate').value) || 7
        };
        localStorage.setItem('pos_shopInfo', JSON.stringify(this.shopInfo));

        // ส่งทั้งข้อมูลร้านและการตั้งค่าเครื่องพิมพ์ไปเก็บที่ backend ไปพร้อมกัน (shop_info เป็น key-value เก็บได้ทุกอย่าง)
        // เครื่องอื่นที่ล็อกอินจะได้เห็นค่าเดียวกัน ไม่ต้องตั้งใหม่ทีละเครื่อง
        // ไม่ส่ง logoRaster เพราะสร้างใหม่จาก logoBase64 ได้เร็วอยู่แล้วในเครื่อง ไม่ต้องเปลืองพื้นที่ซิงก์
        const { logoRaster, ...receiptSettingsForSync } = this.receiptSettings;
        google.script.run
          .withSuccessHandler(() => {})
          .withFailureHandler(() => this.showAlert('บันทึกข้อมูลร้านลง Google Sheet ไม่สำเร็จ (จะเก็บไว้ในเครื่องก่อน)', ''))
          .saveShopInfo({ ...this.shopInfo, ...receiptSettingsForSync });

        this.showAlert('บันทึกการตั้งค่าเครื่องพิมพ์แล้ว', '');
      },

      async handleLogoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.showLoading();
        try {
          const resizedBase64 = await resizeImageBase64(file, 300);
          this.receiptSettings.logoBase64 = resizedBase64;
          await this.regenerateLogoRaster();
          localStorage.setItem('pos_receiptSettings', JSON.stringify(this.receiptSettings));
          this.renderLogoPreview();
          google.script.run
            .withSuccessHandler(() => {})
            .withFailureHandler(() => this.showAlert('ซิงก์โลโก้ไปเครื่องอื่นไม่สำเร็จ (จะเก็บไว้ในเครื่องนี้ก่อน)', ''))
            .saveShopInfo({ logoBase64: resizedBase64 });
          this.hideLoading();
          this.showAlert('อัปโหลดโลโก้เรียบร้อยแล้ว', '');
        } catch (e) {
          this.hideLoading();
          this.showAlert('อัปโหลดโลโก้ไม่สำเร็จ: ' + e.message, '');
        }
      },

      async regenerateLogoRaster() {
        if (!this.receiptSettings.logoBase64) {
          delete this.receiptSettings.logoRaster;
          return;
        }
        const targetWidth = (this.receiptSettings.paperSize === '58mm') ? 300 : 450;
        this.receiptSettings.logoRaster = await imageToRaster(this.receiptSettings.logoBase64, targetWidth);
      },

      removeLogo() {
        delete this.receiptSettings.logoBase64;
        delete this.receiptSettings.logoRaster;
        localStorage.setItem('pos_receiptSettings', JSON.stringify(this.receiptSettings));
        document.getElementById('logo-upload-input').value = '';
        this.renderLogoPreview();
        google.script.run
          .withSuccessHandler(() => {})
          .withFailureHandler(() => {})
          .saveShopInfo({ logoBase64: '' });
      },

      toggleVatRateInput() {
        const wrap = document.getElementById('vat-rate-wrap');
        const checked = document.getElementById('vat-enabled').checked;
        wrap.classList.toggle('hidden', !checked);
      },

      renderLogoPreview() {
        const img = document.getElementById('logo-preview');
        const btnRemove = document.getElementById('btn-remove-logo');
        if (!img || !btnRemove) return;
        if (this.receiptSettings.logoBase64) {
          img.src = this.receiptSettings.logoBase64;
          img.classList.remove('hidden');
          btnRemove.classList.remove('hidden');
        } else {
          img.classList.add('hidden');
          btnRemove.classList.add('hidden');
        }
      },

      // =============================================
      //  Bluetooth Printer Controls
      // =============================================
      // role: 'receipt' | 'kitchen' — เลือกว่ากำลังทำงานกับเครื่องพิมพ์ไหน
      _printerForRole(role) {
        return role === 'kitchen' ? KitchenPrinter : ReceiptPrinter;
      },
      _printerRoleLabel(role) {
        return role === 'kitchen' ? 'เครื่องพิมพ์ครัว' : 'เครื่องพิมพ์ใบเสร็จ';
      },

      async connectBTPrinter(role) {
        const printer = this._printerForRole(role);
        const res = await printer.connect();
        if (res.success) {
          this.showAlert('เชื่อมต่อสำเร็จ: ' + res.name, '');
          localStorage.setItem('pos_btPrinterName_' + (role || 'receipt'), res.name);
        } else {
          this.showAlert('เชื่อมต่อไม่สำเร็จ: ' + res.message, '');
        }
        this.updatePrinterStatusUI(role);
      },

      async disconnectBTPrinter(role) {
        const printer = this._printerForRole(role);
        await printer.disconnect();
        localStorage.removeItem('pos_btPrinterName_' + (role || 'receipt'));
        this.updatePrinterStatusUI(role);
        this.showAlert('ตัดการเชื่อมต่อแล้ว', 'ℹ');
      },

      async testBTPrint(role) {
        const printer = this._printerForRole(role);
        if (!printer.isConnected) {
          return this.showAlert('กรุณาเชื่อมต่อ' + this._printerRoleLabel(role) + 'ก่อน', '');
        }
        try {
          await printer.printTest(this.receiptSettings);
          this.showAlert('ส่งหน้าทดสอบสำเร็จ!', '');
        } catch (e) {
          this.showAlert('พิมพ์ไม่สำเร็จ: ' + e.message, '');
        }
      },

      updatePrinterStatusUI(role) {
        if (!role) { this.updatePrinterStatusUI('receipt'); this.updatePrinterStatusUI('kitchen'); return; }
        const printer = this._printerForRole(role);
        const suffix = '-' + role;
        const statusEl = document.getElementById('bt-printer-status' + suffix);
        const connectBtn = document.getElementById('btn-bt-connect' + suffix);
        const disconnectBtn = document.getElementById('btn-bt-disconnect' + suffix);
        const testBtn = document.getElementById('btn-bt-test' + suffix);
        // ไอคอน nav bar และปุ่มใน user menu ผูกกับเครื่องพิมพ์ใบเสร็จเท่านั้น (เป็นเครื่องหลักที่ใช้ทุกบิล)
        const navIcon = role === 'receipt' ? document.getElementById('nav-printer-status') : null;
        const userMenuBtn = role === 'receipt' ? document.getElementById('user-menu-printer-btn') : null;

        if (printer.isConnected) {
          if (statusEl) statusEl.innerHTML = ' เชื่อมต่ออยู่: <strong>' + printer.deviceName + '</strong>';
          if (connectBtn) connectBtn.classList.add('hidden');
          if (disconnectBtn) disconnectBtn.classList.remove('hidden');
          if (testBtn) testBtn.classList.remove('hidden');
          if (navIcon) { navIcon.classList.remove('text-slate-300'); navIcon.classList.add('text-emerald-500'); }
          if (userMenuBtn) userMenuBtn.innerText = ' ตัดการเชื่อมต่อเครื่องพิมพ์';
        } else {
          if (statusEl) statusEl.innerHTML = ' ยังไม่ได้เชื่อมต่อ';
          if (connectBtn) connectBtn.classList.remove('hidden');
          if (disconnectBtn) disconnectBtn.classList.add('hidden');
          if (testBtn) testBtn.classList.add('hidden');
          if (navIcon) { navIcon.classList.remove('text-emerald-500'); navIcon.classList.add('text-slate-300'); }
          if (userMenuBtn) userMenuBtn.innerText = ' เชื่อมต่อเครื่องพิมพ์';
        }
      },

      async resetQueue() {
        const ok = await this.showConfirm('คุณต้องการรีเซ็ตเลขคิวกลับไปเริ่มต้นที่ Q01 ใหม่ ใช่หรือไม่?', '');
        if (ok) {
          this.queueNumber = 1;
          localStorage.setItem('pos_queueNumber', this.queueNumber);
          
          const qDisplay = document.getElementById('current-queue-display');
          if (qDisplay) qDisplay.innerText = 'Q01';
          
          this.showAlert('รีเซ็ตเลขคิวเป็น Q01 เรียบร้อยแล้ว', '');
        }
      },

      processSyncQueue() {
        if(this.syncQueue.length === 0) {
          this.setIndicator('synced');
          return;
        }
        if(this.isSyncing) return; 
        this.isSyncing = true;
        this.setIndicator('syncing');

        const queueSnapshot = [...this.syncQueue]; 

        google.script.run
          .withSuccessHandler(res => {
            this.isSyncing = false;
            if(res.success) {
              this.syncQueue = this.syncQueue.slice(queueSnapshot.length);
              this.checkAndClearDailyCache();
              this.saveLocalState();
              this.updateSyncQueueBadge();
              this.setIndicator('synced');
              this.fetchServerData(); // ดึงข้อมูลอัปเดตจากเซิร์ฟเวอร์ทันทีที่ซิงค์สำเร็จ
              if(this.syncQueue.length > 0) this.processSyncQueue(); 
            }
          })
          .withFailureHandler(err => {
            this.isSyncing = false;
            console.warn("Sync Failed (Offline) - จะซิงค์ใหม่เมื่อมีเน็ต");
            this.setIndicator('error');
          })
          .syncOfflineOrders(queueSnapshot);
      },

      logPinAttempt(context, success, name) {
        this.accessLogQueue.push({
          timestamp: new Date().toISOString(),
          context: context,
          result: success ? 'สำเร็จ' : 'ล้มเหลว',
          name: success ? (name || 'ไม่ทราบ') : ''
        });
        localStorage.setItem('pos_accessLogQueue', JSON.stringify(this.accessLogQueue));
        this.processLogQueue();
      },

      // =============================================
      //  PIN Lock Screen (ล็อกหน้าแรกทั้งแอป)
      // =============================================
      initPinLock() {
        const savedUserId = localStorage.getItem('pos_loggedInUserId');
        const user = savedUserId ? this.employees.find(e => e.id === savedUserId && e.active) : null;

        if (user) {
          // เช็คว่าตอนแอปถูกปิด/ระงับไป (สลับแอป, ล็อกจอมือถือ, browser kill หน้าเว็บ) ไม่มีการใช้งานนานเกินกำหนดไหม
          // ป้องกันกรณีมือถือ (Android/iOS) ที่ setTimeout ของ auto-lock หยุดทำงานตอนแอปอยู่เบื้องหลัง
          const limitMs = this.autoLockMinutes > 0 ? this.autoLockMinutes * 60 * 1000 : 0;
          const lastActive = Number(localStorage.getItem('pos_lastActivityAt')) || 0;
          const idleMs = Date.now() - lastActive;

          if (limitMs > 0 && idleMs >= limitMs) {
            localStorage.removeItem('pos_loggedInUserId');
            this.logPinAttempt('ล็อกหน้าจออัตโนมัติ (ไม่มีการใช้งานระหว่างปิดแอป)', true, user.name);
            this.loggedInEmployee = null;
            this.currentSettingsUser = null;
            this.showPinLockScreen();
            return;
          }

          this.loggedInEmployee = user;
          this.currentSettingsUser = user;
          this.hidePinLockScreen();
          this.updateLoggedInUserLabel();
        } else {
          this.loggedInEmployee = null;
          this.currentSettingsUser = null;
          this.showPinLockScreen();
        }
      },

      showPinLockScreen() {
        const el = document.getElementById('pin-lock-screen');
        if (el) el.classList.remove('hidden');
        this.pinBuffer = '';
        this.updatePinDots();
        const err = document.getElementById('pin-lock-error');
        if (err) err.classList.add('hidden');
      },

      hidePinLockScreen() {
        const el = document.getElementById('pin-lock-screen');
        if (el) el.classList.add('hidden');
      },

      pinKeyPress(digit) {
        if (this.pinBuffer.length >= 6) return;
        this.pinBuffer += digit;
        this.updatePinDots();
        this.tryUnlockPin();
      },

      pinBackspace() {
        this.pinBuffer = this.pinBuffer.slice(0, -1);
        this.updatePinDots();
        const err = document.getElementById('pin-lock-error');
        if (err) err.classList.add('hidden');
      },

      pinClear() {
        this.pinBuffer = '';
        this.updatePinDots();
        const err = document.getElementById('pin-lock-error');
        if (err) err.classList.add('hidden');
      },

      updatePinDots() {
        for (let i = 0; i < 6; i++) {
          const dot = document.getElementById(`pin-dot-${i}`);
          if (!dot) continue;
          dot.className = i < this.pinBuffer.length
            ? 'w-4 h-4 rounded-full bg-primary border-2 border-primary'
            : 'w-4 h-4 rounded-full border-2 border-primary/30';
        }
      },

      tryUnlockPin() {
        const pin = this.pinBuffer.trim();
        const user = this.employees.find(e => String(e.pin).trim() === pin && e.active);

        if (user) {
          this.loggedInEmployee = user;
          this.currentSettingsUser = user; //  ใช้คนนี้เป็นผู้ใช้ของทุกการกระทำในระบบ
          localStorage.setItem('pos_loggedInUserId', user.id);
          this.logPinAttempt('เข้าใช้งานระบบ (Lock Screen)', true, user.name);
          this.pinBuffer = '';
          this.hidePinLockScreen();
          this.updateLoggedInUserLabel();
          this.resetAutoLockTimer();
        } else {
          // หาความยาว PIN ที่ยาวที่สุดในระบบ ถ้ากรอกเกินนั้นแล้วยังไม่เจอ = ผิดแน่นอน
          const maxPinLength = this.employees.reduce((max, e) => {
            const len = String(e.pin).trim().length;
            return len > max ? len : max;
          }, 0) || 6;

          if (pin.length >= maxPinLength) {
            this.logPinAttempt('เข้าใช้งานระบบ (Lock Screen)', false, null);
            const err = document.getElementById('pin-lock-error');
            if (err) err.classList.remove('hidden');
            this.pinBuffer = '';
            this.updatePinDots();
          }
        }
      },

      updateLoggedInUserLabel() {
        const el = document.getElementById('current-user-label');
        const wrap = document.getElementById('user-menu-wrap');
        if (!el || !wrap) return;
        if (this.loggedInEmployee) {
          el.innerText = this.loggedInEmployee.name;
          wrap.classList.remove('hidden');
        } else {
          wrap.classList.add('hidden');
          this.closeUserMenu();
        }
      },

      toggleUserMenu() {
        const dropdown = document.getElementById('user-menu-dropdown');
        const backdrop = document.getElementById('user-menu-backdrop');
        const chevron = document.getElementById('user-menu-chevron');
        const opening = dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden', !opening);
        backdrop.classList.toggle('hidden', !opening);
        if (chevron) chevron.style.transform = opening ? 'rotate(180deg)' : '';

        if (opening) {
          // คำนวณตำแหน่งจากปุ่มจริงตอนเปิดทุกครั้ง (dropdown เป็น fixed แยกจาก nav ไม่ใช่ absolute ซ้อนข้างใน
          // เพราะแบบเดิมโดนกล่องอื่นในหน้า เช่น แผงตะกร้า วาดทับตอนหน้าจอกว้าง)
          const btn = document.querySelector('#user-menu-wrap button');
          const rect = btn.getBoundingClientRect();
          dropdown.style.top = (rect.bottom + 8) + 'px';
          dropdown.style.left = Math.max(8, rect.right - dropdown.offsetWidth) + 'px';
          this.updatePrinterStatusUI();
        }
      },

      closeUserMenu() {
        const dropdown = document.getElementById('user-menu-dropdown');
        const backdrop = document.getElementById('user-menu-backdrop');
        const chevron = document.getElementById('user-menu-chevron');
        if (dropdown) dropdown.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        if (chevron) chevron.style.transform = '';
      },

      togglePrinterFromUserMenu() {
        if (ReceiptPrinter.isConnected) {
          this.disconnectBTPrinter('receipt');
        } else {
          this.connectBTPrinter('receipt');
        }
      },

      startAutoLockWatcher() {
        // ผูก event ครั้งเดียวตอนเปิดแอป ทุกการแตะ/กด/เลื่อน จะรีเซ็ตเวลานับถอยหลัง
        ['click', 'touchstart', 'keydown', 'scroll'].forEach(evt => {
          document.addEventListener(evt, () => this.resetAutoLockTimer(), { passive: true });
        });
        // มือถือ (Android/iOS) มักหยุด/หน่วง setTimeout ตอนสลับแอปไปพักหน้าจอ โดยไม่ปิดหน้าเว็บทิ้ง
        // พอกลับมาเปิดแอปอีกครั้ง (visibilitychange) เลยต้องเช็คเวลาที่หายไปเองอีกที ไม่ต้องรอ event อื่น
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.checkAutoLockOnResume();
        });
        this.resetAutoLockTimer();
      },

      checkAutoLockOnResume() {
        if (!this.loggedInEmployee) return;
        if (!this.autoLockMinutes || this.autoLockMinutes <= 0) return;
        const lastActive = Number(localStorage.getItem('pos_lastActivityAt')) || 0;
        if (Date.now() - lastActive >= this.autoLockMinutes * 60 * 1000) {
          this.autoLockNow();
        } else {
          this.resetAutoLockTimer();
        }
      },

      resetAutoLockTimer() {
        if (this.autoLockTimer) clearTimeout(this.autoLockTimer);
        if (!this.loggedInEmployee) return; // ยังไม่ได้ล็อกอิน ไม่ต้องนับ
        localStorage.setItem('pos_lastActivityAt', String(Date.now())); // เก็บเวลากิจกรรมล่าสุดไว้เช็คตอนเปิดแอปใหม่ (กรณีมือถือ suspend หน้าเว็บ)
        if (!this.autoLockMinutes || this.autoLockMinutes <= 0) return; // ปิดใช้งาน auto-lock

        this.autoLockTimer = setTimeout(() => {
          this.autoLockNow();
        }, this.autoLockMinutes * 60 * 1000);
      },

      autoLockNow() {
        if (!this.loggedInEmployee) return;
        this.logPinAttempt('ล็อกหน้าจออัตโนมัติ (ไม่มีการใช้งาน)', true, this.loggedInEmployee.name);
        localStorage.removeItem('pos_loggedInUserId');
        this.loggedInEmployee = null;
        this.currentSettingsUser = null;
        this.updateLoggedInUserLabel();

        // ปิดโมดัลที่ค้างอยู่ทั้งหมดก่อนล็อก กันหน้าจอซ้อนกัน
        document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));

        this.showPinLockScreen();
      },

      async lockApp() {
        const ok = await this.showConfirm('ต้องการล็อกหน้าจอและออกจากระบบผู้ใช้ปัจจุบันหรือไม่?', '');
        if (!ok) return;
        localStorage.removeItem('pos_loggedInUserId');
        this.loggedInEmployee = null;
        this.currentSettingsUser = null;
        this.updateLoggedInUserLabel();
        this.showPinLockScreen();
      },

      processLogQueue() {
        if (this.accessLogQueue.length === 0 || this.isLogSyncing) return;
        this.isLogSyncing = true;

        const snapshot = [...this.accessLogQueue];

        google.script.run
          .withSuccessHandler(res => {
            this.isLogSyncing = false;
            if (res.success) {
              this.accessLogQueue = this.accessLogQueue.slice(snapshot.length);
              localStorage.setItem('pos_accessLogQueue', JSON.stringify(this.accessLogQueue));
              if (this.accessLogQueue.length > 0) this.processLogQueue();
            }
          })
          .withFailureHandler(() => {
            this.isLogSyncing = false;
            console.warn("Access log sync failed (offline) - จะลองใหม่ครั้งถัดไป");
          })
          .syncAccessLogs(snapshot);
      },

      loadHistoryDate(dateStr) {
        const note = document.getElementById('history-date-note');
        const input = document.getElementById('history-date');
        if (!dateStr) {
          this.historyViewDate = null;
          this.historyViewData = null;
          if (input) input.value = '';
          if (note) note.innerText = '';
          this.renderHistory();
          return;
        }
        this.historyViewDate = dateStr;
        if (note) note.innerText = 'กำลังโหลด...';
        google.script.run
          .withSuccessHandler(data => {
            if (this.historyViewDate !== dateStr) return;
            this.historyViewData = (data && data.history) || [];
            if (note) note.innerText = 'ข้อมูลวันที่ ' + dateStr;
            this.renderHistory();
          })
          .withFailureHandler(() => {
            if (note) note.innerText = 'โหลดไม่สำเร็จ ลองใหม่อีกครั้ง';
          })
          .getPOSDataByDate(dateStr);
      },

      // แตะหัวบิลเพื่อกาง/พับรายละเอียด (รายการสินค้า + ปุ่มจัดการ) บนมือถือ เพื่อให้รายการดูโปร่งไม่แน่นเหมือนย่อมาจากจอคอม
      // บนจอคอม (lg+) รายละเอียดกางอยู่ตลอดเหมือนเดิม ฟังก์ชันนี้เลยไม่ต้องทำอะไร
      toggleHistoryDetail(headerEl) {
        if (window.innerWidth >= 1024) return;
        const detail = headerEl.nextElementSibling;
        if (!detail) return;
        detail.classList.toggle('hidden');
        const chevron = headerEl.querySelector('.history-chevron');
        if (chevron) chevron.classList.toggle('rotate-180');
      },

      renderHistoryReadOnly(rows) {
        const list = document.getElementById('history-list');
        if (!list) return;
        const sorted = rows.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (sorted.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8 11h8M8 15h6"/></svg>ไม่มีบิลในวันที่เลือก</div>';
          return;
        }
        let html = '';
        for (const h of sorted) {
          const off = h.status === 'cancelled' || h.status === 'waste';
          html += '<div class="py-4' + (off ? ' opacity-60' : '') + '">';
          html += '<div class="flex justify-between items-center gap-2 cursor-pointer lg:cursor-default" onclick="Controller.toggleHistoryDetail(this)">';
          html += '<div class="min-w-0"><p class="font-bold text-secondary' + (off ? ' line-through' : '') + '">' + h.invoice + '</p>';
          html += '<p class="text-xs text-slate-400 mt-0.5">' + new Date(h.timestamp).toLocaleString() + '</p>';
          html += '</div><div class="flex items-center gap-2 shrink-0"><div class="text-right">';
          html += '<p class="font-black text-lg ' + (off ? 'text-slate-400 line-through' : 'text-primary') + '">฿' + h.total + '</p>';
          html += '<span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold mt-1">' + (h.paymentType || 'ไม่ระบุ') + '</span>';
          html += '</div><svg class="history-chevron lg:hidden text-slate-300 transition-transform shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.1em;height:1.1em"><path d="M6 9l6 6 6-6"/></svg></div></div>';
          html += '<div class="history-detail hidden lg:block mt-2">';
          if (h.items && h.items.length > 0) {
            html += '<div class="mt-2 pl-2 border-l-2 border-slate-200 space-y-1">';
            for (const it of h.items) {
              const canCancelItem = !off && !it.cancelled;
              html += '<div class="flex justify-between items-center text-sm ' + (it.cancelled ? 'text-slate-400 line-through' : 'text-slate-600') + '">';
              html += '<span>' + it.qty + 'x ' + it.name + (it.note ? ' <span class="text-xs text-slate-400">(' + it.note + ')</span>' : '') + '</span>';
              html += '<span class="flex items-center gap-2 shrink-0">฿' + (it.price * it.qty);
              if (canCancelItem) {
                html += '<button data-invoice="' + escAttr(h.invoice) + '" data-sku="' + escAttr(it.sku) + '" data-note="' + escAttr(it.note || '') + '" onclick="Controller.cancelOrderItemFromButton(this)" class="px-2 min-h-[2rem] inline-flex items-center justify-center text-[10px] font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ยกเลิก</button>';
              }
              if (it.cancelled) {
                html += '<span class="text-[10px] font-bold text-orange-400 whitespace-nowrap">ยกเลิกแล้ว</span>';
              }
              html += '</span></div>';
            }
            html += '</div>';
          }
          if (!off) {
              html += '<div class="mt-2 flex flex-wrap justify-end gap-2">';
              html += '<button onclick="Controller.openEditBill(\'' + h.invoice + '\')" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-primary bg-primary/10 rounded-full active:scale-95 transition-all whitespace-nowrap">แก้ไขบิล</button>';
              if ((Number(h.total || 0) - Number(h.refundedTotal || 0)) > 0) {
                html += '<button data-invoice="' + escAttr(h.invoice) + '" onclick="Controller.refundOrder(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-sky-600 bg-sky-50 rounded-full active:scale-95 transition-all whitespace-nowrap">คืนเงิน</button>';
              }
              html += '<button data-invoice="' + escAttr(h.invoice) + '" onclick="Controller.markAsWaste(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-orange-500 bg-orange-50 rounded-full active:scale-95 transition-all whitespace-nowrap">บันทึกของเสีย</button>';
              html += '<button data-invoice="' + escAttr(h.invoice) + '" onclick="Controller.cancelOrder(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ยกเลิกบิล</button>';
              html += '</div>';
            }
            if (h.refundedTotal > 0) {
              html += '<div class="mt-2 bg-sky-50 text-sky-600 text-xs font-bold px-3 py-2 rounded-lg">คืนเงินแล้ว ฿' + Number(h.refundedTotal).toFixed(2) + ' จาก ฿' + Number(h.total).toFixed(2) + '</div>';
            }
            if (h.cancelReason) {
            html += '<div class="mt-2 bg-red-50 text-red-500 text-xs font-bold px-3 py-2 rounded-lg">ยกเลิกแล้ว: ' + h.cancelReason + '</div>';
          }
          html += '</div>'; // .history-detail
          html += '</div>'; // .py-4
        }
        list.innerHTML = html;
      },

      renderHistory() {
        const list = document.getElementById('history-list');
        if (this.historyViewData) {
          this.renderHistoryReadOnly(this.historyViewData);
          return;
        }
        
        // นำบิลที่รอซิงค์ (ออฟไลน์) มารวมกับประวัติบิลในเครื่อง/เซิร์ฟเวอร์
        const offlineInvoices = new Set(this.syncQueue.map(o => o.invoice));
        const combined = [
           ...this.syncQueue, 
           ...this.history.filter(h => !offlineInvoices.has(h.invoice))
        ];
        // เรียงตามเวลาใหม่สุด
        combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (combined.length === 0) {
          list.innerHTML = '<div class="p-8 flex flex-col items-center gap-2 text-center text-slate-400 font-bold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem" class="text-primary/15"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8 11h8M8 15h6"/></svg>ยังไม่มีบิลวันนี้</div>';
          return;
        }

        list.innerHTML = combined.map((h, idx) => {
          const isCancelled = h.status === 'cancelled';
          const isWaste = h.status === 'waste';
          
          return `
          <div class="py-4 ${isCancelled || isWaste ? 'opacity-60' : ''}">
            <div class="flex justify-between items-center gap-2 cursor-pointer lg:cursor-default" onclick="Controller.toggleHistoryDetail(this)">
              <div class="min-w-0">
                <p class="font-bold text-secondary ${isCancelled || isWaste ? 'line-through' : ''}">${h.invoice}</p>
                <p class="text-xs text-slate-400 mt-0.5">${new Date(h.timestamp).toLocaleString()}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div class="text-right">
                  <p class="font-black text-lg ${isCancelled || isWaste ? 'text-slate-400 line-through' : 'text-primary'}">฿${h.total}</p>
                  <span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold mt-1">${h.paymentType}</span>
                </div>
                <svg class="history-chevron lg:hidden text-slate-300 transition-transform shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.1em;height:1.1em"><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>
            <div class="history-detail hidden lg:block mt-2">
            ${h.items && h.items.length > 0 ? `
              <div class="mt-2 pl-2 border-l-2 border-slate-200 space-y-1">
                ${h.items.map(item => {
                  const itemCancelled = item.cancelled;
                  const canCancelItem = !isCancelled && !isWaste && !offlineInvoices.has(h.invoice) && !itemCancelled;
                  return `
                  <div class="flex justify-between items-center text-sm ${itemCancelled ? 'text-slate-400 line-through' : 'text-slate-600'}">
                    <span>${item.qty}x ${escHtml(item.name)} ${item.note ? `<span class="text-xs text-slate-400">(${escHtml(item.note)})</span>` : ''}</span>
                    <span class="flex items-center gap-2 shrink-0">
                      ฿${item.price * item.qty}
                      ${canCancelItem ? `<button data-invoice="${escAttr(h.invoice)}" data-sku="${escAttr(item.sku)}" data-note="${escAttr(item.note || '')}" onclick="Controller.cancelOrderItemFromButton(this)" class="px-2 min-h-[2rem] inline-flex items-center justify-center text-[10px] font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ยกเลิก</button>` : ''}
                      ${itemCancelled ? `<span class="text-[10px] font-bold text-orange-400 whitespace-nowrap">ยกเลิกแล้ว</span>` : ''}
                    </span>
                  </div>
                `}).join('')}
              </div>
            ` : ''}
            ${h.refundedTotal > 0 ? `<div class="mt-2 bg-sky-50 text-sky-600 text-xs font-bold px-3 py-2 rounded-lg">คืนเงินแล้ว ฿${Number(h.refundedTotal).toFixed(2)} จาก ฿${Number(h.total).toFixed(2)}</div>` : ''}
            ${isCancelled
              ? `<div class="mt-2 bg-red-50 text-red-500 text-xs font-bold px-3 py-2 rounded-lg"> ยกเลิกแล้ว: ${escHtml(h.cancelReason)}</div>`
              : isWaste
              ? `<div class="mt-2 bg-orange-50 text-orange-500 text-xs font-bold px-3 py-2 rounded-lg"> ของเสีย: ${escHtml(h.cancelReason)}</div>`
              : `<div class="mt-2 flex flex-wrap justify-end gap-2">
                   <button data-invoice="${escAttr(h.invoice)}" onclick="Controller.openEditBill(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-primary bg-primary/10 rounded-full active:scale-95 transition-all whitespace-nowrap">แก้ไขบิล</button>
                   <button data-invoice="${escAttr(h.invoice)}" onclick="Controller.printReceiptByInvoice(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-slate-500 bg-slate-100 rounded-full active:scale-95 transition-all whitespace-nowrap">พิมพ์</button>
                   ${(Number(h.total || 0) - Number(h.refundedTotal || 0)) > 0 ? `<button data-invoice="${escAttr(h.invoice)}" onclick="Controller.refundOrder(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-sky-600 bg-sky-50 rounded-full active:scale-95 transition-all whitespace-nowrap">คืนเงิน</button>` : ''}
                   <button data-invoice="${escAttr(h.invoice)}" onclick="Controller.markAsWaste(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-orange-500 bg-orange-50 rounded-full active:scale-95 transition-all whitespace-nowrap">บันทึกของเสีย</button>
                   <button data-invoice="${escAttr(h.invoice)}" onclick="Controller.cancelOrder(this.dataset.invoice)" class="px-3 min-h-[2.5rem] inline-flex items-center justify-center text-xs font-bold text-red-500 bg-red-50 rounded-full active:scale-95 transition-all whitespace-nowrap">ยกเลิกบิล</button>
                 </div>`
            }
            </div>
          </div>
        `}).join('');
      },
      cancelOrder(invoiceId) {
        this.updateOrderStatus(invoiceId, 'cancelled');
      },
      
      markAsWaste(invoiceId) {
        this.updateOrderStatus(invoiceId, 'waste');
      },

      // คืนเงินบางส่วน/เต็มจำนวนให้บิล ไม่แตะ sales/payments/สต๊อกเลย ของยังถือว่าขายไปแล้วจริง แค่คืนเงินให้ลูกค้า
      // คืนได้หลายครั้งต่อบิล (เช่น คืน 10 บาทวันนี้ อีก 5 บาทวันหลัง) เซิร์ฟเวอร์เป็นคนเช็คยอดคงเหลือที่คืนได้จริง
      async refundOrder(invoiceId) {
        const order = this.findOrderByInvoice(invoiceId);
        if (!order) return this.showAlert('ไม่พบบิลนี้', '');
        if (order.status === 'cancelled' || order.status === 'waste') return;

        const remaining = Number(order.total || 0) - Number(order.refundedTotal || 0);
        if (remaining <= 0) return this.showAlert('บิลนี้คืนเงินครบแล้ว', '');

        const amountStr = await this.showPrompt(
          `บิล ${order.invoice} คืนเงินได้ไม่เกิน ${remaining.toFixed(2)} บาท ระบุจำนวนที่จะคืน:`,
          { type: 'number', placeholder: remaining.toFixed(2) }
        );
        if (amountStr === null) return;
        const amount = Number(amountStr);
        if (!amount || amount <= 0) return this.showAlert('กรุณาระบุจำนวนเงินที่มากกว่า 0', '');
        if (amount > remaining) return this.showAlert(`คืนเงินได้ไม่เกิน ${remaining.toFixed(2)} บาท`, '');

        const reason = await this.showPrompt(`ระบุเหตุผลที่คืนเงิน ฿${amount.toFixed(2)}:`, {});
        if (reason === null) return;
        if (reason.trim() === '') return this.showAlert('กรุณาระบุเหตุผลก่อนคืนเงิน', '');

        const auth = await this.requireActionPin(`ใส่รหัส PIN เพื่อยืนยันการคืนเงิน ฿${amount.toFixed(2)}:`);
        if (!auth) return;
        const userName = auth.employee.name;
        this.showLoading();
        google.script.run
          .withSuccessHandler(res => {
            this.hideLoading();
            if (res && res.success) {
              this.logPinAttempt(`คืนเงิน: ${order.invoice} ฿${amount.toFixed(2)}`, true, userName);
              order.refundedTotal = res.refundedTotal;
              this.renderHistory();
              this.showAlert('คืนเงินสำเร็จแล้ว', '');
            } else {
              this.showAlert((res && res.error) || 'คืนเงินไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => { this.hideLoading(); this.showAlert('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', ''); })
          .refundOrder({ invoice: order.invoice, amount: amount, reason: reason.trim(), employeeId: auth.employeeId, pin: auth.pin });
      },

      async updateOrderStatus(invoiceId, status) {
        // หาข้อมูลบิลจาก combined history
        const order = this.history.find(o => o.invoice === invoiceId) || this.syncQueue.find(o => o.invoice === invoiceId);
        if (!order || order.status === 'cancelled' || order.status === 'waste') return;

        const actionText = status === 'waste' ? 'บันทึกของเสีย' : 'ยกเลิกบิล';
        const icon = status === 'waste' ? '' : '';

        const reason = await this.showPrompt(`ระบุเหตุผลที่ต้องการ${actionText} ${order.invoice}:`, { icon: icon });
        if (reason === null) return;
        if (reason.trim() === '') return this.showAlert(`กรุณาระบุเหตุผลก่อน${actionText}`, '');

        const auth = await this.requireActionPin(`ใส่รหัส PIN เพื่อยืนยัน${actionText} ${order.invoice}:`);
        if (!auth) return;
        const userName = auth.employee.name;

        // ถ้าเป็นบิลออฟไลน์ที่ยังไม่ซิงก์ ให้เปลี่ยนค่าแล้วเซฟได้เลย
        const queueEntry = this.syncQueue.find(o => o.invoice === order.invoice);
        if (queueEntry) {
          queueEntry.status = status;
          queueEntry.cancelReason = `${reason.trim()} (โดย ${userName})`;
          queueEntry.cancelUser = userName;
          queueEntry.cancelTimestamp = new Date().toISOString();

          this.saveLocalState();
          this.renderHistory();
          this.processSyncQueue();
          return;
        }

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(res => {
            if (res.success) {
              // เซิร์ฟเวอร์ยืนยันว่าสำเร็จ ค่อยเปลี่ยนสถานะในแอป
              order.status = status;
              order.cancelReason = `${reason.trim()} (โดย ${userName})`;
              order.cancelUser = userName;
              order.cancelTimestamp = new Date().toISOString();
              
              // ลดยอดแก้วทันทีเพื่อให้ UI เปลี่ยนแปลงไวที่สุด
              const removedCups = order.items.reduce((s, i) => s + i.qty, 0);
              this.serverCupCount = Math.max(0, this.serverCupCount - removedCups);
              localStorage.setItem('pos_serverCupCount', this.serverCupCount);
              
              this.saveLocalState();
              this.renderHistory();
              this.updateCupUI();
              this.setIndicator('synced');
              
              // ดึงข้อมูลมายืนยันให้ตรงกับเซิร์ฟเวอร์อีกครั้ง
              this.fetchServerData();
            } else {
              this.showAlert(res.message || `${actionText}ไม่สำเร็จ`, '');
              this.setIndicator('synced');
            }
          })
          .withFailureHandler(() => {
            // ถ้าเน็ตหลุด ไม่เปลี่ยนสถานะ เพื่อป้องกันหน้าจอกับเซิร์ฟเวอร์ข้อมูลไม่ตรงกัน
            this.showAlert(`เชื่อมต่อไม่สำเร็จ (ไม่มีอินเทอร์เน็ต) บิลยังไม่ถูก${actionText} กรุณาลองใหม่เมื่อมีอินเทอร์เน็ต`, '');
            this.setIndicator('error');
          })
          .updateOrderStatus({ invoice: order.invoice, status: status, reason: reason.trim(), employeeId: auth.employeeId, pin: auth.pin });
      },

      cancelOrderItemFromButton(btnEl) {
        const invoice = btnEl.dataset.invoice;
        const sku = btnEl.dataset.sku;
        const note = btnEl.dataset.note;
        this.cancelOrderItem(invoice, sku, note);
      },

      findOrderByInvoice(invoice) {
        return this.syncQueue.find(o => o.invoice === invoice) || this.history.find(o => o.invoice === invoice) || (this.historyViewData || []).find(o => o.invoice === invoice);
      },

      printReceiptByInvoice(invoice) {
        const order = this.findOrderByInvoice(invoice);
        if (!order) {
          this.showAlert('ไม่พบข้อมูลบิลนี้ (อาจถูกล้างแคชไปแล้ว ลองกด Refresh ในหน้า History)', '');
          return;
        }
        this.printReceipt(order, order.queue || '');
      },

      async cancelOrderItem(invoice, sku, note) {
        const order = this.history.find(o => o.invoice === invoice);
        if (!order) return;
        const item = order.items.find(i => i.sku === sku && (i.note || '') === (note || ''));
        if (!item || item.cancelled) return;

        const reason = await this.showPrompt(`ระบุเหตุผลที่ต้องการยกเลิกรายการ "${item.name}" ในบิล ${invoice}:`, { icon: '' });
        if (reason === null) return;
        if (reason.trim() === '') return this.showAlert('กรุณาระบุเหตุผลก่อนยกเลิกรายการ', '');

        const auth = await this.requireActionPin(`ใส่รหัส PIN เพื่อยืนยันการยกเลิกรายการ "${item.name}":`);
        if (!auth) return;
        const userName = auth.employee.name;

        this.setIndicator('syncing');
        google.script.run
          .withSuccessHandler(async res => {
            if (res.success) {
              item.cancelled = true;
              item.cancelReason = reason.trim();

              if (res.newTotal !== null && res.newTotal !== undefined) {
                order.total = res.newTotal;
              }

              this.serverCupCount = Math.max(0, this.serverCupCount - item.qty);
              localStorage.setItem('pos_serverCupCount', this.serverCupCount);

              if (res.wholeBillCancelled) {
                order.status = 'cancelled';
                order.cancelReason = 'ยกเลิกทั้งบิลอัตโนมัติ (ยกเลิกครบทุกรายการ)';
                order.cancelUser = userName;
                order.cancelTimestamp = new Date().toISOString();
              }

              this.saveLocalState();
              this.renderHistory();
              this.updateCupUI();
              this.setIndicator('synced');

              this.fetchServerData();

              if (res.wholeBillCancelled) {
                await this.showAlert(`บิล ${invoice} ถูกยกเลิกครบทุกรายการแล้ว ระบบยกเลิกทั้งบิลให้อัตโนมัติ`, '');
              }
            } else {
              this.showAlert(res.message || 'ยกเลิกรายการไม่สำเร็จ', '');
              this.setIndicator('synced');
            }
          })
          .withFailureHandler(() => {
            this.showAlert('เชื่อมต่อไม่สำเร็จ (ไม่มีอินเทอร์เน็ต) รายการยังไม่ถูกยกเลิก กรุณาลองใหม่เมื่อมีอินเทอร์เน็ต', '');
            this.setIndicator('error');
          })
          .cancelSalesItems({ invoice: invoice, items: [{ sku: sku, note: note }], reason: reason.trim(), employeeId: auth.employeeId, pin: auth.pin });
      },

      async clearHistory() {
        const pin = await this.showPrompt("กรุณาใส่รหัส PIN เพื่อล้างข้อมูล History (Clear Cache):", { type: 'password', icon: '' });
        const user = this.checkSettingsAccess(pin);
        if (user && this.getAllowedTabs(user).includes('history')) {
          this.logPinAttempt('Clear History', true, user.name);
          const ok = await this.showConfirm("ยืนยันการล้างข้อมูล? บิลที่ยังไม่ซิงค์เข้าระบบจะหายไปทั้งหมด!", '');
          if (ok) {
            this.history = [];
            this.saveLocalState();
            this.renderHistory();
          }
        } else if (pin !== null) {
          this.logPinAttempt('Clear History', false, null);
          this.showAlert("รหัส PIN ไม่ถูกต้องครับ การล้างข้อมูลถูกยกเลิก", '');
        }
      },

        fetchSummary(btn) {
        this.setIndicator('syncing');
        this.updateCupUI();
        this.setBtnLoading(btn, true);
        
        google.script.run
          .withSuccessHandler(stats => {
            this.setBtnLoading(btn, false);
            const floatCash = stats.floatCash || 0;
            const expectedDrawer = stats.cash + floatCash; 
            document.getElementById('sum-total').innerText = `฿${stats.total.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById('sum-cash').innerText = `฿${stats.cash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById('sum-qr').innerText = `฿${stats.qr.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            
            const sumFloatEl = document.getElementById('sum-float');
            if (sumFloatEl) sumFloatEl.innerText = `฿${floatCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            
            const expectedDrawerEl = document.getElementById('sum-expected-drawer');
            if (expectedDrawerEl) expectedDrawerEl.innerText = `฿${expectedDrawer.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            
            // --- คำนวณต้นทุนและกำไรจาก History ภายในแอป ---
            const todayStr = new Date().toLocaleDateString();
            const offlineInvoices = new Set(this.syncQueue.map(o => o.invoice));
            const combined = [
               ...this.syncQueue, 
               ...this.history.filter(h => !offlineInvoices.has(h.invoice))
            ];
            
            let totalCost = 0;
            let totalProfit = 0;
            let wasteCost = 0;

            combined.forEach(order => {
              const orderDateStr = new Date(order.timestamp).toLocaleDateString();
              if (orderDateStr !== todayStr || order.status === 'cancelled') return;
              const isWaste = order.status === 'waste';
              order.items.forEach(item => {
                 if (item.cancelled) return; // ข้ามรายการที่ถูกยกเลิกไปแล้ว
                 //  หาต้นทุนจาก menuData โดยใช้ SKU (เพราะประวัติที่ดึงจากเซิร์ฟเวอร์ไม่ได้เก็บต้นทุนไว้)
                 const menuProduct = this.menuData.find(m => m.sku === item.sku);
                 const itemCost = menuProduct ? (menuProduct.cost || 0) : (item.cost || 0);

                 if (isWaste) {
                   wasteCost += itemCost * item.qty;
                 } else {
                   totalCost += itemCost * item.qty;
                   totalProfit += (item.price - itemCost) * item.qty;
                 }
              });
            });
            const refundedTotal = Number(stats.refundedTotal) || 0;
            totalProfit -= wasteCost;
            totalProfit -= refundedTotal;

            const costEl = document.getElementById('sum-cost');
            const profitEl = document.getElementById('sum-profit');
            if (costEl) costEl.innerText = `฿${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            if (profitEl) profitEl.innerText = `฿${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

            const wasteBanner = document.getElementById('sum-waste-banner');
            const wasteCostEl = document.getElementById('sum-waste-cost');
            if (wasteCostEl) wasteCostEl.innerText = `฿${wasteCost.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            if (wasteBanner) wasteBanner.classList.toggle('hidden', wasteCost <= 0);

            const refundBanner = document.getElementById('sum-refund-banner');
            const refundTotalEl = document.getElementById('sum-refund-total');
            if (refundTotalEl) refundTotalEl.innerText = `฿${refundedTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            if (refundBanner) refundBanner.classList.toggle('hidden', refundedTotal <= 0);
            // ------------------------------------------

            const breakdownContainer = document.getElementById('sum-breakdown-container');
            const breakdownList = document.getElementById('sum-breakdown-list');
            if (breakdownContainer && breakdownList && stats.byType) {
              const entries = Object.entries(stats.byType);
              if (entries.length > 0) {
                breakdownContainer.classList.remove('hidden');
                breakdownList.innerHTML = entries.map(([name, amt]) => `
                  <div class="flex justify-between text-sm">
                    <span class="text-slate-500 font-bold">${escHtml(name)}</span>
                    <span class="text-secondary font-black">฿${amt.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                  </div>
                `).join('');
              } else {
                breakdownContainer.classList.add('hidden');
              }
            }

            this.setIndicator('synced');
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            console.warn("Offline: ไม่สามารถโหลดสรุปยอดล่าสุดได้");
            this.setIndicator('error');
          })
          .getTodaySummary();
      },

      closeDayCashManual(btn) {
        this.setBtnLoading(btn, true);
        google.script.run
          .withSuccessHandler(res => {
            this.setBtnLoading(btn, false);
            if (res.success) {
              this.logPinAttempt(`ปิดยอดประจำวัน: ฿${res.amount}`, true, this.currentSettingsUser ? this.currentSettingsUser.name : 'Unknown');
              this.showAlert(`ปิดยอดประจำวันสำเร็จ นำยอดขายสด ฿${res.amount.toLocaleString(undefined, {minimumFractionDigits: 2})} เข้าเป็นเงินทอนแล้ว`, '');
              this.fetchSummary();
            } else {
              this.showAlert(res.message || 'ปิดยอดไม่สำเร็จ', '');
            }
          })
          .withFailureHandler(() => {
            this.setBtnLoading(btn, false);
            this.showAlert('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต', '');
          })
          .closeDayCash();
      },

      openFloatCashPrompt() {
        this.clearDenominations(); // ล้างค่าเก่าก่อนเปิด
        this.setFloatAction('IN');
        document.getElementById('float-note-input').value = '';
        this.combinedAvailable = null;
        this.openModal('modal-float-cash');

        google.script.run
          .withSuccessHandler(stats => {
            this.combinedAvailable = (stats.cash || 0) + (stats.floatCash || 0);
            this.updateFloatAvailableDisplay();
          })
          .withFailureHandler(() => {
            this.combinedAvailable = null;
            this.updateFloatAvailableDisplay('ไม่สามารถโหลดยอดได้ (ออฟไลน์) — จะไม่จำกัดยอดถอน');
          })
          .getTodaySummary();
      },

      floatAction: 'IN',
      combinedAvailable: null,

      setFloatAction(action) {
        this.floatAction = action;
        const btnIn = document.getElementById('btn-float-in');
        const btnOut = document.getElementById('btn-float-out');
        
        if (action === 'IN') {
          btnIn.className = 'flex-1 py-2 rounded-lg bg-white shadow-sm font-bold text-emerald-500 transition-all border border-slate-200';
          btnOut.className = 'flex-1 py-2 rounded-lg font-bold text-slate-400 hover:text-slate-600 transition-all border border-transparent';
        } else {
          btnOut.className = 'flex-1 py-2 rounded-lg bg-white shadow-sm font-bold text-red-500 transition-all border border-slate-200';
          btnIn.className = 'flex-1 py-2 rounded-lg font-bold text-slate-400 hover:text-slate-600 transition-all border border-transparent';
        }

        this.updateFloatAvailableDisplay();
      },

      updateFloatAvailableDisplay(customText) {
        const el = document.getElementById('float-available-display');
        if (!el) return;

        if (this.floatAction !== 'OUT') {
          el.classList.add('hidden');
          return;
        }

        el.classList.remove('hidden');
        if (customText) {
          el.innerText = customText;
        } else if (this.combinedAvailable !== null) {
          el.innerText = `ยอดเงินสดที่มีในลิ้นชัก (เงินทอน + เงินขายสดวันนี้): ฿${this.combinedAvailable.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        } else {
          el.innerText = 'กำลังโหลดยอด...';
        }
      },

      clearDenominations() {
        document.getElementById('float-total-input').value = '';
        const inputs = document.querySelectorAll('.denom-input');
        inputs.forEach(input => input.value = '');
      },

      calculateFloatTotal() {
        const inputs = document.querySelectorAll('.denom-input');
        let total = 0;
        inputs.forEach(input => {
          const count = Number(input.value) || 0;
          const val = Number(input.dataset.value) || 0;
          total += (count * val);
        });
        document.getElementById('float-total-input').value = total || '';
      },

      saveFloatCashFromModal(btn) {
        const totalInput = document.getElementById('float-total-input').value;
        const total = Number(totalInput);
        const note = document.getElementById('float-note-input').value.trim();
        const action = this.floatAction;
        
        if (isNaN(total) || total <= 0) {
          return this.showAlert('กรุณากรอกยอดเงินให้ถูกต้อง', '');
        }

        if (action === 'OUT' && this.combinedAvailable !== null && total > this.combinedAvailable) {
          return this.showAlert(
            `ไม่สามารถนำเงินออกได้ครับ ยอดที่กรอก (฿${total.toLocaleString(undefined, {minimumFractionDigits: 2})}) เกินยอดเงินสดที่มีในลิ้นชัก (เงินทอน + เงินขายสด = ฿${this.combinedAvailable.toLocaleString(undefined, {minimumFractionDigits: 2})})`,
            ''
          );
        }

        const userName = this.currentSettingsUser ? this.currentSettingsUser.name : 'พนักงาน';
        const tzOffset = (new Date()).getTimezoneOffset() * 60000;
        const timestamp = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');

        // เก็บรายละเอียดแต่ละแบงค์
        const denominations = {
          B1000: Number(document.getElementById('denom-1000').value) || 0,
          B500: Number(document.getElementById('denom-500').value) || 0,
          B100: Number(document.getElementById('denom-100').value) || 0,
          B50: Number(document.getElementById('denom-50').value) || 0,
          B20: Number(document.getElementById('denom-20').value) || 0,
          C10: Number(document.getElementById('denom-10').value) || 0,
          C5: Number(document.getElementById('denom-5').value) || 0,
          C2: Number(document.getElementById('denom-2').value) || 0,
          C1: Number(document.getElementById('denom-1').value) || 0,
        };

        const logEntry = {
          timestamp,
          user: userName,
          action,
          note,
          total,
          denominations
        };

        // 1. บันทึกลงเครื่อง (Queue) ก่อนเลย เพื่อให้ทำงานออฟไลน์ได้
        if (!this.floatCashQueue) this.floatCashQueue = [];
        this.floatCashQueue.push(logEntry);
        localStorage.setItem('pos_floatCashQueue', JSON.stringify(this.floatCashQueue));

        // 2. ปิดหน้าต่างและแจ้งเตือนทันที
        this.closeModal('modal-float-cash');
        this.showAlert('บันทึกรายการสำเร็จ!', '');
        this.logPinAttempt(`${action === 'IN' ? 'นำเงินเข้า' : 'นำเงินออก'}: ฿${total}`, true, userName);

        // 3. ส่งขึ้นเซิร์ฟเวอร์ แล้วค่อยรีเฟรช Summary ตอนสำเร็จ
        this.processFloatCashQueue();
      },

      processFloatCashQueue() {
        if (!this.floatCashQueue || this.floatCashQueue.length === 0 || this.isFloatCashSyncing) return;
        if (!navigator.onLine) return; // ถ้าออฟไลน์อยู่ ไม่ต้องพยายามส่ง

        this.isFloatCashSyncing = true;
        const payload = [...this.floatCashQueue];

        google.script.run
          .withSuccessHandler(res => {
            this.isFloatCashSyncing = false;
            if (res.success) {
              // ลบรายการที่ส่งสำเร็จแล้วออกจาก Queue
              this.floatCashQueue.splice(0, payload.length);
              localStorage.setItem('pos_floatCashQueue', JSON.stringify(this.floatCashQueue));
              
              // ถ้ายอดเข้ามาระหว่างที่ทำ ก็ซิงค์ต่อ
              if (this.floatCashQueue.length > 0) this.processFloatCashQueue();
              else this.fetchSummary();
            }
          })
          .withFailureHandler(() => {
            this.isFloatCashSyncing = false;
            // เน็ตมีปัญหา เก็บไว้ซิงค์รอบหน้า
          })
          .syncFloatCashLogs(payload);
      },

      saveLocalState() {
        localStorage.setItem('pos_syncQueue', JSON.stringify(this.syncQueue));
        localStorage.setItem('pos_history', JSON.stringify(this.history));
        localStorage.setItem('pos_heldOrders', JSON.stringify(this.heldOrders));
      }
    };

          // ============================================================
          // OFFLINE-FIRST QUEUE ENHANCEMENTS (เพิ่มเติมภายหลัง)
          // ครอบคลุมการยกเลิกบิล/รายการที่ซิงค์ขึ้นเซิร์ฟเวอร์ไปแล้ว ให้ทำงานออฟไลน์ได้
          // และเพิ่มระบบ auto-retry เมื่อเน็ตกลับมา (ไม่ต้องรอผู้ใช้กดซิงค์เอง)
          // ============================================================
          Controller.statusQueue = JSON.parse(localStorage.getItem('pos_statusQueue')) || [];
          Controller.isStatusSyncing = false;

          Controller.updateSyncQueueBadge = function () {
                    const badge = document.getElementById('sync-queue-badge');
                    if (!badge) return;
                    const count = this.syncQueue.length
                      + (this.floatCashQueue ? this.floatCashQueue.length : 0)
                      + (this.accessLogQueue ? this.accessLogQueue.length : 0)
                      + (this.statusQueue ? this.statusQueue.length : 0);
                    if (count > 0) {
                                badge.innerText = count;
                                badge.classList.remove('hidden');
                    } else {
                                badge.classList.add('hidden');
                    }
          };

          Controller.processStatusQueue = function () {
                    if (!this.statusQueue || this.statusQueue.length === 0) return;
                    if (this.isStatusSyncing) return;
                    if (!navigator.onLine) return;
                    this.isStatusSyncing = true;
                    const job = this.statusQueue[0];

                    const finish = (ok) => {
                                this.isStatusSyncing = false;
                                if (ok) {
                                              this.statusQueue.shift();
                                              localStorage.setItem('pos_statusQueue', JSON.stringify(this.statusQueue));
                                              this.updateSyncQueueBadge();
                                              this.setIndicator(this.statusQueue.length > 0 ? 'syncing' : 'synced');
                                              this.fetchServerData();
                                              if (this.statusQueue.length > 0) this.processStatusQueue();
                                } else {
                                              this.setIndicator('error');
                                }
                    };

                    if (job.type === 'updateOrderStatus') {
                                google.script.run
                                  .withSuccessHandler(res => finish(!!(res && res.success)))
                                  .withFailureHandler(() => finish(false))
                                  .updateOrderStatus({ invoice: job.invoice, status: job.status, reason: job.reason, employeeId: job.employeeId, pin: job.pin });
                    } else if (job.type === 'cancelSalesItems') {
                                google.script.run
                                  .withSuccessHandler(res => finish(!!(res && res.success)))
                                  .withFailureHandler(() => finish(false))
                                  .cancelSalesItems({ invoice: job.invoice, items: job.items, reason: job.reason, employeeId: job.employeeId, pin: job.pin });
                    } else {
                                finish(true);
                    }
          };

          // เขียนทับ updateOrderStatus เดิม (ยกเลิกบิล/บันทึกของเสีย) ให้ทำงานแบบ offline-first:
          // อัปเดตหน้าจอทันที (optimistic) แล้วค่อยยิงขึ้นเซิร์ฟเวอร์เบื้องหลัง
          // ถ้าเน็ตหลุดจะเก็บเข้าคิวไว้ แล้วระบบ auto-retry จะซิงค์ให้เองเมื่อเน็ตกลับมา
          Controller.updateOrderStatus = async function (invoiceId, status) {
                    const isPastDay = !this.history.some(o => o.invoice === invoiceId) && !this.syncQueue.some(o => o.invoice === invoiceId);
                    const order = this.history.find(o => o.invoice === invoiceId) || this.syncQueue.find(o => o.invoice === invoiceId) || (this.historyViewData || []).find(o => o.invoice === invoiceId);
                    if (!order || order.status === 'cancelled' || order.status === 'waste') return;

                    const actionText = status === 'waste' ? 'บันทึกของเสีย' : 'ยกเลิกบิล';

                    const reason = await this.showPrompt(`ระบุเหตุผลที่ต้องการ${actionText} ${order.invoice}:`, {});
                    if (reason === null) return;
                    if (reason.trim() === '') return this.showAlert(`กรุณาระบุเหตุผลก่อน${actionText}`, '');

                    const auth = await this.requireActionPin(`ใส่รหัส PIN เพื่อยืนยัน${actionText} ${order.invoice}:`);
                    if (!auth) return;
                    const userName = auth.employee.name;

                    const queueEntry = this.syncQueue.find(o => o.invoice === order.invoice);
                    if (queueEntry) {
                                queueEntry.status = status;
                                queueEntry.cancelReason = `${reason.trim()} (โดย ${userName})`;
                                queueEntry.cancelUser = userName;
                                queueEntry.cancelTimestamp = new Date().toISOString();
                                this.saveLocalState();
                                this.renderHistory();
                                this.processSyncQueue();
                                return;
                    }

                    order.status = status;
                    order.cancelReason = `${reason.trim()} (โดย ${userName})`;
                    order.cancelUser = userName;
                    order.cancelTimestamp = new Date().toISOString();
                    // บิลของวันอื่น (ไม่ใช่วันนี้) ยอดแก้วของวันนั้นถูกสรุปปิดไปแล้ว ไม่ต้องไปหักยอดแก้ววันนี้
                    if (!isPastDay) {
                              const removedCups = order.items.reduce((s, i) => s + i.qty, 0);
                              this.serverCupCount = Math.max(0, this.serverCupCount - removedCups);
                              localStorage.setItem('pos_serverCupCount', this.serverCupCount);
                              this.updateCupUI();
                    }
                    this.saveLocalState();
                    this.renderHistory();
                    this.setIndicator('syncing');

                    this.statusQueue.push({ type: 'updateOrderStatus', invoice: order.invoice, status: status, reason: reason.trim(), employeeId: auth.employeeId, pin: auth.pin, ts: Date.now() });
                    localStorage.setItem('pos_statusQueue', JSON.stringify(this.statusQueue));
                    this.updateSyncQueueBadge();
                    this.processStatusQueue();
          };

          // เขียนทับ cancelOrderItem เดิม (ยกเลิกรายการเดียวในบิล) ให้ทำงานแบบ offline-first เช่นกัน
          Controller.cancelOrderItem = async function (invoice, sku, note) {
                    const isPastDay = !this.history.some(o => o.invoice === invoice);
                    const order = this.history.find(o => o.invoice === invoice) || (this.historyViewData || []).find(o => o.invoice === invoice);
                    if (!order) return;
                    const item = order.items.find(i => i.sku === sku && (i.note || '') === (note || ''));
                    if (!item || item.cancelled) return;

                    const reason = await this.showPrompt(`ระบุเหตุผลที่ต้องการยกเลิกรายการ "${item.name}" ในบิล ${invoice}:`, {});
                    if (reason === null) return;
                    if (reason.trim() === '') return this.showAlert('กรุณาระบุเหตุผลก่อนยกเลิกรายการ', '');

                    const auth = await this.requireActionPin(`ใส่รหัส PIN เพื่อยืนยันการยกเลิกรายการ "${item.name}":`);
                    if (!auth) return;
                    const userName = auth.employee.name;

                    item.cancelled = true;
                    item.cancelReason = reason.trim();
                    // บิลของวันอื่น (ไม่ใช่วันนี้) ยอดแก้วของวันนั้นถูกสรุปปิดไปแล้ว ไม่ต้องไปหักยอดแก้ววันนี้
                    if (!isPastDay) {
                              this.serverCupCount = Math.max(0, this.serverCupCount - item.qty);
                              localStorage.setItem('pos_serverCupCount', this.serverCupCount);
                              this.updateCupUI();
                    }
                    this.saveLocalState();
                    this.renderHistory();
                    this.setIndicator('syncing');

                    this.statusQueue.push({
                                type: 'cancelSalesItems',
                                invoice: invoice,
                                items: [{ sku: sku, note: note }],
                                reason: reason.trim(),
                                employeeId: auth.employeeId,
                                pin: auth.pin,
                                ts: Date.now()
                    });
                    localStorage.setItem('pos_statusQueue', JSON.stringify(this.statusQueue));
                    this.updateSyncQueueBadge();
                    this.processStatusQueue();
          };

          // ระบบ auto-retry กลาง: เมื่อเน็ตกลับมา หรือเช็คเป็นระยะ ให้ลองซิงค์ทุกคิวที่ค้างอยู่โดยอัตโนมัติ
          // ไม่ต้องรอให้ผู้ใช้กดปุ่ม Refresh หรือสั่งออเดอร์ใหม่เพื่อ trigger การซิงค์อีกต่อไป
          Controller.startOfflineSyncWatcher = function () {
                    const trySyncAll = () => {
                                if (!navigator.onLine) return;
                                this.processSyncQueue();
                                this.processFloatCashQueue();
                                this.processLogQueue();
                                this.processStatusQueue();
                                // ถ้าโหลดข้อมูลตอนเปิดแอปครั้งก่อนพลาดบางส่วน (เมนู/พนักงาน/ฯลฯ) ให้ลองใหม่อัตโนมัติ
                                // ไม่ต้องรอให้ผู้ใช้ปิดเปิดแอปเอง (ใช้ throttle ตัวเดียวกับ visibilitychange ด้านล่าง)
                                if (this._refreshHadFailure && Date.now() - (this.lastServerRefreshAt || 0) > 15000) {
                                            this.lastServerRefreshAt = Date.now();
                                            this.setIndicator('syncing');
                                            this.refreshFromServer();
                                }
                    };

                    window.addEventListener('online', () => {
                                this.setIndicator('syncing');
                                trySyncAll();
                    });
                    window.addEventListener('offline', () => {
                                this.setIndicator('error');
                    });

                    // เช็คซ้ำเป็นระยะ เผื่อกรณี browser ไม่ยิง event 'online' ให้ (พบได้บ่อยบนมือถือบางรุ่น)
                    setInterval(() => {
                                trySyncAll();
                                this.updateSyncQueueBadge();
                    }, 20000);

                    // เช็คว่ามีเวอร์ชันใหม่ deploy ขึ้นมาหรือยังเป็นระยะ (ไม่ auto-reload เอง แค่ขึ้นแถบแจ้งให้กดรีเฟรชเอง)
                    this.checkForAppUpdate();
                    setInterval(() => this.checkForAppUpdate(), 5 * 60 * 1000);

                    // เช็คแจ้งเตือนหมดอายุเป็นระยะ (ไม่ต้องรอเน็ต เทียบเวลาจากข้อมูลที่โหลดไว้ในเครื่องอยู่แล้ว)
                    setInterval(() => this.checkNotifications(), 60000);

                    // เช็คออเดอร์ออนไลน์ใหม่เป็นระยะ (ต้องยิงไปเซิร์ฟเวอร์จริงเพราะลูกค้าสั่งจากเครื่องอื่น)
                    this.checkPendingOrders();
                    setInterval(() => this.checkPendingOrders(), 8000);

                    // มือถือมักหยุด/หน่วง setInterval ตอนแอปถูกสลับไปพัก (background tab/PWA)
                    // พอสลับกลับมาเปิดอีกครั้ง (visibilitychange) ให้ดึงข้อมูลใหม่ + ลอง sync คิวที่ค้างทันที
                    // ไม่ต้องรอรอบ setInterval ถัดไปหรือให้ผู้ใช้กด refresh เอง
                    this.lastServerRefreshAt = Date.now();
                    document.addEventListener('visibilitychange', () => {
                                if (document.visibilityState !== 'visible') return;
                                trySyncAll();
                                this.checkNotifications();
                                this.checkPendingOrders();
                                this.checkForAppUpdate();
                                if (Date.now() - this.lastServerRefreshAt < 15000) return;
                                this.lastServerRefreshAt = Date.now();
                                this.setIndicator('syncing');
                                this.refreshFromServer();
                    });
          };

    window.onload = () => { Controller.init(); Controller.startOfflineSyncWatcher(); };
