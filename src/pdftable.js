// قراءة جدول من ملف PDF نصّي (مثل تقرير أوامر الشراء من النظام) وتحويله لصفوف وأعمدة.
// الفكرة: كل كلمة في PDF لها موضع (x, y). نجمع الكلمات بنفس y في سطر واحد، ونوزعها على الأعمدة
// حسب أقرب عنوان عمود (x). صف العناوين نتعرف عليه من كلمات مثل «رقم الأمر» و«رقم الصنف».
'use strict';
globalThis.pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.js');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const HEADER_HINTS = ['رقم الامر', 'رقم الأمر', 'رقم الصنف', 'اسم الصنف', 'الوحدة', 'الكمية', 'كمية', 'سعر', 'القيمة', 'المورد', 'التاريخ'];
const clean = s => String(s || '').normalize('NFKC').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
// تحويل الأرقام الهندية (٠١٢٣) إلى عربية (0123)
const digits = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.');

// تقرير المخلّص (بيان المعاملات تحت التخليص — Crystal/4Link): الصفحة مدوّرة، فكل معاملة = عمود رأسي (محور x)
// وكل حقل = مسافة على محور y. العناوين الإنجليزية (Consig # / BL # / Container / Status.N / EX DO LK SGP) تحدد الحقول.
const CLR_HEAD = { 'L.N': 'ln', 'Consig #': 'consig', 'Client Name': 'client', 'Importer name': 'importer', 'BL #': 'bl', 'QTY': 'qty', 'Agent': 'agent', 'Container': 'container', 'Bayan': 'bayan', 'Dam': 'dam', 'ETA': 'eta', 'Port': 'port', 'coo': 'coo', 'Terminal': 'terminal', 'Status.N': 'status', 'Duties': 'duties', 'port': 'ops', 'Description': 'desc', 'Descaription': 'desc', 'EX': 'EX', 'DO': 'DO', 'LK': 'LK', 'SGP': 'SGP' };
const CLR_FLAG = { EX: 'شحن', DO: 'تسليم', LK: 'ربط', SGP: 'مواني' };
async function readClearerPdf(doc) {
  const recs = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => clean(it.str) && Math.abs(it.transform[0]) < 0.01 && it.transform[1] > 0)
      .map(it => ({ s: clean(it.str), r: it.transform[4], f0: it.transform[5], f1: it.transform[5] + (it.width || 0) }));
    const heads = items.filter(it => CLR_HEAD[it.s] && it.r > 200 && it.r < 236);
    if (heads.length < 10) continue;
    const cols = heads.map(h => ({ k: CLR_HEAD[h.s], c: (h.f0 + h.f1) / 2 })).sort((a, b) => b.c - a.c);
    const fieldOf = y => { let best = null, d = Infinity; for (const c of cols) { const dd = Math.abs(c.c - y); if (dd < d) { d = dd; best = c.k; } } return best; };
    const hdrR = Math.max(...heads.map(h => h.r));
    const lnC = (cols.find(c => c.k === 'ln') || {}).c;
    const serials = items.filter(it => it.r > hdrR + 8 && /^\d{1,4}$/.test(it.s) && lnC != null && Math.abs((it.f0 + it.f1) / 2 - lnC) < 10).sort((a, b) => a.r - b.r);
    const gaps = serials.slice(1).map((x, i) => x.r - serials[i].r).sort((a, b) => a - b);
    const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 26;
    serials.forEach((sr, i) => {
      const r0 = sr.r - 3, r1 = i + 1 < serials.length ? serials[i + 1].r - 3 : sr.r + step - 3;
      const cells = {};
      for (const it of items) {
        if (it.r < r0 || it.r >= r1 || it === sr) continue;
        const k = fieldOf((it.f0 + it.f1) / 2); (cells[k] = cells[k] || []).push(it);
      }
      // نص الخلية: الأسطر بالترتيب (r)، وداخل السطر من اليمين لليسار (y نازل) مع مسافة بين الكلمات
      const text = k => {
        const its = (cells[k] || []).slice().sort((a, b) => Math.round(a.r) - Math.round(b.r) || b.f0 - a.f0);
        let out = '', prev = null;
        for (const it of its) {
          if (prev && (Math.round(it.r) !== Math.round(prev.r) || prev.f0 - it.f1 > 1.2 || it.s.length > 1 || prev.s.length > 1)) out += ' ';
          out += it.s; prev = it;
        }
        return digits(out).replace(/\s+/g, ' ').trim();
      };
      const rec = { ln: sr.s };
      for (const k of new Set(cols.map(c => c.k))) if (!CLR_FLAG[k]) { const t = text(k); if (t) rec[k] = t; }
      rec.flags = Object.keys(CLR_FLAG).filter(k => (cells[k] || []).some(it => /[*•●]/.test(it.s))).map(k => CLR_FLAG[k]);
      if (rec.consig || rec.bl) recs.push(rec);
    });
  }
  return recs;
}

async function readPdfTable(data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
  const clr = await readClearerPdf(doc);
  if (clr.length) return { sheets: [{ name: 'تقرير المخلّص', rows: [['بيان المعاملات تحت التخليص', 'رقم البوليصه', 'رقم الحاوية']], clearerPdf: clr }] };
  const out = [];
  let header = null; // [{text, x}]
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // كلمات بموضعها: مركز x و y
    const items = tc.items.filter(it => clean(it.str)).map(it => ({ s: clean(it.str), x: it.transform[4] + (it.width || 0) / 2, x0: it.transform[4], x1: it.transform[4] + (it.width || 0), y: it.transform[5] }));
    // تجميع الأسطر حسب y (تسامح 3 نقاط)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const ln = lines.find(l => Math.abs(l.y - it.y) <= 3);
      if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    // صف العناوين في هذه الصفحة
    let hdrIdx = -1, best = 0;
    lines.forEach((l, i) => {
      const txt = l.items.map(t => t.s).join(' ');
      const score = HEADER_HINTS.filter(h => txt.includes(h)).length;
      if (score > best) { best = score; hdrIdx = i; }
    });
    if (hdrIdx >= 0 && best >= 2) {
      // دمج كلمات العنوان المتلاصقة في خلية واحدة (العنوان قد يتقطع لأكثر من قطعة)
      const hs = lines[hdrIdx].items.slice().sort((a, b) => a.x0 - b.x0);
      const cells = [];
      for (const h of hs) {
        const last = cells[cells.length - 1];
        if (last && h.x0 - last.x1 < 4) { last.parts.push(h); last.x1 = h.x1; } else cells.push({ parts: [h], x0: h.x0, x1: h.x1 });
      }
      const pageHeader = cells.map(c => ({ text: c.parts.sort((a, b) => b.x0 - a.x0).map(t => t.s).join(' '), x: (c.x0 + c.x1) / 2, w: c.x1 - c.x0 }));
      if (!header) { header = pageHeader; out.push(header.map(h => h.text)); }
      else header = header.map(h => { const m = pageHeader.find(ph => ph.text === h.text); return m ? { text: h.text, x: m.x, w: m.w } : h; });
    }
    if (!header) continue;
    // حدود الأعمدة من البيانات نفسها: نسقط كل كلمات الأسطر الكاملة على محور x،
    // والفراغات اللي ما فيها أي نص = الفواصل بين الأعمدة (الجدول له حدود، والنص ما يعديها)
    const dataLines = lines.slice(hdrIdx + 1);
    // أسطر البيانات الكاملة فقط (التذييل مثل «طبع بواسطة» نصه طويل ويغطي الفواصل)
    const full = dataLines.filter(l => l.items.length >= Math.ceil(header.length * 0.75));
    const iv = full.flatMap(l => l.items.map(t => [t.x0, t.x1])).sort((a, b) => a[0] - b[0]);
    const segs = [];
    for (const [x0, x1] of iv) {
      const last = segs[segs.length - 1];
      if (last && x0 < last[1] - 0.2) last[1] = Math.max(last[1], x1); else segs.push([x0, x1]);
    }
    // كل مقطع ← أقرب عنوان عمود
    const segCol = segs.map(([x0, x1]) => {
      const c = (x0 + x1) / 2; let k = 0, d = Infinity;
      header.forEach((h, j) => { const inside = h.x >= x0 && h.x <= x1 ? -1 : 0; const dd = Math.abs(h.x - c) + inside * 1e6; if (dd < d) { d = dd; k = j; } });
      return k;
    });
    const colOf = it => {
      if (segs.length) {
        let best = 0, bd = Infinity;
        segs.forEach(([x0, x1], j) => { const dd = it.x < x0 ? x0 - it.x : it.x > x1 ? it.x - x1 : 0; if (dd < bd) { bd = dd; best = j; } });
        return segCol[best];
      }
      let k = 0, d = Infinity;
      header.forEach((h, j) => { const dd = Math.abs(h.x - it.x); if (dd < d) { d = dd; k = j; } });
      return k;
    };
    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const cells = header.map(() => []);
      for (const it of lines[i].items) cells[colOf(it)].push(it);
      // داخل الخلية: النص العربي يُقرأ من اليمين لليسار
      const row = cells.map(c => !c.length ? null : c.sort((a, b) => (/[\u0600-\u06FF]/.test(c.map(t => t.s).join('')) ? b.x0 - a.x0 : a.x0 - b.x0)).map(t => t.s).join(' '));
      const vals = row.map(v => {
        if (v == null) return null;
        const t = digits(v).replace(/,/g, '');
        return /^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t) ? Number(t) : v;
      });
      if (vals.filter(v => v != null && v !== '').length >= 2) out.push(vals);
    }
  }
  return { sheets: [{ name: 'PDF', rows: out }] };
}
module.exports = { readPdfTable };
