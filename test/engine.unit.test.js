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
// الإعداد مقفل (الافتراضي): أوامر الشراء لا تنخصم من الطلب
close(E.compute(db).rows[0].transit, 0, 'PO not counted when setting is off');
db.settings.poAsTransit = true;
let rr = E.compute(db).rows;
close(rr[0].transit, 100, 'A1 transit from PO = 10 cartons'); close(rr[1].transit, 35, 'B1 transit = (40-10) + 5');
// الخطة التراكمية من تاريخ الأمر (P1 خارجي، أول ظهور 1/7): مخطط الشحن = +66 يوم (2+2+7+45+7+3)، والمستودع = +113
let s1 = E.poSummary(db, '2026-07-01').find(o => o.no === 'P1');
assert.strictEqual(s1.expShip, '2026-09-05'); assert.strictEqual(s1.eta, '2026-10-22'); assert.strictEqual(s1.planEta, '2026-10-22');
assert.ok(!s1.shipLate); assert.strictEqual(s1.mainStatus, 'صادر'); assert.strictEqual(s1.variance, 0);
let pl = E.poPlan(db, db.po.orders.P1, '2026-07-01');
assert.strictEqual(pl.stages[7].dayFromPo, 96, 'docs stage = day 96 from PO date (66 + 30)');
// عدّى موعد الشحن المخطط بدون شحن ← «تأخر الشحن» والحالة تبقى «صادر»
s1 = E.poSummary(db, '2026-09-10').find(o => o.no === 'P1');
assert.ok(s1.shipLate); assert.strictEqual(s1.shipLateDays, 5); assert.strictEqual(s1.stage, 'issued');
// مدة التجهيز في كارت الصنف تغلب: A1 = 60 يوم ← الشحن المخطط +81
db.items[0].prepDays = 60;
assert.strictEqual(E.poSummary(db, '2026-07-01').find(o => o.no === 'P1').expShip, '2026-09-20');
db.items[0].shipDays = 40; // مدة الشحن للصنف ← مرحلة «في الطريق» 40
assert.strictEqual(E.poPlan(db, db.po.orders.P1, '2026-07-01').stages[7].dayFromPo, 121);
delete db.items[0].prepDays; delete db.items[0].shipDays;
// الفعلي يزيح الباقي: الشحن الفعلي 20/9 (متأخر 15 يوم عن المخطط 5/9) ← الوصول يتأخر 15 يوم، والمقارنة تبين الفرق
E.setTrackStage(db, db.po.orders.P1, 'shipped', { date: '2026-09-20' });
s1 = E.poSummary(db, '2026-09-20').find(o => o.no === 'P1');
assert.strictEqual(s1.eta, '2026-11-06'); assert.strictEqual(s1.planEta, '2026-10-22'); assert.strictEqual(s1.variance, 15);
assert.strictEqual(s1.mainStatus, 'مشحون — بدون أوراق');
E.setTrackStage(db, db.po.orders.P1, 'docs', { date: '2026-09-25' });
assert.strictEqual(E.poSummary(db, '2026-09-25').find(o => o.no === 'P1').mainStatus, 'مشحون — استلمنا الأوراق');
// إرجاع P1 لحالته (باقي الاختبارات تعتمد عليه صادر بدون متابعة)
delete db.po.orders.P1.track; db.po.orders.P1.shipped = false; db.po.orders.P1.shippedAt = ''; db.po.orders.P1.shippedBy = '';
// نوع محلي (مصنع) ← بدون مراحل شحن، والوصول بفترة التوصيل
const s2 = E.poSummary(db, '2026-12-01').find(o => o.no === 'P2');
assert.strictEqual(s2.expShip, ''); assert.ok(!s2.shipLate); assert.strictEqual(s2.eta, '2026-08-01'); assert.ok(!s2.foreign);
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
// المراحل: الأوامر في شيت المحاسب ← «تم الشحن»، والوصول = تاريخ الشحن + مدة الشحن
assert.strictEqual(E.stageOf(db.po.orders.P1), 'shipped'); assert.strictEqual(E.stageOf(db.po.orders.P2), 'issued');
I.applyPOPay(db, [{ poNo: 'P2', status: 'لم يتم السداد', shipDate: '2026-08-01', blNo: 'BL-77' }], { date: '2026-08-02' });
const p2 = E.poSummary(db, '2026-08-02').find(o => o.no === 'P2');
assert.strictEqual(p2.stage, 'shipped'); assert.strictEqual(p2.blNo, 'BL-77'); assert.strictEqual(p2.eta, '2026-08-01', 'local order: PO date + lead time (no shipping stages)');
// تاريخ الأمر من الشيت: الأمر الصادر يحسب وصوله من تاريخ الأمر + فترة التوصيل
db.po.orders.P2.shipped = false; db.po.orders.P2.shipDate = ''; db.po.orders.P2.shippedAt = '';
I.applyPOPay(db, [{ poNo: 'P2', poDate: '2026-05-01' }], { date: '2026-08-03' });
assert.strictEqual(db.po.orders.P2.poDate, '2026-05-01');
db.po.orders.P2.shipped = false; db.po.orders.P2.shippedAt = '';
assert.strictEqual(E.poAutoEta(db, db.po.orders.P2), '2026-06-01', 'issued: PO date + 1 month (مصنع)');
// تكاليف إضافية بعملة مختلفة تدخل الإجمالي والمتبقي
db.po.orders.P1.extraCosts = [{ id: 'x1', desc: 'جمارك', amount: 375, currency: 'SAR' }];
const p1b = E.poSummary(db, '2026-07-21').find(o => o.no === 'P1');
close(p1b.extrasSar, 375, 'extras SAR'); close(p1b.totalSar, 1100 * 3.75 + 375, 'total incl extras'); close(p1b.dueSar, 375, 'due = unpaid extras');
assert.strictEqual(p1b.payStatus, 'مسدد جزئيًا');
// عملة من عنوان العمود
assert.strictEqual(I.currencyFromHeader('القيمة دولار'), 'USD');

// متابعة المعاملات الخارجية: المراحل، التأخير، الحاويات وأيام السماح
db = baseDb(); db.settings.poAsTransit = true; db.transit = [];
I.applyPOs(db, [{ poNo: 'T1', code: 'A1', unit: 'كرتون', qty: 10, value: 1000, invQty: 0 }], { date: '2026-07-01' });
const T1 = db.po.orders.T1;
assert.strictEqual(E.trackStageIndex(db, T1), 0, 'implicit stage = issue');
E.setTrackStage(db, T1, 'prep', { date: '2026-07-05', by: 'x' });
let tr = E.trackSummary(db, '2026-08-25').find(t => t.no === 'T1');
assert.strictEqual(tr.stageId, 'prep'); assert.strictEqual(tr.group, 'عند المورد'); assert.ok(tr.late, 'prep 45 days exceeded (51)');
assert.strictEqual(tr.daysIn, 51);
// الشحن يحوّل الحالة العامة «تم الشحن»
E.setTrackStage(db, T1, 'shipped', { date: '2026-08-26' });
assert.ok(T1.shipped); assert.strictEqual(E.poSummary(db, '2026-08-26').find(o => o.no === 'T1').stage, 'shipped');
tr = E.trackSummary(db, '2026-08-26').find(t => t.no === 'T1');
assert.strictEqual(tr.group, 'تحت الشحن');
// الوصول من المراحل: 26/8 + شحن 30 + أوراق 5 + للمخلّص 2 + ميناء 3 + تخليص 5 + خروج 2 = +47 يوم
assert.strictEqual(tr.etaStages, '2026-10-12'); assert.strictEqual(E.poSummary(db, '2026-08-26').find(o => o.no === 'T1').eta, '2026-10-12');
// وصول الميناء يبدأ أيام السماح (14 افتراضي) للحاويات
T1.track.containers = [{ no: 'MSKU1' }, { no: 'MSKU2' }];
E.setTrackStage(db, T1, 'port', { date: '2026-09-28' });
tr = E.trackSummary(db, '2026-10-09').find(t => t.no === 'T1');
assert.strictEqual(tr.group, 'عند المخلّص / الميناء'); assert.strictEqual(tr.containers[0].deadline, '2026-10-12');
assert.ok(tr.demurrageSoon && !tr.demurrageOverdue, '3 days left = warn');
T1.track.containers[1].emptyAt = '2026-10-10';
tr = E.trackSummary(db, '2026-10-15').find(t => t.no === 'T1');
assert.ok(tr.demurrageOverdue); assert.strictEqual(tr.containersOpen, 1);
assert.strictEqual(E.compute(db).checks.find(c => c.id === 'demurrage').count, 1);
// وكيل بأيام سماح خاصة
db.parties = [{ id: 'f1', kind: 'forwarder', name: 'وكيل', freeDays: 21 }]; T1.track.forwarder = 'f1';
tr = E.trackSummary(db, '2026-10-15').find(t => t.no === 'T1');
assert.strictEqual(tr.containers[0].deadline, '2026-10-19'); assert.ok(!tr.demurrageOverdue);
// وصول المستودع ← «وصل المخزون» (ينشال من بالطريق) — والمعاملة تبقى لين تسليم الحاوية فارغة
E.setTrackStage(db, T1, 'warehouse', { date: '2026-10-16' });
assert.strictEqual(T1.status, 'received'); close(E.compute(db).rows[0].transit, 0, 'received removed from transit');
assert.ok(!E.trackSummary(db, '2026-10-16').find(t => t.no === 'T1').closed);
E.setTrackStage(db, T1, 'emptyReturned', { date: '2026-10-20' });
tr = E.trackSummary(db, '2026-10-20').find(t => t.no === 'T1');
assert.ok(tr.closed); assert.strictEqual(tr.group, 'منتهية'); assert.strictEqual(T1.track.history.length, 5);

// شيت المخلّص: مطابقة بالبوليصة، حالة مُحوّلة، حاويات
db = baseDb();
I.applyPOs(db, [{ poNo: 'K1', code: 'A1', unit: 'كرتون', qty: 5, value: 100, invQty: 0 }], { date: '2026-07-01' });
db.po.orders.K1.blNo = 'BL-1';
db.parties = [{ id: 'c1', kind: 'clearer', name: 'مخلّص', statusMap: [{ text: 'تم الربط مع الوكيل', stage: 'customs' }, { text: 'وصلت الميناء', stage: 'port' }] }];
const tk = I.applyTrack(db, [
  { blNo: 'BL-1', containerNo: 'msku1', status: 'وصلت الميناء', statusDate: '2026-09-01', portDate: '2026-09-01' },
  { blNo: 'BL-1', containerNo: 'MSKU2', status: 'تم الربط مع الوكيل', statusDate: '2026-09-03' },
  { poNo: 'NOPE', status: 'x' }, { blNo: 'BL-1', status: 'حالة جديدة' }
], { date: '2026-09-03', partyId: 'c1' });
assert.deepStrictEqual(tk.matched, ['K1']); assert.deepStrictEqual(tk.notFound, ['NOPE']); assert.strictEqual(tk.unmapped['حالة جديدة'], 1);
assert.strictEqual(tk.containersAdded, 2); assert.strictEqual(db.po.orders.K1.track.stage, 'customs'); assert.strictEqual(db.po.orders.K1.track.clearer, 'c1');
assert.ok(db.po.orders.K1.shipped, 'reaching port implies shipped');
// تسليم كل الحاويات فارغة ← منتهية
I.applyTrack(db, [{ containerNo: 'MSKU1', emptyDate: '2026-09-20' }, { containerNo: 'MSKU2', emptyDate: '2026-09-21' }], { date: '2026-09-21' });
assert.strictEqual(db.po.orders.K1.track.stage, 'emptyReturned'); assert.ok(db.po.orders.K1.track.closed);

// تقرير المخلّص بشكل Crystal Reports (بيانات وهمية): مسلسل ← بيانات ← ملاحظات، والأعمدة تتحرك
{
  const row = (pairs) => { const r = []; for (const [c, v] of pairs) r[c] = v; return r; };
  const rows = [
    row([[8, 'بيان المعاملات تحت التخليص']]),
    row([[18, 'الحالة '], [34, 'رقم الحاوية'], [37, 'الوكيل'], [43, 'رقم البوليصه'], [56, 'رقم المعامله'], [58, 'مسلسل']]),
    row([[1, 'موانى '], [2, 'ربط'], [4, 'تسليم'], [5, 'شحن'], [6, 'الملاحظات']]),
    row([[58, 1]]),
    row([[10, 0], [15, 0], [21, 'NOT ARRIVED'], [23, 'الصين'], [26, 'ميناء جدة الإسلامي'], [28, 46340], [34, 'ABCU 1234567|ABCU 7654321'], [37, 'Fast'], [41, '20x2 - جاف'], [44, 'BLX12345'], [56, 501]]),
    row([[6, 'NEED TELEX - 90009'], [18, 'إنتظار']]),
    row([[58, 2]]),
    row([[10, 1500.5], [15, 300], [21, 'Arrived'], [23, 'الهند'], [26, 'ميناء جدة الإسلامي'], [28, 46333], [32, '1082286'], [34, 'XYZU 1111111'], [37, 'Slow'], [41, '20x1 - جاف'], [42, 'BLY999'], [56, 502]]),
    row([[2, '*'], [4, '*'], [6, 'الشيك مع الوكيل- 90008'], [18, 'تحصيل رسوم']]),
    row([[10, 1500.5], [22, 'الإجمالي ']]),
    row([[0, '4Link ERP'], [25, ' :القائم بالطباعه'], [51, 46336]])
  ];
  const cdb = baseDb();
  I.applyPOs(cdb, [{ poNo: '90009', code: 'A1', unit: 'كرتون', qty: 1, value: 1 }, { poNo: '90008', code: 'B1', unit: 'حبه', qty: 1, value: 1 }].map(x => Object.assign(x, { invQty: 0 })), { date: '2026-11-01' });
  const sheets = [{ name: 'Sheet1', rows }];
  assert.ok(I.isClearerReport(sheets));
  const recs = I.parseClearerReport(sheets, cdb);
  assert.strictEqual(recs.length, 2, 'footer and totals skipped');
  assert.deepStrictEqual(recs[0].containers, ['ABCU1234567', 'ABCU7654321']); assert.strictEqual(recs[0].blNo, 'BLX12345');
  assert.strictEqual(recs[0].poNo, '90009'); assert.ok(recs[0].extra.needTelex); assert.strictEqual(recs[0].portEta, '2026-11-14');
  assert.deepStrictEqual(recs[1].statuses, ['Arrived', 'تحصيل رسوم']); assert.strictEqual(recs[1].extra.bayan, '1082286');
  assert.strictEqual(recs[1].extra.opsFee, 1500.5); assert.deepStrictEqual(recs[1].extra.flags, ['ربط', 'تسليم']);
  const rr2 = I.applyTrack(cdb, recs, { date: '2026-11-10' });
  assert.deepStrictEqual(rr2.matched.sort(), ['90008', '90009']); assert.deepStrictEqual(rr2.unmapped, {});
  const z8 = E.trackSummary(cdb, '2026-11-10').find(t => t.no === '90008'), z9 = E.trackSummary(cdb, '2026-11-10').find(t => t.no === '90009');
  assert.strictEqual(z8.stageId, 'customs', 'furthest of Arrived + تحصيل رسوم'); assert.strictEqual(z8.containers[0].portAt, '2026-11-07');
  assert.strictEqual(z8.containers[0].deadline, '2026-11-21');
  assert.strictEqual(z9.stageId, 'shipped'); assert.ok(z9.needTelex);
  // وصول الميناء المتوقع من المخلّص (14/11) + مدد الميناء والتخليص والخروج (3+5+2) = 24/11
  assert.strictEqual(z9.etaStages, '2026-11-24');
}

// تقرير PDF: آخر اسم الصنف داخل خانة الوحدة ← نطلّع الوحدة الصحيحة ونرجع الباقي للاسم، ونقرأ «تاريخ امر الشر» المقصوص
{
  const d3 = E.emptyDb();
  d3.items.push({ code: 'U1', name: 'مكنسة', baseUnit: 'حبه', units: [], type: 'خارجي', active: true }, { code: 'U2', name: 'سلك', baseUnit: 'كرتون2', units: [], type: 'خارجي', active: true });
  const hdr = ['تاريخ امر الشر', 'الكمية المتبقية', 'كمية الفاتورة', 'سعر امر الشراء', 'كمية امر الشراء', 'الوحدة', 'اسم الصنف', 'رقم الصنف', 'رقم الأمر'];
  const rows = [hdr, ['05/03/2026', 10, 0, 100, 10, '12 ح حبه', 'مكانس 60 سم', 'U1', 'Q1'], ['05/03/2026', 5, 0, 50, 5, 'كرتون 2', 'سلك لحام شد', 'U2', 'Q1'], ['05/03/2026', 3, 0, 30, 3, 'ع كيس', 'قفل', 'U3', 'Q1']];
  const dh = I.detectHeader(rows, 'po');
  assert.strictEqual(dh.map.poDate, 0, 'truncated PO date header is detected');
  I.applyPOs(d3, I.rowsToRecords(rows, dh.row, dh.map, 'poNo'), { date: '2026-03-10' });
  const L = d3.po.orders.Q1.lines;
  assert.strictEqual(d3.po.orders.Q1.poDate, '2026-03-05');
  assert.deepStrictEqual(L.map(l => l.unit), ['حبه', 'كرتون2', 'كيس']);
  assert.strictEqual(L[0].name, 'مكانس 60 سم 12 ح');
}

// تقرير أوامر الشراء الكامل: المخزن، مركز التكلفة (رقمه منسكب في خانة الشحن)، رسوم الشحن، والمخلّص يتسجل كجهة لو مو موجود
{
  const d4 = E.emptyDb();
  const hdr = ['المخلص الجمركي', 'رسوم الشحن', 'مركز التكلفة', 'الكمية المتبقية', 'كمية الفاتورة', 'سعر امر الشراء', 'كمية امر الشراء', 'المخزن', 'الوحدة', 'اسم الصنف', 'رقم الصنف', 'رقم الأمر', 'تاريخ امر الشراء'];
  const rows = [hdr,
    ['برق المحيط', '12600 9011', 'موردون خارجيون -نايف محمد', 5, 0, 100, 5, 1101, 'حبه', 'س', 'C1', 'R1', '01/02/2026'],
    [null, null, 'مركز عام 8001', 5, 0, 100, 5, 1002, 'حبه', 'ص', 'C2', 'R1', '01/02/2026'],
    [null, 9006, 'موردون خارجيون -وعد الشروق ل', 5, 0, 100, 5, 1101, 'حبه', 'ع', 'C3', 'R2', '03/02/2026'],
    [null, 9000, 'مؤسسة اديب 9008', 5, 0, 100, 5, 1101, 'حبه', 'ع', 'C3', 'R3', '03/02/2026']];
  const dh = I.detectHeader(rows, 'po');
  I.applyPOs(d4, I.rowsToRecords(rows, dh.row, dh.map, 'poNo'), { date: '2026-03-10' });
  const R1 = d4.po.orders.R1, R2 = d4.po.orders.R2, R3 = d4.po.orders.R3;
  assert.strictEqual(R1.costCenter, 'موردون خارجيون -نايف محمد 9011'); assert.strictEqual(R1.shipping, 12600);
  assert.strictEqual(R1.warehouse, '1101، 1002');
  assert.strictEqual(R2.costCenter, 'موردون خارجيون -وعد الشروق ل 9006'); assert.ok(!R2.shipping, 'spilled code is not shipping');
  assert.strictEqual(R3.shipping, 9000, 'real shipping kept when cost center already has its code');
  const cl = d4.parties.find(p => p.kind === 'clearer' && p.name === 'برق المحيط');
  assert.ok(cl, 'clearer party created'); assert.strictEqual(R1.track.clearer, cl.id);
  // مركز التكلفة = مكتب الاستيراد: يتسجل وكيل باسم مختصر، والأمر يصير خارجي بعملة الاستيراد (الدولار)
  const fw = d4.parties.find(p => p.kind === 'forwarder' && p.name === 'نايف محمد 9011');
  assert.ok(fw, 'import office party created from cost center'); assert.strictEqual(R1.track.forwarder, fw.id);
  assert.strictEqual(R1.currency, 'USD'); assert.ok(E.isForeign(d4, R1));
  assert.ok(!d4.parties.some(p => /مركز عام/.test(p.name)), 'general cost center is not an import office');
  I.applyPOs(d4, I.rowsToRecords(rows, dh.row, dh.map, 'poNo'), { date: '2026-03-11' });
  assert.strictEqual(d4.parties.filter(p => p.name === 'برق المحيط').length, 1, 'no duplicate party on re-import');
  assert.strictEqual(d4.parties.filter(p => p.kind === 'forwarder').length, 3, 'one office per cost center, no duplicates');
}

// النموذج الموحد الجديد: حالة المعاملة = أعمدة النجمة، وأكثر من حاوية لنفس الأمر، وتقرير المخلّص PDF
{
  const d5 = E.emptyDb(); d5.shipStages = E.defaultShipStages(); d5.clearerForm = I.defaultClearerForm();
  d5.po.orders.K1 = { no: 'K1', status: 'open', currency: 'USD', lines: [], payments: [], shipped: true, shipDate: '2026-10-01', firstSeen: '2026-09-01', poDate: '2026-09-01' };
  d5.po.orders.K2 = { no: 'K2', status: 'open', currency: 'USD', lines: [], payments: [], shipped: true, shipDate: '2026-10-01', firstSeen: '2026-09-01', poDate: '2026-09-01' };
  const hdr = I.KINDS.track.fields.filter(f => f.form !== false).map(f => f.label);
  assert.deepStrictEqual(hdr.slice(0, 3), ['رقم معاملة العميل', 'رقم المعاملة لدى المخلّص', 'رقم البوليصة']);
  assert.ok(!hdr.includes('المنشأ') && !hdr.includes('حالة المعاملة') && !hdr.includes('مطلوب تلكس منّا'), 'removed columns not in form');
  const row = o => hdr.map(h => o[h] == null ? null : o[h]);
  const rows = [hdr,
    row({ 'رقم معاملة العميل': 'K1', 'رقم الحاوية': 'ABCU1234567', 'عدد الحاويات': 2, 'حالة الشحنة': 'وصلت (في الميناء)', 'وصول المنفذ الفعلي': '2026-11-10', 'تسليم (DO)': '*', 'ربط (LK)': '*' }),
    row({ 'رقم معاملة العميل': 'K1', 'رقم الحاوية': 'ABCU7654321', 'عدد الحاويات': 2, 'حالة الشحنة': 'وصلت (في الميناء)', 'تسليم (DO)': '*', 'ربط (LK)': '*' }),
    row({ 'رقم معاملة العميل': 'K2', 'حالة الشحنة': 'لم تصل (بالطريق)', 'ملاحظات': 'NEED TELEX' })];
  const dh = I.detectHeader(rows, 'track');
  const res = I.applyTrack(d5, I.rowsToRecords(rows, dh.row, dh.map, 'poNo'), { date: '2026-11-12' });
  assert.deepStrictEqual(res.unmapped, {});
  assert.strictEqual(d5.po.orders.K1.track.containers.length, 2, 'two containers on one PO');
  assert.strictEqual(d5.po.orders.K1.track.stage, 'customs', 'LK star → customs');
  assert.strictEqual(d5.po.orders.K1.track.clearerInfo.qty, '2');
  assert.ok(d5.po.orders.K2.track.needTelex, 'NEED TELEX in notes');
  // PDF: السجلات جاهزة من قارئ PDF ← نفس المسار
  const pdfRecs = I.parseClearerPdf([{ consig: '19000', bl: 'BLX1', container: 'ZGXU 3004349|ZGXU 2989549', eta: 'مي 2026/11/20 12:00:00AM ن', port: 'اءجدةا لإ س لا مي', terminal: 'Arrived', status: 'تحصيلرسوم', desc: 'NEED TELEX-K2', flags: ['تسليم', 'ربط', 'مواني'] }], d5);
  assert.deepStrictEqual(pdfRecs[0].containers, ['ZGXU3004349', 'ZGXU2989549']);
  assert.strictEqual(pdfRecs[0].extra.port, 'ميناء جدة الإسلامي'); assert.strictEqual(pdfRecs[0].portEta, '2026-11-20');
  assert.ok(pdfRecs[0].extra.needTelex);
  assert.strictEqual(I.mapTrackStatus(d5, 'تحصيلرسوم'), 'customs'); assert.strictEqual(I.mapTrackStatus(d5, 'مواني'), 'customs');
}

// الأوراق: «مطلوب تلكس» = بدون أوراق، والخانة اليدوية تغلب، ومرفق التلكس يكفي
{
  const d6 = E.emptyDb(); d6.shipStages = E.defaultShipStages();
  const o = d6.po.orders.D1 = { no: 'D1', status: 'open', currency: 'USD', lines: [], payments: [], firstSeen: '2026-09-01', poDate: '2026-09-01' };
  E.setTrackStage(d6, o, 'customs', { date: '2026-11-01' });
  const st = () => E.poSummary(d6, '2026-11-10').find(x => x.no === 'D1').mainStatus;
  assert.strictEqual(st(), 'مشحون — استلمنا الأوراق');
  o.track.needTelex = true; assert.strictEqual(st(), 'مشحون — بدون أوراق', 'clearer waiting telex → no docs');
  o.docsManual = 'yes'; assert.strictEqual(st(), 'مشحون — استلمنا الأوراق', 'manual yes wins');
  o.docsManual = 'no'; o.track.needTelex = false; assert.strictEqual(st(), 'مشحون — بدون أوراق', 'manual no wins');
  delete o.docsManual; o.track.needTelex = true; o.attachments = [{ kind: 'تلكس', name: 't.pdf' }]; assert.strictEqual(st(), 'مشحون — استلمنا الأوراق', 'telex attachment');
}

console.log('✓ all engine unit tests passed');
