// اختبارات المحرك ببيانات صناعية (لا تحتاج ملف الشركة) — تعمل في GitHub Actions
const assert = require('assert');
const E = require('../src/renderer/engine');
const I = require('../src/renderer/importers');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

// NORMSINV
close(E.normsinv(0.95), 1.6448536269514715, 'Z 95%');
close(E.normsinv(0.75), 0.6744897501960817, 'Z 75%');

function baseDb() {
  const db = E.emptyDb();
  db.settings.lastMonth = '2026-06';
  db.items = [
    { code: 'A1', name: 'صنف كبير', baseUnit: 'حبه', purchaseUnit: 'كرتون', units: [{ name: 'كرتون', factor: 10 }], group: 'g', type: 'خارجي', active: true, extraOverride: null, leadOverride: null, refCost: 2 },
    { code: 'B1', name: 'صنف متوسط', baseUnit: 'حبه', purchaseUnit: '', units: [], group: 'g', type: 'مصنع', active: true, extraOverride: null, leadOverride: null, refCost: 1 },
    { code: 'C1', name: 'صنف صغير', baseUnit: 'حبه', purchaseUnit: '', units: [], group: 'g', type: 'مصنع', active: false, extraOverride: null, leadOverride: null, refCost: 1 }
  ];
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const qa = [100, 200, 150, 120, 180, 150], qb = [20, 30, 25, 20, 30, 25], qc = [5, 0, 0, 0, 0, 0];
  months.forEach((m, i) => {
    // A1: نصف الكمية بالكرتون (×10) ونصفها بالحبة — لازم تتوحد
    db.sales.push({ month: m, code: 'A1', unit: 'كرتون', issued: qa[i] / 20, returned: 0 });
    db.sales.push({ month: m, code: 'A1', unit: 'علبة', issued: 0, returned: 0 }); // وحدة غير معرفة (كمية صفر)
    db.sales.push({ month: m, code: 'A1', unit: 'حبه', issued: qa[i] / 2, returned: 0 });
    db.sales.push({ month: m, code: 'B1', unit: 'حبة', issued: qb[i] + 1, returned: 1 }); // حبة = حبه بعد التوحيد
    db.sales.push({ month: m, code: 'C1', unit: 'حبه', issued: qc[i], returned: 0 });
  });
  db.stock = { date: '2026-07-01', rows: [{ code: 'A1', unit: 'كرتون', qty: 20, cost: 30 }, { code: 'B1', unit: 'حبه', qty: 10, cost: 0 }] };
  db.transit = [{ code: 'A1', unit: 'حبه', qty: 50, source: 'PO1' }];
  return db;
}

// الحساب الأساسي
let db = baseDb();
let res = E.compute(db);
const a = res.rows.find(r => r.code === 'A1'), b = res.rows.find(r => r.code === 'B1'), c = res.rows.find(r => r.code === 'C1');
assert.deepStrictEqual(res.months, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
assert.strictEqual(res.orderMonth, '2026-07');
close(a.total, 900, 'A total'); close(a.avg, 150, 'A avg');
const stdA = Math.sqrt([100, 200, 150, 120, 180, 150].reduce((s, x) => s + (x - 150) ** 2, 0) / 5);
close(a.std, stdA, 'A std (sample)');
close(b.avg, 25, 'B avg (net of returns, unit normalized)');
close(a.cost, 3, 'A cost per base unit = 30 / 10');
close(b.cost, 1, 'B cost falls back to reference cost');
close(a.stock, 200, 'A stock 20 carton = 200');
close(a.transit, 50, 'A transit');
// تصنيف ABC: الكمية A=900، B=150، C=5 (إجمالي 1055) → A1=A (0%)، B1: قبله 85.3% → B، C1: قبله 99.5% → C
assert.strictEqual(a.clsQ, 'A'); assert.strictEqual(b.clsQ, 'B'); assert.strictEqual(c.clsQ, 'C');
// المعادلة: خارجي توصيل 3 + مراجعة 1، إضافي 3 أشهر (المتوسط + الانحراف)
const z = E.normsinv(0.95); // AA
assert.strictEqual(a.cls, 'AA');
const cover = 4, max = 150 * cover + z * stdA * Math.sqrt(cover) + (150 + stdA) * 3;
close(a.maxLevel, max, 'A max level');
assert.strictEqual(a.suggested, Math.ceil((max - 250) / 10), 'A order in cartons rounded up');
assert.strictEqual(c.suggested, 0, 'inactive item orders nothing');
// وحدة غير معرفة تظهر في الفحوصات
assert.strictEqual(res.checks.find(x => x.id === 'salesUnit').count, 6);

// التعديل اليدوي
db.adjustments = { A1: { delta: 5, reason: 'عرض' } };
res = E.compute(db);
assert.strictEqual(res.rows[0].final, res.rows[0].suggested + 5);

// الفترة الاستثنائية: +2 شهر لنوع خارجي على شهر الطلب 2026-07 فقط
db = baseDb();
db.exceptions = [{ id: 'x', name: 'موسم', fromMonth: '2026-07', toMonth: '2026-07', scope: 'type', value: 'خارجي', months: 2, enabled: true }];
let r1 = E.compute(db).rows[0];
close(r1.extraMonths, 5, 'fixed 3 + exceptional 2');
db.settings.lastMonth = '2026-07'; // شهر الطلب 2026-08 → لم تعد سارية
r1 = E.compute(db).rows[0];
close(r1.extraMonths, 3, 'exception expired');

// أساس الإضافي = المتوسط فقط
db = baseDb(); db.settings.extraBasis = 'avg';
close(E.compute(db).rows[0].extra, 150 * 3, 'extra basis avg');

// الاستيراد: تعرّف الأعمدة + إضافة صنف جديد تلقائيًا كـ غير مصنف
db = baseDb();
const rows = [['تقرير'], [], ['كود الصنف', 'اسم الصنف', 'الوحدة', 'الوارد', 'المنصرف'], ['A1', 'x', 'حبه', 0, 10], ['NEW', 'جديد', 'حبه', 0, 3], ['الإجمالي', '', '', '', 13]];
const det = I.detectHeader(rows, 'sales');
assert.strictEqual(det.row, 2);
const recs = I.rowsToRecords(rows, det.row, det.map);
assert.strictEqual(recs.length, 2, 'total row skipped');
const out = I.applySales(db, recs, '2026-07');
assert.strictEqual(out.added.length, 1);
const added = db.items.find(i => i.code === 'NEW');
assert.ok(added.autoAdded && added.group === 'غير مصنف');

// التصنيف اليدوي يغلب التلقائي
db = baseDb(); db.items[1].clsOverride = 'AA';
const rb = E.compute(db).rows[1];
assert.strictEqual(rb.cls, 'AA'); assert.strictEqual(rb.clsAuto, 'BB'); assert.ok(rb.clsManual);
close(rb.service, 0.95, 'manual class service level');

// أوامر الشراء: استيراد، بالطريق تلقائي، الإغلاق عند الاختفاء، إعادة الفتح، السداد
db = baseDb(); db.transit = [];
const poRows = (list) => list.map(([poNo, code, unit, qty, value, inv]) => ({ poNo, code, unit, qty, value, invQty: inv }));
let pr = I.applyPOs(db, poRows([['P1', 'A1', 'كرتون', 10, 1000, 0], ['P1', 'B1', 'حبه', 40, 200, 10], ['P2', 'B1', 'حبه', 5, 50, 0]]), { date: '2026-07-01' });
assert.strictEqual(pr.orders, 2); assert.strictEqual(pr.newOrders.length, 2);
assert.strictEqual(db.po.orders.P1.currency, 'USD', 'currency from item type (خارجي)');
let rr = E.compute(db).rows;
close(rr[0].transit, 100, 'A1 transit from PO = 10 cartons'); close(rr[1].transit, 35, 'B1 transit = (40-10) + 5');
// P1 تلقائيًا: الوصول = أول ظهور + أطول توصيل (خارجي 3 أشهر)
assert.strictEqual(E.poSummary(db, '2026-07-01').find(o => o.no === 'P1').eta, '2026-10-01');
// إعادة الرفع بدون P2 ← P2 وصل المخزون
pr = I.applyPOs(db, poRows([['P1', 'A1', 'كرتون', 10, 1000, 0], ['P1', 'B1', 'حبه', 40, 200, 10]]), { date: '2026-07-15' });
assert.deepStrictEqual(pr.closed, ['P2']); assert.strictEqual(db.po.orders.P2.status, 'received');
close(E.compute(db).rows[1].transit, 30, 'received PO no longer in transit');
// رجع P2 للتقرير ← يعاد فتحه (لأنه أُغلق تلقائيًا)
pr = I.applyPOs(db, poRows([['P1', 'A1', 'كرتون', 10, 1000, 0], ['P2', 'B1', 'حبه', 5, 50, 0]]), { date: '2026-07-20' });
assert.deepStrictEqual(pr.reopened, ['P2']);
// شيت السداد: P1 مسدد بالكامل، P3 جديد بدفعة من الملاحظة
const pay = I.applyPOPay(db, [{ poNo: 'P1', shipping: 100, status: 'تم السداد' }, { poNo: 'P3', value: 2000, status: 'لم يتم السداد', note: 'تم سداد دفعة 500' }], { date: '2026-07-20', currencyHint: 'USD' });
assert.strictEqual(pay.paidFull, 1); assert.deepStrictEqual(pay.fromNote, ['P3']);
const sm = E.poSummary(db, '2026-07-20');
const p1 = sm.find(o => o.no === 'P1'), p3 = sm.find(o => o.no === 'P3');
close(p1.totalSar, 1100 * 3.75, 'P1 total SAR'); assert.strictEqual(p1.payStatus, 'مسدد'); close(p1.dueSar, 0, 'P1 due');
close(p3.dueSar, (2000 - 500) * 3.75, 'P3 due'); assert.strictEqual(p3.payStatus, 'مسدد جزئيًا');
// إعادة استيراد الشيت لا تكرر الدفعات
I.applyPOPay(db, [{ poNo: 'P1', status: 'تم السداد' }], { date: '2026-07-21', currencyHint: 'USD' });
assert.strictEqual(db.po.orders.P1.payments.length, 1);
// عملة من عنوان العمود
assert.strictEqual(I.currencyFromHeader('القيمة دولار'), 'USD');

console.log('✓ all engine unit tests passed');
