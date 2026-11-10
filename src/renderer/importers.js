/*
 * الاستيراد: تعريف القوالب، التعرف التلقائي على الأعمدة، وتطبيق البيانات على قاعدة البيانات.
 * يعمل في المتصفح (window.Importers) وفي Node.
 */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Engine;
  const { normCode, num, toMonth, normUnit } = E;

  const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/[\s_\-:؟?()«»"'.]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

  // تعريف الحقول لكل نوع استيراد: key, label, aliases, required
  const KINDS = {
    items: {
      title: 'الأصناف',
      fields: [
        { key: 'code', label: 'رقم الصنف', aliases: ['رقم الصنف', 'كود الصنف', 'الكود', 'رقم', 'code', 'itemcode', 'sku'], required: true },
        { key: 'name', label: 'اسم الصنف', aliases: ['اسم الصنف', 'الاسم', 'البيان', 'name', 'description'] },
        { key: 'baseUnit', label: 'الوحدة الأساسية', aliases: ['الوحدة الأساسية', 'الوحدة', 'وحدة', 'unit', 'baseunit'] },
        { key: 'purchaseUnit', label: 'وحدة الشراء', aliases: ['وحدة الشراء', 'وحدة الطلب', 'purchaseunit'] },
        { key: 'group', label: 'المجموعة الرئيسية', aliases: ['المجموعة الرئيسية', 'المجموعة', 'group'] },
        { key: 'sub1', label: 'المجموعة الفرعية 1', aliases: ['المجموعة الفرعية 1', 'المجموعة الفرعية1', 'فرعية 1', 'subgroup1'] },
        { key: 'sub2', label: 'المجموعة الفرعية 2', aliases: ['المجموعة الفرعية 2', 'المجموعة الفرعية2', 'فرعية 2', 'subgroup2'] },
        { key: 'mainItem', label: 'الصنف الرئيسي', aliases: ['الصنف الرئيسي', 'mainitem'] },
        { key: 'type', label: 'نوع الصنف', aliases: ['نوع الصنف', 'النوع', 'type'] },
        { key: 'active', label: 'نشاط الصنف', aliases: ['نشاط الصنف', 'النشاط', 'الحالة', 'active', 'status'] },
        { key: 'leadOverride', label: 'فترة توصيل خاصة (شهر)', aliases: ['فترة توصيل خاصة (شهر)', 'فترة توصيل خاصة', 'فترة التوصيل', 'leadtime'] },
        { key: 'extraOverride', label: 'أشهر إضافية خاصة', aliases: ['أشهر إضافية خاصة', 'أشهر إضافية بقرار الإدارة', 'اشهر اضافيه', 'extramonths'] },
        { key: 'refCost', label: 'تكلفة مرجعية', aliases: ['تكلفة مرجعية', 'تكلفة مرجعية (إذا لم يوجد في المخزون)', 'التكلفة', 'تكلفة الوحدة', 'cost'] },
        { key: 'notes', label: 'ملاحظات', aliases: ['ملاحظات', 'notes'] },
        { key: 'u2', label: 'وحدة 2', aliases: ['وحدة 2', 'وحدة2', 'unit2'] },
        { key: 'f2', label: 'معامل 2', aliases: ['معامل 2', 'معامل2', 'factor2'] },
        { key: 'u3', label: 'وحدة 3', aliases: ['وحدة 3', 'وحدة3', 'unit3'] },
        { key: 'f3', label: 'معامل 3', aliases: ['معامل 3', 'معامل3', 'factor3'] },
        { key: 'u4', label: 'وحدة 4', aliases: ['وحدة 4', 'وحدة4', 'unit4'] },
        { key: 'f4', label: 'معامل 4', aliases: ['معامل 4', 'معامل4', 'factor4'] }
      ]
    },
    sales: {
      title: 'المبيعات',
      fields: [
        { key: 'month', label: 'الشهر (اختياري)', aliases: ['الشهر', 'month', 'التاريخ'] },
        { key: 'code', label: 'رقم الصنف', aliases: ['رقم الصنف', 'كود الصنف', 'الكود', 'رقم', 'code'], required: true },
        { key: 'name', label: 'اسم الصنف', aliases: ['اسم الصنف', 'الاسم', 'name'] },
        { key: 'unit', label: 'الوحدة', aliases: ['الوحدة', 'وحدة', 'unit'] },
        { key: 'returned', label: 'الوارد (مرتجع)', aliases: ['الوارد (مرتجع)', 'الوارد', 'مرتجع', 'المرتجع', 'returns'] },
        { key: 'issued', label: 'المنصرف', aliases: ['المنصرف', 'الكمية المباعة', 'المبيعات', 'issued', 'sold', 'qty'] },
        { key: 'net', label: 'صافي المبيعات (بدل الوارد/المنصرف)', aliases: ['صافي المبيعات', 'الصافي', 'net'] }
      ]
    },
    stock: {
      title: 'المخزون',
      fields: [
        { key: 'code', label: 'رقم الصنف', aliases: ['رقم الصنف', 'كود الصنف', 'الكود', 'رقم', 'code'], required: true },
        { key: 'name', label: 'اسم الصنف', aliases: ['اسم الصنف', 'الاسم', 'name'] },
        { key: 'unit', label: 'الوحدة', aliases: ['الوحدة', 'وحدة', 'unit'] },
        { key: 'qty', label: 'الكمية المتوفرة', aliases: ['الكمية المتوفرة', 'الكمية', 'الرصيد', 'qty', 'quantity'], required: true },
        { key: 'cost', label: 'تكلفة الوحدة', aliases: ['تكلفة الوحدة', 'التكلفة', 'سعر التكلفة', 'cost'] }
      ]
    },
    po: {
      title: 'أوامر الشراء',
      fields: [
        { key: 'poNo', label: 'رقم الأمر', aliases: ['رقم الأمر', 'رقم الامر', 'رقم امر الشراء', 'امر الشراء', 'po', 'pono'], required: true },
        { key: 'code', label: 'رقم الصنف', aliases: ['رقم الصنف', 'كود الصنف', 'الكود', 'code'], required: true },
        { key: 'name', label: 'اسم الصنف', aliases: ['اسم الصنف', 'الاسم', 'name'] },
        { key: 'unit', label: 'الوحدة', aliases: ['الوحدة', 'وحدة', 'unit'] },
        { key: 'qty', label: 'كمية أمر الشراء', aliases: ['كمية امر الشراء', 'كمية الأمر', 'الكمية المطلوبة', 'الكمية', 'qty'], required: true },
        { key: 'value', label: 'قيمة السطر (سعر أمر الشراء)', aliases: ['سعر امر الشراء', 'قيمة امر الشراء', 'قيمة السطر', 'القيمة', 'الاجمالي', 'value', 'amount'] },
        { key: 'invQty', label: 'الكمية المستلمة (كمية الفاتورة)', aliases: ['كمية الفاتورة', 'الكمية المستلمة', 'المستلم', 'received'] },
        { key: 'remaining', label: 'الكمية المتبقية', aliases: ['الكمية المتبقية', 'المتبقي', 'remaining'] },
        { key: 'supplier', label: 'المورد', aliases: ['المورد', 'اسم المورد', 'supplier', 'vendor'] },
        { key: 'currency', label: 'العملة', aliases: ['العملة', 'currency'] },
        { key: 'poDate', label: 'تاريخ الأمر', aliases: ['تاريخ الأمر', 'تاريخ الامر', 'التاريخ', 'date'] },
        { key: 'eta', label: 'تاريخ الوصول المتوقع', aliases: ['تاريخ الوصول المتوقع', 'تاريخ الوصول', 'الوصول المتوقع', 'eta'] }
      ]
    },
    poPay: {
      title: 'شحن وسداد أوامر الشراء',
      fields: [
        { key: 'poNo', label: 'رقم الأمر', aliases: ['رقم الأمر', 'رقم الامر', 'رقم امر الشراء', 'امر الشراء', 'po'], required: true },
        { key: 'poDate', label: 'تاريخ الأمر', aliases: ['تاريخ الأمر', 'تاريخ الامر', 'تاريخ امر الشراء', 'تاريخ إصدار الأمر', 'podate'] },
        { key: 'value', label: 'قيمة الأمر', aliases: ['القيمة دولار', 'قيمة الأمر', 'قيمة الامر', 'القيمة', 'value'] },
        { key: 'shipping', label: 'رسوم الشحن', aliases: ['رسوم الشحن دولار', 'رسوم الشحن', 'الشحن', 'shipping'] },
        { key: 'currency', label: 'العملة', aliases: ['العملة', 'currency'] },
        { key: 'status', label: 'حالة السداد', aliases: ['حالة السداد', 'السداد', 'status'] },
        { key: 'paid', label: 'المبلغ المدفوع', aliases: ['المبلغ المدفوع', 'المدفوع', 'المسدد', 'paid'] },
        { key: 'payDate', label: 'تاريخ السداد', aliases: ['تاريخ السداد', 'تاريخ الدفع'] },
        { key: 'agent', label: 'المخلّص', aliases: ['المخلص', 'المخلّص', 'agent'] },
        { key: 'supplier', label: 'المورد', aliases: ['المورد', 'supplier'] },
        { key: 'blNo', label: 'رقم البوليصة', aliases: ['رقم البوليصة', 'البوليصة', 'بوليصة الشحن', 'رقم بوليصة الشحن', 'bl', 'blno', 'b/l'] },
        { key: 'shipDate', label: 'تاريخ الشحن', aliases: ['تاريخ الشحن', 'تاريخ البوليصة', 'shipdate', 'etd'] },
        { key: 'eta', label: 'تاريخ الوصول المتوقع', aliases: ['تاريخ الوصول المتوقع', 'تاريخ الوصول', 'eta'] },
        { key: 'note', label: 'ملاحظة', aliases: ['ملاحظة', 'ملاحظات', 'note'] }
      ]
    },
    track: {
      title: 'تحديث المخلّص / الوكيل',
      fields: [
        { key: 'poNo', label: 'رقم أمر الشراء', aliases: ['رقم أمر الشراء', 'رقم الأمر', 'رقم الامر', 'امر الشراء', 'po'] },
        { key: 'blNo', label: 'رقم البوليصة', aliases: ['رقم البوليصة', 'البوليصة', 'بوليصة الشحن', 'bl', 'blno', 'b/l', 'رقم التلكس'] },
        { key: 'containerNo', label: 'رقم الحاوية', aliases: ['رقم الحاوية', 'الحاوية', 'container', 'containerno', 'cntr'] },
        { key: 'status', label: 'حالة المعاملة', aliases: ['حالة المعاملة', 'الحالة', 'حالة الشحنة', 'status'] },
        { key: 'statusDate', label: 'تاريخ الحالة', aliases: ['تاريخ الحالة', 'التاريخ', 'تاريخ التحديث', 'date'] },
        { key: 'portDate', label: 'تاريخ وصول الميناء', aliases: ['تاريخ وصول الميناء', 'وصول الميناء', 'تاريخ الوصول', 'eta port', 'arrival'] },
        { key: 'warehouseDate', label: 'تاريخ الوصول للمستودع', aliases: ['تاريخ الوصول للمستودع', 'وصول المستودع', 'تاريخ التسليم للمستودع'] },
        { key: 'emptyDate', label: 'تاريخ تسليم الحاوية فارغة', aliases: ['تاريخ تسليم الحاوية فارغة', 'تسليم الفارغ', 'إرجاع الحاوية', 'empty return'] },
        { key: 'note', label: 'ملاحظة', aliases: ['ملاحظة', 'ملاحظات', 'note'] }
      ]
    },
    transit: {
      title: 'البضاعة بالطريق',
      fields: [
        { key: 'code', label: 'رقم الصنف', aliases: ['رقم الصنف', 'كود الصنف', 'الكود', 'رقم', 'code'], required: true },
        { key: 'name', label: 'اسم الصنف', aliases: ['اسم الصنف', 'الاسم', 'name'] },
        { key: 'unit', label: 'الوحدة', aliases: ['الوحدة', 'وحدة', 'unit'] },
        { key: 'qty', label: 'الكمية بالطريق', aliases: ['الكمية بالطريق', 'الكمية', 'qty'], required: true },
        { key: 'source', label: 'المصدر / رقم الأمر', aliases: ['المصدر / رقم الأمر', 'المصدر', 'رقم الأمر', 'source', 'po'] }
      ]
    }
  };

  // يبحث عن صف العناوين: الصف اللي فيه أكبر عدد تطابقات خلال أول 15 صف
  function detectHeader(rows, kind) {
    const fields = KINDS[kind].fields;
    let best = { row: 0, score: -1, map: {} };
    const lim = Math.min(rows.length, 15);
    for (let r = 0; r < lim; r++) {
      const hdr = (rows[r] || []).map(norm);
      const map = {}; let score = 0;
      for (const f of fields) {
        const al = f.aliases.map(norm);
        let idx = -1;
        // تطابق تام أولًا ثم احتواء
        for (let c = 0; c < hdr.length && idx < 0; c++) if (hdr[c] && al.includes(hdr[c])) idx = c;
        if (idx < 0) for (let c = 0; c < hdr.length && idx < 0; c++) if (hdr[c] && al.some(a => a.length > 2 && hdr[c].startsWith(a))) idx = c;
        if (idx >= 0 && !Object.values(map).includes(idx)) { map[f.key] = idx; score++; }
      }
      if (score > best.score) best = { row: r, score, map };
    }
    return best;
  }

  function rowsToRecords(rows, headerRow, map, keyField) {
    const key = keyField || 'code';
    const out = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const rec = {};
      let any = false;
      for (const [k, c] of Object.entries(map)) {
        if (c == null || c < 0) continue;
        const v = row[c];
        rec[k] = v;
        if (v != null && v !== '') any = true;
      }
      if (!any) continue;
      if (rec[key] == null || String(rec[key]).trim() === '') continue;
      // تجاهل صفوف الإجمالي
      if (/^(الإجمالي|الاجمالي|المجموع|total)$/i.test(String(rec[key]).trim())) continue;
      if (rec.code != null) rec.code = normCode(rec.code);
      if (rec.poNo != null) rec.poNo = normCode(rec.poNo);
      out.push(rec);
    }
    return out;
  }

  function parseActive(v) {
    if (v == null || v === '') return true;
    const s = String(v).trim();
    if (/^(لا يعمل|لايعمل|موقوف|غير نشط|متوقف|no|false|0|inactive)$/i.test(s)) return false;
    return true;
  }
  const blankOrNum = v => (v == null || String(v).trim() === '') ? null : num(v);

  // ---------- إضافة أصناف تلقائيًا (غير مصنف) ----------
  function autoAddItems(db, recs, source) {
    const known = new Set(db.items.map(i => i.code));
    const added = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const r of recs) {
      if (known.has(r.code)) continue;
      known.add(r.code);
      const it = {
        code: r.code, name: String(r.name || '').trim() || r.code, baseUnit: String(r.unit || '').trim(), purchaseUnit: '', units: [],
        group: 'غير مصنف', sub1: '', sub2: '', mainItem: '', type: db.settings.defaultType || (db.types[0] && db.types[0].name) || '',
        active: true, leadOverride: null, extraOverride: null, refCost: r.cost != null ? blankOrNum(r.cost) : null, notes: 'أضيف تلقائيًا من ' + source,
        autoAdded: true, addedAt: today
      };
      db.items.push(it);
      added.push(it);
    }
    if (added.length && !db.groups.includes('غير مصنف')) db.groups.push('غير مصنف');
    return added;
  }

  // ---------- تطبيق الاستيراد ----------
  function applyItems(db, recs, mode) {
    // mode: 'merge' (تحديث الموجود + إضافة الجديد) | 'addOnly'
    const idx = new Map(db.items.map((it, i) => [it.code, i]));
    let added = 0, updated = 0;
    const has = (r, k) => Object.prototype.hasOwnProperty.call(r, k) && r[k] != null && String(r[k]).trim() !== '';
    for (const r of recs) {
      const units = [];
      for (const k of [2, 3, 4]) if (has(r, 'u' + k) && num(r['f' + k]) > 0) units.push({ name: String(r['u' + k]).trim(), factor: num(r['f' + k]) });
      if (idx.has(r.code)) {
        if (mode === 'addOnly') continue;
        const it = db.items[idx.get(r.code)];
        if (has(r, 'name')) it.name = String(r.name).trim();
        if (has(r, 'baseUnit')) it.baseUnit = String(r.baseUnit).trim();
        if (has(r, 'purchaseUnit')) it.purchaseUnit = String(r.purchaseUnit).trim();
        for (const k of ['group', 'sub1', 'sub2', 'mainItem', 'type', 'notes']) if (has(r, k)) it[k] = String(r[k]).trim();
        if ('active' in r && has(r, 'active')) it.active = parseActive(r.active);
        if ('leadOverride' in r) it.leadOverride = blankOrNum(r.leadOverride);
        if ('extraOverride' in r) it.extraOverride = blankOrNum(r.extraOverride);
        if (has(r, 'refCost')) it.refCost = num(r.refCost);
        if (units.length) {
          for (const u of units) {
            const ex = it.units.find(x => normUnit(x.name) === normUnit(u.name));
            if (ex) ex.factor = u.factor; else it.units.push(u);
          }
        }
        if (has(r, 'group') || has(r, 'type')) it.autoAdded = false;
        updated++;
      } else {
        const it = {
          code: r.code, name: String(r.name || '').trim(), baseUnit: String(r.baseUnit || '').trim(), purchaseUnit: String(r.purchaseUnit || '').trim(), units,
          group: String(r.group || 'غير مصنف').trim(), sub1: String(r.sub1 || '').trim(), sub2: String(r.sub2 || '').trim(), mainItem: String(r.mainItem || '').trim(),
          type: String(r.type || db.settings.defaultType || '').trim(), active: parseActive(r.active),
          leadOverride: blankOrNum(r.leadOverride), extraOverride: blankOrNum(r.extraOverride), refCost: blankOrNum(r.refCost), notes: String(r.notes || '').trim(),
          autoAdded: false, addedAt: new Date().toISOString().slice(0, 10)
        };
        db.items.push(it); idx.set(it.code, db.items.length - 1); added++;
      }
    }
    syncGroups(db);
    return { added, updated };
  }

  function syncGroups(db) {
    const set = new Set(db.groups || []);
    for (const it of db.items) if (it.group) set.add(it.group);
    db.groups = [...set];
  }

  function applySales(db, recs, month) {
    // month: الشهر الافتراضي لو الملف ما فيه عمود شهر
    const rows = [];
    let skipped = 0;
    for (const r of recs) {
      const m = toMonth(r.month) || month;
      if (!m) { skipped++; continue; }
      let issued = num(r.issued), returned = num(r.returned);
      if (r.net != null && r.net !== '' && (r.issued == null || r.issued === '')) { issued = num(r.net); returned = 0; }
      rows.push({ month: m, code: r.code, name: String(r.name || '').trim(), unit: String(r.unit || '').trim(), returned, issued });
    }
    const monthsIn = [...new Set(rows.map(r => r.month))];
    const replaced = monthsIn.filter(m => db.sales.some(s => s.month === m));
    db.sales = db.sales.filter(s => !monthsIn.includes(s.month)).concat(rows);
    const added = autoAddItems(db, rows, 'المبيعات');
    return { rows: rows.length, months: monthsIn.sort(), replaced, skipped, added };
  }

  function applyStock(db, recs, date) {
    const rows = recs.map(r => ({ code: r.code, name: String(r.name || '').trim(), unit: String(r.unit || '').trim(), qty: num(r.qty), cost: num(r.cost) }));
    db.stock = { date: date || db.stock.date || '', rows };
    const added = autoAddItems(db, rows, 'المخزون');
    return { rows: rows.length, added };
  }

  function applyTransit(db, recs, mode, defaultSource) {
    const rows = recs.map(r => ({ code: r.code, name: String(r.name || '').trim(), unit: String(r.unit || '').trim(), qty: num(r.qty), source: String(r.source || defaultSource || '').trim() }));
    db.transit = mode === 'append' ? db.transit.concat(rows) : rows;
    const added = autoAddItems(db, rows, 'بالطريق');
    return { rows: rows.length, added };
  }

  // ---------- أوامر الشراء ----------
  const isNum = v => v !== null && v !== '' && v !== undefined && isFinite(typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')));
  const toDate = v => {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const s = String(v).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
  };
  function curCode(db, v) {
    const s = String(v || '').trim(); if (!s) return '';
    const c = (db.currencies || []).find(x => x.code.toLowerCase() === s.toLowerCase() || norm(x.name) === norm(s) || (s.includes('دولار') && x.code === 'USD') || (s.includes('ريال') && x.code === 'SAR'));
    return c ? c.code : s.toUpperCase();
  }
  function defaultCurrency(db, lines) {
    const items = new Map(db.items.map(i => [i.code, i]));
    for (const l of lines || []) {
      const it = items.get(l.code); if (!it) continue;
      const t = (db.types || []).find(x => x.name === it.type);
      if (t && t.currency) return t.currency;
    }
    return '';
  }
  function ensurePo(db) { if (!db.po) db.po = { orders: {}, imports: [] }; if (!db.po.orders) db.po.orders = {}; if (!db.po.imports) db.po.imports = []; return db.po; }

  // استيراد تقرير أوامر الشراء (سطر لكل صنف). التقرير = كل الأوامر المفتوحة الآن:
  // أمر موجود ← يتحدث ، أمر جديد ← يُضاف ، أمر مفتوح اختفى من التقرير ← «وصل المخزون» تلقائيًا.
  function applyPOs(db, recs, { date, user, file } = {}) {
    const po = ensurePo(db);
    const day = date || new Date().toISOString().slice(0, 10);
    const groups = new Map();
    let skipped = 0;
    for (const r of recs) {
      if (!r.poNo || !/\d/.test(r.poNo) || /[^\w\-./]/.test(r.poNo) || !r.code || /[٠-٩:]/.test(r.code) || !(isNum(r.qty) || isNum(r.remaining))) { skipped++; continue; }
      if (!groups.has(r.poNo)) groups.set(r.poNo, []);
      const qty = num(r.qty), inv = num(r.invQty);
      groups.get(r.poNo).push({
        code: r.code, name: String(r.name || '').trim(), unit: String(r.unit || '').trim(), qty, value: Math.abs(num(r.value)), invQty: inv,
        remaining: isNum(r.remaining) ? num(r.remaining) : Math.max(0, qty - inv), _r: r
      });
    }
    const added = autoAddItems(db, [...groups.values()].flat().map(l => ({ code: l.code, name: l.name, unit: l.unit })), 'أوامر الشراء');
    const res = { orders: groups.size, lines: 0, newOrders: [], closed: [], reopened: [], completed: [], skipped, added };
    for (const [no, lines] of groups) {
      res.lines += lines.length;
      let o = po.orders[no];
      const first = lines[0]._r;
      if (!o) {
        o = po.orders[no] = { no, status: 'open', firstSeen: day, lastSeen: day, currency: '', lines: [], payments: [], shipping: 0, agent: '', supplier: '', note: '', eta: '', etaManual: false, flags: [] };
        res.newOrders.push(no);
      }
      o.lines = lines.map(l => { const x = Object.assign({}, l); delete x._r; return x; });
      o.lastSeen = day;
      if (first.supplier) o.supplier = String(first.supplier).trim();
      if (first.currency) o.currency = curCode(db, first.currency);
      if (!o.currency) o.currency = defaultCurrency(db, o.lines) || 'SAR';
      const pd = toDate(first.poDate); if (pd) o.poDate = pd;
      const eta = toDate(first.eta); if (eta) { o.eta = eta; o.etaManual = true; }
      o.flags = (o.flags || []).filter(f => f !== 'stillInReport');
      const allDone = o.lines.every(l => num(l.remaining) <= 0);
      if (allDone && o.status === 'open') { o.status = 'received'; o.receivedAt = day; o.receivedBy = 'auto'; o.receivedNote = 'الكمية المتبقية صفر'; res.completed.push(no); }
      else if (!allDone && o.status === 'received') {
        if (o.receivedBy === 'auto') { o.status = 'open'; o.receivedAt = ''; o.receivedBy = ''; res.reopened.push(no); }
        else o.flags.push('stillInReport'); // علّمه المستخدم واصل لكنه ما زال في تقرير النظام
      }
    }
    for (const no of Object.keys(po.orders)) {
      const o = po.orders[no];
      if (o.status === 'open' && !groups.has(no) && (o.lines || []).length) {
        o.status = 'received'; o.receivedAt = day; o.receivedBy = 'auto'; o.receivedNote = 'اختفى من تقرير ' + day; res.closed.push(no);
      }
    }
    po.imports.push({ at: new Date().toISOString(), date: day, kind: 'po', file: file || '', user: user || '', orders: res.orders, lines: res.lines, newOrders: res.newOrders.length, closed: res.closed.length, reopened: res.reopened.length });
    if (po.imports.length > 200) po.imports.splice(0, po.imports.length - 200);
    return res;
  }

  // استيراد شيت محاسب الموردين (سطر لكل أمر): الشحن، المخلّص، الحالة، المدفوع، الملاحظة.
  // دفعات «من الشيت» تُستبدل في كل استيراد، والدفعات اليدوية تبقى كما هي.
  function applyPOPay(db, recs, { date, user, file, currencyHint } = {}) {
    const po = ensurePo(db);
    const day = date || new Date().toISOString().slice(0, 10);
    const res = { orders: 0, created: [], shipped: [], paidFull: 0, partial: 0, fromNote: [], skipped: 0 };
    const has = (r, k) => r[k] != null && String(r[k]).trim() !== '';
    for (const r of recs) {
      if (!r.poNo || !/\d/.test(r.poNo)) { res.skipped++; continue; }
      res.orders++;
      let o = po.orders[r.poNo];
      if (!o) {
        o = po.orders[r.poNo] = { no: r.poNo, status: 'open', firstSeen: day, lastSeen: day, currency: '', lines: [], payments: [], shipping: 0, agent: '', supplier: '', note: '', eta: '', etaManual: false, flags: [] };
        res.created.push(r.poNo);
      }
      // الشيت هو مرجع المبالغ: عمود العملة، أو عملة من عنوان عمود القيمة (مثل «القيمة دولار»)
      if (has(r, 'currency')) o.currency = curCode(db, r.currency);
      else if (currencyHint) o.currency = currencyHint;
      if (!o.currency) o.currency = defaultCurrency(db, o.lines) || 'SAR';
      if (has(r, 'value') && !(o.lines || []).length) o.manualValue = Math.abs(num(r.value));
      if (has(r, 'shipping')) o.shipping = Math.abs(num(r.shipping));
      if (has(r, 'agent')) o.agent = String(r.agent).trim();
      if (has(r, 'supplier')) o.supplier = String(r.supplier).trim();
      if (has(r, 'note')) o.note = String(r.note).trim();
      const eta = toDate(r.eta); if (eta) { o.eta = eta; o.etaManual = true; }
      // وجود الأمر في شيت المحاسب = صدرت له بوليصة شحن ← «تم الشحن»
      if (!o.shipped) { o.shipped = true; o.shippedAt = day; o.shippedBy = 'sheet'; res.shipped.push(r.poNo); }
      if (has(r, 'blNo')) o.blNo = String(r.blNo).trim();
      const pdt = toDate(r.poDate); if (pdt) o.poDate = pdt;
      const sd = toDate(r.shipDate); if (sd) o.shipDate = sd;
      o.payments = (o.payments || []).filter(p => p.source !== 'sheet');
      const st = String(r.status || '').trim();
      const notPaid = /لم|غير|not|unpaid/i.test(st);
      const paid = !notPaid && /سدد|السداد|مدفوع|paid/i.test(st);
      const linesValue = (o.lines || []).reduce((a, l) => a + num(l.value), 0);
      const total = ((o.lines || []).length ? linesValue : num(o.manualValue)) + num(o.shipping);
      const payDate = toDate(r.payDate) || day;
      if (has(r, 'paid') && num(r.paid) > 0) {
        o.payments.push({ id: 'S' + Date.now() + Math.random().toString(36).slice(2, 6), date: payDate, amount: num(r.paid), currency: o.currency, kind: 'دفعة', note: 'من شيت السداد', source: 'sheet', by: user || '' });
        res.partial++;
      } else if (paid && total > 0) {
        o.payments.push({ id: 'S' + Date.now() + Math.random().toString(36).slice(2, 6), date: payDate, amount: total, currency: o.currency, kind: 'سداد كامل', note: 'حالة «' + st + '» في شيت السداد', source: 'sheet', by: user || '' });
        res.paidFull++;
      } else if (has(r, 'note')) {
        // ملاحظة فيها مبلغ مثل «تم سداد دفعة 5000» ← دفعة جزئية للمراجعة
        const nums = (String(r.note).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/\d[\d,.]*/g) || []).map(x => num(x)).filter(x => x >= 100);
        if (nums.length) {
          const amt = Math.max(...nums);
          o.payments.push({ id: 'S' + Date.now() + Math.random().toString(36).slice(2, 6), date: payDate, amount: amt, currency: o.currency, kind: 'دفعة', note: 'من الملاحظة: ' + r.note + ' — راجع العملة', source: 'sheet', review: true, by: user || '' });
          res.fromNote.push(r.poNo);
        }
      }
    }
    po.imports.push({ at: new Date().toISOString(), date: day, kind: 'poPay', file: file || '', user: user || '', orders: res.orders, newOrders: res.created.length });
    return res;
  }

  // ---------- تقرير المخلّص (بيان المعاملات تحت التخليص — Crystal Reports) ----------
  // كل معاملة: سطر مسلسل ← سطر بيانات (الحالة، المنشأ، المنفذ، التواريخ، الحاويات، الوكيل، البوليصة، رقم المعاملة)
  // ← سطر ملاحظات (فيه رقم أمر الشراء غالبًا) + الحالة بالعربي + علامات (*). الأعمدة تتحرك، فنتعرف على كل قيمة من شكلها.
  const CONT_RE = /[A-Za-z]{4}\s?\d{6,7}/g;
  const isSerialDate = v => typeof v === 'number' && v > 40000 && v < 60000;
  const serialToIso = v => new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  function isClearerReport(sheets) {
    return sheets.some(sh => sh.rows.slice(0, 40).some(r => { const t = norm((r || []).join(' ')); return t.includes(norm('رقم البوليصه')) && t.includes(norm('رقم الحاوية')); }));
  }
  function parseClearerReport(sheets, db) {
    const sh = sheets.find(s => s.rows.slice(0, 40).some(r => norm((r || []).join(' ')).includes(norm('رقم الحاوية'))));
    const rows = sh.rows;
    const hdrIdx = rows.findIndex(r => norm((r || []).join(' ')).includes(norm('رقم الحاوية')));
    // عناوين علامات (*) مثل: موانى، ربط، تسليم، شحن
    const flagRow = rows.slice(hdrIdx, hdrIdx + 4).find(r => (r || []).some(v => /ربط|تسليم/.test(String(v || ''))));
    const flagHdr = flagRow ? flagRow.map((v, c) => v ? { c, t: String(v).trim() } : null).filter(Boolean) : [];
    const known = new Set(Object.keys((db.po && db.po.orders) || {}));
    const cells = r => (r || []).map((v, c) => (v == null || v === '' || String(v).trim() === '') ? null : { c, v: typeof v === 'string' ? v.trim() : v }).filter(Boolean);
    const out = [];
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const cs = cells(rows[i]);
      if (cs.length < 6 || !cs.some(x => isSerialDate(x.v))) continue; // سطر بيانات معاملة
      if (cs.some(x => /الإجمالي|الاجمالي|القائم\s*بالطباع|تاريخ\s*الطباعة|رقم\s*الصفحة|page\s*\d|total/i.test(String(x.v)))) continue; // التذييل والإجماليات
      const rec = { containers: [], statuses: [], extra: {} };
      const contCell = cs.find(x => typeof x.v === 'string' && CONT_RE.test(x.v)); CONT_RE.lastIndex = 0;
      if (contCell) rec.containers = (contCell.v.match(CONT_RE) || []).map(x => x.replace(/\s+/g, '').toUpperCase());
      const cc = contCell ? contCell.c : 34;
      const latin = cs.filter(x => typeof x.v === 'string' && /^[A-Za-z][A-Za-z .]*$/.test(x.v));
      const st = latin.find(x => x.c < cc - 4); if (st) rec.statuses.push(st.v);
      const ag = latin.find(x => x.c > cc && x.c < cc + 8 && x !== st); if (ag) rec.extra.agent = ag.v;
      const bl = cs.find(x => typeof x.v === 'string' && x.c > cc && /\d/.test(x.v) && /[A-Za-z]/.test(x.v) && !/^\d+\s*x\s*\d+/i.test(x.v) && x !== contCell && !CONT_RE.test(x.v)); CONT_RE.lastIndex = 0;
      if (bl) rec.blNo = bl.v;
      const dates = cs.filter(x => isSerialDate(x.v)).map(x => serialToIso(x.v));
      if (dates[0]) rec.portEta = dates[0];
      if (dates[1]) rec.extra.secondDate = dates[1];
      const qty = cs.find(x => typeof x.v === 'string' && /\d+\s*x\s*\d+/i.test(x.v)); if (qty) rec.extra.qty = qty.v;
      const ar = cs.filter(x => typeof x.v === 'string' && /[؀-ۿ]/.test(x.v) && x.c < cc);
      const port = ar.find(x => /ميناء|منفذ|مطار/.test(x.v)); if (port) rec.extra.port = port.v;
      const origin = ar.find(x => x !== port); if (origin) rec.extra.origin = origin.v;
      const bayan = cs.find(x => x.c < cc && x.c > (st ? st.c : 0) && /^\d{5,9}$/.test(String(x.v)) && !isSerialDate(x.v)); if (bayan) rec.extra.bayan = String(bayan.v);
      const nums = cs.filter(x => typeof x.v === 'number' && !isSerialDate(x.v));
      const fees = nums.filter(x => x.c < (st ? st.c : 20)); if (fees[0]) rec.extra.opsFee = fees[0].v; if (fees[1]) rec.extra.duties = fees[1].v;
      const consig = nums.filter(x => x.c > cc).pop(); if (consig) rec.extra.consig = String(consig.v);
      // أسطر الملاحظات والحالة بالعربي والعلامات حتى المعاملة التالية
      const notes = [], flags = [];
      for (let j = i + 1; j < rows.length; j++) {
        const ns = cells(rows[j]);
        if (ns.some(x => /الإجمالي|الاجمالي|القائم\s*بالطباع|تاريخ\s*الطباعة|رقم\s*الصفحة|page\s*\d|total/i.test(String(x.v)))) break;
        if (ns.some(x => isSerialDate(x.v)) && ns.length >= 6) break;
        if (ns.length === 1 && typeof ns[0].v === 'number') break; // مسلسل المعاملة التالية
        for (const x of ns) {
          if (x.v === '*') { const h = flagHdr.reduce((b, f) => !b || Math.abs(f.c - x.c) < Math.abs(b.c - x.c) ? f : b, null); flags.push(h ? h.t : '*'); }
          else if (typeof x.v === 'string' && x.c >= 12 && /^[؀-ۿ ]+$/.test(x.v)) rec.statuses.push(x.v);
          else if (typeof x.v === 'string' && x.c < 12) notes.push(x.v);
        }
      }
      rec.note = notes.join(' ');
      rec.extra.flags = [...new Set(flags)];
      rec.extra.needTelex = /need+\s*telex/i.test(rec.note) && !/تم\s*ارسال\s*التلكس/.test(rec.note);
      // رقم أمر الشراء من الملاحظة: الأرقام الموجودة عندنا أولًا
      const ns2 = (rec.note.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/\d{4,7}/g) || []);
      rec.poNo = ns2.find(n => known.has(n)) || ns2[0] || '';
      out.push(rec);
    }
    return out;
  }
  // حالات المخلّص الافتراضية ← مراحلنا (تتعدل من الإعدادات). «__none» = حالة محايدة ما تغيّر المرحلة
  const DEFAULT_CLEARER_MAP = [
    { text: 'NOT ARRIVED', stage: 'shipped' }, { text: 'On vessel', stage: 'shipped' }, { text: 'Arrived', stage: 'port' },
    { text: 'إنتظار', stage: '__none' }, { text: 'تحصيل رسوم', stage: 'customs' }, { text: 'قسم النقل', stage: 'released' },
    { text: 'جاري النقل', stage: 'released' }, { text: 'تم النقل', stage: 'warehouse' }
  ];

  // ---------- تحديث المخلّص / الوكيل (المتابعة الخارجية) ----------
  // المطابقة: رقم الأمر ← رقم البوليصة ← رقم الحاوية. الحالة تتحول لمرحلة من جدول تحويل الجهة ثم الجدول العام.
  function mapTrackStatus(db, text, partyId) {
    const t = norm(text); if (!t) return '';
    const party = (db.parties || []).find(p => p.id === partyId);
    const maps = [].concat((party && party.statusMap) || [], db.trackStatusMap || []);
    for (const m of maps) if (m.text && m.stage && norm(m.text) === t) return m.stage;
    // الحالات الافتراضية لتقارير المخلّص (إذا ما عُرّفت في الجداول)
    for (const m of DEFAULT_CLEARER_MAP) if (norm(m.text) === t && !maps.some(x => norm(x.text) === t)) return m.stage;
    for (const m of maps) if (m.text && m.stage && (t.includes(norm(m.text)) || norm(m.text).includes(t))) return m.stage;
    // اسم المرحلة نفسه
    const st = (db.shipStages || []).find(x => norm(x.name) === t || norm(x.id) === t);
    return st ? st.id : '';
  }
  function applyTrack(db, recs, { date, user, partyId, file, allowBack } = {}) {
    const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Engine;
    const po = ensurePo(db);
    const day = date || new Date().toISOString().slice(0, 10);
    const orders = Object.values(po.orders);
    const res = { rows: 0, matched: new Set(), notFound: [], unmapped: {}, advanced: [], containersAdded: 0 };
    const stageIdx = id => (db.shipStages || []).findIndex(x => x.id === id);
    for (const r of recs) {
      res.rows++;
      const cn = String(r.containerNo || '').trim().toUpperCase();
      const conts = (r.containers && r.containers.length ? r.containers : (cn ? [cn] : [])).map(x => String(x).replace(/\s+/g, '').toUpperCase());
      const o = (r.poNo && po.orders[r.poNo]) || (r.blNo && orders.find(x => x.blNo && norm(x.blNo) === norm(r.blNo))) ||
        (conts.length && orders.find(x => ((x.track || {}).containers || []).some(c => conts.includes(c.no))));
      if (!o) { res.notFound.push(r.poNo || r.blNo || conts[0] || '?'); continue; }
      res.matched.add(o.no);
      o.track = o.track || { history: [], containers: [] };
      o.track.containers = o.track.containers || [];
      if (r.blNo && !o.blNo) o.blNo = String(r.blNo).trim();
      if (partyId && !o.track.clearer) o.track.clearer = partyId;
      for (const no of conts) {
        let c = o.track.containers.find(x => x.no === no);
        if (!c) { c = { no }; o.track.containers.push(c); res.containersAdded++; }
        const pd = toDate(r.portDate); if (pd) c.portAt = pd;
        const wd = toDate(r.warehouseDate); if (wd) c.warehouseAt = wd;
        const ed = toDate(r.emptyDate); if (ed) c.emptyAt = ed;
      }
      if (!conts.length) { const pd = toDate(r.portDate); if (pd) o.track.portAt = pd; }
      if (r.portEta) o.track.portEta = r.portEta; // الوصول المتوقع للميناء من المخلّص
      if (r.extra) { o.track.clearerInfo = Object.assign({}, o.track.clearerInfo || {}, r.extra, { at: day }); o.track.needTelex = !!r.extra.needTelex; }
      if (r.note != null && r.extra) o.track.clearerNote = r.note;
      const texts = (r.statuses && r.statuses.length ? r.statuses : [r.status]).filter(x => x != null && String(x).trim()).map(x => String(x).trim());
      if (texts.length) {
        o.track.lastStatus = texts.join(' — ') + (r.note && r.extra ? ' — ' + r.note : ''); o.track.lastStatusAt = toDate(r.statusDate) || day;
        // أبعد مرحلة من كل الحالات، والحالة المحايدة («__none») ما تغيّر شي
        let best = '', bestI = -1;
        for (const txt of texts) {
          const sid = mapTrackStatus(db, txt, partyId || o.track.clearer);
          if (!sid) { res.unmapped[txt] = (res.unmapped[txt] || 0) + 1; continue; }
          if (sid === '__none') continue;
          const k = stageIdx(sid); if (k > bestI) { bestI = k; best = sid; }
        }
        if (best) {
          const cur = E.trackStageIndex(db, o);
          if (bestI > cur || (allowBack && bestI !== cur)) {
            const st = db.shipStages[bestI];
            const when = st.marks === 'port' && r.portEta && r.extra ? r.portEta : (toDate(r.statusDate) || day);
            E.setTrackStage(db, o, best, { date: when, by: user || '', note: o.track.lastStatus, source: 'sheet' });
            res.advanced.push(o.no);
          }
          // وصلت الميناء أو بعدها (مثل «Arrived» + «تحصيل رسوم»): تاريخ الوصول من التقرير — منه تبدأ أيام السماح
          const portI = (db.shipStages || []).findIndex(x => x.marks === 'port');
          if (r.portEta && r.extra && portI >= 0 && bestI >= portI) {
            o.track.portAt = r.portEta;
            for (const c of o.track.containers) if (conts.includes(c.no) && !c.portAt) c.portAt = r.portEta;
          }
        }
      }
    }
    // كل الحاويات سُلّمت فارغة ← المعاملة منتهية
    for (const no of res.matched) {
      const o = po.orders[no], cs = (o.track.containers || []);
      const fin = (db.shipStages || []).find(x => x.marks === 'final');
      if (fin && cs.length && cs.every(c => c.emptyAt) && o.track.stage !== fin.id) { E.setTrackStage(db, o, fin.id, { date: cs.map(c => c.emptyAt).sort().pop(), by: user || '', note: 'كل الحاويات سُلّمت فارغة', source: 'sheet' }); res.advanced.push(no); }
    }
    po.imports.push({ at: new Date().toISOString(), date: day, kind: 'track', file: file || '', user: user || '', orders: res.matched.size, newOrders: 0 });
    res.matched = [...res.matched];
    return res;
  }

  // ---------- استيراد ملف الإكسيل القديم (نفس هيكل ملف تقرير المشتريات) ----------
  function isLegacyWorkbook(sheets) {
    const names = sheets.map(s => s.name);
    return ['الأصناف', 'المبيعات', 'المخزون', 'الإعدادات'].every(n => names.includes(n));
  }

  function importLegacy(sheets) {
    const db = E.emptyDb();
    const get = n => (sheets.find(s => s.name === n) || { rows: [] }).rows;
    const S = get('الإعدادات');
    const cell = (r, c) => (S[r - 1] || [])[c - 1];
    db.settings.lastMonth = toMonth(cell(5, 3)) || '';
    const sd = cell(6, 3);
    const stockDate = sd instanceof Date ? sd.toISOString().slice(0, 10) : (sd ? String(sd).slice(0, 10) : '');
    db.settings.reviewPeriod = num(cell(7, 3)) || 1;
    db.settings.thrA = num(cell(8, 3)) || 0.8;
    db.settings.thrB = num(cell(9, 3)) || 0.95;
    const types = [];
    for (let r = 6; r <= 10; r++) {
      const name = cell(r, 6);
      if (name) types.push({ name: String(name).trim(), leadTime: num(cell(r, 7)), extraMonths: num(cell(r, 8)), note: cell(r, 9) ? String(cell(r, 9)) : '', currency: /خارج|استيراد/.test(String(name) + (cell(r, 9) || '')) ? 'USD' : 'SAR', prepDays: /خارج|استيراد/.test(String(name) + (cell(r, 9) || '')) ? Math.max(0, Math.round(num(cell(r, 7)) * 30) - 30) : 0 });
    }
    if (types.length) db.types = types;
    const classes = [];
    for (let r = 15; r <= 23; r++) {
      const code = cell(r, 6);
      if (code) classes.push({ code: String(code).trim(), service: num(cell(r, 9)) });
    }
    if (classes.length === 9) db.classes = classes;
    const groups = [];
    for (let r = 11; r <= 50; r++) { const g = cell(r, 12); if (g && String(g).trim() !== 'الكل') groups.push(String(g).trim()); }
    db.groups = groups.length ? groups : ['غير مصنف'];

    // الأصناف: A..M من الصف 5
    const I = get('الأصناف');
    const seen = new Set();
    for (let r = 4; r < I.length; r++) {
      const x = I[r] || [];
      const code = normCode(x[0]);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      db.items.push({
        code, name: String(x[1] || '').trim(), baseUnit: String(x[2] || '').trim(), purchaseUnit: '', units: [],
        group: String(x[3] || '').trim(), sub1: String(x[4] || '').trim(), sub2: String(x[5] || '').trim(), mainItem: String(x[6] || '').trim(),
        type: String(x[7] || '').trim(), active: parseActive(x[8]),
        leadOverride: blankOrNum(x[9]), extraOverride: blankOrNum(x[10]), refCost: blankOrNum(x[11]), notes: String(x[12] || '').trim(),
        autoAdded: false, addedAt: ''
      });
    }
    // المبيعات: A الشهر، B رقم، C اسم، D وحدة، E وارد، F منصرف
    const SA = get('المبيعات');
    const sales = [];
    for (let r = 4; r < SA.length; r++) {
      const x = SA[r] || [];
      const code = normCode(x[1]);
      const m = toMonth(x[0]);
      if (!code || !m) continue;
      sales.push({ month: m, code, name: String(x[2] || '').trim(), unit: String(x[3] || '').trim(), returned: num(x[4]), issued: num(x[5]) });
    }
    db.sales = sales;
    // المخزون: A رقم، B اسم، C وحدة، D كمية، E تكلفة
    const ST = get('المخزون');
    const stock = [];
    for (let r = 4; r < ST.length; r++) {
      const x = ST[r] || [];
      const code = normCode(x[0]);
      if (!code) continue;
      stock.push({ code, name: String(x[1] || '').trim(), unit: String(x[2] || '').trim(), qty: num(x[3]), cost: num(x[4]) });
    }
    db.stock = { date: stockDate, rows: stock };
    db.settings.stockDate = stockDate;
    // بالطريق: A رقم، B اسم، C وحدة، D كمية، E مصدر
    const TR = get('بالطريق');
    const transit = [];
    for (let r = 4; r < TR.length; r++) {
      const x = TR[r] || [];
      const code = normCode(x[0]);
      if (!code) continue;
      transit.push({ code, name: String(x[1] || '').trim(), unit: String(x[2] || '').trim(), qty: num(x[3]), source: String(x[4] || '').trim() });
    }
    db.transit = transit;
    // التعديلات اليدوية من ورقة الحساب (AH, AI)
    const H = get('الحساب');
    for (let r = 4; r < H.length; r++) {
      const x = H[r] || [];
      const code = normCode(x[0]);
      const d = num(x[33]);
      if (code && (d !== 0 || (x[34] && String(x[34]).trim()))) db.adjustments[code] = { delta: d, reason: String(x[34] || '').trim() };
    }
    syncGroups(db);
    return db;
  }

  // عملة من نص عنوان العمود: «القيمة دولار» ← USD
  function currencyFromHeader(text) {
    const t = String(text || '');
    if (/دولار|usd|\$/i.test(t)) return 'USD';
    if (/ريال|sar/i.test(t)) return 'SAR';
    if (/يورو|eur/i.test(t)) return 'EUR';
    return '';
  }
  const Importers = { isClearerReport, parseClearerReport, DEFAULT_CLEARER_MAP, applyTrack, mapTrackStatus, currencyFromHeader, KINDS, applyPOs, applyPOPay, toDate, curCode, detectHeader, rowsToRecords, applyItems, applySales, applyStock, applyTransit, autoAddItems, importLegacy, isLegacyWorkbook, syncGroups, parseActive };
  if (typeof module !== 'undefined' && module.exports) module.exports = Importers;
  else root.Importers = Importers;
})(typeof window !== 'undefined' ? window : globalThis);
