// قراءة وكتابة ملفات Excel (يعمل في العملية الرئيسية لـ Electron وفي Node)
'use strict';
const ExcelJS = require('exceljs');

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
    return null;
  }
  return v;
}

// يرجع { sheets: [{ name, rows: [[...], ...] }] }
async function readWorkbook(filePath, opts = {}) {
  const maxRows = opts.maxRows || 200000;
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filePath)) await wb.csv.readFile(filePath);
  else await wb.xlsx.readFile(filePath);
  const sheets = [];
  wb.eachSheet(ws => {
    if (opts.only && !opts.only.includes(ws.name)) return;
    const rows = [];
    const last = Math.min(ws.actualRowCount ? ws.rowCount : 0, maxRows);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const arr = [];
      const cc = row.cellCount;
      for (let c = 1; c <= cc; c++) arr.push(cellValue(row.getCell(c).value));
      while (arr.length && (arr[arr.length - 1] == null || arr[arr.length - 1] === '')) arr.pop();
      rows.push(arr);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    sheets.push({ name: ws.name, rows });
  });
  return { sheets };
}

// spec: { sheets: [{ name, title?, subtitle?, columns: [{header, key, width, fmt}], rows: [obj], totals?: obj }] }
async function writeWorkbook(filePath, spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Purchase Planner';
  for (const sh of spec.sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: (sh.title ? 2 : 0) + (sh.subtitle ? 1 : 0) + 1 }] });
    let r = 1;
    const ncol = sh.columns.length;
    if (sh.title) {
      ws.mergeCells(r, 1, r, Math.max(ncol, 1));
      const c = ws.getCell(r, 1); c.value = sh.title; c.font = { bold: true, size: 14 };
      r += 1;
      if (sh.subtitle) {
        ws.mergeCells(r, 1, r, Math.max(ncol, 1));
        const d = ws.getCell(r, 1); d.value = sh.subtitle; d.font = { color: { argb: 'FF555555' } };
        r += 1;
      }
      r += 1;
    }
    const headerRow = ws.getRow(r);
    sh.columns.forEach((col, i) => {
      const c = headerRow.getCell(i + 1);
      c.value = col.header;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.input ? 'FFB7791F' : 'FF1F4E79' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      ws.getColumn(i + 1).width = col.width || 14;
      if (col.fmt) ws.getColumn(i + 1).numFmt = col.fmt;
    });
    headerRow.height = 30;
    const firstData = r + 1;
    for (const obj of sh.rows) {
      r += 1;
      const row = ws.getRow(r);
      sh.columns.forEach((col, i) => {
        let v = obj[col.key];
        if (v === undefined) v = null;
        row.getCell(i + 1).value = v;
      });
    }
    if (sh.totals) {
      r += 1;
      const row = ws.getRow(r);
      sh.columns.forEach((col, i) => {
        const v = sh.totals[col.key];
        if (v !== undefined) { row.getCell(i + 1).value = v; row.getCell(i + 1).font = { bold: true }; }
      });
    }
    if (sh.rows.length) ws.autoFilter = { from: { row: firstData - 1, column: 1 }, to: { row: firstData - 1, column: ncol } };
    // قائمة منسدلة لعمود (مثل حالات المعاملة) من نطاق في ورقة ثانية — للأسطر الموجودة + 500 سطر فاضي
    sh.columns.forEach((col, i) => {
      if (!col.listRef) return;
      for (let rr = firstData; rr <= firstData + sh.rows.length + 500; rr++) {
        ws.getCell(rr, i + 1).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning', errorTitle: 'حالة غير معتمدة', error: 'اختر الحالة من القائمة', formulae: [col.listRef] };
      }
    });
  }
  await wb.xlsx.writeFile(filePath);
}

module.exports = { readWorkbook, writeWorkbook };
