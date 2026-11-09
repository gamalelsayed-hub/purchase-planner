/*
 * الاستيراد: تعريف القوالب، التعرف التلقائي على الأعمدة، وتطبيق البيانات على قاعدة البيانات.
 * يعمل في المتصفح (window.Importers) وفي Node.
 */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Engine;
  const { normCode, num, toMonth, normUnit } = E;

  const norm = s => String(s == null ? '' : s).replace(/[\s_\-:؟?()«»"'.]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

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

  function rowsToRecords(rows, headerRow, map) {
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
      if (rec.code == null || String(rec.code).trim() === '') continue;
      // تجاهل صفوف الإجمالي
      if (/^(الإجمالي|الاجمالي|المجموع|total)$/i.test(String(rec.code).trim())) continue;
      rec.code = normCode(rec.code);
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
      if (name) types.push({ name: String(name).trim(), leadTime: num(cell(r, 7)), extraMonths: num(cell(r, 8)), note: cell(r, 9) ? String(cell(r, 9)) : '' });
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

  const Importers = { KINDS, detectHeader, rowsToRecords, applyItems, applySales, applyStock, applyTransit, autoAddItems, importLegacy, isLegacyWorkbook, syncGroups, parseActive };
  if (typeof module !== 'undefined' && module.exports) module.exports = Importers;
  else root.Importers = Importers;
})(typeof window !== 'undefined' ? window : globalThis);
