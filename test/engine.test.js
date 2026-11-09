// يقارن نتائج المحرك بالقيم المحسوبة في ملف الإكسيل الأصلي
// الاستخدام: node test/engine.test.js <ملف الإكسيل> <expected.json>
const path = require('path');
const { readWorkbook } = require('../src/xlsxio');
const E = require('../src/renderer/engine');
const I = require('../src/renderer/importers');
(async () => {
  const [xl, expPath] = process.argv.slice(2);
  const exp = require(path.resolve(expPath));
  const t0 = Date.now();
  const wb = await readWorkbook(xl);
  console.log('read', Date.now() - t0, 'ms');
  const db = I.importLegacy(wb.sheets);
  console.log('items', db.items.length, 'sales', db.sales.length, 'stock', db.stock.rows.length, 'transit', db.transit.length, 'lastMonth', db.settings.lastMonth);
  const t1 = Date.now();
  const res = E.compute(db);
  console.log('compute', Date.now() - t1, 'ms');
  const keys = ['total', 'avg', 'std', 'cost', 'lead', 'safety', 'extra', 'max', 'stock', 'transit', 'sugg', 'final', 'val'];
  const map = { total: 'total', avg: 'avg', std: 'std', cost: 'cost', lead: 'lead', safety: 'safety', extra: 'extra', max: 'maxLevel', stock: 'stock', transit: 'transit', sugg: 'suggested', final: 'final', val: 'orderValue' };
  let bad = 0, n = 0; const diffs = {};
  for (const r of res.rows) {
    const e = exp[r.code]; if (!e) continue; n++;
    let rowBad = false;
    if (e.cls !== r.cls) { diffs.cls = (diffs.cls || 0) + 1; rowBad = true; if (diffs.cls < 4) console.log('cls', r.code, e.cls, r.cls); }
    for (const k of keys) {
      const a = Number(e[k] || 0), b = Number(r[map[k]] || 0);
      if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) { diffs[k] = (diffs[k] || 0) + 1; rowBad = true; if (diffs[k] < 4) console.log(k, r.code, a, b); }
    }
    if (rowBad) bad++;
  }
  console.log('compared', n, 'rows with diffs', bad, diffs);
  console.log('totals order value', res.totals.orderValue, 'ordered', res.totals.ordered);
  console.log(res.checks.map(c => (c.ok ? '✓' : c.sev === 'x' ? '✗' : '⚠') + ' ' + c.count + ' ' + c.title).join('\n'));
  process.exit(bad ? 1 : 0);
})();
