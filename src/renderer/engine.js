/*
 * محرك الحساب — سياسة Fixed Order Period (Periodic Review / Order-up-to)
 * يعمل في المتصفح (window.Engine) وفي Node (module.exports) للاختبار.
 *
 * الحد الأقصى = المتوسط × (المراجعة + التوصيل)
 *             + Z × الانحراف × √(المراجعة + التوصيل)
 *             + أساس الإضافي × (أشهر إضافية ثابتة + أشهر الفترات الاستثنائية السارية)
 * الطلب = تقريب لأعلى (الحد الأقصى − المخزون − بالطريق) بوحدة الشراء
 */
(function (root) {
  'use strict';

  // ---------- أدوات عامة ----------
  function normUnit(u) {
    return String(u == null ? '' : u)
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[ةه](?=$|\s|\d)/g, 'ه')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .toLowerCase();
  }
  function normCode(c) {
    if (c == null) return '';
    if (typeof c === 'number') return String(c);
    return String(c).trim();
  }
  function num(v) {
    if (v == null || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isBlank(v) { return v == null || v === ''; }

  // شهر بصيغة YYYY-MM
  function monthAdd(ym, k) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + k;
    const yy = Math.floor(t / 12), mm = (t % 12) + 1;
    return yy + '-' + String(mm).padStart(2, '0');
  }
  function monthLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return m + '/' + y;
  }
  function toMonth(v) {
    // يقبل Date أو "2026-10" أو "2026-10-01" أو "10/2026" أو "1/10/2026"
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0');
    if (typeof v === 'number' && v > 20000 && v < 80000) { // رقم تاريخ إكسيل
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0');
    m = s.match(/^(?:\d{1,2}[-/])?(\d{1,2})[-/](\d{4})$/);
    if (m) return m[2] + '-' + m[1].padStart(2, '0');
    const d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return '';
  }

  // معكوس التوزيع الطبيعي (Acklam) = NORMSINV
  function normsinv(p) {
    if (!(p > 0 && p < 1)) return 0;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= ph) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // تحسين بخطوة Halley
    const e = 0.5 * erfc(-x / Math.SQRT2) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  // ROUNDUP(x,0) مع إزالة أخطاء الفاصلة العائمة (إكسيل يقرّب لـ 15 رقم)
  function roundUp(x) {
    const r = Math.round(x * 1e9) / 1e9;
    return r >= 0 ? Math.ceil(r) : -Math.ceil(-r);
  }

  // ---------- الوحدات ----------
  // يرجع معامل التحويل للوحدة الأساسية أو null إذا الوحدة غير معرّفة للصنف
  function unitFactor(item, unit) {
    const u = normUnit(unit);
    if (u === '' || u === normUnit(item.baseUnit)) return 1;
    for (const x of item.units || []) {
      if (normUnit(x.name) === u && num(x.factor) > 0) return num(x.factor);
    }
    return null;
  }
  function purchaseFactor(item) {
    if (!item.purchaseUnit) return 1;
    const f = unitFactor(item, item.purchaseUnit);
    return f || 1;
  }
  function allUnits(item) {
    return [{ name: item.baseUnit, factor: 1 }].concat((item.units || []).filter(u => u.name && num(u.factor) > 0));
  }

  // ---------- الإعدادات الافتراضية ----------
  function defaultSettings() {
    return {
      lastMonth: '',
      stockDate: '',
      reviewPeriod: 1,
      nMonths: 6,
      thrA: 0.8,
      thrB: 0.95,
      extraBasis: 'avg_std', // avg_std = (المتوسط + الانحراف) ، avg = المتوسط فقط
      classifyScope: 'all', // all = كل الأصناف ، active = النشطة فقط
      defaultType: 'مصنع',
      defaultLead: 1,
      keepMonths: 24,
      currency: 'ريال',
      companyName: ''
    };
  }
  function defaultClasses() {
    return [
      { code: 'AA', service: 0.95 }, { code: 'AB', service: 0.85 }, { code: 'AC', service: 0.75 },
      { code: 'BA', service: 0.95 }, { code: 'BB', service: 0.75 }, { code: 'BC', service: 0.75 },
      { code: 'CA', service: 0.95 }, { code: 'CB', service: 0.75 }, { code: 'CC', service: 0.75 }
    ];
  }
  function emptyDb() {
    return {
      version: 1,
      settings: defaultSettings(),
      types: [
        { name: 'خارجي', leadTime: 3, extraMonths: 3, note: 'استيراد' },
        { name: 'محلي', leadTime: 1, extraMonths: 0, note: '' },
        { name: 'مصنع', leadTime: 1, extraMonths: 0, note: '' }
      ],
      classes: defaultClasses(),
      groups: ['غير مصنف'],
      exceptions: [],
      items: [],
      sales: [],
      stock: { date: '', rows: [] },
      transit: [],
      adjustments: {},
      archive: [],
      log: []
    };
  }

  // ---------- الفترات الاستثنائية ----------
  function exceptionApplies(ex, item, orderMonth) {
    if (!ex.enabled) return false;
    if (ex.fromMonth && orderMonth < ex.fromMonth) return false;
    if (ex.toMonth && orderMonth > ex.toMonth) return false;
    switch (ex.scope) {
      case 'all': return true;
      case 'type': return item.type === ex.value;
      case 'group': return item.group === ex.value;
      case 'mainItem': return item.mainItem === ex.value;
      case 'item': return (ex.value || '').split(/[,\s،]+/).filter(Boolean).includes(item.code);
      default: return false;
    }
  }

  // ---------- التصنيف ABC ----------
  // نفس منطق الإكسيل: نسبة مجموع الأصناف الأكبر تمامًا ÷ الإجمالي < حد A ⇒ A ...
  function abc(values, inScope, thrA, thrB) {
    const n = values.length;
    let total = 0;
    for (let i = 0; i < n; i++) if (inScope[i]) total += values[i];
    const idx = [];
    for (let i = 0; i < n; i++) if (inScope[i]) idx.push(i);
    idx.sort((a, b) => values[b] - values[a]);
    const out = new Array(n).fill('C');
    let greater = 0, k = 0;
    while (k < idx.length) {
      const v = values[idx[k]];
      let j = k, tieSum = 0;
      while (j < idx.length && values[idx[j]] === v) { tieSum += v; j++; }
      for (let t = k; t < j; t++) {
        const i = idx[t];
        if (v <= 0 || total === 0) { out[i] = 'C'; continue; }
        const share = greater / total;
        out[i] = share < thrA ? 'A' : share < thrB ? 'B' : 'C';
      }
      greater += tieSum; k = j;
    }
    return out;
  }

  // ---------- الحساب الرئيسي ----------
  function compute(db) {
    const s = Object.assign(defaultSettings(), db.settings || {});
    const N = Math.max(1, Math.round(num(s.nMonths)) || 6);
    const lastMonth = s.lastMonth || '';
    const months = [];
    if (lastMonth) for (let k = N - 1; k >= 0; k--) months.push(monthAdd(lastMonth, -k));
    const orderMonth = lastMonth ? monthAdd(lastMonth, 1) : '';
    const monthIndex = new Map(months.map((m, i) => [m, i]));

    const typeMap = new Map((db.types || []).map(t => [t.name, t]));
    const classMap = new Map((db.classes || defaultClasses()).map(c => [c.code, c]));
    const items = db.items || [];
    const itemIdx = new Map();
    items.forEach((it, i) => itemIdx.set(it.code, i));

    const n = items.length;
    const sales = items.map(() => new Array(months.length).fill(0));
    const stockQty = new Array(n).fill(0), stockCostSum = new Array(n).fill(0), stockCostCnt = new Array(n).fill(0);
    const stockRowsCnt = new Array(n).fill(0);
    const transitQty = new Array(n).fill(0), transitRowsCnt = new Array(n).fill(0);
    const issues = []; // {kind, sheet, code, name, unit, msg, severity}
    const rowFlags = items.map(() => ({ salesUnit: false, stockUnit: false, transitUnit: false }));

    // المبيعات
    const monthsSeen = new Set();
    let negSalesRows = 0;
    for (const r of db.sales || []) {
      const mi = monthIndex.get(r.month);
      if (mi === undefined) continue;
      monthsSeen.add(r.month);
      const i = itemIdx.get(r.code);
      if (i === undefined) { issues.push({ kind: 'missingItem', sheet: 'المبيعات', code: r.code, name: r.name, unit: r.unit, severity: 'x' }); continue; }
      const f = unitFactor(items[i], r.unit);
      if (f == null) { rowFlags[i].salesUnit = true; issues.push({ kind: 'unit', sheet: 'المبيعات', code: r.code, name: items[i].name, unit: r.unit, month: r.month, severity: 'x' }); continue; }
      const net = num(r.issued) - num(r.returned);
      if (net < 0) negSalesRows++;
      sales[i][mi] += net * f;
    }
    // المخزون
    for (const r of (db.stock && db.stock.rows) || []) {
      const i = itemIdx.get(r.code);
      if (i === undefined) { issues.push({ kind: 'missingItem', sheet: 'المخزون', code: r.code, name: r.name, unit: r.unit, severity: 'x' }); continue; }
      stockRowsCnt[i]++;
      const f = unitFactor(items[i], r.unit);
      if (f == null) { rowFlags[i].stockUnit = true; issues.push({ kind: 'unit', sheet: 'المخزون', code: r.code, name: items[i].name, unit: r.unit, severity: 'x' }); continue; }
      stockQty[i] += num(r.qty) * f;
      const c = num(r.cost);
      if (c > 0) { stockCostSum[i] += c / f; stockCostCnt[i]++; }
    }
    // بالطريق
    for (const r of db.transit || []) {
      const i = itemIdx.get(r.code);
      if (i === undefined) { issues.push({ kind: 'missingItem', sheet: 'بالطريق', code: r.code, name: r.name, unit: r.unit, severity: 'x' }); continue; }
      transitRowsCnt[i]++;
      const f = unitFactor(items[i], r.unit);
      if (f == null) { rowFlags[i].transitUnit = true; issues.push({ kind: 'unit', sheet: 'بالطريق', code: r.code, name: items[i].name, unit: r.unit, severity: 'x' }); continue; }
      transitQty[i] += num(r.qty) * f;
    }

    // الإحصاءات
    const total6 = new Array(n), avg = new Array(n), std = new Array(n), cost = new Array(n), value6 = new Array(n);
    for (let i = 0; i < n; i++) {
      const xs = sales[i];
      const m = xs.length;
      const sum = xs.reduce((a, b) => a + b, 0);
      const mean = m ? sum / m : 0;
      let v = 0;
      for (const x of xs) v += (x - mean) * (x - mean);
      total6[i] = sum;
      avg[i] = mean;
      std[i] = m > 1 ? Math.sqrt(v / (m - 1)) : 0;
      cost[i] = stockCostCnt[i] > 0 ? stockCostSum[i] / stockCostCnt[i] : num(items[i].refCost);
      value6[i] = Math.max(sum, 0) * cost[i];
    }
    const scope = items.map(it => s.classifyScope === 'active' ? it.active !== false : true);
    const clsQ = abc(total6, scope, num(s.thrA), num(s.thrB));
    const clsV = abc(value6, scope, num(s.thrA), num(s.thrB));

    const review = num(s.reviewPeriod);
    const adj = db.adjustments || {};
    const exceptions = (db.exceptions || []).filter(e => e.enabled);
    const rows = new Array(n);

    for (let i = 0; i < n; i++) {
      const it = items[i];
      const t = typeMap.get(it.type);
      const cls = clsQ[i] + clsV[i];
      const clsDef = classMap.get(cls);
      const service = clsDef ? num(clsDef.service) : 0;
      const z = service > 0 && service < 1 ? normsinv(service) : 0;
      const lead = num(it.leadOverride) > 0 ? num(it.leadOverride) : (t ? num(t.leadTime) : num(s.defaultLead) || 1);
      const fixedExtra = !isBlank(it.extraOverride) ? num(it.extraOverride) : (t ? num(t.extraMonths) : 0);
      let excMonths = 0; const excNames = [];
      for (const ex of exceptions) if (exceptionApplies(ex, it, orderMonth)) { excMonths += num(ex.months); excNames.push(ex.name || 'استثنائية'); }
      const extraMonths = fixedExtra + excMonths;
      const cover = review + lead;
      const expected = Math.max(avg[i], 0) * cover;
      const safety = std[i] * z * Math.sqrt(cover);
      const basis = s.extraBasis === 'avg' ? Math.max(avg[i], 0) : Math.max(avg[i] + std[i], 0);
      const extra = basis * extraMonths;
      const maxLevel = expected + safety + extra;
      const available = stockQty[i] + transitQty[i];
      const active = it.active !== false;
      const pf = purchaseFactor(it);
      const needBase = maxLevel - available;
      const suggested = active ? Math.max(0, roundUp(needBase / pf)) : 0; // بوحدة الشراء
      const a = adj[it.code] || {};
      const delta = num(a.delta);
      const final = Math.max(0, suggested + delta);
      const finalBase = final * pf;
      const notes = [];
      if (cost[i] === 0) notes.push('بدون تكلفة');
      if (stockQty[i] < 0) notes.push('مخزون سالب');
      if (!t) notes.push('نوع غير معروف');
      if (rowFlags[i].salesUnit) notes.push('وحدة مبيعات غير معرّفة');
      if (rowFlags[i].stockUnit) notes.push('وحدة مخزون غير معرّفة');
      if (rowFlags[i].transitUnit) notes.push('وحدة بالطريق غير معرّفة');
      if (delta !== 0 && !String(a.reason || '').trim()) notes.push('تعديل بدون سبب');
      if (it.autoAdded) notes.push('غير مصنف — مضاف تلقائيًا');
      if (excNames.length) notes.push('فترة استثنائية: ' + excNames.join('، '));
      rows[i] = {
        i, code: it.code, name: it.name, baseUnit: it.baseUnit, purchaseUnit: it.purchaseUnit || it.baseUnit, pf,
        group: it.group || '', sub1: it.sub1 || '', sub2: it.sub2 || '', mainItem: it.mainItem || '', type: it.type || '', active,
        autoAdded: !!it.autoAdded,
        sales: sales[i], total: total6[i], avg: avg[i], std: std[i], cost: cost[i], value6: value6[i],
        clsQ: clsQ[i], clsV: clsV[i], cls, service, z,
        review, lead, fixedExtra, excMonths, extraMonths, cover,
        expected, safety, extra, maxLevel,
        stock: stockQty[i], transit: transitQty[i], available,
        stockRows: stockRowsCnt[i], transitRows: transitRowsCnt[i],
        suggested, delta, reason: a.reason || '', final, finalBase,
        orderValue: finalBase * cost[i], stockValue: stockQty[i] * cost[i], transitValue: transitQty[i] * cost[i], maxValue: maxLevel * cost[i],
        coverage: avg[i] > 0 ? available / avg[i] : null,
        coverageAfter: avg[i] > 0 ? (available + finalBase) / avg[i] : null,
        status: !active ? (delta > 0 ? 'موقوف + تعديل' : 'موقوف') : (final > 0 ? 'يطلب' : 'لا يطلب'),
        notes
      };
    }

    // الفحوصات
    const missingMonths = months.filter(m => !monthsSeen.has(m));
    const count = (f) => rows.reduce((a, r) => a + (f(r) ? 1 : 0), 0);
    const stockDup = new Map();
    for (const r of (db.stock && db.stock.rows) || []) stockDup.set(r.code, (stockDup.get(r.code) || 0) + 1);
    const transitDup = new Map();
    for (const r of db.transit || []) transitDup.set(r.code, (transitDup.get(r.code) || 0) + 1);
    const unitIssues = issues.filter(x => x.kind === 'unit');
    const checks = [
      { id: 'months', title: 'أشهر ناقصة في فترة التحليل (يجب ' + N + ' أشهر)', count: missingMonths.length, sev: 'x', where: 'المبيعات — ' + missingMonths.map(monthLabel).join('، '), why: 'شهر ناقص = صفر مبيعات = متوسط أقل وطلب أقل' },
      { id: 'salesUnit', title: 'أسطر مبيعات بوحدة غير معرّفة للصنف', count: unitIssues.filter(x => x.sheet === 'المبيعات').length, sev: 'x', where: 'الأصناف ← وحدات الصنف', why: 'السطر لا يدخل المتوسط — عرّف الوحدة ومعامل التحويل' },
      { id: 'stockUnit', title: 'أسطر مخزون بوحدة غير معرّفة للصنف', count: unitIssues.filter(x => x.sheet === 'المخزون').length, sev: 'x', where: 'الأصناف ← وحدات الصنف', why: 'كمية بوحدة مختلفة (كرتون/حبة) تعطي طلبًا غلطًا' },
      { id: 'transitUnit', title: 'أسطر بالطريق بوحدة غير معرّفة للصنف', count: unitIssues.filter(x => x.sheet === 'بالطريق').length, sev: 'x', where: 'الأصناف ← وحدات الصنف', why: 'الكمية لن تُخصم فيتكرر الطلب' },
      { id: 'missingItem', title: 'أسطر لأصناف غير موجودة في ملف الأصناف', count: issues.filter(x => x.kind === 'missingItem').length, sev: 'x', where: 'تُضاف تلقائيًا عند الاستيراد', why: 'لن تدخل الحساب' },
      { id: 'autoAdded', title: 'أصناف مضافة تلقائيًا «غير مصنف» تحتاج مراجعة', count: count(r => r.autoAdded), sev: 'w', where: 'الأصناف ← فلتر «تحتاج تصنيف»', why: 'النوع والمجموعة افتراضية — فترة التوصيل قد تكون غير صحيحة' },
      { id: 'unknownType', title: 'أصناف بنوع غير معروف', count: count(r => !typeMap.has(r.type)), sev: 'x', where: 'الأصناف ← نوع الصنف', why: 'فترة التوصيل تُفترض ' + (num(s.defaultLead) || 1) + ' شهر' },
      { id: 'noCost', title: 'أصناف نشطة بدون تكلفة', count: count(r => r.active && r.cost === 0), sev: 'w', where: 'الأصناف ← تكلفة مرجعية', why: 'قيمة الطلب والتصنيف بالقيمة يطلعون صفر' },
      { id: 'negStock', title: 'أصناف بمخزون سالب', count: count(r => r.stock < 0), sev: 'w', where: 'المخزون', why: 'خطأ في النظام — يضخم الطلب' },
      { id: 'stockDup', title: 'أصناف مكررة في تقرير المخزون', count: [...stockDup.values()].filter(v => v > 1).length, sev: 'w', where: 'المخزون', why: 'تُجمع كمياتها — تأكد أنها ليست لصقًا مكررًا' },
      { id: 'transitDup', title: 'أصناف بالطريق من أكثر من سطر/مصدر', count: [...transitDup.values()].filter(v => v > 1).length, sev: 'w', where: 'بالطريق', why: 'تتجمع — تأكد أنها أوامر مختلفة' },
      { id: 'negSales', title: 'أسطر مبيعات صافيها سالب (مرتجع أكبر من المنصرف)', count: negSalesRows, sev: 'w', where: 'المبيعات', why: 'تقلل المتوسط — تأكد أنها صحيحة' },
      { id: 'adjNoReason', title: 'تعديلات يدوية بدون سبب', count: count(r => r.delta !== 0 && !String(r.reason).trim()), sev: 'x', where: 'قائمة الطلب ← تعديل', why: 'كل تعديل على السياسة لازم يكون له سبب' },
      { id: 'inactiveAdj', title: 'أصناف موقوفة عليها تعديل يدوي', count: count(r => r.status === 'موقوف + تعديل'), sev: 'w', where: 'قائمة الطلب', why: 'صنف موقوف ومطلوب يدويًا — تأكد من القرار' },
      { id: 'noStockDate', title: 'تاريخ رصيد المخزون غير محدد', count: (db.stock && db.stock.date) || s.stockDate ? 0 : 1, sev: 'w', where: 'الدورة الشهرية ← المخزون', why: 'للعرض في التقارير' }
    ];
    for (const c of checks) c.ok = c.count === 0;
    const blocking = checks.filter(c => !c.ok && c.sev === 'x').length;
    const warnings = checks.filter(c => !c.ok && c.sev === 'w').length;

    // الملخصات
    const sumBy = (keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r);
        if (!m.has(k)) m.set(k, { key: k, items: 0, active: 0, ordered: 0, orderValue: 0, stockValue: 0, transitValue: 0, maxValue: 0 });
        const g = m.get(k);
        g.items++; if (r.active) g.active++; if (r.final > 0) g.ordered++;
        g.orderValue += r.orderValue; g.stockValue += r.stockValue; g.transitValue += r.transitValue; g.maxValue += r.maxValue;
      }
      return [...m.values()];
    };
    const totals = sumBy(() => 'الإجمالي')[0] || { items: 0, active: 0, ordered: 0, orderValue: 0, stockValue: 0, transitValue: 0, maxValue: 0 };

    return {
      settings: s, months, orderMonth, rows, issues, checks, blocking, warnings, missingMonths,
      totals,
      byType: sumBy(r => r.type || '—'),
      byClass: sumBy(r => r.cls),
      byGroup: sumBy(r => r.group || '—')
    };
  }

  const Engine = {
    compute, normsinv, normUnit, normCode, num, toMonth, monthAdd, monthLabel,
    unitFactor, purchaseFactor, allUnits, emptyDb, defaultSettings, defaultClasses, abc, roundUp, exceptionApplies
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
