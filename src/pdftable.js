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

async function readPdfTable(data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
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
      const pageHeader = cells.map(c => ({ text: c.parts.sort((a, b) => b.x0 - a.x0).map(t => t.s).join(' '), x: (c.x0 + c.x1) / 2 }));
      if (!header) { header = pageHeader; out.push(header.map(h => h.text)); }
      else header = header.map(h => { const m = pageHeader.find(ph => ph.text === h.text); return m ? { text: h.text, x: m.x } : h; });
    }
    if (!header) continue;
    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const cells = header.map(() => []);
      for (const it of lines[i].items) {
        let k = 0, d = Infinity;
        header.forEach((h, j) => { const dd = Math.abs(h.x - it.x); if (dd < d) { d = dd; k = j; } });
        cells[k].push(it);
      }
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
