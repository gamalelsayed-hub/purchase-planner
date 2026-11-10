/* واجهة نظام تخطيط المشتريات */
(function () {
  'use strict';
  const E = window.Engine, I = window.Importers, api = window.api;
  const { monthLabel, monthAdd, num, normUnit } = E;

  // ================= الحالة =================
  let db = null, res = null;
  // الصلاحيات: كل مستخدم له قائمة صلاحيات يختارها المدير، والقوالب تعبّيها بضغطة
  const PERMS = [
    ['export', 'تصدير Excel وPDF والطباعة'],
    ['import_data', 'استيراد المبيعات والمخزون والبضاعة بالطريق'],
    ['items', 'إضافة وتعديل الأصناف والوحدات والتصنيف اليدوي'],
    ['adjust', 'التعديل اليدوي على كميات الطلب'],
    ['approve', 'اعتماد الطلب الشهري'],
    ['po_import', 'أوامر الشراء: الاستيراد وحالة الوصول وتاريخه'],
    ['po_payments', 'أوامر الشراء: السداد والشحن والمخلّص'],
    ['settings', 'الإعدادات وسياسة المخزون والعملات'],
    ['users', 'إدارة المستخدمين والصلاحيات'],
    ['shipping', 'المعاملات الخارجية: المراحل والحاويات والجهات وتحديث المخلّص'],
    ['data_admin', 'إدارة البيانات: الإكسيل القديم، الاسترجاع، المسح، المجلد المشترك، الحذف']
  ];
  // الأقسام (الشاشات) اللي تظهر للمستخدم
  const SECTIONS = [
    ['dashboard', 'لوحة الطلب'], ['cycle', 'دورة الشراء الشهري'], ['order', 'قائمة الطلب'], ['calc', 'الحساب التفصيلي'], ['checks', 'الفحوصات'],
    ['items', 'الأصناف'], ['data', 'المبيعات والمخزون'], ['po', 'أوامر الشراء والكاش'], ['ship', 'المعاملات الخارجية'], ['archive', 'الأرشيف'], ['settings', 'الإعدادات'], ['users', 'المستخدمين']
  ];
  // كل صلاحية تحتاج قسمها يكون ظاهر
  const PERM_SECTIONS = { shipping: ['ship'], import_data: ['cycle', 'data'], items: ['items'], adjust: ['order'], approve: ['order', 'cycle'], po_import: ['po'], po_payments: ['po'], settings: ['settings'], users: ['users'], data_admin: ['settings'] };
  const ROLE_TEMPLATES = {
    admin: { label: 'مدير', perms: PERMS.map(p => p[0]), pages: SECTIONS.map(x => x[0]) },
    purchasing: { label: 'مشتريات', perms: ['export', 'import_data', 'items', 'adjust', 'po_import', 'shipping'], pages: ['dashboard', 'cycle', 'order', 'calc', 'checks', 'items', 'data', 'po', 'ship', 'archive'] },
    ap: { label: 'محاسب موردين', perms: ['export', 'po_import', 'po_payments'], pages: ['po'] },
    viewer: { label: 'مشاهد', perms: ['export'], pages: ['dashboard', 'order', 'po', 'ship', 'archive'] }
  };
  const withRequired = (pages, perms) => [...new Set(pages.concat(...perms.map(p => PERM_SECTIONS[p] || [])))];
  // المستخدمين القدامى بدون أقسام محفوظة: قالبهم إذا تطابق، وإلا كل الأقسام ما عدا الإعدادات والمستخدمين + أقسام صلاحياتهم
  function userPages(u) {
    const perms = Array.isArray(u.perms) ? u.perms : ((ROLE_TEMPLATES[u.role] || ROLE_TEMPLATES.viewer).perms);
    if (Array.isArray(u.pages)) return withRequired(u.pages, perms);
    const t = ROLE_TEMPLATES[u.role];
    if (t && t.perms.slice().sort().join(',') === perms.slice().sort().join(',')) return t.pages.slice();
    return withRequired(SECTIONS.map(x => x[0]).filter(k => k !== 'settings' && k !== 'users'), perms);
  }
  const canSee = page => !!ui.user && (ui.user.pages || []).includes(page);
  const ROLES = Object.fromEntries(Object.entries(ROLE_TEMPLATES).map(([k, v]) => [k, v.label]));
  const userPerms = u => Array.isArray(u.perms) ? u.perms : ((ROLE_TEMPLATES[u.role] || ROLE_TEMPLATES.viewer).perms);
  function roleLabel(u) {
    const ps = userPerms(u).slice().sort().join(',');
    const t = Object.values(ROLE_TEMPLATES).find(x => x.perms.slice().sort().join(',') === ps);
    return t ? t.label : 'مخصص';
  }
  const canEditAnything = u => userPerms(u).some(p => p !== 'export');
  const ui = {
    user: null, readOnly: true, lockHolder: null, cfg: null, mtime: 0,
    page: 'dashboard',
    tables: {},
    tableRows: {},
    rowHandlers: {},
    printing: false,
    dataTab: 'sales',
    poTab: 'orders',
    f: {
      order: { type: 'الكل', group: 'الكل', cls: 'الكل', show: 'ordered', q: '' },
      calc: { type: 'الكل', group: 'الكل', cls: 'الكل', status: 'الكل', q: '' },
      items: { type: 'الكل', group: 'الكل', active: 'الكل', flag: 'الكل', q: '' },
      sales: { q: '' }, stock: { q: '' }, transit: { q: '' },
      ship: { group: 'نشطة', alert: 'الكل', party: 'الكل', q: '' },
      po: { status: 'open', pay: 'الكل', agent: 'الكل', q: '' }, cash: { horizon: '', stage: 'الكل' }
    }
  };

  // ================= أدوات =================
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = {};
  function fmt(n, d = 0) {
    if (n == null || n === '' || !isFinite(n)) return '';
    const k = d;
    if (!nf[k]) nf[k] = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
    return nf[k].format(n);
  }
  const money = n => fmt(n, 0);
  const pct = n => (n == null || !isFinite(n)) ? '' : fmt(n * 100, 1) + '%';
  const today = () => new Date().toISOString().slice(0, 10);
  const nowStamp = () => new Date().toISOString();
  const cur = () => (db.settings.currency || 'ريال');
  function opts(list, sel, withAll) {
    const arr = (withAll ? ['الكل'] : []).concat(list);
    return arr.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toastRoot').appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4000);
  }
  function log(msg) {
    db.log = db.log || [];
    db.log.push({ at: nowStamp(), user: ui.user ? ui.user.name : '', msg });
    if (db.log.length > 500) db.log.splice(0, db.log.length - 500);
  }

  // ================= النوافذ =================
  function modal({ title, body, foot, size = '', onMount }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${size}"><div class="modal-head"><h2>${title}</h2><button class="sm" data-close>✕</button></div><div class="modal-body">${body}</div>${foot != null ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
    $('#modalRoot').appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    back.addEventListener('mousedown', e => { if (e.target === back) back.dataset.down = '1'; });
    back.addEventListener('mouseup', e => { if (e.target === back && back.dataset.down) close(); delete back.dataset.down; });
    const m = { el: back.querySelector('.modal'), close, q: s => back.querySelector(s), qa: s => back.querySelectorAll(s) };
    if (onMount) onMount(m);
    return m;
  }
  function confirmBox(msg, { ok = 'تأكيد', danger = false, title = 'تأكيد' } = {}) {
    return new Promise(resolve => {
      const m = modal({
        title, size: 'narrow', body: `<div style="line-height:1.8">${msg}</div>`,
        foot: `<button class="${danger ? 'danger' : 'primary'}" data-ok>${ok}</button><button data-close>إلغاء</button>`,
        onMount: mm => {
          mm.q('[data-ok]').onclick = () => { mm.close(); resolve(true); };
          mm.qa('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
        }
      });
      return m;
    });
  }
  function promptBox(title, label, value = '', type = 'text') {
    return new Promise(resolve => {
      modal({
        title, size: 'narrow',
        body: `<label class="f">${label}<input id="pb" type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="any"' : ''}></label>`,
        foot: `<button class="primary" data-ok>حفظ</button><button data-close>إلغاء</button>`,
        onMount: mm => {
          const inp = mm.q('#pb'); inp.focus(); inp.select();
          const done = () => { mm.close(); resolve(inp.value); };
          mm.q('[data-ok]').onclick = done;
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
          mm.qa('[data-close]').forEach(b => b.addEventListener('click', () => resolve(null)));
        }
      });
    });
  }

  // ================= الحفظ والحساب =================
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  let dirty = false;
  function scheduleSaveMark() { dirty = true; }
  async function saveNow(force) {
    clearTimeout(saveTimer);
    if (!force && (ui.readOnly || !dirty)) return true;
    try {
      const r = await api.saveDb(JSON.stringify(db), { force: !!force });
      if (r && r.ok) { ui.mtime = r.mtime; dirty = false; return true; }
      if (r && (r.reason === 'lockLost' || r.reason === 'changed')) {
        toast(r.reason === 'changed' ? 'الملف المشترك تغيّر من جهاز آخر — لم يتم الحفظ. سيُعاد التحميل.' : 'فقدت قفل التعديل — مستخدم آخر يعدّل الآن. لم يتم حفظ آخر تغيير.', 'bad');
        await enterReadOnly(r.lock || null);
        await reloadDb();
      }
      return false;
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'bad'); return false; }
  }
  function recompute() { res = E.compute(db); }
  function commit() { recompute(); if (!ui.readOnly) { dirty = true; scheduleSave(); } render(); }

  function migrate(d) {
    const base = E.emptyDb();
    d.settings = Object.assign(base.settings, d.settings || {});
    for (const k of ['types', 'classes', 'groups', 'exceptions', 'items', 'sales', 'transit', 'archive', 'log']) if (!Array.isArray(d[k])) d[k] = base[k];
    if (!d.stock) d.stock = { date: '', rows: [] };
    if (!d.adjustments) d.adjustments = {};
    if (!d.meta) d.meta = {};
    if (!Array.isArray(d.users)) d.users = [];
    if (!Array.isArray(d.currencies) || !d.currencies.length) d.currencies = base.currencies;
    if (!d.po || typeof d.po !== 'object') d.po = base.po;
    if (!d.po.orders) d.po.orders = {}; if (!Array.isArray(d.po.imports)) d.po.imports = [];
    if (!Array.isArray(d.shipStages) || !d.shipStages.length) d.shipStages = E.defaultShipStages();
    if (!Array.isArray(d.parties)) d.parties = [];
    if (!Array.isArray(d.trackStatusMap)) d.trackStatusMap = [];
    // ترقية الصلاحيات: المستخدم المطابق لقالب ياخذ إضافات القالب الجديدة (المعاملات الخارجية)
    if ((d.meta.permsV || 1) < 2) {
      for (const u of d.users) {
        const add = u.role === 'admin' ? { perms: ['shipping'], pages: ['ship'] } : u.role === 'purchasing' ? { perms: ['shipping'], pages: ['ship'] } : u.role === 'viewer' ? { perms: [], pages: ['ship'] } : null;
        if (!add) continue;
        if (Array.isArray(u.perms)) u.perms = [...new Set(u.perms.concat(add.perms))];
        if (Array.isArray(u.pages)) u.pages = [...new Set(u.pages.concat(add.pages))];
      }
      d.meta.permsV = 2;
    }
    for (const t of d.types) {
      if (!t.currency) t.currency = /خارج|استيراد/.test(t.name + (t.note || '')) ? 'USD' : 'SAR';
      // مدة التجهيز حتى الشحن: للأنواع بالعملة الأجنبية = فترة التوصيل − مدة الشحن (حتى ما تتغير التواريخ الحالية)
      if (t.prepDays == null) t.prepDays = t.currency !== 'SAR' ? Math.max(0, Math.round(num(t.leadTime) * 30) - (num(d.settings.shipTransitDays) || 30)) : 0;
    }
    for (const it of d.items) { if (!Array.isArray(it.units)) it.units = []; }
    return d;
  }

  // ================= الجداول =================
  // cols: [{k, h, v:(r)=>value, f:(r)=>html, n:bool, cls, nosort}]
  function table(id, cols, rows, o = {}) {
    if (o.static) { o.pageSize = Infinity; cols = cols.map(c => Object.assign({}, c, { nosort: true })); }
    const t = ui.tables[id] || (ui.tables[id] = { page: 0, sort: o.sort || null, dir: o.dir || -1, filters: {} });
    if (!t.filters) t.filters = {};
    const canFilter = !o.static && !o.nofilter && !ui.printing;
    const filterable = c => !NOFILTER.includes(c.k);
    let data = rows;
    const active = Object.entries(t.filters).filter(([k, v]) => v && String(v).trim() && cols.some(c => c.k === k));
    if (active.length) {
      const tests = active.map(([k, v]) => { const col = cols.find(c => c.k === k); return { get: colValue(col), test: makeTest(v) }; });
      data = data.filter(r => tests.every(x => x.test(x.get(r))));
    }
    if (t.sort) {
      const col = cols.find(c => c.k === t.sort);
      if (col) {
        const val = col.v || (r => r[col.k]);
        data = data.slice().sort((a, b) => {
          const x = val(a), y = val(b);
          if (x == null && y == null) return 0; if (x == null || x === '') return 1; if (y == null || y === '') return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * t.dir;
          return String(x).localeCompare(String(y), 'ar') * t.dir;
        });
      }
    }
    ui.tableRows[id] = data;
    ui.tableCols = ui.tableCols || {}; ui.tableCols[id] = cols;
    if (o.onRow) ui.rowHandlers[id] = o.onRow;
    const size = ui.printing ? Infinity : (o.pageSize || 100);
    const pages = Math.max(1, Math.ceil(data.length / size));
    if (t.page >= pages) t.page = pages - 1;
    const start = size === Infinity ? 0 : t.page * size;
    const slice = data.slice(start, start + size);
    const fRow = canFilter ? `<tr class="frow no-print">${cols.map(c => `<th>${filterable(c) ? `<input id="flt_${id}_${c.k}" data-colf="${id}" data-k="${c.k}" value="${esc(t.filters[c.k] || '')}" placeholder="${c.n ? '>0' : 'فلتر'}" title="${c.n ? 'رقم: 100 أو >100 أو <5 أو >=1 أو 10..50' : 'نص يحتوي — اكتب !نص للاستبعاد، = للمطابقة التامة، أو (فارغ)'}">` : ''}</th>`).join('')}</tr>` : '';
    const clearBtn = active.length ? `<button class="sm" data-act="clearColF" data-t="${id}">مسح فلاتر الأعمدة (${active.length})</button> ` : '';
    const head = cols.map(c => `<th class="${c.n ? 'n' : ''} ${c.nosort ? '' : 'sortable'}" ${c.nosort ? '' : `data-act="sort" data-t="${id}" data-k="${c.k}"`} ${c.title ? `title="${esc(c.title)}"` : ''}>${c.h}${t.sort === c.k ? (t.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = slice.map((r, i) => `<tr ${o.onRow ? `class="click" data-act="row" data-t="${id}" data-i="${start + i}"` : ''}>${cols.map(c => {
      const v = c.f ? c.f(r, start + i) : (c.v ? c.v(r) : r[c.k]);
      return `<td class="${c.n ? 'n' : ''} ${c.cls || ''}">${c.f ? v : esc(c.n && typeof v === 'number' ? fmt(v, c.d || 0) : v)}</td>`;
    }).join('')}</tr>`).join('');
    const foot = o.foot ? `<tfoot><tr>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${o.foot[c.k] != null ? o.foot[c.k] : ''}</td>`).join('')}</tr></tfoot>` : '';
    const pager = pages > 1 ? `<div class="pager no-print">${start + 1}–${Math.min(start + size, data.length)} من ${fmt(data.length)}
      <button class="sm" data-act="page" data-t="${id}" data-p="0" ${t.page === 0 ? 'disabled' : ''}>الأول</button>
      <button class="sm" data-act="page" data-t="${id}" data-p="${t.page - 1}" ${t.page === 0 ? 'disabled' : ''}>السابق</button>
      <span>صفحة ${t.page + 1} / ${pages}</span>
      <button class="sm" data-act="page" data-t="${id}" data-p="${t.page + 1}" ${t.page >= pages - 1 ? 'disabled' : ''}>التالي</button>
      <button class="sm" data-act="page" data-t="${id}" data-p="${pages - 1}" ${t.page >= pages - 1 ? 'disabled' : ''}>الأخير</button></div>` : (data.length ? `<div class="pager no-print">${fmt(data.length)} سطر</div>` : '');
    const empty = !data.length ? `<div class="empty">${o.empty || 'لا توجد بيانات'}</div>` : '';
    if (clearBtn && !pager) { /* */ }
    return `${clearBtn ? `<div class="toolbar no-print" style="margin:0 0 6px">${clearBtn}<span class="small">${fmt(data.length)} من ${fmt(rows.length)} سطر</span></div>` : ''}<div class="tbl-wrap ${o.short ? 'short' : ''}"><table class="t"><thead><tr>${head}</tr>${fRow}</thead><tbody>${body}</tbody>${foot}</table>${empty}</div>${pager}`;
  }

  function colFiltered(id, cols, rows) {
    const t = ui.tables[id];
    if (!t || !t.filters) return rows;
    const tests = Object.entries(t.filters).filter(([k, v]) => v && String(v).trim() && cols.some(c => c.k === k))
      .map(([k, v]) => ({ get: colValue(cols.find(c => c.k === k)), test: makeTest(v) }));
    return tests.length ? rows.filter(r => tests.every(x => x.test(x.get(r)))) : rows;
  }
  const NOFILTER = ['idx', 'i', 'act', 'del', 'fix', 'go', 'chk', 'delta', 'reason', 'ok'];
  function colValue(col) {
    if (col.v) return col.v;
    if (col.k === 'active') return r => r.active !== false ? 'يعمل' : 'لا يعمل';
    if (col.k === 'autoAdded') return r => r.autoAdded ? 'غير مصنف جديد' : '';
    if (col.k === 'service') return r => r.service * 100;
    return r => r[col.k];
  }
  const normTxt = x => String(x == null ? '' : x).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
  function makeTest(raw) {
    const q = String(raw).trim();
    let m;
    if ((m = q.match(/^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/))) { const a = num(m[1]), b = num(m[2]); return v => typeof v === 'number' && v >= a && v <= b; }
    if ((m = q.match(/^(>=|<=|<>|>|<|=)\s*(-?[\d.,]+)$/))) {
      const n = num(m[2]), op = m[1];
      return v => { if (typeof v !== 'number' || !isFinite(v)) return false; const x = Math.round(v * 1e6) / 1e6; return op === '>' ? x > n : op === '<' ? x < n : op === '>=' ? x >= n : op === '<=' ? x <= n : op === '<>' ? x !== n : Math.abs(x - n) < 1e-6; };
    }
    if (q === '(فارغ)' || q === '(blank)') return v => v == null || v === '' || (Array.isArray(v) && !v.length);
    if (q.startsWith('!')) { const t = normTxt(q.slice(1)); return v => !normTxt(Array.isArray(v) ? v.join(' ') : v).includes(t); }
    if (q.startsWith('=')) { const t = normTxt(q.slice(1)); return v => normTxt(v) === t; }
    if (/^-?[\d.,]+$/.test(q)) { const n = num(q); const t = normTxt(q); return v => typeof v === 'number' ? Math.abs(v - n) < 1e-6 || String(v).includes(q) : normTxt(v).includes(t); }
    const t = normTxt(q);
    return v => normTxt(Array.isArray(v) ? v.join(' ') : v).includes(t);
  }

  // ================= التنقل =================
  const NAV = [
    { id: 'dashboard', t: 'لوحة الطلب', i: '▦' },
    { id: 'cycle', t: 'دورة الشراء الشهري', i: '↻' },
    { id: 'order', t: 'قائمة الطلب', i: '☰' },
    { id: 'calc', t: 'الحساب التفصيلي', i: '∑' },
    { id: 'checks', t: 'الفحوصات', i: '✓' },
    { sep: true },
    { id: 'items', t: 'الأصناف', i: '▤' },
    { id: 'data', t: 'المبيعات والمخزون', i: '⇅' },
    { id: 'po', t: 'أوامر الشراء والكاش', i: '⛴' },
    { id: 'ship', t: 'المعاملات الخارجية', i: '🚢' },
    { id: 'archive', t: 'الأرشيف', i: '▣' },
    { id: 'settings', t: 'الإعدادات', i: '⚙' },
    { id: 'users', t: 'المستخدمين', i: '👤', admin: true }
  ];
  function renderNav() {
    const auto = res ? res.rows.filter(r => r.autoAdded).length : 0;
    $('#nav').innerHTML = NAV.filter(n => n.sep || canSee(n.id)).filter((n, i, a) => !(n.sep && (i === 0 || i === a.length - 1 || a[i - 1].sep))).map(n => {
      if (n.sep) return '<div class="nav-sep"></div>';
      let badge = '';
      if (n.id === 'checks' && res) badge = res.blocking ? `<span class="badge">${res.blocking}</span>` : (res.warnings ? `<span class="badge w">${res.warnings}</span>` : '');
      if (n.id === 'items' && auto) badge = `<span class="badge w" title="غير مصنف — مضاف تلقائيًا">${auto}</span>`;
      return `<div class="nav-item ${ui.page === n.id ? 'active' : ''}" data-act="nav" data-p="${n.id}"><span class="ico">${n.i}</span><span>${n.t}</span>${badge}</div>`;
    }).join('');
    const s = db.settings;
    $('#sideFoot').innerHTML = (s.lastMonth
      ? `آخر شهر مبيعات: <b>${monthLabel(s.lastMonth)}</b><br>شهر الطلب: <b>${monthLabel(res.orderMonth)}</b><br>المخزون: ${esc(db.stock.date || s.stockDate || '—')}<br>${fmt(db.items.length)} صنف`
      : 'لا توجد بيانات بعد') +
      `<div class="userbox"><b>${esc(ui.user.name)}</b> — ${roleLabel(ui.user)}<br>${ui.readOnly ? '🔒 للعرض فقط' : '✎ وضع التعديل'}${ui.cfg && !ui.cfg.isDefault ? '<br>📁 مجلد مشترك' : ''}
        <div class="side-btns"><button class="sm" data-act="checkUpdate">فحص التحديثات</button><button class="sm" data-act="myPassword">كلمة المرور</button><button class="sm" data-act="logout">خروج</button></div>
        <div class="small" style="opacity:.7">نسخة رقم ${ui.cfg ? (String(ui.cfg.version).split('.').pop() === '0' ? 'تطوير' : String(ui.cfg.version).split('.').pop()) : ''}</div></div>`;
  }

  function render() {
    const ae = document.activeElement;
    const focusId = ae && ae.id && $('#main').contains(ae) ? ae.id : null;
    const selStart = focusId && ae.selectionStart != null ? ae.selectionStart : null;
    const scroller = $('#main .tbl-wrap');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    if (!ui.user) { document.body.classList.add('auth'); $('#main').innerHTML = pageAuth(); return; }
    document.body.classList.remove('auth');
    document.body.classList.toggle('ro', ui.readOnly);
    if (!canSee(ui.page)) ui.page = (SECTIONS.find(x => canSee(x[0])) || ['dashboard'])[0];
    renderNav();
    const fn = PAGES[ui.page] || PAGES.dashboard;
    const banner = ui.readOnly ? `<div class="banner warn no-print"><span class="grow">${!canEditAnything(ui.user) ? '👁 وضع العرض فقط (صلاحياتك عرض وتصدير)' : `🔒 للعرض فقط — البيانات مفتوحة للتعديل عند <b>${esc((ui.lockHolder && (ui.lockHolder.name || ui.lockHolder.user)) || '—')}</b> على جهاز ${esc((ui.lockHolder && ui.lockHolder.machine) || '—')}. سيتحدث العرض تلقائيًا، وتحصل على التعديل أول ما يغلق البرنامج.`}</span>${canEditAnything(ui.user) ? '<button class="sm" data-act="tryLock">محاولة التعديل الآن</button>' : ''}</div>` : '';
    $('#main').innerHTML = banner + (!(ui.user.pages || []).length ? '<div class="empty"><h2>لا توجد أقسام متاحة لك</h2>تواصل مع المدير لإضافة أقسام لحسابك.</div>' : !db.items.length && !['settings', 'items', 'users', 'po'].includes(ui.page) && (canSee('cycle') || canSee('items')) ? pageWelcome() : fn());
    const actions = $('#main .page-head .actions');
    const exp = EXPORTS[ui.page];
    if (exp && $('#main .page-head')) {
      const box = actions || (() => { const d = document.createElement('div'); d.className = 'actions'; $('#main .page-head').appendChild(d); return d; })();
      box.insertAdjacentHTML('afterbegin', `${exp.excel ? '<button data-act="pgExcel">تصدير Excel</button>' : ''}${exp.pdf ? '<button data-act="pgPdf">PDF</button><button data-act="pgPrint">طباعة</button>' : ''}`);
    }
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (e) { /* */ } }
    }
    const info = document.getElementById('appInfo');
    if (info && ui.cfg) info.textContent = `النسخ الاحتياطية على هذا الجهاز: ${ui.cfg.backupDir}`;
    const sc2 = $('#main .tbl-wrap');
    if (sc2 && ui.keepScroll) sc2.scrollTop = scrollTop;
    ui.keepScroll = false;
  }
  function go(page) {
    if (ui.user && !canSee(page)) { toast('هذا القسم غير متاح لك', 'bad'); return; }
    ui.page = page; $('#main').scrollTop = 0; render();
  }

  // ================= المستخدمين والصلاحيات =================
  function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  async function hashPw(pw, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
    return hex(bits);
  }
  async function makeUser(username, name, role, pw) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { username: username.trim().toLowerCase(), name: name.trim() || username.trim(), role, perms: (ROLE_TEMPLATES[role] || ROLE_TEMPLATES.viewer).perms.slice(), pages: (ROLE_TEMPLATES[role] || ROLE_TEMPLATES.viewer).pages.slice(), salt, hash: await hashPw(pw, salt), active: true, createdAt: nowStamp() };
  }
  // التعديل يحتاج الصلاحية + قفل التعديل. العرض متاح للجميع.
  const has = perm => !!ui.user && userPerms(ui.user).includes(perm);
  function can(perm) {
    if (!ui.user) return false;
    if (perm === 'view') return true;
    if (perm === 'export') return has('export');
    if (ui.readOnly) return false;
    return has(perm);
  }
  function deny(perm) {
    if (ui.readOnly && has(perm)) toast('البرنامج في وضع العرض فقط — مستخدم آخر يعدّل الآن', 'bad');
    else { const p = PERMS.find(x => x[0] === perm); toast('لا تملك صلاحية: ' + (p ? p[1] : perm), 'bad'); }
  }
  const PERM = {
    newItem: 'items', bulkEdit: 'items', defineUnit: 'items',
    delMonth: 'import_data', clearTransit: 'import_data', delTransit: 'import_data', addTransit: 'import_data',
    importLegacy: 'data_admin', restoreBackup: 'data_admin', resetAll: 'data_admin', archDel: 'data_admin', chooseShared: 'data_admin', resetDataDir: 'data_admin',
    approve: 'approve',
    addType: 'settings', delType: 'settings', addExc: 'settings', delExc: 'settings', addGroup: 'settings', renGroup: 'settings', delGroup: 'settings',     addCur: 'settings', delCur: 'settings', stgMove: 'settings', stgDel: 'settings', stgAdd: 'settings', stgReset: 'settings', partyAdd: 'shipping', partyDel: 'shipping', partyMap: 'shipping', shipNext: 'shipping',
    addUser: 'users', editUser: 'users',
    pgExcel: 'export', pgPdf: 'export', pgPrint: 'export', tpl: 'export', tplItemsFull: 'export', exportBackup: 'export',
    poReceive: 'po_import', poReopen: 'po_import', clearManualTransit: 'import_data', poQuickRecv: 'po_import', poQuickShip: 'po_import', poQuickPay: 'po_payments', poNew: 'po_payments'
  };
  const CHG_PERM = { stg: 'settings', party: 'shipping', adj: 'adjust', reason: 'adjust', stockDate: 'import_data', set: 'settings', setBool: 'settings', setPct: 'settings', type: 'settings', cls: 'settings', exc: 'settings', cur: 'settings' };
  const IMPORT_PERM = { track: 'shipping', items: 'items', sales: 'import_data', stock: 'import_data', transit: 'import_data', po: 'po_import', poPay: 'po_payments' };

  function pageAuth() {
    const first = !db.users.length;
    let last = ''; try { last = localStorage.getItem('pp_last_user') || ''; } catch (e) { /* */ }
    return `<div class="card auth-card">
      <h1 style="margin:0 0 4px">نظام تخطيط المشتريات</h1>
      <div class="small" style="margin-bottom:16px">${first ? 'أول تشغيل — أنشئ حساب المدير' : 'تسجيل الدخول'}${ui.cfg && !ui.cfg.isDefault ? ' — البيانات: ' + esc(ui.cfg.dataDir) : ''}</div>
      ${ui.cfg && !ui.cfg.reachable ? `<div class="banner bad">مجلد البيانات غير متاح: ${esc(ui.cfg.dataDir)} — تأكد أن Google Drive يعمل ومتزامن.<button class="sm" data-act="resetDataDir">استخدام المجلد المحلي</button></div>` : ''}
      <form id="authForm" class="form" style="grid-template-columns:1fr">
        ${first ? '<label class="f">الاسم الظاهر<input id="au_name" required></label>' : ''}
        <label class="f">اسم المستخدم<input id="au_user" value="${esc(first ? 'admin' : last)}" required autocomplete="username"></label>
        <label class="f">كلمة المرور<input id="au_pw" type="password" required autocomplete="current-password"></label>
        ${first ? '<label class="f">تأكيد كلمة المرور<input id="au_pw2" type="password" required></label>' : ''}
        <button class="primary" type="submit">${first ? 'إنشاء الحساب والدخول' : 'دخول'}</button>
      </form>
      ${first ? `<p class="small" style="margin-top:14px">البيانات موجودة على درايف مشترك؟ <button class="link" data-act="chooseShared">اختر المجلد المشترك</button></p>` : ''}
    </div>`;
  }
  async function submitAuth(e) {
    e.preventDefault();
    const u = $('#au_user').value.trim().toLowerCase(), pw = $('#au_pw').value;
    if (!db.users.length) {
      if (pw.length < 4) return toast('كلمة المرور قصيرة (4 أحرف على الأقل)', 'bad');
      if (pw !== $('#au_pw2').value) return toast('كلمتا المرور غير متطابقتين', 'bad');
      const nu = await makeUser(u, $('#au_name').value, 'admin', pw);
      db.users.push(nu);
      await startSession(nu, true);
      return;
    }
    const usr = db.users.find(x => x.username === u && x.active !== false);
    if (!usr || await hashPw(pw, usr.salt) !== usr.hash) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'bad');
    await startSession(usr, false);
  }
  async function startSession(usr, created) {
    ui.user = { username: usr.username, name: usr.name, role: usr.role, perms: userPerms(usr).slice(), pages: userPages(usr) };
    ui.page = (SECTIONS.find(x => canSee(x[0])) || ['dashboard'])[0];
    try { localStorage.setItem('pp_last_user', usr.username); } catch (e) { /* */ }
    ui.readOnly = true; ui.lockHolder = null;
    if (canEditAnything(usr)) await tryLock(true);
    if (created) {
      if (ui.readOnly) { toast('لا يمكن إنشاء المستخدم — البيانات مقفلة عند مستخدم آخر', 'bad'); ui.user = null; db.users = []; render(); return; }
      dirty = true; await saveNow();
    }
    if (!ui.readOnly) { log('تسجيل دخول'); dirty = true; scheduleSave(); }
    recompute(); render();
    checkUpdate(true);
  }
  async function tryLock(silent) {
    if (!ui.user || !canEditAnything(ui.user)) return;
    const r = await api.acquireLock(ui.user.username, ui.user.name);
    if (r.ok) {
      const wasRO = ui.readOnly;
      ui.readOnly = false; ui.lockHolder = null;
      if (wasRO) await reloadDb(true);
      if (!silent) toast('✎ أصبحت لديك صلاحية التعديل', 'ok');
    } else {
      await enterReadOnly(r.holder);
      if (!silent) toast(`البيانات مفتوحة للتعديل عند ${r.holder.name || r.holder.user}`, 'bad');
    }
  }
  async function enterReadOnly(holder) { ui.readOnly = true; ui.lockHolder = holder || ui.lockHolder; render(); }
  async function reloadDb(keepUser) {
    const r = await api.loadDb();
    if (r.json) { const users = db.users; db = migrate(JSON.parse(r.json)); if (!db.users.length && keepUser) db.users = users; }
    ui.mtime = r.mtime; dirty = false;
    recompute(); render();
  }
  // في وضع العرض: متابعة تغييرات الملف المشترك ومحاولة أخذ القفل
  setInterval(async () => {
    if (!ui.user || !ui.readOnly) return;
    try {
      const st = await api.statDb();
      if (st.mtime && Math.abs(st.mtime - ui.mtime) > 1) { await reloadDb(); toast('تم تحديث البيانات من الملف المشترك'); }
      if (canEditAnything(ui.user)) {
        if (!st.lock || (Date.now() - new Date(st.lock.at).getTime() > 5 * 60 * 1000)) await tryLock(false);
        else if (!ui.lockHolder || ui.lockHolder.user !== st.lock.user) { ui.lockHolder = st.lock; render(); }
      }
    } catch (e) { /* */ }
  }, 20000);

  async function checkUpdate(silent) {
    let r;
    try { r = await api.checkUpdate(); } catch (e) { if (!silent) toast('تعذر فحص التحديثات: ' + e.message, 'bad'); return; }
    if (!r.ok) {
      if (!silent) toast(r.reason === 'noRelease' ? 'لا توجد نسخة منشورة بعد في مستودع التنزيلات' : 'تعذر الاتصال بـ GitHub لفحص التحديثات — تأكد من الإنترنت', 'bad');
      return;
    }
    if (!r.newer) { if (!silent) toast(r.dev ? `نسخة تطوير (${r.current}) — آخر نسخة منشورة رقم ${r.latest}` : `✓ أنت على آخر نسخة (رقم ${r.build})`, 'ok'); return; }
    modal({
      title: '⬆ يوجد تحديث جديد', size: 'narrow',
      body: `<p>نسختك: <b>${r.build}</b> — الجديدة: <b>${r.latest}</b>${r.date ? ' (' + esc(r.date) + ')' : ''}</p>${r.notes ? `<div class="formula" style="white-space:pre-wrap;max-height:200px;overflow:auto">${esc(r.notes)}</div>` : ''}<p class="small">البيانات لا تتأثر بالتحديث. البرنامج ينزّل ملف التثبيت ثم يُغلق ويفتح التثبيت.</p><div id="upd_prog" class="small"></div>`,
      foot: `<button class="primary" data-ok ${r.installerExists ? '' : 'disabled'}>تنزيل وتثبيت</button><button data-close>لاحقًا</button>`,
      onMount: m => {
        api.onUpdateProgress(p => { const el = document.getElementById('upd_prog'); if (el) el.textContent = 'جارِ التنزيل… ' + p + '%'; });
        m.q('[data-ok]').onclick = async () => {
          m.q('[data-ok]').disabled = true;
          if (!ui.readOnly) { dirty = true; await saveNow(); }
          const x = await api.installUpdate();
          if (!x.ok) { toast('تعذر التحديث: ' + (x.error || ''), 'bad'); m.q('[data-ok]').disabled = false; }
        };
      }
    });
  }

  // ================= التصدير العام لكل شاشة =================
  const EXPORTS = {
    dashboard: { pdf: true, excel: true, tables: [['dashType', 'حسب النوع'], ['dashCls', 'حسب التصنيف'], ['dashGrp', 'حسب المجموعة']], title: () => 'لوحة الطلب ' + monthLabel(res.orderMonth) },
    order: { pdf: true, excel: true, custom: () => exportOrder(), title: () => 'طلب-الشراء-' + res.orderMonth },
    calc: { excel: true, custom: () => exportCalc() },
    checks: { pdf: true, excel: true, tables: [['checks', 'الفحوصات']], title: () => 'الفحوصات' },
    items: { pdf: true, excel: true, tables: [['items', 'الأصناف']], title: () => 'الأصناف' },
    data: { pdf: true, excel: true, tables: () => [[{ sales: 'salesMat', stock: 'stockT', transit: 'transitT', units: 'unitsT' }[ui.dataTab], { sales: 'المبيعات', stock: 'المخزون', transit: 'بالطريق', units: 'وحدات غير معرفة' }[ui.dataTab]]], title: () => ({ sales: 'المبيعات', stock: 'المخزون', transit: 'بالطريق', units: 'وحدات غير معرفة' }[ui.dataTab]) },
    archive: { pdf: true, excel: true, tables: [['arch', 'الأرشيف']], title: () => 'أرشيف الطلبات' },
    ship: { pdf: true, excel: true, tables: [['shipList', 'المعاملات الخارجية']], title: () => 'المعاملات الخارجية ' + today() },
    po: { pdf: true, excel: true, tables: () => ui.poTab === 'cash' ? [['cashBuckets', 'الكاش حسب الشهر'], ['cashList', 'الكاش المطلوب']] : ui.poTab === 'imports' ? [['poImports', 'سجل الاستيراد']] : [['poList', 'أوامر الشراء']], title: () => ui.poTab === 'cash' ? 'الكاش المطلوب ' + today() : 'أوامر الشراء ' + today() },
    users: { pdf: true, excel: true, tables: [['users', 'المستخدمين']], title: () => 'المستخدمين' }
  };
  function cellExport(c, r, i) {
    if (c.k === 'idx' || c.k === 'i' && !('i' in r)) return i + 1;
    let v = colValue(c)(r);
    if (Array.isArray(v)) v = v.join('؛ ');
    if (typeof v === 'boolean') v = v ? 'نعم' : '';
    if (typeof v === 'number' && !isFinite(v)) v = null;
    if (v != null && typeof v === 'object') v = null;
    return v;
  }
  function exportTables(list, name) {
    const SKIP = ['act', 'del', 'fix', 'go', 'chk'];
    const sheets = list.map(([id, title]) => {
      const cols = (ui.tableCols[id] || []).filter(c => !SKIP.includes(c.k));
      const rows = ui.tableRows[id] || [];
      return {
        name: title, title: title + (db.settings.companyName ? ' — ' + db.settings.companyName : ''), subtitle: 'تاريخ التصدير ' + today(),
        columns: cols.map(c => ({ header: c.h.replace(/<[^>]+>/g, ''), key: c.k, width: c.k === 'name' ? 40 : c.cls === 'wrap' ? 30 : 13, fmt: c.n ? (c.d ? '#,##0.00' : '#,##0') : undefined })),
        rows: rows.map((r, i) => { const o = {}; cols.forEach(c => { o[c.k] = cellExport(c, r, i); }); return o; })
      };
    });
    exportSpec({ sheets }, name);
  }
  async function printOrPdfPage(pdf) {
    const exp = EXPORTS[ui.page] || {};
    ui.printing = true; render();
    try {
      if (pdf) { const p = await api.savePdf((exp.title ? exp.title() : ui.page) + '-' + today(), true); if (p) toast('تم الحفظ: ' + p, 'ok'); }
      else await api.print();
    } finally { ui.printing = false; render(); }
  }

  function pageUsers() {
    return `<div class="page-head"><div><h1>المستخدمين والصلاحيات</h1><div class="sub">لكل مستخدم صلاحيات تختارها بنفسك — القوالب (مدير، مشتريات، محاسب موردين، مشاهد) تعبّيها بضغطة وتقدر تعدّل بعدها</div></div>
      <div class="actions"><button class="primary" data-act="addUser">إضافة مستخدم</button></div></div>
      ${table('users', [
        { k: 'username', h: 'اسم المستخدم' }, { k: 'name', h: 'الاسم' }, { k: 'role', h: 'الدور', v: u => roleLabel(u) },
        { k: 'pages', h: 'الأقسام', cls: 'wrap', v: u => userPages(u).map(p => (SECTIONS.find(x => x[0] === p) || [p, p])[1]).join('، ') },
        { k: 'perms', h: 'الصلاحيات', cls: 'wrap', v: u => userPerms(u).map(p => (PERMS.find(x => x[0] === p) || [p, p])[1]).join('، ') },
        { k: 'active', h: 'الحالة', v: u => u.active !== false ? 'نشط' : 'موقوف' }, { k: 'createdAt', h: 'تاريخ الإنشاء', v: u => (u.createdAt || '').slice(0, 10) },
        { k: 'act', h: '', nosort: true, f: u => `<button class="sm" data-act="editUser" data-k="${esc(u.username)}">تعديل</button>` }
      ], db.users, { short: true })}
      <div class="card" style="margin-top:16px"><h2>سجل العمليات</h2>${table('log', [
        { k: 'at', h: 'الوقت', v: l => (l.at || '').replace('T', ' ').slice(0, 16) }, { k: 'user', h: 'المستخدم' }, { k: 'msg', h: 'العملية', cls: 'wrap' }
      ], (db.log || []).slice().reverse(), { pageSize: 50 })}</div>`;
  }
  function userModal(username) {
    const u = username ? db.users.find(x => x.username === username) : null;
    const cur = u ? userPerms(u) : ROLE_TEMPLATES.purchasing.perms;
    const curPages = u ? userPages(u) : ROLE_TEMPLATES.purchasing.pages;
    modal({
      title: u ? 'تعديل مستخدم ' + esc(u.username) : 'إضافة مستخدم',
      body: `<div class="form f2">
        <label class="f">اسم المستخدم (للدخول)<input id="u_user" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''}></label>
        <label class="f">الاسم الظاهر<input id="u_name" value="${esc(u ? u.name : '')}"></label>
        <label class="f">${u ? 'كلمة مرور جديدة (اتركها فارغة بدون تغيير)' : 'كلمة المرور'}<input id="u_pw" type="password"></label>
        <label class="f">قالب صلاحيات (يعبّي الخانات تحت)<select id="u_tpl"><option value="">— اختر قالب —</option>${Object.entries(ROLE_TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></label>
        ${u ? `<label class="chk full"><input type="checkbox" id="u_active" ${u.active !== false ? 'checked' : ''}> المستخدم نشط (إلغاء التحديد يمنعه من الدخول)</label>` : ''}
      </div>
      <h3>الأقسام اللي تظهر له <span class="small">(اللي مو معلّم ما يشوفه أبدًا)</span></h3>
      <div class="perm-grid sec-grid">${SECTIONS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-page="${k}" ${curPages.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <h3>الصلاحيات <span class="small">(وش يقدر يعدّل داخل أقسامه — كل صلاحية تعلّم قسمها تلقائيًا)</span></h3>
      <div class="perm-grid">${PERMS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-perm="${k}" ${cur.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="small" id="u_rolelbl" style="margin-top:8px"></div>`,
      foot: `<button class="primary" data-ok>حفظ</button><button data-close>إلغاء</button>`,
      onMount: m => {
        const perms = () => [...m.qa('[data-perm]')].filter(x => x.checked).map(x => x.dataset.perm);
        const pages = () => [...m.qa('[data-page]')].filter(x => x.checked).map(x => x.dataset.page);
        // الصلاحية تعلّم قسمها، والقسم المطلوب لصلاحية معلّمة ما ينشال
        const syncPages = () => { const need = new Set(perms().flatMap(p => PERM_SECTIONS[p] || [])); m.qa('[data-page]').forEach(x => { if (need.has(x.dataset.page)) x.checked = true; x.disabled = need.has(x.dataset.page); x.closest('label').title = x.disabled ? 'مطلوب لصلاحية معلّمة' : ''; }); };
        // القائمة تعكس الخانات دائمًا: اسم القالب المطابق، أو «— اختر قالب —» إذا الخانات مخصصة
        const lbl = () => {
          const ps = perms().slice().sort().join(',');
          const match = Object.entries(ROLE_TEMPLATES).find(([, t]) => t.perms.slice().sort().join(',') === ps);
          m.q('#u_tpl').value = match ? match[0] : '';
          m.q('#u_rolelbl').innerHTML = 'الدور: <b>' + roleLabel({ perms: perms() }) + '</b> — الخانات المعلّمة هي اللي تنحفظ (' + pages().length + ' قسم، ' + perms().length + ' صلاحية)';
        };
        syncPages();
        lbl();
        m.q('.modal-body').addEventListener('change', e => { if (e.target.dataset.perm) { syncPages(); lbl(); } else if (e.target.dataset.page) lbl(); });
        m.q('#u_tpl').onchange = e => { const t = ROLE_TEMPLATES[e.target.value]; if (!t) return; m.qa('[data-perm]').forEach(x => { x.checked = t.perms.includes(x.dataset.perm); }); m.qa('[data-page]').forEach(x => { x.checked = t.pages.includes(x.dataset.page); }); syncPages(); lbl(); };
        m.q('[data-ok]').onclick = async () => {
          const pw = m.q('#u_pw').value, name = m.q('#u_name').value.trim(), ps = perms();
          const role = (Object.entries(ROLE_TEMPLATES).find(([, t]) => t.perms.slice().sort().join(',') === ps.slice().sort().join(',')) || ['custom'])[0];
          const others = db.users.filter(x => x !== u && x.active !== false && userPerms(x).includes('users'));
          if (u) {
            const act = m.q('#u_active').checked;
            if (!others.length && (!act || !ps.includes('users'))) return toast('لازم يبقى مستخدم نشط واحد على الأقل عنده صلاحية «إدارة المستخدمين»', 'bad');
            u.role = role; u.perms = ps; u.pages = withRequired(pages(), ps); u.name = name || u.username; u.active = act;
            if (pw) { if (pw.length < 4) return toast('كلمة المرور قصيرة', 'bad'); u.salt = hex(crypto.getRandomValues(new Uint8Array(16))); u.hash = await hashPw(pw, u.salt); }
            if (u.username === ui.user.username) { ui.user.perms = ps.slice(); ui.user.pages = u.pages.slice(); }
            log('تعديل المستخدم ' + u.username + ' (' + roleLabel(u) + ')');
          } else {
            const un = m.q('#u_user').value.trim().toLowerCase();
            if (!/^[\w.\-\u0600-\u06FF]{2,}$/.test(un)) return toast('اسم مستخدم غير صالح', 'bad');
            if (db.users.some(x => x.username === un)) return toast('اسم المستخدم موجود', 'bad');
            if (pw.length < 4) return toast('كلمة المرور قصيرة (4 أحرف على الأقل)', 'bad');
            const nu = await makeUser(un, name, role === 'custom' ? 'viewer' : role, pw);
            nu.role = role; nu.perms = ps; nu.pages = withRequired(pages(), ps);
            db.users.push(nu);
            log('إضافة المستخدم ' + un + ' (' + roleLabel(nu) + ')');
          }
          m.close(); commit();
        };
      }
    });
  }
  function myPassword() {
    modal({
      title: 'تغيير كلمة المرور', size: 'narrow',
      body: `<div class="form" style="grid-template-columns:1fr"><label class="f">كلمة المرور الحالية<input id="p_old" type="password"></label><label class="f">الجديدة<input id="p_new" type="password"></label><label class="f">تأكيد الجديدة<input id="p_new2" type="password"></label></div>`,
      foot: `<button class="primary" data-ok>حفظ</button><button data-close>إلغاء</button>`,
      onMount: m => {
        m.q('[data-ok]').onclick = async () => {
          if (ui.readOnly) return toast('البرنامج في وضع العرض فقط — مستخدم آخر يعدّل الآن', 'bad');
          const u = db.users.find(x => x.username === ui.user.username);
          if (!u || await hashPw(m.q('#p_old').value, u.salt) !== u.hash) return toast('كلمة المرور الحالية غير صحيحة', 'bad');
          const n = m.q('#p_new').value;
          if (n.length < 4 || n !== m.q('#p_new2').value) return toast('كلمة المرور الجديدة قصيرة أو غير متطابقة', 'bad');
          u.salt = hex(crypto.getRandomValues(new Uint8Array(16))); u.hash = await hashPw(n, u.salt);
          log('تغيير كلمة المرور'); m.close(); commit(); toast('تم التغيير', 'ok');
        };
      }
    });
  }

  // ================= الصفحات =================
  const PAGES = {};
  PAGES.users = () => has('users') ? pageUsers() : '<div class="empty">لا تملك صلاحية</div>';

  function pageWelcome() {
    return `<div class="card" style="max-width:820px;margin:40px auto">
      <h1 style="margin-top:0">مرحبًا بك في نظام تخطيط المشتريات</h1>
      <p class="hint" style="font-size:14px">البرنامج يحسب الطلب الشهري بسياسة <b>Fixed Order Period</b>: الحد الأقصى = المتوسط × (المراجعة + التوصيل) + Z × الانحراف × √(المراجعة + التوصيل) + المخزون الإضافي، ثم يخصم المخزون والبضاعة بالطريق.</p>
      <h3>ابدأ بإحدى الطريقتين:</h3>
      <div class="grid g2">
        <div class="card" style="margin:0"><h2>١. نقل ملف الإكسيل الحالي</h2><p class="hint">اختر ملف «تقرير المشتريات» بنفس هيكله (الأصناف، المبيعات، المخزون، بالطريق، الإعدادات). ينقل كل البيانات والإعدادات والتعديلات اليدوية دفعة واحدة.</p><button class="primary" data-act="importLegacy">استيراد ملف الإكسيل</button></div>
        <div class="card" style="margin:0"><h2>٢. البدء من الصفر</h2><p class="hint">نزّل قالب الأصناف، عبّئه، واستورده. بعدها استورد المبيعات والمخزون من «دورة الشراء الشهري».</p><div class="row-flex"><button data-act="tpl" data-k="items">تحميل قالب الأصناف</button><button class="primary" data-act="import" data-k="items">استيراد الأصناف</button></div></div>
      </div>
      <p class="small" style="margin-top:16px">لديك نسخة احتياطية؟ <button class="link" data-act="restoreBackup">استرجاع نسخة احتياطية</button></p>
    </div>`;
  }

  // ---------- لوحة الطلب ----------
  PAGES.dashboard = function () {
    const s = db.settings, t = res.totals;
    const auto = res.rows.filter(r => r.autoAdded).length;
    const excApplied = res.rows.filter(r => r.excMonths > 0).length;
    const ratio = t.maxValue ? (t.stockValue + t.transitValue) / t.maxValue : 0;
    const typeRows = res.byType;
    const clsRows = db.classes.map(c => Object.assign({ key: c.code, service: c.service }, res.byClass.find(x => x.key === c.code) || { items: 0, ordered: 0, orderValue: 0 }));
    const grpRows = res.byGroup.sort((a, b) => b.orderValue - a.orderValue);
    const archived = db.archive.find(a => a.orderMonth === res.orderMonth);
    return `
    <div class="page-head"><div><h1>لوحة طلب المشتريات — ${monthLabel(res.orderMonth)}</h1>
      <div class="sub">المبيعات من ${monthLabel(res.months[0])} إلى ${monthLabel(res.months[res.months.length - 1])} (${res.months.length} أشهر) — المخزون كما في ${esc(db.stock.date || s.stockDate || '—')} — فترة المراجعة ${s.reviewPeriod} شهر</div></div>
      <div class="actions"><button data-act="nav" data-p="cycle">دورة الشراء الشهري</button><button class="primary" data-act="nav" data-p="order">قائمة الطلب</button></div></div>
    ${res.blocking ? `<div class="banner bad"><span class="grow">✗ يوجد <b>${res.blocking}</b> فحص غير سليم — راجع الفحوصات قبل الاعتماد${res.warnings ? ` (و${res.warnings} تنبيه)` : ''}</span><button class="sm" data-act="nav" data-p="checks">الفحوصات</button></div>`
        : `<div class="banner ok"><span class="grow">✓ البيانات سليمة — يمكن اعتماد الطلب${res.warnings ? ` (يوجد ${res.warnings} تنبيه للمراجعة)` : ''}</span><button class="sm" data-act="nav" data-p="checks">الفحوصات</button></div>`}
    ${auto ? `<div class="banner warn"><span class="grow">⚠ يوجد <b>${auto}</b> صنف «غير مصنف» أُضيف تلقائيًا من الاستيراد — حدّد نوعه ومجموعته ووحداته (النوع يحدد فترة التوصيل)</span><button class="sm" data-act="reviewAuto">مراجعة الأصناف</button></div>` : ''}
    ${excApplied ? `<div class="banner warn"><span class="grow">فترات استثنائية سارية على شهر الطلب ${monthLabel(res.orderMonth)}: تنطبق على <b>${excApplied}</b> صنف</span><button class="sm" data-act="nav" data-p="settings">الإعدادات</button></div>` : ''}
    ${archived ? `<div class="banner ok"><span class="grow">تم اعتماد طلب ${monthLabel(res.orderMonth)} بتاريخ ${esc(archived.approvedAt.slice(0, 10))}${archived.approver ? ' — ' + esc(archived.approver) : ''}</span><button class="sm" data-act="nav" data-p="archive">الأرشيف</button></div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="l">قيمة الطلب</div><div class="v">${money(t.orderValue)}</div><div class="s">${cur()}</div></div>
      <div class="kpi"><div class="l">أصناف مطلوبة</div><div class="v">${fmt(t.ordered)}</div><div class="s">من ${fmt(t.active)} صنف نشط</div></div>
      <div class="kpi"><div class="l">قيمة المخزون</div><div class="v">${money(t.stockValue)}</div><div class="s">${cur()}</div></div>
      <div class="kpi"><div class="l">قيمة بالطريق</div><div class="v">${money(t.transitValue)}</div><div class="s">${cur()}</div></div>
      <div class="kpi"><div class="l">قيمة الحد الأقصى</div><div class="v">${money(t.maxValue)}</div><div class="s">${cur()}</div></div>
      <div class="kpi"><div class="l">المتاح ÷ الحد الأقصى</div><div class="v">${pct(ratio)}</div><div class="s">المخزون + بالطريق</div></div>
    </div>
    ${cashBanner()}
    ${demurrageBanner()}
    <div class="card"><h2>حسب نوع الصنف</h2>${table('dashType', [
        { k: 'key', h: 'النوع' },
        { k: 'active', h: 'نشطة', n: true }, { k: 'ordered', h: 'مطلوبة', n: true },
        { k: 'orderValue', h: 'قيمة الطلب', n: true }, { k: 'stockValue', h: 'المخزون', n: true },
        { k: 'transitValue', h: 'بالطريق', n: true }, { k: 'maxValue', h: 'الحد الأقصى', n: true }
      ], typeRows, { nofilter: true, short: true, sort: 'orderValue', onRow: r => { ui.f.order.type = r.key; go('order'); }, foot: { key: 'الإجمالي', active: fmt(t.active), ordered: fmt(t.ordered), orderValue: money(t.orderValue), stockValue: money(t.stockValue), transitValue: money(t.transitValue), maxValue: money(t.maxValue) } })}
      <p class="small">اضغط على أي سطر لفتح قائمة الطلب مفلترة.</p></div>
    <div class="grid g2">
      <div class="card"><h2>حسب التصنيف</h2>${table('dashCls', [
        { k: 'key', h: 'التصنيف', f: r => `<span class="cls">${r.key}</span>` },
        { k: 'service', h: 'مستوى الخدمة', n: true, f: r => pct(r.service) },
        { k: 'items', h: 'عدد الأصناف', n: true }, { k: 'ordered', h: 'مطلوبة', n: true },
        { k: 'orderValue', h: 'قيمة الطلب', n: true }
      ], clsRows, { nofilter: true, short: true, onRow: r => { ui.f.order.cls = r.key; go('order'); } })}</div>
      <div class="card"><h2>حسب المجموعة الرئيسية</h2>${table('dashGrp', [
        { k: 'key', h: 'المجموعة' }, { k: 'items', h: 'الأصناف', n: true }, { k: 'ordered', h: 'مطلوبة', n: true },
        { k: 'orderValue', h: 'قيمة الطلب', n: true }, { k: 'stockValue', h: 'المخزون', n: true }
      ], grpRows, { nofilter: true, short: true, onRow: r => { ui.f.order.group = r.key; go('order'); } })}</div>
    </div>`;
  };

  // ---------- دورة الشراء الشهري ----------
  PAGES.cycle = function () {
    const s = db.settings, meta = db.meta || {};
    const lastAppr = db.archive.length ? db.archive.map(a => a.approvedAt).sort().pop() : '';
    const after = ts => ts && (!lastAppr || ts > lastAppr);
    const monthsInDb = salesMonths();
    const nextMonth = s.lastMonth ? monthAdd(s.lastMonth, 1) : '';
    const auto = res.rows.filter(r => r.autoAdded).length;
    const archived = db.archive.find(a => a.orderMonth === res.orderMonth);
    const step = (n, done, title, body) => `<div class="card step ${done ? 'done' : ''}"><div class="num">${done ? '✓' : n}</div><div class="body"><h2>${title}</h2>${body}</div></div>`;
    return `
    <div class="page-head"><div><h1>دورة الشراء الشهري</h1><div class="sub">خطوات إعداد طلب الشراء كل شهر — شهر الطلب الحالي: <b>${monthLabel(res.orderMonth) || '—'}</b></div></div></div>
    <div class="steps">
    ${step(1, res.missingMonths.length === 0 && after(meta.salesAt), 'مبيعات الشهر المنتهي', `
      <div class="hint">استورد تقرير مبيعات الشهر من النظام (رقم الصنف، الاسم، الوحدة، الوارد، المنصرف). يُضاف للأشهر السابقة، والمتوسط يؤخذ من آخر ${s.nMonths} أشهر. استيراد شهر موجود يستبدله.</div>
      <div class="row-flex" style="margin-top:10px">
        <button class="primary" data-act="import" data-k="sales">استيراد مبيعات ${nextMonth ? 'شهر ' + monthLabel(nextMonth) : 'شهر'}</button>
        <button data-act="tpl" data-k="sales">تحميل القالب</button>
        <span class="small">آخر شهر في التحليل: <b>${monthLabel(s.lastMonth) || '—'}</b></span>
      </div>
      <div class="month-chips">${monthsInDb.map(m => `<span class="chip ${res.months.includes(m.month) ? 'in' : ''}" title="${fmt(m.rows)} سطر">${monthLabel(m.month)} <span class="small">${fmt(m.rows)}</span></span>`).join('')}</div>
      ${res.missingMonths.length ? `<div class="banner bad" style="margin:10px 0 0">أشهر ناقصة في فترة التحليل: ${res.missingMonths.map(monthLabel).join('، ')}</div>` : ''}`)}
    ${step(2, db.stock.rows.length > 0 && after(meta.stockAt), 'رصيد المخزون يوم إعداد الطلب', `
      <div class="hint">استورد تقرير المخزون (رقم الصنف، الاسم، الوحدة، الكمية، تكلفة الوحدة). يستبدل الرصيد السابق بالكامل.</div>
      <div class="row-flex" style="margin-top:10px"><button class="primary" data-act="import" data-k="stock">استيراد المخزون</button><button data-act="tpl" data-k="stock">تحميل القالب</button>
      <span class="small">الرصيد الحالي: ${fmt(db.stock.rows.length)} سطر — كما في <b>${esc(db.stock.date || '—')}</b></span></div>`)}
    ${step(3, after(meta.transitAt), 'البضاعة بالطريق (لم تصل بعد)', `
      <div class="hint">استورد أوامر الشراء اللي لسه ما وصلت. «استبدال» يمسح القديم، و«إضافة» يضيف ملفًا آخر تحت الموجود (لأكثر من مصدر).</div>
      <div class="row-flex" style="margin-top:10px"><button class="primary" data-act="import" data-k="transit" data-mode="replace">استيراد (استبدال)</button><button data-act="import" data-k="transit" data-mode="append">استيراد (إضافة مصدر)</button><button data-act="tpl" data-k="transit">تحميل القالب</button><button class="danger" data-act="clearTransit">لا يوجد بضاعة بالطريق</button>
      <span class="small">الحالي: ${fmt(db.transit.length)} سطر</span></div>`)}
    ${step(4, auto === 0, 'مراجعة الأصناف الجديدة', `
      <div class="hint">الأصناف اللي ظهرت في المبيعات أو المخزون وما كانت موجودة تُضاف تلقائيًا كـ «غير مصنف» بالنوع الافتراضي (${esc(s.defaultType)}). حدّد نوعها ومجموعتها ووحداتها.</div>
      <div class="row-flex" style="margin-top:10px">${auto ? `<span class="pill warn">${auto} صنف يحتاج تصنيف</span><button class="primary" data-act="reviewAuto">مراجعة</button>` : '<span class="pill ok">لا توجد أصناف جديدة</span>'}<button data-act="nav" data-p="items">الأصناف</button></div>`)}
    ${step(5, res.blocking === 0, 'الفحوصات', `
      <div class="row-flex">${res.blocking ? `<span class="pill bad">${res.blocking} فحص غير سليم</span>` : '<span class="pill ok">كل الفحوصات الأساسية سليمة</span>'}${res.warnings ? `<span class="pill warn">${res.warnings} تنبيه</span>` : ''}<button data-act="nav" data-p="checks">عرض الفحوصات</button></div>`)}
    ${step(6, false, 'مراجعة قائمة الطلب والتعديلات اليدوية', `
      <div class="hint">لو الإدارة قررت كمية مختلفة لصنف، اكتب الفرق (+ أو −) والسبب في قائمة الطلب.</div>
      <div class="row-flex" style="margin-top:10px"><span class="pill brand">${fmt(res.totals.ordered)} صنف — ${money(res.totals.orderValue)} ${cur()}</span><button class="primary" data-act="nav" data-p="order">قائمة الطلب</button></div>`)}
    ${step(7, !!archived, 'اعتماد الطلب وحفظه في الأرشيف', `
      <div class="hint">الاعتماد يحفظ نسخة ثابتة من الطلب (الكميات، التصنيف، الإعدادات) تقدر ترجع لها وتصدرها لاحقًا.</div>
      <div class="row-flex" style="margin-top:10px">${archived ? `<span class="pill ok">معتمد ${esc(archived.approvedAt.slice(0, 10))}</span>` : ''}<button class="ok" data-act="approve">${archived ? 'إعادة الاعتماد' : 'اعتماد طلب ' + monthLabel(res.orderMonth)}</button></div>`)}
    </div>`;
  };

  function salesMonths() {
    const m = new Map();
    for (const r of db.sales) m.set(r.month, (m.get(r.month) || 0) + 1);
    return [...m.entries()].map(([month, rows]) => ({ month, rows })).sort((a, b) => b.month.localeCompare(a.month));
  }

  // ---------- قائمة الطلب ----------
  function orderRows() {
    const f = ui.f.order, q = f.q.trim().toLowerCase();
    return res.rows.filter(r =>
      (f.type === 'الكل' || r.type === f.type) &&
      (f.group === 'الكل' || r.group === f.group) &&
      (f.cls === 'الكل' || r.cls === f.cls) &&
      (f.show === 'all' ? true : f.show === 'adjusted' ? r.delta !== 0 : r.final > 0) &&
      (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.mainItem.toLowerCase().includes(q)));
  }
  const ORDER_COLS = () => [
    { k: 'idx', h: 'م', nosort: true, f: (r, i) => i + 1, n: true },
    { k: 'code', h: 'رقم الصنف' },
    { k: 'name', h: 'اسم الصنف', cls: 'wrap' },
    { k: 'mainItem', h: 'الصنف الرئيسي' },
    { k: 'type', h: 'النوع' },
    { k: 'cls', h: 'التصنيف', f: r => `<span class="cls">${r.cls}</span>${r.clsManual ? ' <span title="تصنيف يدوي — التلقائي ' + r.clsAuto + '">✎</span>' : ''}` },
    { k: 'purchaseUnit', h: 'الوحدة' },
    { k: 'avgP', h: 'متوسط شهري', n: true, v: r => r.avg / r.pf, d: 1 },
    { k: 'stockP', h: 'المخزون', n: true, v: r => r.stock / r.pf, d: 1 },
    { k: 'transitP', h: 'بالطريق', n: true, v: r => r.transit / r.pf, d: 1 },
    { k: 'maxP', h: 'الحد الأقصى', n: true, v: r => r.maxLevel / r.pf, d: 1 },
    { k: 'suggested', h: 'الطلب المقترح', n: true },
    { k: 'delta', h: 'تعديل (+/−)', n: true, f: r => ui.printing ? (r.delta ? fmt(r.delta, 2) : '') : `<input class="cell-input" type="number" step="any" id="adj_${esc(r.code)}" data-chg="adj" data-code="${esc(r.code)}" value="${r.delta || ''}">` },
    { k: 'final', h: 'الطلب النهائي', n: true, f: r => `<b>${fmt(r.final)}</b>` },
    { k: 'costP', h: 'تكلفة الوحدة', n: true, v: r => r.cost * r.pf, d: 2 },
    { k: 'coverageAfter', h: 'التغطية بعد الطلب (شهر)', n: true, d: 1 },
    { k: 'orderValue', h: 'قيمة الطلب', n: true, f: r => money(r.orderValue) },
    { k: 'reason', h: 'سبب التعديل', f: r => ui.printing ? esc(r.reason) : `<input class="cell-input wide" id="rsn_${esc(r.code)}" data-chg="reason" data-code="${esc(r.code)}" value="${esc(r.reason)}" ${r.delta || r.reason ? '' : 'placeholder="—"'}>` },
    { k: 'status', h: 'الحالة', f: r => statusPill(r) }
  ].filter(c => !ui.printing || !['mainItem', 'status', 'costP'].includes(c.k));
  function statusPill(r) {
    const c = r.status === 'يطلب' ? 'brand' : r.status === 'لا يطلب' ? '' : r.status === 'موقوف' ? '' : 'bad';
    return `<span class="pill ${c}">${r.status}</span>${r.autoAdded ? ' <span class="pill warn" title="غير مصنف — مضاف تلقائيًا">جديد</span>' : ''}${r.excMonths ? ` <span class="pill warn" title="فترة استثنائية +${r.excMonths} شهر">+${r.excMonths}</span>` : ''}`;
  }
  PAGES.order = function () {
    const f = ui.f.order;
    const rows = orderRows();
    const vis = colFiltered('order', ORDER_COLS(), rows);
    const tv = vis.reduce((a, r) => a + r.orderValue, 0);
    const cnt = vis.filter(r => r.final > 0).length;
    const types = db.types.map(t => t.name), groups = db.groups, classes = db.classes.map(c => c.code);
    const archived = db.archive.find(a => a.orderMonth === res.orderMonth);
    return `
    <div class="page-head"><div><h1>قائمة الطلب الشهرية — ${monthLabel(res.orderMonth)}</h1>
      <div class="sub">المخزون كما في ${esc(db.stock.date || '—')} — المبيعات من ${monthLabel(res.months[0])} إلى ${monthLabel(res.months[res.months.length - 1])} — الكميات بوحدة الشراء — مرتبة حسب قيمة الطلب</div></div>
      <div class="actions"><button class="ok" data-act="approve">${archived ? 'إعادة الاعتماد' : 'اعتماد الطلب'}</button></div></div>
    <div class="print-only"><div class="small">النوع: ${esc(f.type)} — المجموعة: ${esc(f.group)} — التصنيف: ${esc(f.cls)} — المخزون كما في ${esc(db.stock.date || '—')} — عدد الأصناف ${fmt(cnt)} — إجمالي القيمة ${money(tv)} ${cur()}</div></div>
    <div class="toolbar">
      <label class="chk">النوع <select class="inp" data-chg="filter" data-f="order.type">${opts(types, f.type, true)}</select></label>
      <label class="chk">المجموعة <select class="inp" data-chg="filter" data-f="order.group">${opts(groups, f.group, true)}</select></label>
      <label class="chk">التصنيف <select class="inp" data-chg="filter" data-f="order.cls">${opts(classes, f.cls, true)}</select></label>
      <label class="chk">عرض <select data-chg="filter" data-f="order.show"><option value="ordered" ${f.show === 'ordered' ? 'selected' : ''}>المطلوبة فقط</option><option value="adjusted" ${f.show === 'adjusted' ? 'selected' : ''}>المعدّلة يدويًا</option><option value="all" ${f.show === 'all' ? 'selected' : ''}>كل الأصناف</option></select></label>
      <input type="search" id="qOrder" placeholder="بحث برقم أو اسم الصنف…" value="${esc(f.q)}" data-search="order.q">
      <span class="grow"></span>
      <span class="pill brand">${fmt(cnt)} صنف</span><span class="pill brand">إجمالي ${money(tv)} ${cur()}</span>
    </div>
    ${table('order', ORDER_COLS(), rows, { sort: 'orderValue', dir: -1, empty: 'لا توجد أصناف مطلوبة بهذه الفلاتر', foot: { name: 'الإجمالي', final: '', orderValue: money(tv) } })}
    <div class="print-only" style="margin-top:30px"><table style="width:100%;text-align:center"><tr><td>إعداد: ____________</td><td>مراجعة: ____________</td><td>اعتماد المشتريات: ____________</td></tr></table></div>`;
  };

  // ---------- الحساب التفصيلي ----------
  function calcRows() {
    const f = ui.f.calc, q = f.q.trim().toLowerCase();
    return res.rows.filter(r =>
      (f.type === 'الكل' || r.type === f.type) && (f.group === 'الكل' || r.group === f.group) && (f.cls === 'الكل' || r.cls === f.cls) &&
      (f.status === 'الكل' || r.status === f.status || (f.status === 'ملاحظات' && r.notes.length)) &&
      (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
  }
  function calcCols() {
    const mcols = res.months.map((m, i) => ({ k: 'm' + i, h: monthLabel(m), n: true, v: r => r.sales[i], d: 2 }));
    return [
      { k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'baseUnit', h: 'الوحدة الأساسية' }, { k: 'type', h: 'النوع' },
      { k: 'active', h: 'النشاط', v: r => r.active ? 'يعمل' : 'لا يعمل' },
      ...mcols,
      { k: 'total', h: 'إجمالي', n: true, d: 2 }, { k: 'avg', h: 'المتوسط', n: true, d: 2 }, { k: 'std', h: 'الانحراف', n: true, d: 2 },
      { k: 'cost', h: 'التكلفة', n: true, d: 4 }, { k: 'value6', h: 'قيمة المبيعات', n: true },
      { k: 'cls', h: 'التصنيف', f: r => `<span class="cls">${r.cls}</span>${r.clsManual ? ' ✎' : ''}` }, { k: 'clsAuto', h: 'التلقائي' }, { k: 'service', h: 'الخدمة', n: true, f: r => pct(r.service) }, { k: 'z', h: 'Z', n: true, d: 3 },
      { k: 'lead', h: 'التوصيل', n: true, d: 2 }, { k: 'extraMonths', h: 'أشهر إضافية', n: true, d: 2 },
      { k: 'expected', h: 'الطلب المتوقع', n: true, d: 1 }, { k: 'safety', h: 'مخزون الأمان', n: true, d: 1 }, { k: 'extra', h: 'المخزون الإضافي', n: true, d: 1 },
      { k: 'maxLevel', h: 'الحد الأقصى', n: true, d: 1 }, { k: 'stock', h: 'المخزون', n: true, d: 2 }, { k: 'transit', h: 'بالطريق', n: true, d: 2 },
      { k: 'suggested', h: 'المقترح (وحدة الشراء)', n: true }, { k: 'final', h: 'النهائي', n: true }, { k: 'orderValue', h: 'قيمة الطلب', n: true },
      { k: 'coverage', h: 'التغطية الحالية', n: true, d: 1 }, { k: 'status', h: 'الحالة' }, { k: 'notes', h: 'ملاحظات', v: r => r.notes.join('؛ ') }
    ];
  }
  PAGES.calc = function () {
    const f = ui.f.calc;
    const rows = calcRows();
    return `
    <div class="page-head"><div><h1>الحساب التفصيلي</h1><div class="sub">سطر لكل صنف — الكميات بالوحدة الأساسية. اضغط على أي صنف لعرض تفاصيل المعادلة.</div></div>
</div>
    <div class="toolbar">
      <label class="chk">النوع <select class="inp" data-chg="filter" data-f="calc.type">${opts(db.types.map(t => t.name), f.type, true)}</select></label>
      <label class="chk">المجموعة <select class="inp" data-chg="filter" data-f="calc.group">${opts(db.groups, f.group, true)}</select></label>
      <label class="chk">التصنيف <select class="inp" data-chg="filter" data-f="calc.cls">${opts(db.classes.map(c => c.code), f.cls, true)}</select></label>
      <label class="chk">الحالة <select class="inp" data-chg="filter" data-f="calc.status">${opts(['يطلب', 'لا يطلب', 'موقوف', 'موقوف + تعديل', 'ملاحظات'], f.status, true)}</select></label>
      <input type="search" id="qCalc" placeholder="بحث…" value="${esc(f.q)}" data-search="calc.q">
    </div>
    ${table('calc', calcCols(), rows, { sort: 'orderValue', dir: -1, onRow: r => showItemCalc(r.code) })}`;
  };

  function showItemCalc(code) {
    const r = res.rows.find(x => x.code === code);
    if (!r) return;
    const it = db.items[r.i];
    const max = Math.max(1, ...r.sales.map(Math.abs));
    const bars = r.sales.map(v => `<div class="b"><span class="bv">${fmt(v, 1)}</span><div class="bar ${v < 0 ? 'neg' : ''}" style="height:${Math.abs(v) / max * 90}%"></div></div>`).join('');
    const lbls = res.months.map(m => `<span>${monthLabel(m)}</span>`).join('');
    const n = (v, d = 2) => `<span class="n">${fmt(v, d)}</span>`;
    const s = db.settings;
    const basisTxt = s.extraBasis === 'avg' ? `المتوسط ${n(Math.max(r.avg, 0))}` : `(المتوسط + الانحراف) ${n(Math.max(r.avg + r.std, 0))}`;
    const stockRows = db.stock.rows.filter(x => x.code === code);
    const trRows = db.transit.filter(x => x.code === code);
    const unitsTxt = E.allUnits(it).map(u => `${esc(u.name)}${u.factor !== 1 ? ' = ' + fmt(u.factor, 4) + ' ' + esc(it.baseUnit) : ' (أساسية)'}`).join(' ، ');
    modal({
      title: `${esc(r.code)} — ${esc(r.name)}`, size: 'wide',
      body: `
      <div class="row-flex" style="margin-bottom:12px"><span class="pill brand">${esc(r.type)}</span><span class="pill">${esc(r.group)}</span><span class="cls pill">${r.cls}</span>${statusPill(r)}<span class="small">الوحدات: ${unitsTxt} — وحدة الشراء: ${esc(r.purchaseUnit)}</span></div>
      ${r.notes.length ? `<div class="banner warn">${r.notes.map(esc).join(' — ')}</div>` : ''}
      <h3>المبيعات الشهرية (بالوحدة الأساسية: ${esc(r.baseUnit)})</h3>
      <div class="bars">${bars}</div><div class="bars-l">${lbls}</div>
      <div class="calc-grid" style="margin-top:14px">
        <div class="c"><div class="l">إجمالي ${res.months.length} أشهر</div><div class="v">${fmt(r.total, 2)}</div></div>
        <div class="c"><div class="l">المتوسط الشهري</div><div class="v">${fmt(r.avg, 2)}</div></div>
        <div class="c"><div class="l">الانحراف المعياري</div><div class="v">${fmt(r.std, 2)}</div></div>
        <div class="c"><div class="l">تكلفة الوحدة الأساسية</div><div class="v">${fmt(r.cost, 4)}</div></div>
        <div class="c"><div class="l">تصنيف الكمية / القيمة</div><div class="v">${r.clsQ} / ${r.clsV}</div></div>
        <div class="c"><div class="l">مستوى الخدمة / Z</div><div class="v">${pct(r.service)} / ${fmt(r.z, 3)}</div></div>
        <div class="c"><div class="l">المراجعة + التوصيل</div><div class="v">${fmt(r.review, 2)} + ${fmt(r.lead, 2)} = ${fmt(r.cover, 2)}</div></div>
        <div class="c"><div class="l">أشهر إضافية (ثابتة + استثنائية)</div><div class="v">${fmt(r.fixedExtra, 2)} + ${fmt(r.excMonths, 2)}</div></div>
      </div>
      <h3>المعادلة</h3>
      <div class="formula">
        الطلب المتوقع = المتوسط ${n(Math.max(r.avg, 0))} × ${n(r.cover)} = <b>${n(r.expected)}</b><br>
        مخزون الأمان = Z ${n(r.z, 4)} × الانحراف ${n(r.std)} × √${n(r.cover)} = <b>${n(r.safety)}</b><br>
        المخزون الإضافي = ${basisTxt} × ${n(r.extraMonths)} شهر = <b>${n(r.extra)}</b><br>
        الحد الأقصى = ${n(r.expected)} + ${n(r.safety)} + ${n(r.extra)} = <b>${n(r.maxLevel)}</b> ${esc(r.baseUnit)}<br>
        المتاح = المخزون ${n(r.stock)} + بالطريق ${n(r.transit)} = <b>${n(r.available)}</b><br>
        الطلب المقترح = تقريب لأعلى ((${n(r.maxLevel)} − ${n(r.available)}) ÷ ${n(r.pf, 4)}) = <b>${n(r.suggested, 0)}</b> ${esc(r.purchaseUnit)}${r.active ? '' : ' (الصنف موقوف ⇒ صفر)'}<br>
        الطلب النهائي = ${n(r.suggested, 0)} ${r.delta >= 0 ? '+' : '−'} ${n(Math.abs(r.delta), 2)} = <b>${n(r.final, 2)}</b> ${esc(r.purchaseUnit)} — القيمة <b>${n(r.orderValue, 0)}</b> ${cur()}
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div><h3>أسطر المخزون</h3>${table('dStock', [{ k: 'unit', h: 'الوحدة' }, { k: 'qty', h: 'الكمية', n: true, d: 2 }, { k: 'cost', h: 'التكلفة', n: true, d: 4 }], stockRows, { static: true, short: true, empty: 'لا يوجد' })}</div>
        <div><h3>أسطر بالطريق</h3>${table('dTr', [{ k: 'unit', h: 'الوحدة' }, { k: 'qty', h: 'الكمية', n: true, d: 2 }, { k: 'source', h: 'المصدر' }], trRows, { static: true, short: true, empty: 'لا يوجد' })}</div>
      </div>`,
      foot: `<button class="primary" data-edit>تعديل الصنف</button><button data-close>إغلاق</button>`,
      onMount: m => { m.q('[data-edit]').onclick = () => { m.close(); editItem(code); }; }
    });
  }

  // ---------- الفحوصات ----------
  PAGES.checks = function () {
    const links = { salesUnit: 'units', stockUnit: 'units', transitUnit: 'units', autoAdded: 'auto', noCost: 'noCost', adjNoReason: 'adj', inactiveAdj: 'adj', months: 'cycle', unknownType: 'unknownType', negStock: 'negStock', poOverdue: 'po', poShipLate: 'poLate', trackLate: 'shipLate', demurrage: 'shipDem', demurrageSoon: 'shipSoon', transitBoth: 'units_transit' };
    return `
    <div class="page-head"><div><h1>فحوصات جودة البيانات</h1><div class="sub">راجعها قبل اعتماد الطلب. ✗ = يجب التصحيح، ⚠ = تنبيه للمراجعة.</div></div></div>
    ${res.blocking ? `<div class="banner bad">✗ يوجد ${res.blocking} فحص غير سليم</div>` : '<div class="banner ok">✓ كل الفحوصات الأساسية سليمة</div>'}
    <div class="card">${table('checks', [
      { k: 'i', h: '#', nosort: true, f: (r, i) => i + 1 },
      { k: 'ok', h: 'النتيجة', nosort: true, f: r => r.ok ? '<span class="mark ok">✓</span>' : r.sev === 'x' ? '<span class="mark bad">✗</span>' : '<span class="mark warn">⚠</span>' },
      { k: 'title', h: 'الفحص', nosort: true }, { k: 'count', h: 'العدد', n: true, nosort: true },
      { k: 'where', h: 'أين تراجع', nosort: true, cls: 'wrap' }, { k: 'why', h: 'ليش مهم', nosort: true, cls: 'wrap' },
      { k: 'go', h: '', nosort: true, f: r => !r.ok && links[r.id] ? `<button class="sm" data-act="checkGo" data-k="${links[r.id]}">عرض</button>` : '' }
    ], res.checks, { nofilter: true, short: true })}</div>`;
  };

  // ---------- الأصناف ----------
  function itemRows() {
    const f = ui.f.items, q = f.q.trim().toLowerCase();
    const rmap = new Map(res.rows.map(r => [r.code, r]));
    return db.items.filter(it =>
      (f.type === 'الكل' || it.type === f.type) && (f.group === 'الكل' || it.group === f.group) &&
      (f.active === 'الكل' || (f.active === 'يعمل') === (it.active !== false)) &&
      (f.flag === 'الكل' || (f.flag === 'تحتاج تصنيف' && it.autoAdded) || (f.flag === 'بدون تكلفة' && rmap.get(it.code) && rmap.get(it.code).cost === 0 && it.active !== false) ||
        (f.flag === 'متعددة الوحدات' && it.units.length) || (f.flag === 'نوع غير معروف' && !db.types.some(t => t.name === it.type)) ||
        (f.flag === 'مخزون سالب' && rmap.get(it.code) && rmap.get(it.code).stock < 0)) &&
      (!q || it.code.toLowerCase().includes(q) || (it.name || '').toLowerCase().includes(q) || (it.mainItem || '').toLowerCase().includes(q)));
  }
  PAGES.items = function () {
    const f = ui.f.items;
    const rows = itemRows();
    const auto = db.items.filter(i => i.autoAdded).length;
    return `
    <div class="page-head"><div><h1>الأصناف</h1><div class="sub">البيانات الثابتة: المجموعات، النوع، النشاط، الوحدات ومعاملات التحويل. ${fmt(db.items.length)} صنف.</div></div>
      <div class="actions"><button class="primary" data-act="newItem">إضافة صنف</button><button data-act="import" data-k="items">استيراد / تحديث بقالب</button><button data-act="tpl" data-k="items">تحميل القالب</button><button data-act="tplItemsFull">تصدير الأصناف (قالب معبأ)</button></div></div>
    ${auto ? `<div class="banner warn"><span class="grow">⚠ ${auto} صنف «غير مصنف» أُضيف تلقائيًا — افتحه وحدّد بياناته، أو استخدم «تعديل جماعي» للمعروض.</span>${f.flag !== 'تحتاج تصنيف' ? '<button class="sm" data-act="reviewAuto">عرضها</button>' : ''}</div>` : ''}
    <div class="toolbar">
      <label class="chk">النوع <select class="inp" data-chg="filter" data-f="items.type">${opts(db.types.map(t => t.name), f.type, true)}</select></label>
      <label class="chk">المجموعة <select class="inp" data-chg="filter" data-f="items.group">${opts(db.groups, f.group, true)}</select></label>
      <label class="chk">النشاط <select class="inp" data-chg="filter" data-f="items.active">${opts(['يعمل', 'لا يعمل'], f.active, true)}</select></label>
      <label class="chk">فلتر <select class="inp" data-chg="filter" data-f="items.flag">${opts(['تحتاج تصنيف', 'بدون تكلفة', 'متعددة الوحدات', 'نوع غير معروف', 'مخزون سالب'], f.flag, true)}</select></label>
      <input type="search" id="qItems" placeholder="بحث…" value="${esc(f.q)}" data-search="items.q">
      <span class="grow"></span><button data-act="bulkEdit">تعديل جماعي للمعروض (${fmt(rows.length)})</button>
    </div>
    ${table('items', [
      { k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' },
      { k: 'baseUnit', h: 'الوحدة الأساسية' },
      { k: 'units', h: 'وحدات أخرى', v: it => it.units.map(u => `${u.name}=${fmt(u.factor, 4)}`).join('، ') },
      { k: 'purchaseUnit', h: 'وحدة الشراء', v: it => it.purchaseUnit || it.baseUnit },
      { k: 'group', h: 'المجموعة' }, { k: 'sub1', h: 'فرعية 1' }, { k: 'sub2', h: 'فرعية 2' }, { k: 'mainItem', h: 'الصنف الرئيسي' },
      { k: 'type', h: 'النوع' }, { k: 'active', h: 'النشاط', f: it => it.active !== false ? '<span class="pill ok">يعمل</span>' : '<span class="pill">لا يعمل</span>', v: it => it.active !== false ? 1 : 0 },
      { k: 'clsOverride', h: 'تصنيف يدوي' }, { k: 'leadOverride', h: 'توصيل خاص', n: true, d: 2 }, { k: 'extraOverride', h: 'إضافي خاص', n: true, d: 2 }, { k: 'refCost', h: 'تكلفة مرجعية', n: true, d: 4 },
      { k: 'autoAdded', h: '', f: it => it.autoAdded ? '<span class="pill warn">غير مصنف — جديد</span>' : '', v: it => it.autoAdded ? 1 : 0 }
    ], rows, { onRow: it => editItem(it.code) })}`;
  };

  function editItem(code) {
    const isNew = !code;
    const it = isNew ? { code: '', name: '', baseUnit: '', purchaseUnit: '', units: [], group: 'غير مصنف', sub1: '', sub2: '', mainItem: '', type: db.settings.defaultType, active: true, leadOverride: null, extraOverride: null, refCost: null, notes: '', autoAdded: false } : db.items.find(x => x.code === code);
    if (!it) return;
    const r = res.rows.find(x => x.code === code);
    const v = x => x == null ? '' : esc(x);
    const unitRow = (u = { name: '', factor: '' }) => `<tr><td><input data-u="name" value="${v(u.name)}" placeholder="مثال: كرتون"></td><td><input data-u="factor" type="number" step="any" min="0" value="${v(u.factor)}" placeholder="كم وحدة أساسية"></td><td><button class="sm danger" data-delunit>حذف</button></td></tr>`;
    modal({
      title: isNew ? 'إضافة صنف' : `تعديل الصنف ${esc(it.code)}`, size: 'wide',
      body: `
      ${it.autoAdded ? `<div class="banner warn">هذا الصنف أُضيف تلقائيًا كـ «غير مصنف» (${esc(it.notes)}). الحفظ يؤكد تصنيفه.</div>` : ''}
      <div class="form">
        <label class="f">رقم الصنف<input id="e_code" value="${v(it.code)}" ${isNew ? '' : 'readonly'}></label>
        <label class="f full" style="grid-column:span 2">اسم الصنف<input id="e_name" value="${v(it.name)}"></label>
        <label class="f">المجموعة الرئيسية<input id="e_group" list="dl_groups" class="inp" value="${v(it.group)}"></label>
        <label class="f">المجموعة الفرعية 1<input id="e_sub1" list="dl_sub1" value="${v(it.sub1)}"></label>
        <label class="f">المجموعة الفرعية 2<input id="e_sub2" list="dl_sub2" value="${v(it.sub2)}"></label>
        <label class="f">الصنف الرئيسي<input id="e_main" list="dl_main" value="${v(it.mainItem)}"></label>
        <label class="f">نوع الصنف<select id="e_type" class="inp">${opts(db.types.map(t => t.name).concat(db.types.some(t => t.name === it.type) ? [] : [it.type]), it.type)}</select></label>
        <label class="f">نشاط الصنف<select id="e_active" class="inp"><option value="1" ${it.active !== false ? 'selected' : ''}>يعمل</option><option value="0" ${it.active === false ? 'selected' : ''}>لا يعمل</option></select></label>
        <label class="f">فترة توصيل خاصة (شهر) — فارغ = حسب النوع<input id="e_lead" type="number" step="any" min="0" value="${v(it.leadOverride)}"></label>
        <label class="f">أشهر إضافية خاصة — فارغ = حسب النوع<input id="e_extra" type="number" step="any" min="0" value="${v(it.extraOverride)}"></label>
        <label class="f">تكلفة مرجعية للوحدة الأساسية (إذا لم توجد في المخزون)<input id="e_cost" type="number" step="any" min="0" value="${v(it.refCost)}"></label>
        <label class="f">التصنيف اليدوي — فارغ = تلقائي${r ? ' (التلقائي الآن: ' + r.clsAuto + ')' : ''}<select id="e_cls" class="inp"><option value="">تلقائي</option>${db.classes.map(c => `<option value="${c.code}" ${it.clsOverride === c.code ? 'selected' : ''}>${c.code} — خدمة ${pct(c.service)}</option>`).join('')}</select></label>
        <label class="f full">ملاحظات<input id="e_notes" value="${v(it.notes)}"></label>
      </div>
      <h3>الوحدات</h3>
      <div class="hint">كل الحسابات تتم بالوحدة الأساسية. أي سطر مبيعات أو مخزون أو بالطريق بوحدة أخرى يتحول تلقائيًا بالمعامل (مثال: كرتون = 24 حبة). الطلب يطلع بوحدة الشراء ويتقرب لأعلى لعبوة كاملة.</div>
      <div class="form" style="margin:10px 0">
        <label class="f">الوحدة الأساسية<input id="e_base" class="inp" value="${v(it.baseUnit)}"></label>
        <label class="f">وحدة الشراء<select id="e_pu" class="inp"></select></label>
      </div>
      <table class="t units-tbl" style="max-width:560px"><thead><tr><th>الوحدة</th><th>تساوي كم من الوحدة الأساسية</th><th></th></tr></thead><tbody id="e_units">${it.units.map(unitRow).join('')}</tbody></table>
      <button class="sm" id="e_addunit" style="margin-top:8px">+ إضافة وحدة</button>
      ${r ? `<div class="small" style="margin-top:14px">الحساب الحالي: المتوسط ${fmt(r.avg, 2)} ${esc(r.baseUnit)} — الحد الأقصى ${fmt(r.maxLevel, 1)} — الطلب ${fmt(r.final)} ${esc(r.purchaseUnit)} — التصنيف ${r.cls}</div>` : ''}
      <datalist id="dl_groups">${db.groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <datalist id="dl_sub1">${[...new Set(db.items.map(i => i.sub1).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <datalist id="dl_sub2">${[...new Set(db.items.map(i => i.sub2).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <datalist id="dl_main">${[...new Set(db.items.map(i => i.mainItem).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>`,
      foot: `<button class="primary" data-save>حفظ</button><button data-close>إلغاء</button><span class="grow"></span>${isNew ? '' : '<button class="danger" data-del>حذف الصنف</button>'}`,
      onMount: m => {
        const fillPU = () => {
          const base = m.q('#e_base').value.trim();
          const names = [base].concat([...m.qa('#e_units tr')].map(tr => tr.querySelector('[data-u=name]').value.trim())).filter(Boolean);
          const curPU = m.q('#e_pu').value || it.purchaseUnit || base;
          m.q('#e_pu').innerHTML = names.map(n => `<option ${normUnit(n) === normUnit(curPU) ? 'selected' : ''}>${esc(n)}</option>`).join('');
        };
        fillPU();
        m.q('#e_base').addEventListener('input', fillPU);
        m.q('#e_units').addEventListener('input', fillPU);
        m.q('#e_addunit').onclick = () => { m.q('#e_units').insertAdjacentHTML('beforeend', unitRow()); fillPU(); };
        m.q('#e_units').addEventListener('click', e => { if (e.target.closest('[data-delunit]')) { e.target.closest('tr').remove(); fillPU(); } });
        m.q('[data-save]').onclick = () => {
          if (!can('items')) return deny('items');
          const code2 = E.normCode(m.q('#e_code').value);
          if (!code2) return toast('رقم الصنف مطلوب', 'bad');
          if (isNew && db.items.some(x => x.code === code2)) return toast('رقم الصنف موجود مسبقًا', 'bad');
          const base = m.q('#e_base').value.trim();
          if (!base) return toast('الوحدة الأساسية مطلوبة', 'bad');
          const units = [];
          for (const tr of m.qa('#e_units tr')) {
            const n = tr.querySelector('[data-u=name]').value.trim(), f = num(tr.querySelector('[data-u=factor]').value);
            if (!n) continue;
            if (!(f > 0)) return toast(`معامل الوحدة «${n}» لازم يكون أكبر من صفر`, 'bad');
            if (normUnit(n) === normUnit(base) || units.some(u => normUnit(u.name) === normUnit(n))) return toast(`الوحدة «${n}» مكررة`, 'bad');
            units.push({ name: n, factor: f });
          }
          const nb = x => { const s = m.q(x).value.trim(); return s === '' ? null : num(s); };
          Object.assign(it, {
            code: code2, name: m.q('#e_name').value.trim(), baseUnit: base, units, purchaseUnit: m.q('#e_pu').value === base ? '' : m.q('#e_pu').value,
            group: m.q('#e_group').value.trim() || 'غير مصنف', sub1: m.q('#e_sub1').value.trim(), sub2: m.q('#e_sub2').value.trim(), mainItem: m.q('#e_main').value.trim(),
            type: m.q('#e_type').value, active: m.q('#e_active').value === '1', leadOverride: nb('#e_lead'), extraOverride: nb('#e_extra'), refCost: nb('#e_cost'), clsOverride: m.q('#e_cls').value || '',
            notes: m.q('#e_notes').value.trim(), autoAdded: false
          });
          if (isNew) { it.addedAt = today(); db.items.push(it); log('إضافة صنف ' + code2); } else log('تعديل صنف ' + code2);
          I.syncGroups(db);
          m.close(); toast('تم الحفظ', 'ok'); ui.keepScroll = true; commit();
        };
        const del = m.q('[data-del]');
        if (del) del.onclick = async () => {
          if (!can('data_admin')) return deny('data_admin');
          if (!await confirmBox(`حذف الصنف ${esc(it.code)} — ${esc(it.name)}؟ مبيعاته ومخزونه تبقى في البيانات لكنها لن تدخل الحساب (ستظهر في الفحوصات).<br>للإيقاف استخدم «لا يعمل» بدل الحذف.`, { ok: 'حذف', danger: true })) return;
          db.items = db.items.filter(x => x !== it); delete db.adjustments[it.code]; log('حذف صنف ' + it.code);
          m.close(); commit();
        };
      }
    });
  }

  function bulkEdit() {
    const rows = itemRows();
    if (!rows.length) return toast('لا توجد أصناف معروضة');
    modal({
      title: `تعديل جماعي — ${fmt(rows.length)} صنف (حسب الفلاتر الحالية)`,
      body: `<div class="hint">الحقل الفارغ لا يتغير.</div><div class="form f2" style="margin-top:10px">
        <label class="f">نوع الصنف<select id="b_type"><option value="">— بدون تغيير —</option>${opts(db.types.map(t => t.name), '')}</select></label>
        <label class="f">المجموعة الرئيسية<input id="b_group" list="dl_bg"></label>
        <label class="f">نشاط الصنف<select id="b_active"><option value="">— بدون تغيير —</option><option value="1">يعمل</option><option value="0">لا يعمل</option></select></label>
        <label class="f">أشهر إضافية خاصة<select id="b_extraMode"><option value="">— بدون تغيير —</option><option value="clear">مسح (حسب النوع)</option><option value="set">تحديد قيمة</option></select></label>
        <label class="f">قيمة الأشهر الإضافية<input id="b_extra" type="number" step="any" min="0"></label>
        <label class="f">فترة توصيل خاصة<select id="b_leadMode"><option value="">— بدون تغيير —</option><option value="clear">مسح (حسب النوع)</option><option value="set">تحديد قيمة</option></select></label>
        <label class="f">قيمة فترة التوصيل<input id="b_lead" type="number" step="any" min="0"></label>
        <label class="f">التصنيف اليدوي<select id="b_cls"><option value="">— بدون تغيير —</option><option value="auto">إرجاع للتلقائي</option>${db.classes.map(c => `<option value="${c.code}">${c.code}</option>`).join('')}</select></label>
        <label class="chk full"><input type="checkbox" id="b_confirm"> تأكيد التصنيف (إزالة علامة «غير مصنف — جديد»)</label>
      </div><datalist id="dl_bg">${db.groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>`,
      foot: `<button class="primary" data-ok>تطبيق على ${fmt(rows.length)} صنف</button><button data-close>إلغاء</button>`,
      onMount: m => {
        m.q('[data-ok]').onclick = () => {
          const t = m.q('#b_type').value, g = m.q('#b_group').value.trim(), a = m.q('#b_active').value;
          const em = m.q('#b_extraMode').value, ev = m.q('#b_extra').value, lm = m.q('#b_leadMode').value, lv = m.q('#b_lead').value;
          const conf = m.q('#b_confirm').checked;
          for (const it of rows) {
            if (t) it.type = t; if (g) it.group = g; if (a) it.active = a === '1';
            if (em === 'clear') it.extraOverride = null; else if (em === 'set' && ev !== '') it.extraOverride = num(ev);
            if (lm === 'clear') it.leadOverride = null; else if (lm === 'set' && lv !== '') it.leadOverride = num(lv);
            const bc = m.q('#b_cls').value; if (bc === 'auto') it.clsOverride = ''; else if (bc) it.clsOverride = bc;
            if (conf || t || g) it.autoAdded = false;
          }
          I.syncGroups(db); log(`تعديل جماعي ${rows.length} صنف`);
          m.close(); toast('تم التطبيق', 'ok'); commit();
        };
      }
    });
  }

  // ---------- المبيعات والمخزون ----------
  PAGES.data = function () {
    const tab = ui.dataTab;
    const tabs = [['sales', 'المبيعات'], ['stock', 'المخزون'], ['transit', 'بالطريق'], ['units', `الوحدات غير المعرّفة (${unitIssueGroups().length})`]];
    let body = '';
    if (tab === 'sales') body = dataSales();
    else if (tab === 'stock') body = dataStock();
    else if (tab === 'transit') body = dataTransit();
    else body = dataUnits();
    return `<div class="page-head"><div><h1>المبيعات والمخزون والبضاعة بالطريق</h1><div class="sub">بيانات الإدخال الشهرية</div></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${tab === k ? 'active' : ''}" data-act="dataTab" data-k="${k}">${l}</div>`).join('')}</div>${body}`;
  };
  function dataSales() {
    const months = salesMonths();
    const shown = months.slice(0, 12).map(m => m.month).reverse();
    const idx = new Map(db.items.map((it, i) => [it.code, it]));
    const mat = new Map();
    for (const r of db.sales) {
      const mi = shown.indexOf(r.month); if (mi < 0) continue;
      const it = idx.get(r.code);
      const f = it ? E.unitFactor(it, r.unit) : null;
      if (!mat.has(r.code)) mat.set(r.code, { code: r.code, name: it ? it.name : r.name, unit: it ? it.baseUnit : r.unit, m: new Array(shown.length).fill(0), bad: false });
      const row = mat.get(r.code);
      if (f == null) { row.bad = true; continue; }
      row.m[mi] += (num(r.issued) - num(r.returned)) * f;
    }
    const q = ui.f.sales.q.trim().toLowerCase();
    const rows = [...mat.values()].filter(r => !q || r.code.toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
    return `<div class="card"><h2>الأشهر المحفوظة</h2>
      <div class="hint">الأشهر المظللة داخل فترة التحليل (${res.months.length} أشهر حتى ${monthLabel(db.settings.lastMonth)}). يُحتفظ بآخر ${db.settings.keepMonths} شهر.</div>
      <div class="month-chips">${months.map(m => `<span class="chip ${res.months.includes(m.month) ? 'in' : ''}">${monthLabel(m.month)} <span class="small">${fmt(m.rows)} سطر</span> <span class="x" data-act="delMonth" data-k="${m.month}" title="حذف الشهر">✕</span></span>`).join('') || '<span class="small">لا توجد مبيعات</span>'}</div>
      <div class="row-flex" style="margin-top:12px"><button class="primary" data-act="import" data-k="sales">استيراد مبيعات شهر</button><button data-act="tpl" data-k="sales">تحميل القالب</button><button data-act="exportSales">تصدير المبيعات</button></div></div>
      <div class="toolbar"><input type="search" id="qSales" placeholder="بحث…" value="${esc(ui.f.sales.q)}" data-search="sales.q"><span class="small">صافي المبيعات بالوحدة الأساسية — آخر 12 شهر</span></div>
      ${table('salesMat', [{ k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'unit', h: 'الوحدة' },
        ...shown.map((m, i) => ({ k: 'm' + i, h: monthLabel(m), n: true, v: r => r.m[i], d: 2 })),
        { k: 'bad', h: '', f: r => r.bad ? '<span class="pill bad">وحدة غير معرّفة</span>' : '' }], rows, { onRow: r => { if (idx.get(r.code)) showItemCalc(r.code); } })}`;
  }
  function dataStock() {
    const idx = new Map(db.items.map(it => [it.code, it]));
    const q = ui.f.stock.q.trim().toLowerCase();
    const rows = db.stock.rows.filter(r => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    return `<div class="toolbar"><button class="primary" data-act="import" data-k="stock">استيراد المخزون (استبدال)</button><button data-act="tpl" data-k="stock">تحميل القالب</button>
      <label class="chk">تاريخ الرصيد <input type="date" class="inp" data-chg="stockDate" value="${esc(db.stock.date)}"></label>
      <input type="search" id="qStock" placeholder="بحث…" value="${esc(ui.f.stock.q)}" data-search="stock.q"><span class="grow"></span><span class="pill">${fmt(db.stock.rows.length)} سطر</span></div>
      ${table('stockT', [{ k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'unit', h: 'الوحدة' }, { k: 'qty', h: 'الكمية', n: true, d: 2 }, { k: 'cost', h: 'تكلفة الوحدة', n: true, d: 4 },
        { k: 'chk', h: 'التحويل', f: r => { const it = idx.get(r.code); if (!it) return '<span class="pill bad">غير موجود</span>'; const f = E.unitFactor(it, r.unit); return f == null ? '<span class="pill bad">وحدة غير معرّفة</span>' : f === 1 ? '<span class="pill ok">أساسية</span>' : `<span class="pill brand">× ${fmt(f, 4)} = ${fmt(r.qty * f, 2)} ${esc(it.baseUnit)}</span>`; } }], rows)}`;
  }
  function dataTransit() {
    const idx = new Map(db.items.map(it => [it.code, it]));
    const q = ui.f.transit.q.trim().toLowerCase();
    const rows = db.transit.map((r, i) => Object.assign({ _i: i }, r)).filter(r => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.source.toLowerCase().includes(q));
    return `<div class="toolbar"><button class="primary" data-act="import" data-k="transit" data-mode="replace">استيراد (استبدال)</button><button data-act="import" data-k="transit" data-mode="append">استيراد (إضافة)</button><button data-act="addTransit">إضافة سطر يدوي</button><button data-act="tpl" data-k="transit">تحميل القالب</button><button class="danger" data-act="clearTransit">مسح الكل</button>
      <input type="search" id="qTransit" placeholder="بحث…" value="${esc(ui.f.transit.q)}" data-search="transit.q"><span class="grow"></span><span class="pill">${fmt(db.transit.length)} سطر</span></div>
      ${table('transitT', [{ k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'unit', h: 'الوحدة' }, { k: 'qty', h: 'الكمية', n: true, d: 2 }, { k: 'source', h: 'المصدر / رقم الأمر' },
        { k: 'chk', h: 'التحويل', f: r => { const it = idx.get(r.code); if (!it) return '<span class="pill bad">غير موجود</span>'; const f = E.unitFactor(it, r.unit); return f == null ? '<span class="pill bad">وحدة غير معرّفة</span>' : f === 1 ? '<span class="pill ok">أساسية</span>' : `<span class="pill brand">× ${fmt(f, 4)}</span>`; } },
        { k: 'del', h: '', nosort: true, f: r => `<button class="sm danger" data-act="delTransit" data-i="${r._i}">حذف</button>` }], rows)}
      <div class="card" style="margin-top:16px"><h2>من أوامر الشراء المفتوحة ${db.settings.poAsTransit ? '<span class="pill ok">تنخصم من الطلب</span>' : '<span class="pill">لا تنخصم — الإعداد مقفل</span>'}</h2><div class="hint">${db.settings.poAsTransit ? 'الكمية المتبقية في أوامر الشراء المفتوحة تنخصم تلقائيًا كبضاعة بالطريق.' : 'للعرض فقط. لتفعيل الخصم: الإعدادات ← «خصم أوامر الشراء المفتوحة من الطلب».'} للتعديل: شاشة «أوامر الشراء».</div>
      ${table('transitPo', [{ k: 'source', h: 'أمر الشراء' }, { k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'unit', h: 'الوحدة' }, { k: 'qty', h: 'الكمية المتبقية', n: true, d: 2 }], E.openPoLines(db), { short: true, empty: 'لا توجد أوامر شراء مفتوحة' })}</div>`;
  }
  function unitIssueGroups() {
    const m = new Map();
    for (const x of res.issues.filter(i => i.kind === 'unit')) {
      const k = x.code + '|' + normUnit(x.unit);
      if (!m.has(k)) m.set(k, { code: x.code, name: x.name, unit: x.unit, sheets: new Set(), rows: 0 });
      const g = m.get(k); g.sheets.add(x.sheet); g.rows++;
    }
    return [...m.values()].map(g => Object.assign(g, { sheets: [...g.sheets].join('، '), base: (db.items.find(i => i.code === g.code) || {}).baseUnit }));
  }
  function dataUnits() {
    const rows = unitIssueGroups();
    return `<div class="card"><div class="hint">أسطر بوحدة غير معرّفة للصنف لا تدخل الحساب. عرّف الوحدة بمعامل التحويل للوحدة الأساسية (مثال: الوحدة الأساسية حبة، والسطر بالكرتون = 24 حبة) أو صحّح البيانات من المصدر.</div></div>
      ${table('unitsT', [{ k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'base', h: 'الوحدة الأساسية' }, { k: 'unit', h: 'الوحدة الواردة' }, { k: 'sheets', h: 'المصدر' }, { k: 'rows', h: 'الأسطر', n: true },
        { k: 'fix', h: '', nosort: true, f: r => `<button class="sm primary" data-act="defineUnit" data-code="${esc(r.code)}" data-unit="${esc(r.unit)}">تعريف الوحدة</button> <button class="sm" data-act="editItemBtn" data-code="${esc(r.code)}">فتح الصنف</button>` }], rows, { empty: '✓ كل الوحدات معرّفة' })}`;
  }

  // ---------- أوامر الشراء والكاش ----------
  const curName = c => (db.currencies.find(x => x.code === c) || { name: c }).name;
  function poRows() {
    const f = ui.f.po, q = f.q.trim().toLowerCase();
    return E.poSummary(db, today()).filter(o =>
      (f.status === 'الكل' || (f.status === 'open' ? o.status === 'open' : f.status === 'late' ? o.shipLate : o.stage === f.status)) && (f.pay === 'الكل' || o.payStatus === f.pay) && (f.agent === 'الكل' || o.agent === f.agent) &&
      (!q || o.no.toLowerCase().includes(q) || o.agent.toLowerCase().includes(q) || o.supplier.toLowerCase().includes(q) || o.note.toLowerCase().includes(q) ||
        (db.po.orders[o.no].lines || []).some(l => l.code.toLowerCase().includes(q) || String(l.name).toLowerCase().includes(q))));
  }
  const stagePill = o => (o.shipLate ? `<span class="pill bad" title="الشحن المتوقع ${esc(o.expShip)}">⚠ تأخر الشحن</span> ` : '') + stageCore(o);
  const stageCore = o => o.stage === 'received' ? `<span class="pill ok" title="${esc(o.receivedAt)} ${o.receivedBy === 'auto' ? '(تلقائي)' : '(يدوي)'}">وصل ${esc(o.receivedAt)}</span>` : o.stage === 'shipped' ? `<span class="pill warn" title="${esc(o.blNo ? 'بوليصة ' + o.blNo : '')}">🚢 تم الشحن</span>` : '<span class="pill brand">صادر</span>';
  const payPill = s => `<span class="pill ${s === 'مسدد' ? 'ok' : s === 'مسدد جزئيًا' ? 'warn' : s === 'غير مسدد' ? 'bad' : ''}">${s}</span>`;
  const etaCell = o => !o.eta ? '<span class="muted">—</span>' : `${esc(o.eta)}${o.etaManual ? ' ✎' : ''}${o.status === 'open' && o.daysToEta != null ? ` <span class="pill ${o.daysToEta < 0 ? 'bad' : o.daysToEta <= 30 ? 'warn' : ''}">${o.daysToEta < 0 ? 'متأخر ' + (-o.daysToEta) + ' يوم' : 'بعد ' + o.daysToEta + ' يوم'}</span>` : ''}`;
  function cashBanner() {
    const H = num(db.settings.cashHorizonDays) || 60;
    const open = E.poSummary(db, today()).filter(o => o.status === 'open' && o.dueSar > 0.5);
    if (!open.length) return '';
    const over = open.filter(o => o.daysToEta != null && o.daysToEta < 0), soon = open.filter(o => o.daysToEta != null && o.daysToEta >= 0 && o.daysToEta <= H);
    const sum = a => a.reduce((x, o) => x + o.dueSar, 0);
    const shipSoon = soon.filter(o => o.stage === 'shipped');
    return `<div class="banner ${over.length ? 'bad' : 'warn'} no-print"><span class="grow">💰 كاش مطلوب لأوامر الشراء: <b>${money(sum(soon))} ${cur()}</b> خلال ${H} يوم (${fmt(soon.length)} أمر، منها مشحون ${money(sum(shipSoon))})${over.length ? ` + <b>${money(sum(over))}</b> لأوامر متأخرة (${fmt(over.length)})` : ''} — إجمالي غير المسدد ${money(sum(open))}</span><button class="sm" data-act="poTab" data-k="cash">التفاصيل</button></div>`;
  }
  PAGES.po = function () {
    const tab = ui.poTab;
    const all = E.poSummary(db, today());
    const open = all.filter(o => o.status === 'open');
    const tabs = [['orders', `أوامر الشراء (${fmt(open.filter(o => o.stage === 'issued').length)} صادر — ${fmt(open.filter(o => o.stage === 'shipped').length)} تم الشحن)`], ['cash', 'الكاش المطلوب'], ['imports', 'سجل الاستيراد']];
    const manualTransit = db.transit.length;
    let body = '';
    if (tab === 'cash') body = poCash(all);
    else if (tab === 'imports') body = table('poImports', [
      { k: 'at', h: 'الوقت', v: x => (x.at || '').replace('T', ' ').slice(0, 16) }, { k: 'kind', h: 'النوع', v: x => x.kind === 'po' ? 'تقرير أوامر الشراء' : 'شيت السداد' },
      { k: 'date', h: 'تاريخ التقرير' }, { k: 'file', h: 'الملف' }, { k: 'user', h: 'المستخدم' }, { k: 'orders', h: 'أوامر', n: true }, { k: 'newOrders', h: 'جديد', n: true }, { k: 'closed', h: 'وصل المخزون', n: true }
    ], (db.po.imports || []).slice().reverse(), { empty: 'لا يوجد استيراد بعد' });
    else body = poOrdersTab();
    return `<div class="page-head"><div><h1>أوامر الشراء والكاش المطلوب</h1><div class="sub">متابعة الأوامر بالطريق وحالة السداد — ${db.settings.poAsTransit ? 'الكمية المتبقية في الأوامر المفتوحة <b>تنخصم من الطلب</b> كبضاعة بالطريق' : 'الأوامر للمتابعة والكاش فقط و<b>لا تنخصم من الطلب</b> (الإعداد مقفل)'}</div></div>
      <div class="actions"><button class="primary" data-act="import" data-k="po">استيراد أوامر الشراء (Excel / PDF)</button><button data-act="import" data-k="poPay">استيراد شيت الشحن والسداد</button><button data-act="poNew">إضافة أمر يدوي</button><button data-act="tpl" data-k="po">قالب أوامر الشراء</button><button data-act="tpl" data-k="poPay">قالب الشحن والسداد</button></div></div>
      ${db.settings.poAsTransit && manualTransit && open.some(o => o.lines) ? `<div class="banner warn no-print"><span class="grow">يوجد ${fmt(manualTransit)} سطر بضاعة بالطريق مُدخل يدويًا بجانب أوامر الشراء — إذا كانت نفس الأوامر فهي تنخصم مرتين.</span><button class="sm" data-act="clearManualTransit">مسح بالطريق اليدوي</button><button class="sm" data-act="dataTabGo" data-k="transit">عرض</button></div>` : ''}
      <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${tab === k ? 'active' : ''}" data-act="poTab" data-k="${k}">${l}</div>`).join('')}</div>${body}`;
  };
  function poOrdersTab() {
    const f = ui.f.po;
    const rows = poRows();
    const agents = [...new Set(E.poSummary(db).map(o => o.agent).filter(Boolean))];
    const sum = k => rows.reduce((a, o) => a + o[k], 0);
    return `<div class="toolbar">
      <label class="chk">الحالة <select class="inp" data-chg="filter" data-f="po.status">${[['open', 'مفتوح (صادر + تم الشحن)'], ['issued', 'صادر (لم يُشحن)'], ['late', '⚠ تأخر الشحن'], ['shipped', 'تم الشحن'], ['received', 'وصل المخزون'], ['الكل', 'الكل']].map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk">السداد <select class="inp" data-chg="filter" data-f="po.pay">${opts(['غير مسدد', 'مسدد جزئيًا', 'مسدد', 'غير محدد'], f.pay, true)}</select></label>
      <label class="chk">المخلّص <select class="inp" data-chg="filter" data-f="po.agent">${opts(agents, f.agent, true)}</select></label>
      <input type="search" id="qPo" placeholder="بحث برقم الأمر أو الصنف…" value="${esc(f.q)}" data-search="po.q">
      <span class="grow"></span><span class="pill brand">${fmt(rows.length)} أمر</span><span class="pill brand">الإجمالي ${money(sum('totalSar'))}</span><span class="pill bad">غير المسدد ${money(sum('dueSar'))} ${cur()}</span>
    </div>
    ${table('poList', [
      { k: 'no', h: 'رقم الأمر', f: o => `<b>${esc(o.no)}</b>${o.flags.includes('stillInReport') ? ' <span class="pill warn" title="علّمته واصل لكنه ما زال في تقرير النظام">لا يزال في التقرير</span>' : ''}` },
      { k: 'act', h: '', nosort: true, f: o => `${o.stage === 'issued' ? `<button class="sm" data-act="poQuickShip" data-k="${esc(o.no)}" title="صدرت بوليصة شحن">شحن</button> ` : ''}${o.status === 'open' ? `<button class="sm ok" data-act="poQuickRecv" data-k="${esc(o.no)}" title="تعليم الأمر وصل المخزون">وصل</button> ` : ''}${o.dueSar > 0.5 ? `<button class="sm" data-act="poQuickPay" data-k="${esc(o.no)}" title="تسجيل دفعة">سداد</button>` : ''}` },
      { k: 'stage', h: 'الحالة', v: o => o.stageLabel, f: o => stagePill(o) },
      { k: 'poDate', h: 'تاريخ الأمر' }, { k: 'expShip', h: 'الشحن المتوقع', f: o => o.expShip ? `${esc(o.expShip)}${o.shipLate ? ` <span class="pill bad">تأخر ${o.shipLateDays} يوم</span>` : ''}` : '' }, { k: 'blNo', h: 'البوليصة' }, { k: 'shipDate', h: 'تاريخ الشحن' }, { k: 'attachments', h: '📎', n: true, f: o => o.attachments ? '📎 ' + o.attachments : '' },
      { k: 'lines', h: 'أصناف', n: true }, { k: 'supplier', h: 'المورد' }, { k: 'agent', h: 'المخلّص' },
      { k: 'currency', h: 'العملة', v: o => curName(o.currency) },
      { k: 'value', h: 'القيمة', n: true, d: 2 }, { k: 'shipping', h: 'الشحن', n: true, d: 2 }, { k: 'extrasSar', h: 'تكاليف إضافية ' + cur(), n: true },
      { k: 'totalSar', h: 'الإجمالي ' + cur(), n: true }, { k: 'paidSar', h: 'المدفوع', n: true }, { k: 'dueSar', h: 'المتبقي للسداد', n: true, f: o => `<b>${money(o.dueSar)}</b>` },
      { k: 'payStatus', h: 'السداد', f: o => payPill(o.payStatus) },
      { k: 'eta', h: 'الوصول المتوقع', f: etaCell }, { k: 'firstSeen', h: 'أول ظهور' }, { k: 'note', h: 'ملاحظة', cls: 'wrap' }
    ], rows, { sort: 'eta', dir: 1, onRow: o => poModal(o.no), empty: 'لا توجد أوامر — استورد تقرير أوامر الشراء أو شيت السداد', foot: { no: 'الإجمالي', totalSar: money(sum('totalSar')), paidSar: money(sum('paidSar')), dueSar: money(sum('dueSar')) } })}`;
  }
  function poCash(all) {
    const H = ui.f.cash.horizon !== '' ? num(ui.f.cash.horizon) : (num(db.settings.cashHorizonDays) || 60);
    const stg = ui.f.cash.stage || 'الكل';
    const open = all.filter(o => o.status === 'open' && o.dueSar > 0.5 && (stg === 'الكل' || o.stage === stg));
    const t = today();
    const bucketOf = o => o.daysToEta == null ? 'بدون تاريخ' : o.daysToEta < 0 ? 'متأخر (تجاوز التاريخ)' : o.eta.slice(0, 7);
    const m = new Map();
    for (const o of open) { const k = bucketOf(o); if (!m.has(k)) m.set(k, { key: k, count: 0, dueSar: 0, totalSar: 0, paidSar: 0, shippedSar: 0, issuedSar: 0 }); const g = m.get(k); g.count++; g.dueSar += o.dueSar; g.totalSar += o.totalSar; g.paidSar += o.paidSar; if (o.stage === 'shipped') g.shippedSar += o.dueSar; else g.issuedSar += o.dueSar; }
    const ord = k => k.startsWith('متأخر') ? '0' : k === 'بدون تاريخ' ? '9' : k;
    const buckets = [...m.values()].sort((a, b) => ord(a.key).localeCompare(ord(b.key)));
    let cum = 0; buckets.forEach(b => { cum += b.dueSar; b.cum = cum; });
    const inH = open.filter(o => o.daysToEta != null && o.daysToEta <= H);
    const sum = (a, k = 'dueSar') => a.reduce((x, o) => x + o[k], 0);
    const over = open.filter(o => o.daysToEta != null && o.daysToEta < 0);
    const byCur = new Map(); for (const o of inH) byCur.set(o.currency, (byCur.get(o.currency) || 0) + o.dueSar / o.rate);
    const agentRows = [...inH.reduce((mm, o) => { const k = o.agent || '—'; const g = mm.get(k) || { key: k, count: 0, dueSar: 0 }; g.count++; g.dueSar += o.dueSar; mm.set(k, g); return mm; }, new Map()).values()];
    const shipIn = inH.filter(o => o.stage === 'shipped');
    return `<div class="toolbar"><label class="chk">يشمل <select class="inp" data-chg="filter" data-f="cash.stage">${[['الكل', 'المشحون + الصادر'], ['shipped', 'تم الشحن فقط'], ['issued', 'الصادر فقط']].map(([k, l]) => `<option value="${k}" ${stg === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="chk">خلال <select class="inp" data-chg="filter" data-f="cash.horizon">${[30, 60, 90, 120, 180, 365].map(d => `<option value="${d}" ${d === H ? 'selected' : ''}>${d} يوم</option>`).join('')}</select></label><span class="small">من اليوم ${esc(t)} — الأوامر المفتوحة غير المسددة بالكامل، حسب تاريخ الوصول المتوقع</span></div>
      <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi"><div class="l">مطلوب خلال ${H} يوم (شامل المتأخر)</div><div class="v">${money(sum(inH))}</div><div class="s">${cur()} — ${fmt(inH.length)} أمر${[...byCur].map(([c, v]) => c !== db.currencies[0].code ? ` — ${money(v)} ${esc(curName(c))}` : '').join('')}</div></div>
        <div class="kpi"><div class="l">منها تم شحنه (عليه بوليصة)</div><div class="v" style="color:var(--warn)">${money(sum(shipIn))}</div><div class="s">${fmt(shipIn.length)} أمر — متأخر ${money(sum(over))} (${fmt(over.length)})</div></div>
        <div class="kpi"><div class="l">بعد ${H} يوم</div><div class="v">${money(sum(open.filter(o => o.daysToEta != null && o.daysToEta > H)))}</div><div class="s">${cur()}</div></div>
        <div class="kpi"><div class="l">إجمالي غير المسدد</div><div class="v">${money(sum(open))}</div><div class="s">${fmt(open.length)} أمر — المدفوع مقدمًا ${money(sum(all.filter(o => o.status === 'open'), 'paidSar'))}</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h2>حسب شهر الوصول</h2>${table('cashBuckets', [
          { k: 'key', h: 'الشهر', v: b => /^\d{4}-\d{2}$/.test(b.key) ? monthLabel(b.key) : b.key }, { k: 'count', h: 'أوامر', n: true },
          { k: 'shippedSar', h: 'منه مشحون', n: true }, { k: 'issuedSar', h: 'منه صادر', n: true }, { k: 'paidSar', h: 'مدفوع مقدمًا', n: true }, { k: 'dueSar', h: 'المطلوب', n: true, f: b => `<b>${money(b.dueSar)}</b>` }, { k: 'cum', h: 'تراكمي', n: true }
        ], buckets, { short: true, nofilter: true, empty: 'لا يوجد كاش مطلوب' })}</div>
        <div class="card"><h2>حسب المخلّص (خلال ${H} يوم)</h2>${table('cashAgents', [{ k: 'key', h: 'المخلّص' }, { k: 'count', h: 'أوامر', n: true }, { k: 'dueSar', h: 'المطلوب', n: true }], agentRows, { short: true, nofilter: true, sort: 'dueSar' })}</div>
      </div>
      <div class="card"><h2>الأوامر المطلوب سدادها خلال ${H} يوم</h2>${table('cashList', [
        { k: 'eta', h: 'الوصول المتوقع', f: etaCell }, { k: 'no', h: 'رقم الأمر' }, { k: 'stage', h: 'الحالة', v: o => o.stageLabel, f: o => stagePill(o) }, { k: 'blNo', h: 'البوليصة' }, { k: 'agent', h: 'المخلّص' }, { k: 'supplier', h: 'المورد' }, { k: 'currency', h: 'العملة', v: o => curName(o.currency) },
        { k: 'total', h: 'الإجمالي بالعملة', n: true, d: 2 }, { k: 'totalSar', h: 'الإجمالي ' + cur(), n: true }, { k: 'paidSar', h: 'مدفوع', n: true }, { k: 'dueSar', h: 'المطلوب', n: true, f: o => `<b>${money(o.dueSar)}</b>` },
        { k: 'payStatus', h: 'السداد', f: o => payPill(o.payStatus) }, { k: 'note', h: 'ملاحظة', cls: 'wrap' }
      ], inH, { sort: 'eta', dir: 1, onRow: o => poModal(o.no), empty: 'لا يوجد', foot: { no: 'الإجمالي', totalSar: money(sum(inH, 'totalSar')), paidSar: money(sum(inH, 'paidSar')), dueSar: money(sum(inH)) } })}</div>`;
  }
  function poImportResult(kind, r, msg) {
    const list = (title, arr) => arr.length ? `<h3>${title} (${fmt(arr.length)})</h3><div class="small" style="line-height:1.9">${arr.map(esc).join('، ')}</div>` : '';
    const body = kind === 'po'
      ? list('أوامر جديدة', r.newOrders) + list('وصل المخزون (اختفى من التقرير)', r.closed) + list('وصل المخزون (الكمية المتبقية صفر)', r.completed) + list('أعيد فتحها (رجعت للتقرير)', r.reopened) +
        (r.added.length ? `<div class="banner warn" style="margin-top:10px">أضيف ${fmt(r.added.length)} صنف غير موجود كـ «غير مصنف»: ${r.added.map(a => esc(a.code)).join('، ')}</div>` : '') +
        (db.settings.poAsTransit && db.transit.length ? `<div class="banner warn" style="margin-top:10px">يوجد ${fmt(db.transit.length)} سطر بضاعة بالطريق مُدخل يدويًا — إذا كانت نفس هذه الأوامر امسحها حتى لا تنخصم مرتين.</div>` : '')
      : list('صارت «تم الشحن» (موجودة في الشيت = لها بوليصة)', r.shipped) + list('أوامر جديدة من الشيت (بدون أصناف)', r.created) + (r.fromNote.length ? `<div class="banner warn" style="margin-top:10px">دفعات أُخذت من نص الملاحظة — راجع مبلغها وعملتها: ${r.fromNote.map(esc).join('، ')}</div>` : '');
    modal({
      title: kind === 'po' ? 'نتيجة استيراد أوامر الشراء' : 'نتيجة استيراد شيت السداد',
      body: `<div class="banner ok">${esc(msg)}</div>${body}`,
      foot: `<button class="primary" data-close>تم</button>${kind === 'po' && db.settings.poAsTransit && db.transit.length && can('import_data') ? '<button class="danger" data-clr>مسح بالطريق اليدوي</button>' : ''}`,
      onMount: m => { const b = m.q('[data-clr]'); if (b) b.onclick = () => { db.transit = []; log('مسح البضاعة بالطريق اليدوية بعد استيراد أوامر الشراء'); m.close(); commit(); }; }
    });
  }
  function poModal(no) {
    const o = db.po.orders[no]; if (!o) return;
    const sm = E.poSummary(db, today()).find(x => x.no === no);
    const canPay = can('po_payments'), canSt = can('po_import') || can('po_payments');
    const dis = c => c ? '' : 'disabled';
    const auto = E.poAutoEta(db, o);
    modal({
      title: `أمر الشراء ${esc(no)}`, size: 'wide',
      body: `<div class="row-flex" style="margin-bottom:12px">${stagePill(sm)}${o.status === 'received' ? `<span class="small">${o.receivedBy === 'auto' ? 'تلقائي: ' + esc(o.receivedNote || '') : 'يدوي'}</span>` : ''}${payPill(sm.payStatus)}${sm.expShip ? `<span class="small">الشحن المتوقع ${esc(sm.expShip)} (تاريخ الأمر + ${fmt(E.poPrepDays(db, o))} يوم)</span>` : ''}<span class="small">أول ظهور ${esc(o.firstSeen || '—')} — آخر تحديث ${esc(o.lastSeen || '—')}</span></div>
      <div class="calc-grid">
        <div class="c"><div class="l">الإجمالي (قيمة + شحن + تكاليف إضافية)</div><div class="v">${fmt(sm.total, 2)} ${esc(curName(sm.currency))}</div></div>
        <div class="c"><div class="l">بالعملة الأساسية</div><div class="v">${money(sm.totalSar)} ${cur()}</div></div>
        <div class="c"><div class="l">المدفوع</div><div class="v">${money(sm.paidSar)}</div></div>
        <div class="c"><div class="l">المتبقي للسداد</div><div class="v" style="color:var(--bad)">${money(sm.dueSar)}</div></div>
      </div>
      <h3>الأصناف والكميات (${fmt((o.lines || []).length)} صنف)</h3>
      ${(o.lines || []).length ? table('poLines', [
        { k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap', v: l => { const it = db.items.find(i => i.code === l.code); return it ? it.name : l.name; } }, { k: 'unit', h: 'الوحدة' },
        { k: 'qty', h: 'كمية الأمر', n: true }, { k: 'invQty', h: 'المستلم', n: true }, { k: 'remaining', h: 'المتبقي (بالطريق)', n: true, f: l => `<b>${fmt(l.remaining)}</b>` },
        { k: 'price', h: 'سعر الوحدة', n: true, d: 4, v: l => num(l.qty) ? num(l.value) / num(l.qty) : null },
        { k: 'value', h: 'القيمة ' + esc(curName(sm.currency)), n: true, d: 2 }, { k: 'valueSar', h: 'القيمة ' + cur(), n: true, v: l => num(l.value) * sm.rate },
        { k: 'remValue', h: 'قيمة المتبقي', n: true, d: 2, v: l => num(l.qty) ? num(l.value) * Math.max(0, num(l.remaining)) / num(l.qty) : 0 }
      ], o.lines, { static: true, short: true, foot: {
        code: 'الإجمالي', qty: fmt((o.lines).reduce((a, l) => a + num(l.qty), 0)), invQty: fmt((o.lines).reduce((a, l) => a + num(l.invQty), 0)), remaining: fmt((o.lines).reduce((a, l) => a + num(l.remaining), 0)),
        value: fmt(sm.value, 2), valueSar: money(sm.value * sm.rate), remValue: fmt(sm.remainingValue, 2) } })
        + `<div class="small" style="margin-top:4px">قيمة الأصناف ${fmt(sm.value, 2)} + الشحن ${fmt(sm.shipping, 2)}${sm.extras ? ' + تكاليف إضافية ' + fmt(sm.extras, 2) : ''} = ${fmt(sm.total, 2)} ${esc(curName(sm.currency))} (${money(sm.totalSar)} ${cur()})</div>`
        : '<div class="empty" style="padding:14px">الأمر بدون أصناف (من شيت السداد أو مضاف يدويًا) — الأصناف تنضاف من استيراد تقرير أوامر الشراء</div>'}
      <h3>بيانات الأمر</h3>
      <div class="form f4">
        <label class="f">المورد<input id="o_sup" value="${esc(o.supplier || '')}" ${dis(canPay)}></label>
        <label class="f">المخلّص<input id="o_agent" value="${esc(o.agent || '')}" ${dis(canPay)}></label>
        <label class="f">العملة<select id="o_cur" ${dis(canPay)}>${db.currencies.map(c => `<option value="${esc(c.code)}" ${o.currency === c.code ? 'selected' : ''}>${esc(c.name)} (${c.rate})</option>`).join('')}</select></label>
        <label class="f">سعر صرف خاص (فارغ = من الإعدادات)<input id="o_rate" type="number" step="any" value="${o.rate || ''}" ${dis(canPay)}></label>
        <label class="f">رسوم الشحن (بعملة الأمر)<input id="o_ship" type="number" step="any" value="${o.shipping || ''}" ${dis(canPay)}></label>
        ${(o.lines || []).length ? '' : `<label class="f">قيمة الأمر (بدون أصناف)<input id="o_val" type="number" step="any" value="${o.manualValue || ''}" ${dis(canPay)}></label>`}
        <label class="f">تاريخ الأمر<input id="o_pd" type="date" value="${esc(o.poDate || '')}" ${dis(canSt || canPay)}></label>
        <label class="f">رقم بوليصة الشحن<input id="o_bl" value="${esc(o.blNo || '')}" ${dis(canSt)}></label>
        <label class="f">تاريخ الشحن<input id="o_sd" type="date" value="${esc(o.shipDate || '')}" ${dis(canSt)}></label>
        <label class="f">الوصول المتوقع — فارغ = تلقائي (${esc(auto || '—')})<input id="o_eta" type="date" value="${esc(o.etaManual ? o.eta : '')}" ${dis(canSt)}></label>
        <label class="f full">ملاحظة<input id="o_note" value="${esc(o.note || '')}" ${dis(canPay || canSt)}></label>
      </div>
      ${trackSectionHtml(o)}
      <h3>المرفقات (البوليصة والأوراق)</h3>
      ${table('poAtt', [
        { k: 'name', h: 'الملف', f: a => `<button class="link" data-openatt="${esc(a.file)}">📄 ${esc(a.name)}</button>` }, { k: 'kind', h: 'النوع' }, { k: 'size', h: 'الحجم', v: a => a.size ? fmt(a.size / 1024, 0) + ' KB' : '' },
        { k: 'addedAt', h: 'التاريخ', v: a => (a.addedAt || '').slice(0, 10) }, { k: 'by', h: 'بواسطة' },
        { k: 'del', h: '', nosort: true, f: a => canSt ? `<button class="sm danger" data-delatt="${esc(a.file)}">حذف</button>` : '' }
      ], o.attachments || [], { static: true, short: true, empty: 'لا توجد مرفقات' })}
      <div class="row-flex" style="margin-top:8px">${canSt ? `<select id="att_kind"><option>بوليصة شحن</option><option>تلكس</option><option>إيميل تأكيد الاتفاق</option><option>مستند تسليم الحاوية فارغة</option><option>فاتورة المورد</option><option>شهادة منشأ</option><option>قائمة تعبئة</option><option>إيصال سداد</option><option>أخرى</option></select><button class="primary" id="att_add">📎 إرفاق ملفات</button>` : ''}<button id="att_folder">فتح مجلد المرفقات</button><span class="small">تنحفظ في مجلد البيانات (المشترك إذا كان على الدرايف)</span></div>
      <h3>التكاليف الإضافية</h3>
      ${table('poExtras', [
        { k: 'date', h: 'التاريخ' }, { k: 'desc', h: 'البيان' }, { k: 'amount', h: 'المبلغ', n: true, d: 2 }, { k: 'currency', h: 'العملة', v: x => curName(x.currency || o.currency) },
        { k: 'sar', h: 'بال' + cur(), n: true, v: x => num(x.amount) * (num(x.rate) > 0 ? num(x.rate) : E.fxRate(db, x.currency || o.currency)) }, { k: 'note', h: 'ملاحظة', cls: 'wrap' }, { k: 'by', h: 'بواسطة' },
        { k: 'del', h: '', nosort: true, f: x => canPay ? `<button class="sm danger" data-delext="${esc(x.id)}">حذف</button>` : '' }
      ], o.extraCosts || [], { static: true, short: true, empty: 'لا توجد تكاليف إضافية', foot: (o.extraCosts || []).length ? { desc: 'الإجمالي', sar: money(sm.extrasSar) } : null })}
      ${canPay ? `<div class="form f4" style="margin-top:10px;align-items:end">
        <label class="f">البيان<input id="x_desc" list="dl_extras" placeholder="جمارك، تخليص، نقل…"></label>
        <label class="f">المبلغ<input id="x_amt" type="number" step="any"></label>
        <label class="f">العملة<select id="x_cur">${db.currencies.map((c, i) => `<option value="${esc(c.code)}" ${i === 0 ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="f">التاريخ<input id="x_date" type="date" value="${today()}"></label>
        <label class="f full">ملاحظة<input id="x_note"></label>
        <button class="primary" id="x_add">+ إضافة تكلفة</button>
        <datalist id="dl_extras">${['جمارك', 'تخليص جمركي', 'نقل داخلي', 'أرضيات', 'تأمين', 'فحص'].map(x => `<option value="${x}">`).join('')}</datalist>
      </div>` : ''}
      <h3>الدفعات</h3>
      ${table('poPays', [
        { k: 'date', h: 'التاريخ' }, { k: 'kind', h: 'النوع' }, { k: 'amount', h: 'المبلغ', n: true, d: 2 }, { k: 'currency', h: 'العملة', v: p => curName(p.currency || o.currency) },
        { k: 'note', h: 'ملاحظة', cls: 'wrap', f: p => esc(p.note || '') + (p.review ? ' <span class="pill warn">راجع</span>' : '') + (p.source === 'sheet' ? ' <span class="pill">من الشيت</span>' : '') }, { k: 'by', h: 'بواسطة' },
        { k: 'del', h: '', nosort: true, f: p => canPay ? `<button class="sm danger" data-delpay="${esc(p.id)}">حذف</button>` : '' }
      ], o.payments || [], { static: true, short: true, empty: 'لا توجد دفعات' })}
      ${canPay ? `<div class="form f4" style="margin-top:10px;align-items:end">
        <label class="f">التاريخ<input id="p_date" type="date" value="${today()}"></label>
        <label class="f">النوع<select id="p_kind"><option>عربون</option><option>دفعة</option><option>سداد كامل</option><option>شحن</option></select></label>
        <label class="f">المبلغ<input id="p_amt" type="number" step="any"></label>
        <label class="f">العملة<select id="p_cur">${db.currencies.map(c => `<option value="${esc(c.code)}" ${o.currency === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="f full">ملاحظة الدفعة<input id="p_note"></label>
        <button class="primary" id="p_add">+ إضافة دفعة</button><button id="p_full">سداد المتبقي بالكامل</button>
      </div>` : ''}
`,
      foot: `<button class="primary" data-save ${canPay || canSt ? '' : 'disabled'}>حفظ</button><button data-close>إغلاق</button><span class="grow"></span>${canSt && o.status === 'open' ? (o.shipped ? '<button data-unship>إلغاء «تم الشحن»</button>' : '<button data-ship>🚢 تم الشحن</button>') : ''}${canSt ? (o.status === 'open' ? '<button class="ok" data-recv>وصل المخزون</button>' : '<button data-reopen>إعادة فتح (لم يصل)</button>') : ''}${can('data_admin') ? '<button class="danger" data-delpo>حذف الأمر</button>' : ''}`,
      onMount: m => {
        const save = () => {
          if (canPay) {
            o.supplier = m.q('#o_sup').value.trim(); o.agent = m.q('#o_agent').value.trim(); o.currency = m.q('#o_cur').value;
            o.rate = m.q('#o_rate').value === '' ? null : num(m.q('#o_rate').value); o.shipping = num(m.q('#o_ship').value);
            if (m.q('#o_val')) o.manualValue = num(m.q('#o_val').value);
          }
          if (canSt) {
            const e = m.q('#o_eta').value; o.eta = e; o.etaManual = !!e;
            o.blNo = m.q('#o_bl').value.trim(); o.shipDate = m.q('#o_sd').value;
            if ((o.blNo || o.shipDate) && !o.shipped && o.status === 'open') { o.shipped = true; o.shippedAt = o.shipDate || today(); o.shippedBy = 'manual'; }
          }
          if (canPay || canSt) { o.note = m.q('#o_note').value.trim(); o.poDate = m.q('#o_pd').value; }
        };
        m.q('[data-save]').onclick = () => { save(); if (m._saveTrack) m._saveTrack(); log('تعديل أمر الشراء ' + no); m.close(); commit(); toast('تم الحفظ', 'ok'); };
        const reopenModal = () => { m.close(); commit(); poModal(no); };
        const add = (amt, kind, curc, note, date) => { o.payments = o.payments || []; o.payments.push({ id: 'P' + Date.now(), date, amount: amt, currency: curc, kind, note, source: 'manual', by: ui.user.name }); log(`دفعة ${fmt(amt, 2)} ${curc} لأمر الشراء ${no}`); };
        const pa = m.q('#p_add');
        if (pa) pa.onclick = () => { const a = num(m.q('#p_amt').value); if (!(a > 0)) return toast('أدخل المبلغ', 'bad'); save(); add(a, m.q('#p_kind').value, m.q('#p_cur').value, m.q('#p_note').value.trim(), m.q('#p_date').value || today()); reopenModal(); };
        const pf = m.q('#p_full');
        if (pf) pf.onclick = () => { save(); const x = E.poSummary(db, today()).find(y => y.no === no); if (!(x.dueSar > 0.5)) return toast('لا يوجد متبقي'); add(+(x.dueSar / x.rate).toFixed(2), 'سداد كامل', o.currency, m.q('#p_note').value.trim(), m.q('#p_date').value || today()); reopenModal(); };
        const xa = m.q('#x_add');
        if (xa) xa.onclick = () => {
          const a = num(m.q('#x_amt').value), d = m.q('#x_desc').value.trim();
          if (!d) return toast('اكتب بيان التكلفة', 'bad'); if (!(a > 0)) return toast('أدخل المبلغ', 'bad');
          save(); o.extraCosts = o.extraCosts || [];
          o.extraCosts.push({ id: 'X' + Date.now(), date: m.q('#x_date').value || today(), desc: d, amount: a, currency: m.q('#x_cur').value, note: m.q('#x_note').value.trim(), by: ui.user.name });
          log(`تكلفة إضافية «${d}» ${fmt(a, 2)} ${m.q('#x_cur').value} على أمر الشراء ${no}`); reopenModal();
        };
        m.q('.modal-body').addEventListener('click', e => { const bx = e.target.closest('[data-delext]'); if (!bx) return; save(); o.extraCosts = (o.extraCosts || []).filter(x => x.id !== bx.dataset.delext); log('حذف تكلفة إضافية من أمر الشراء ' + no); reopenModal(); });
        m.q('.modal-body').addEventListener('click', e => { const b = e.target.closest('[data-delpay]'); if (!b) return; save(); o.payments = o.payments.filter(p => p.id !== b.dataset.delpay); log('حذف دفعة من أمر الشراء ' + no); reopenModal(); });
        const aa = m.q('#att_add');
        if (aa) aa.onclick = async () => {
          const files = await api.attachAdd(no); if (!files.length) return;
          save(); o.attachments = o.attachments || [];
          for (const f of files) o.attachments.push(Object.assign(f, { kind: m.q('#att_kind').value, addedAt: nowStamp(), by: ui.user.name }));
          log(`إرفاق ${files.length} ملف لأمر الشراء ${no}`); reopenModal();
          if (files.some(f => f.size > 20 * 1024 * 1024)) toast('ملف أكبر من 20MB — قد يبطئ مزامنة الدرايف', 'bad');
        };
        m.q('#att_folder').onclick = () => api.attachFolder(no);
        m.q('.modal-body').addEventListener('click', async e => {
          const op = e.target.closest('[data-openatt]'); if (op) { const err = await api.attachOpen(no, op.dataset.openatt); if (err) toast(err, 'bad'); return; }
          const dl = e.target.closest('[data-delatt]'); if (!dl) return;
          if (!await confirmBox('حذف المرفق نهائيًا؟', { ok: 'حذف', danger: true })) return;
          await api.attachRemove(no, dl.dataset.delatt); save(); o.attachments = (o.attachments || []).filter(a => a.file !== dl.dataset.delatt); log('حذف مرفق من أمر الشراء ' + no); reopenModal();
        });
        bindTrackSection(m, o, save, reopenModal);
        const sh = m.q('[data-ship]'); if (sh) sh.onclick = () => { save(); o.shipped = true; o.shippedAt = o.shipDate || today(); o.shippedBy = 'manual'; log('أمر الشراء ' + no + ' تم الشحن (يدوي)'); reopenModal(); };
        const us = m.q('[data-unship]'); if (us) us.onclick = () => { save(); o.shipped = false; o.shippedAt = ''; o.shippedBy = ''; log('إلغاء حالة الشحن لأمر الشراء ' + no); reopenModal(); };
        const rv = m.q('[data-recv]'); if (rv) rv.onclick = () => { save(); o.status = 'received'; o.receivedAt = today(); o.receivedBy = 'manual'; o.receivedNote = 'يدوي — ' + ui.user.name; log('أمر الشراء ' + no + ' وصل المخزون (يدوي)'); m.close(); commit(); };
        const ro = m.q('[data-reopen]'); if (ro) ro.onclick = () => { save(); o.status = 'open'; o.receivedAt = ''; o.receivedBy = ''; o.flags = (o.flags || []).filter(f => f !== 'stillInReport'); log('إعادة فتح أمر الشراء ' + no); m.close(); commit(); };
        const dp = m.q('[data-delpo]'); if (dp) dp.onclick = async () => { if (!await confirmBox(`حذف أمر الشراء ${esc(no)} نهائيًا مع دفعاته؟`, { ok: 'حذف', danger: true })) return; delete db.po.orders[no]; log('حذف أمر الشراء ' + no); m.close(); commit(); };
      }
    });
  }

  // ---------- المعاملات الخارجية (المتابعة من أمر الشراء حتى تسليم الحاوية فارغة) ----------
  const GROUPS = ['عند المورد', 'تحت الشحن', 'عند المخلّص / الميناء', 'في المستودع', 'منتهية'];
  const partyName = id => ((db.parties || []).find(p => p.id === id) || {}).name || '';
  const stageName = id => ((db.shipStages || []).find(s => s.id === id) || {}).name || id;
  function shipRows() {
    const f = ui.f.ship, q = f.q.trim().toLowerCase();
    const po = new Map(E.poSummary(db, today()).map(o => [o.no, o]));
    return E.trackSummary(db, today()).filter(t => {
      if (!t.foreign && !(db.po.orders[t.no].track)) return false;
      if (f.group === 'نشطة' ? t.closed : f.group !== 'الكل' && t.group !== f.group) return false;
      if (f.alert === 'متأخرة' && !t.late) return false;
      if (f.alert === 'غرامة' && !t.demurrageOverdue) return false;
      if (f.alert === 'قربت' && !t.demurrageSoon) return false;
      if (f.party !== 'الكل' && t.forwarder !== f.party && t.clearer !== f.party) return false;
      if (q && !(t.no.toLowerCase().includes(q) || t.blNo.toLowerCase().includes(q) || t.containers.some(c => c.no.toLowerCase().includes(q)) || t.supplier.toLowerCase().includes(q))) return false;
      return true;
    }).map(t => Object.assign(t, { eta: (po.get(t.no) || {}).eta || '', dueSar: (po.get(t.no) || {}).dueSar || 0, payStatus: (po.get(t.no) || {}).payStatus || '' }));
  }
  const trackPill = t => `<span class="pill ${t.closed ? 'ok' : t.late ? 'bad' : t.group === 'عند المورد' ? 'brand' : 'warn'}" title="${esc(t.party)}">${esc(t.stageName)}</span>`;
  const demCell = t => !t.containers.length ? '' : t.demurrageOverdue ? `<span class="pill bad">غرامة! متأخر ${-t.demurrageLeft} يوم</span>` : t.demurrageSoon ? `<span class="pill warn">باقي ${t.demurrageLeft} يوم</span>` : t.containersOpen ? (t.demurrageLeft != null ? `<span class="pill">باقي ${t.demurrageLeft} يوم</span>` : '<span class="small">لم تصل الميناء</span>') : '<span class="pill ok">سُلّمت كلها</span>';
  function demurrageBanner() {
    const ts = E.trackSummary(db, today()).filter(t => !t.closed);
    const over = ts.reduce((a, t) => a + t.containers.filter(c => c.overdue).length, 0), soon = ts.reduce((a, t) => a + t.containers.filter(c => c.soon).length, 0);
    if (!over && !soon) return '';
    return `<div class="banner ${over ? 'bad' : 'warn'} no-print"><span class="grow">🚛 حاويات: ${over ? `<b>${over}</b> تجاوزت أيام السماح (غرامة) ` : ''}${soon ? `<b>${soon}</b> قربت تنتهي أيام سماحها` : ''} — سلّمها فارغة للوكيل</span>${canSee('ship') ? `<button class="sm" data-act="shipAlert" data-k="${over ? 'غرامة' : 'قربت'}">عرض</button>` : ''}</div>`;
  }
  PAGES.ship = function () {
    const f = ui.f.ship;
    const all = E.trackSummary(db, today()).filter(t => t.foreign || db.po.orders[t.no].track);
    const rows = shipRows();
    const cnt = g => all.filter(t => t.group === g).length;
    const parties = (db.parties || []).map(p => p.name);
    return `<div class="page-head"><div><h1>المعاملات الخارجية</h1><div class="sub">متابعة كل أمر شراء خارجي من الإصدار حتى تسليم الحاوية فارغة للوكيل — المرجع: رقم أمر الشراء</div></div>
      <div class="actions"><button class="primary" data-act="import" data-k="track">استيراد تحديث المخلّص / الوكيل</button><button data-act="tpl" data-k="track">قالب التحديث</button>${can('settings') ? '<button data-act="nav" data-p="settings">المراحل والجهات</button>' : ''}</div></div>
      ${demurrageBanner()}
      <div class="kpis" style="grid-template-columns:repeat(6,minmax(0,1fr))">
        ${GROUPS.map(g => `<div class="kpi click" data-act="shipGroup" data-k="${g}" style="cursor:pointer"><div class="l">${g}</div><div class="v">${fmt(cnt(g))}</div><div class="s">أمر</div></div>`).join('')}
        <div class="kpi click" data-act="shipAlert" data-k="متأخرة" style="cursor:pointer"><div class="l">متأخرة في مرحلتها</div><div class="v" style="color:var(--bad)">${fmt(all.filter(t => t.late && !t.closed).length)}</div><div class="s">عدّت المدة المتوقعة</div></div>
      </div>
      <div class="toolbar">
        <label class="chk">المجموعة <select class="inp" data-chg="filter" data-f="ship.group">${opts(['نشطة'].concat(GROUPS), f.group, true)}</select></label>
        <label class="chk">تنبيه <select class="inp" data-chg="filter" data-f="ship.alert">${opts(['متأخرة', 'قربت', 'غرامة'], f.alert, true)}</select></label>
        <label class="chk">الجهة <select class="inp" data-chg="filter" data-f="ship.party">${opts(parties, f.party, true)}</select></label>
        <input type="search" id="qShip" placeholder="بحث برقم الأمر أو البوليصة أو الحاوية…" value="${esc(f.q)}" data-search="ship.q">
        <span class="grow"></span><span class="pill brand">${fmt(rows.length)} أمر</span>
      </div>
      ${table('shipList', [
        { k: 'no', h: 'أمر الشراء', f: t => `<b>${esc(t.no)}</b>` },
        { k: 'act', h: '', nosort: true, f: t => !t.closed && can('shipping') ? `<button class="sm" data-act="shipNext" data-k="${esc(t.no)}" title="نقل للمرحلة التالية">التالية ◀</button>` : '' },
        { k: 'stageIdx', h: 'المرحلة', v: t => t.stageIdx, f: t => trackPill(t) }, { k: 'party', h: 'عند' },
        { k: 'daysIn', h: 'منذ (يوم)', n: true, f: t => t.daysIn == null ? '' : `${t.late ? '<b style="color:var(--bad)">' : ''}${fmt(t.daysIn)}${t.stageDays !== '' && t.stageDays != null ? ' / ' + t.stageDays : ''}${t.late ? '</b>' : ''}` },
        { k: 'group', h: 'المجموعة' }, { k: 'supplier', h: 'المورد' }, { k: 'forwarder', h: 'الوكيل' }, { k: 'clearer', h: 'المخلّص' },
        { k: 'blNo', h: 'البوليصة', f: t => esc(t.blNo) + (t.docType ? ` <span class="small">(${esc(t.docType)})</span>` : '') },
        { k: 'containers', h: 'الحاويات', v: t => t.containers.map(c => c.no).join(' '), f: t => t.containers.length ? `${fmt(t.containers.length)} <span class="small">(${fmt(t.containersOpen)} لم تُسلّم)</span>` : '' },
        { k: 'demurrageLeft', h: 'أيام السماح', n: true, f: demCell },
        { k: 'eta', h: 'الوصول المتوقع' }, { k: 'dueSar', h: 'المتبقي للسداد', n: true }
      ], rows, { sort: 'stageIdx', dir: 1, onRow: t => poModal(t.no), empty: 'لا توجد معاملات خارجية بهذه الفلاتر' })}`;
  };

  // قسم المتابعة داخل شاشة أمر الشراء
  function trackSectionHtml(o) {
    const t = E.trackSummary(db, today(), o.no)[0];
    const ok = can('shipping');
    const dis = ok ? '' : 'disabled';
    const tr = o.track || {};
    const fws = (db.parties || []).filter(p => p.kind === 'forwarder'), cls = (db.parties || []).filter(p => p.kind === 'clearer');
    const stages = db.shipStages || [];
    return `<h3>المتابعة الخارجية</h3>
      <div class="track-bar">${stages.map((s, i) => `<span class="ts ${i < t.stageIdx ? 'done' : i === t.stageIdx ? (t.late ? 'cur late' : 'cur') : ''}" title="${esc(s.party)}${s.days ? ' — ' + s.days + ' يوم' : ''}">${esc(s.name)}</span>`).join('')}</div>
      <div class="row-flex" style="margin:6px 0 10px">${trackPill(t)}<span class="small">عند ${esc(t.party || '—')} منذ ${esc(t.since || '—')}${t.daysIn != null ? ' (' + t.daysIn + ' يوم' + (t.stageDays ? ' من ' + t.stageDays : '') + ')' : ''}${tr.lastStatus ? ' — آخر حالة من المخلّص: «' + esc(tr.lastStatus) + '» ' + esc(tr.lastStatusAt || '') : ''}</span></div>
      <div class="form f4">
        <label class="f">الوكيل / مكتب الشحن<select id="t_fw" ${dis}><option value="">—</option>${fws.map(p => `<option value="${esc(p.id)}" ${tr.forwarder === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="f">المخلّص الجمركي<select id="t_cl" ${dis}><option value="">—</option>${cls.map(p => `<option value="${esc(p.id)}" ${tr.clearer === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="f">نوع مستند الشحن<select id="t_doc" ${dis}><option value="">—</option>${['بوليصة', 'تلكس'].map(x => `<option ${tr.docType === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f">أيام السماح للحاوية (فارغ = ${fmt(t.freeDays)})<input id="t_free" type="number" step="1" min="0" value="${tr.freeDays || ''}" ${dis}></label>
      </div>
      ${ok && !t.closed ? `<div class="form f4" style="margin-top:10px;align-items:end">
        <label class="f">نقل إلى مرحلة<select id="t_stage">${stages.map((s, i) => `<option value="${esc(s.id)}" ${i === Math.min(t.stageIdx + 1, stages.length - 1) ? 'selected' : ''}>${i + 1}. ${esc(s.name)}</option>`).join('')}</select></label>
        <label class="f">التاريخ<input id="t_date" type="date" value="${today()}"></label>
        <label class="f">ملاحظة (مثال: تأكيد بالإيميل / واتساب)<input id="t_note"></label>
        <button class="primary" id="t_go">تحديث المرحلة</button>
      </div>` : ''}
      <h3 style="margin-top:14px">الحاويات</h3>
      ${table('trkCont', [
        { k: 'no', h: 'رقم الحاوية' }, { k: 'portAt', h: 'وصول الميناء', f: c => ok ? `<input type="date" class="cell-input" style="width:130px" data-cdate="portAt" data-cno="${esc(c.no)}" value="${esc(c.portAt || '')}">` : esc(c.portAt || '') },
        { k: 'warehouseAt', h: 'وصول المستودع', f: c => ok ? `<input type="date" class="cell-input" style="width:130px" data-cdate="warehouseAt" data-cno="${esc(c.no)}" value="${esc(c.warehouseAt || '')}">` : esc(c.warehouseAt || '') },
        { k: 'emptyAt', h: 'تسليمها فارغة', f: c => ok ? `<input type="date" class="cell-input" style="width:130px" data-cdate="emptyAt" data-cno="${esc(c.no)}" value="${esc(c.emptyAt || '')}">` : esc(c.emptyAt || '') },
        { k: 'deadline', h: 'آخر موعد بدون غرامة' },
        { k: 'left', h: 'المتبقي', f: c => c.emptyAt ? '<span class="pill ok">سُلّمت</span>' : c.left == null ? '' : c.overdue ? `<span class="pill bad">متأخر ${-c.left} يوم</span>` : `<span class="pill ${c.soon ? 'warn' : ''}">${c.left} يوم</span>` },
        { k: 'del', h: '', nosort: true, f: c => ok ? `<button class="sm danger" data-delcont="${esc(c.no)}">حذف</button>` : '' }
      ], t.containers, { static: true, short: true, empty: 'لا توجد حاويات' })}
      ${ok ? `<div class="row-flex" style="margin-top:8px"><input id="t_cno" placeholder="رقم الحاوية (مثال MSKU1234567)" style="width:240px"><button id="t_cadd">+ إضافة حاوية</button><span class="small">أيام السماح تبدأ من وصول الميناء (تاريخ الحاوية أو تاريخ مرحلة «وصلت الميناء»)</span></div>` : ''}
      <details style="margin-top:10px"><summary class="small" style="cursor:pointer">سجل المراحل (${fmt(t.history.length)})</summary>
      ${table('trkHist', [{ k: 'at', h: 'التاريخ' }, { k: 'stage', h: 'المرحلة', v: h => stageName(h.stage) }, { k: 'note', h: 'ملاحظة', cls: 'wrap' }, { k: 'by', h: 'بواسطة' }, { k: 'source', h: 'المصدر', v: h => h.source === 'sheet' ? 'شيت' : h.source === 'manual' ? 'يدوي' : h.source }], t.history.slice().reverse(), { static: true, short: true, empty: 'لا يوجد' })}</details>`;
  }
  function bindTrackSection(m, o, save, reopenModal) {
    if (!can('shipping')) return;
    const saveTrack = () => {
      o.track = o.track || { history: [], containers: [] };
      o.track.forwarder = m.q('#t_fw').value; o.track.clearer = m.q('#t_cl').value; o.track.docType = m.q('#t_doc').value;
      o.track.freeDays = m.q('#t_free').value === '' ? null : num(m.q('#t_free').value);
    };
    m._saveTrack = saveTrack;
    const go = m.q('#t_go');
    if (go) go.onclick = () => { save(); saveTrack(); E.setTrackStage(db, o, m.q('#t_stage').value, { date: m.q('#t_date').value || today(), by: ui.user.name, note: m.q('#t_note').value.trim() }); log(`أمر الشراء ${o.no}: ${stageName(o.track.stage)}`); reopenModal(); };
    const ca = m.q('#t_cadd');
    if (ca) ca.onclick = () => {
      const no = m.q('#t_cno').value.trim().toUpperCase(); if (!no) return toast('اكتب رقم الحاوية', 'bad');
      save(); saveTrack(); o.track.containers = o.track.containers || [];
      if (o.track.containers.some(c => c.no === no)) return toast('الحاوية موجودة', 'bad');
      o.track.containers.push({ no }); log(`حاوية ${no} لأمر الشراء ${o.no}`); reopenModal();
    };
    m.q('.modal-body').addEventListener('change', e => {
      const d = e.target.closest('[data-cdate]'); if (!d) return;
      const c = (o.track.containers || []).find(x => x.no === d.dataset.cno); if (!c) return;
      c[d.dataset.cdate] = d.value;
      const fin = (db.shipStages || []).find(x => x.marks === 'final');
      if (d.dataset.cdate === 'emptyAt' && fin && o.track.containers.every(x => x.emptyAt) && o.track.stage !== fin.id) { save(); saveTrack(); E.setTrackStage(db, o, fin.id, { date: d.value, by: ui.user.name, note: 'كل الحاويات سُلّمت فارغة' }); toast('كل الحاويات سُلّمت فارغة — المعاملة انتهت', 'ok'); }
      log(`حاوية ${c.no}: ${d.dataset.cdate} ${d.value}`); reopenModal();
    });
    m.q('.modal-body').addEventListener('click', e => { const b = e.target.closest('[data-delcont]'); if (!b) return; save(); saveTrack(); o.track.containers = o.track.containers.filter(c => c.no !== b.dataset.delcont); reopenModal(); });
  }

  // إعدادات المراحل والجهات
  function shipSettingsHtml() {
    const st = db.shipStages || [];
    const marks = [['', '—'], ['shipped', '= تم الشحن'], ['port', '= وصول الميناء (تبدأ أيام السماح)'], ['received', '= وصل المخزون'], ['final', '= نهاية المعاملة']];
    return `<div class="card"><h2>مراحل المعاملات الخارجية</h2>
      <div class="hint">رتّبها وغيّر أسماءها ومددها كما تبغى. «المدة» = الأيام المتوقعة في المرحلة (فارغ = بدون تنبيه تأخير). «الأثر» يربط المرحلة بالحالة العامة للأمر والكاش وأيام السماح.</div>
      <div style="overflow:auto"><table class="t" style="margin-top:8px"><thead><tr><th>#</th><th>المرحلة</th><th>عند (الجهة)</th><th>المدة (يوم)</th><th>الأثر</th><th>أوامر فيها</th><th></th></tr></thead><tbody>
      ${st.map((s, i) => `<tr><td>${i + 1}</td>
        <td><input class="inp" style="width:280px" data-chg="stg" data-i="${i}" data-k="name" value="${esc(s.name)}"></td>
        <td><input class="inp" style="width:110px" data-chg="stg" data-i="${i}" data-k="party" value="${esc(s.party || '')}"></td>
        <td><input class="inp" style="width:70px" type="number" step="1" min="0" data-chg="stg" data-i="${i}" data-k="days" value="${esc(s.days)}"></td>
        <td><select class="inp" data-chg="stg" data-i="${i}" data-k="marks">${marks.map(([k, l]) => `<option value="${k}" ${s.marks === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="n">${fmt(E.trackSummary(db, today()).filter(t => t.stageId === s.id && !t.closed).length)}</td>
        <td><button class="sm" data-act="stgMove" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button> <button class="sm" data-act="stgMove" data-i="${i}" data-d="1" ${i < st.length - 1 ? '' : 'disabled'}>▼</button> <button class="sm danger" data-act="stgDel" data-i="${i}">حذف</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row-flex" style="margin-top:8px"><button class="sm" data-act="stgAdd">+ إضافة مرحلة</button><button class="sm" data-act="stgReset">استرجاع المراحل الافتراضية</button></div>
      <div class="form f4" style="margin-top:12px">
        <label class="f">أيام السماح الافتراضية للحاوية<input class="inp" type="number" step="1" min="0" data-chg="set" data-k="defaultFreeDays" value="${esc(db.settings.defaultFreeDays)}"></label>
        <label class="f">نبّهني قبل انتهاء أيام السماح بـ (يوم)<input class="inp" type="number" step="1" min="0" data-chg="set" data-k="demurrageWarnDays" value="${esc(db.settings.demurrageWarnDays)}"></label>
      </div></div>
    <div class="card"><h2>الوكلاء ومكاتب الشحن والمخلّصين</h2>
      <div class="hint">أيام السماح للوكيل تغلب الافتراضي. لكل جهة جدول «تحويل الحالات»: النص اللي يكتبه المخلّص في شيته ← مرحلتنا.</div>
      <div style="overflow:auto"><table class="t" style="margin-top:8px"><thead><tr><th>النوع</th><th>الاسم</th><th>الشخص المسؤول</th><th>الجوال</th><th>الإيميل</th><th>أيام السماح</th><th>تحويل الحالات</th><th></th></tr></thead><tbody>
      ${(db.parties || []).map((p, i) => `<tr>
        <td><select class="inp" data-chg="party" data-i="${i}" data-k="kind"><option value="forwarder" ${p.kind === 'forwarder' ? 'selected' : ''}>وكيل / مكتب شحن</option><option value="clearer" ${p.kind === 'clearer' ? 'selected' : ''}>مخلّص جمركي</option></select></td>
        <td><input class="inp" style="width:150px" data-chg="party" data-i="${i}" data-k="name" value="${esc(p.name)}"></td>
        <td><input style="width:120px" data-chg="party" data-i="${i}" data-k="contact" value="${esc(p.contact || '')}"></td>
        <td><input style="width:110px" data-chg="party" data-i="${i}" data-k="phone" value="${esc(p.phone || '')}"></td>
        <td><input style="width:160px" data-chg="party" data-i="${i}" data-k="email" value="${esc(p.email || '')}"></td>
        <td><input class="inp" style="width:70px" type="number" step="1" min="0" data-chg="party" data-i="${i}" data-k="freeDays" value="${p.freeDays == null ? '' : p.freeDays}"></td>
        <td><button class="sm" data-act="partyMap" data-i="${i}">${fmt((p.statusMap || []).length)} حالة ✎</button></td>
        <td><button class="sm danger" data-act="partyDel" data-i="${i}">حذف</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">لا توجد جهات بعد</td></tr>'}
      </tbody></table></div>
      <div class="row-flex" style="margin-top:8px"><button class="sm" data-act="partyAdd" data-k="forwarder">+ وكيل / مكتب شحن</button><button class="sm" data-act="partyAdd" data-k="clearer">+ مخلّص جمركي</button><button class="sm" data-act="partyMap" data-i="-1">تحويل الحالات العام (${fmt((db.trackStatusMap || []).length)})</button></div>
    </div>`;
  }
  function statusMapModal(i, preset, after) {
    const p = i >= 0 ? db.parties[i] : null;
    const list = (p ? (p.statusMap = p.statusMap || []) : (db.trackStatusMap = db.trackStatusMap || []));
    const rows = list.map(x => Object.assign({}, x)).concat((preset || []).filter(t => !list.some(x => x.text === t)).map(t => ({ text: t, stage: '' })));
    const row = (x, k) => `<tr><td><input data-mt="${k}" value="${esc(x.text)}" style="width:100%"></td><td><select data-ms="${k}"><option value="">— اختر —</option>${db.shipStages.map(s => `<option value="${esc(s.id)}" ${x.stage === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td></tr>`;
    modal({
      title: 'تحويل الحالات — ' + (p ? esc(p.name) : 'عام لكل الجهات'),
      body: `<div class="hint">اكتب الحالة كما تجي في شيت ${p ? 'هذه الجهة' : 'المخلّص'} واختر مرحلتنا المقابلة. المطابقة تتجاهل الهمزات والتاء المربوطة.</div>
        <table class="t" style="margin-top:8px"><thead><tr><th>نص الحالة في الشيت</th><th>مرحلتنا</th></tr></thead><tbody id="mapBody">${rows.map(row).join('')}</tbody></table>
        <button class="sm" id="mapAdd" style="margin-top:8px">+ إضافة حالة</button>`,
      foot: `<button class="primary" data-ok>حفظ</button><button data-close>إلغاء</button>`,
      onMount: m => {
        let k = rows.length;
        m.q('#mapAdd').onclick = () => m.q('#mapBody').insertAdjacentHTML('beforeend', row({ text: '', stage: '' }, k++));
        m.q('[data-ok]').onclick = () => {
          const out = [];
          m.qa('[data-mt]').forEach(inp => { const s = m.q(`[data-ms="${inp.dataset.mt}"]`).value; if (inp.value.trim() && s) out.push({ text: inp.value.trim(), stage: s }); });
          list.splice(0, list.length, ...out); log('تحديث تحويل الحالات ' + (p ? p.name : 'العام')); m.close(); commit();
          if (after) after();
        };
      }
    });
  }

  // ---------- الأرشيف ----------
  PAGES.archive = function () {
    const rows = db.archive.slice().sort((a, b) => b.orderMonth.localeCompare(a.orderMonth));
    return `<div class="page-head"><div><h1>أرشيف الطلبات المعتمدة</h1><div class="sub">نسخة ثابتة من كل طلب شهري تم اعتماده</div></div></div>
      ${table('arch', [
        { k: 'orderMonth', h: 'شهر الطلب', v: a => a.orderMonth, f: a => `<b>${monthLabel(a.orderMonth)}</b>` },
        { k: 'approvedAt', h: 'تاريخ الاعتماد', v: a => a.approvedAt, f: a => esc(a.approvedAt.replace('T', ' ').slice(0, 16)) },
        { k: 'approver', h: 'المعتمد' }, { k: 'count', h: 'أصناف مطلوبة', n: true, v: a => a.totals.ordered },
        { k: 'value', h: 'قيمة الطلب', n: true, v: a => a.totals.orderValue, f: a => money(a.totals.orderValue) },
        { k: 'stockDate', h: 'المخزون كما في' }, { k: 'note', h: 'ملاحظات', cls: 'wrap' },
        { k: 'act', h: '', nosort: true, f: a => `<button class="sm" data-act="archView" data-k="${a.id}">عرض</button> <button class="sm" data-act="archExport" data-k="${a.id}">تصدير</button> <button class="sm danger" data-act="archDel" data-k="${a.id}">حذف</button>` }
      ], rows, { empty: 'لا توجد طلبات معتمدة بعد' })}`;
  };

  // ---------- الإعدادات ----------
  PAGES.settings = function () {
    const s = db.settings;
    const inp = (k, type = 'number', extra = '') => `<input class="inp" type="${type}" ${type === 'number' ? 'step="any"' : ''} data-chg="set" data-k="${k}" value="${esc(s[k])}" ${extra}>`;
    const om = res.orderMonth;
    return `<div class="page-head"><div><h1>الإعدادات وسياسة المخزون</h1><div class="sub">كل المعاملات تُقرأ من هنا — التغيير ينعكس فورًا على الحساب.</div></div></div>
    <div class="card"><h2>المعاملات العامة</h2><div class="form f4">
      <label class="f">آخر شهر مبيعات في التحليل${inp('lastMonth', 'month')}</label>
      <label class="f">فترة المراجعة (شهر)${inp('reviewPeriod', 'number', 'min="0"')}</label>
      <label class="f">عدد أشهر المتوسط${inp('nMonths', 'number', 'min="1" max="36" step="1"')}</label>
      <label class="f">تاريخ رصيد المخزون<input class="inp" type="date" data-chg="stockDate" value="${esc(db.stock.date)}"></label>
      <label class="f">حد الفئة A (نسبة تراكمية %)<input class="inp" type="number" step="any" data-chg="setPct" data-k="thrA" value="${s.thrA * 100}"></label>
      <label class="f">حد الفئة B (نسبة تراكمية %)<input class="inp" type="number" step="any" data-chg="setPct" data-k="thrB" value="${s.thrB * 100}"></label>
      <label class="f">أساس المخزون الإضافي<select class="inp" data-chg="set" data-k="extraBasis"><option value="avg_std" ${s.extraBasis === 'avg_std' ? 'selected' : ''}>(المتوسط + الانحراف) × الأشهر</option><option value="avg" ${s.extraBasis === 'avg' ? 'selected' : ''}>المتوسط × الأشهر</option></select></label>
      <label class="f">نطاق تصنيف ABC<select class="inp" data-chg="set" data-k="classifyScope"><option value="all" ${s.classifyScope === 'all' ? 'selected' : ''}>كل الأصناف</option><option value="active" ${s.classifyScope === 'active' ? 'selected' : ''}>الأصناف النشطة فقط</option></select></label>
      <label class="f">النوع الافتراضي للأصناف الجديدة<select class="inp" data-chg="set" data-k="defaultType">${opts(db.types.map(t => t.name), s.defaultType)}</select></label>
      <label class="f">فترة التوصيل لنوع غير معروف (شهر)${inp('defaultLead')}</label>
      <label class="f">الاحتفاظ بالمبيعات (شهر)${inp('keepMonths', 'number', 'min="6" step="1"')}</label>
      <label class="f">العملة${inp('currency', 'text')}</label>
      <label class="f full">اسم الشركة (للطباعة)${inp('companyName', 'text')}</label>
    </div><p class="hint">أشهر التحليل: ${res.months.map(monthLabel).join('، ') || '—'} — شهر الطلب: ${monthLabel(om) || '—'}</p></div>

    <div class="card"><h2>أنواع الأصناف — فترة التوصيل والفترة الإضافية</h2>
      <div class="hint">«الفترة الإضافية» = أشهر مخزون فوق السياسة بقرار الإدارة، ثابتة لين تغيّرها. يمكن تحديد قيمة خاصة لصنف من شاشة الصنف.</div>
      <div style="overflow:auto"><table class="t" style="margin-top:8px"><thead><tr><th>النوع</th><th>فترة التوصيل (شهر)</th><th>أشهر إضافية</th><th>عملة الشراء</th><th title="من تاريخ الأمر حتى صدور البوليصة — صفر = بدون مرحلة شحن">التجهيز حتى الشحن (يوم)</th><th>ملاحظة</th><th>أصناف</th><th></th></tr></thead><tbody>
      ${db.types.map((t, i) => `<tr><td><input class="inp" style="width:100px" data-chg="type" data-i="${i}" data-k="name" value="${esc(t.name)}"></td>
        <td><input class="inp" style="width:80px" type="number" step="any" min="0" data-chg="type" data-i="${i}" data-k="leadTime" value="${t.leadTime}"></td>
        <td><input class="inp" style="width:80px" type="number" step="any" min="0" data-chg="type" data-i="${i}" data-k="extraMonths" value="${t.extraMonths}"></td>
        <td><select class="inp" data-chg="type" data-i="${i}" data-k="currency">${db.currencies.map(c => `<option value="${esc(c.code)}" ${t.currency === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
        <td><input class="inp" style="width:80px" type="number" step="1" min="0" data-chg="type" data-i="${i}" data-k="prepDays" value="${num(t.prepDays)}"></td>
        <td><input style="width:90px" data-chg="type" data-i="${i}" data-k="note" value="${esc(t.note || '')}"></td>
        <td class="n">${fmt(db.items.filter(x => x.type === t.name).length)}</td>
        <td><button class="sm danger" data-act="delType" data-i="${i}">حذف</button></td></tr>`).join('')}
      </tbody></table></div><button class="sm" data-act="addType" style="margin-top:8px">+ إضافة نوع</button></div>
    <div>

    <div class="card"><h2>التصنيف ومستوى الخدمة ومعامل Z</h2>
      <div class="hint">الحرف الأول = تصنيف الكمية، الثاني = تصنيف تكلفة البيع. Z = NORMSINV(مستوى الخدمة) ويُحسب تلقائيًا.</div>
      <table class="t" style="margin-top:8px"><thead><tr><th>التصنيف</th><th>مستوى الخدمة %</th><th class="n">Z</th><th class="n">أصناف</th></tr></thead><tbody>
      ${db.classes.map((c, i) => `<tr><td><span class="cls">${c.code}</span></td><td><input class="inp" style="width:90px" type="number" step="any" min="0" max="99.99" data-chg="cls" data-i="${i}" value="${+(c.service * 100).toFixed(4)}"></td><td class="n">${fmt(E.normsinv(c.service), 4)}</td><td class="n">${fmt(res.rows.filter(r => r.cls === c.code).length)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="card"><h2>العملات وأسعار الصرف (لأوامر الشراء والكاش)</h2>
      <div class="hint">كل المبالغ تتحول للعملة الأساسية (${esc(cur())}) بسعر الصرف هنا. تقدر تحدد سعر صرف خاص لأمر معيّن من شاشة الأمر.</div>
      <table class="t" style="margin-top:8px;max-width:620px"><thead><tr><th>الرمز</th><th>الاسم</th><th>سعر الصرف (= كم ${esc(cur())})</th><th></th></tr></thead><tbody>
      ${db.currencies.map((c, i) => `<tr><td><input class="inp" style="width:80px" data-chg="cur" data-i="${i}" data-k="code" value="${esc(c.code)}"></td><td><input class="inp" style="width:120px" data-chg="cur" data-i="${i}" data-k="name" value="${esc(c.name)}"></td><td><input class="inp" style="width:100px" type="number" step="any" min="0" data-chg="cur" data-i="${i}" data-k="rate" value="${c.rate}"></td><td>${i ? `<button class="sm danger" data-act="delCur" data-i="${i}">حذف</button>` : '<span class="small">الأساسية</span>'}</td></tr>`).join('')}
      </tbody></table><button class="sm" data-act="addCur" style="margin-top:8px">+ إضافة عملة</button>
      <div class="form f4" style="margin-top:12px"><label class="f">أفق الكاش المطلوب (يوم)<input class="inp" type="number" step="1" min="1" data-chg="set" data-k="cashHorizonDays" value="${esc(s.cashHorizonDays)}"></label>
        <label class="f">مدة الشحن حتى الوصول (يوم) — للأوامر المشحونة<input class="inp" type="number" step="1" min="1" data-chg="set" data-k="shipTransitDays" value="${esc(s.shipTransitDays)}"></label>
        <label class="f" style="grid-column:span 3">خصم أوامر الشراء المفتوحة من الطلب كبضاعة بالطريق<select class="inp" data-chg="setBool" data-k="poAsTransit"><option value="0" ${!s.poAsTransit ? 'selected' : ''}>مقفل — أوامر الشراء للمتابعة والكاش فقط، والطلب يعتمد على البضاعة بالطريق اليدوية</option><option value="1" ${s.poAsTransit ? 'selected' : ''}>مفعّل — الكمية المتبقية في الأوامر المفتوحة تنخصم من الطلب تلقائيًا</option></select></label></div>
    </div>

    <div class="card"><h2>الفترات الاستثنائية المؤقتة</h2>
      <div class="hint">أشهر إضافية مؤقتة (مثل موسم أو رمضان) تسري فقط على أشهر الطلب بين «من» و«إلى»، وتُضاف فوق الفترة الإضافية الثابتة، وبعدها ترجع تلقائيًا. النطاق: الكل، نوع، مجموعة، صنف رئيسي، أو أرقام أصناف (مفصولة بفاصلة).</div>
      <div style="overflow:auto"><table class="t" style="margin-top:8px"><thead><tr><th>مفعّلة</th><th>الاسم</th><th>من شهر طلب</th><th>إلى شهر طلب</th><th>النطاق</th><th>القيمة</th><th>أشهر إضافية</th><th>سارية على ${monthLabel(om)}</th><th></th></tr></thead><tbody>
      ${db.exceptions.map((x, i) => {
        const applies = x.enabled && (!x.fromMonth || om >= x.fromMonth) && (!x.toMonth || om <= x.toMonth);
        const cnt = applies ? db.items.filter(it => E.exceptionApplies(x, it, om)).length : 0;
        let valInput;
        if (x.scope === 'type') valInput = `<select class="inp" data-chg="exc" data-i="${i}" data-k="value">${opts(db.types.map(t => t.name), x.value)}</select>`;
        else if (x.scope === 'group') valInput = `<select class="inp" data-chg="exc" data-i="${i}" data-k="value">${opts(db.groups, x.value)}</select>`;
        else if (x.scope === 'all') valInput = '<span class="small">—</span>';
        else valInput = `<input class="inp" style="width:180px" data-chg="exc" data-i="${i}" data-k="value" value="${esc(x.value || '')}" placeholder="${x.scope === 'item' ? '01-05557, 01-05558' : 'اسم الصنف الرئيسي'}">`;
        return `<tr><td><input type="checkbox" data-chg="exc" data-i="${i}" data-k="enabled" ${x.enabled ? 'checked' : ''}></td>
        <td><input class="inp" style="width:130px" data-chg="exc" data-i="${i}" data-k="name" value="${esc(x.name)}"></td>
        <td><input class="inp" type="month" data-chg="exc" data-i="${i}" data-k="fromMonth" value="${esc(x.fromMonth)}"></td>
        <td><input class="inp" type="month" data-chg="exc" data-i="${i}" data-k="toMonth" value="${esc(x.toMonth)}"></td>
        <td><select class="inp" data-chg="exc" data-i="${i}" data-k="scope">${[['all', 'كل الأصناف'], ['type', 'نوع'], ['group', 'مجموعة'], ['mainItem', 'صنف رئيسي'], ['item', 'أصناف محددة']].map(([k, l]) => `<option value="${k}" ${x.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${valInput}</td>
        <td><input class="inp" style="width:70px" type="number" step="any" data-chg="exc" data-i="${i}" data-k="months" value="${x.months}"></td>
        <td>${applies ? `<span class="pill warn">نعم — ${fmt(cnt)} صنف</span>` : '<span class="pill">لا</span>'}</td>
        <td><button class="sm danger" data-act="delExc" data-i="${i}">حذف</button></td></tr>`;
      }).join('') || '<tr><td colspan="9" class="muted">لا توجد فترات استثنائية</td></tr>'}
      </tbody></table></div><button class="sm" data-act="addExc" style="margin-top:8px">+ إضافة فترة استثنائية</button></div>

    <div class="grid g2">
    ${shipSettingsHtml()}
    <div class="card"><h2>المجموعات الرئيسية</h2>
      <div class="month-chips">${db.groups.map((g, i) => `<span class="chip">${esc(g)} <span class="small">${fmt(db.items.filter(x => x.group === g).length)}</span> <span class="x" data-act="renGroup" data-i="${i}" title="إعادة تسمية">✎</span> <span class="x" data-act="delGroup" data-i="${i}" title="حذف">✕</span></span>`).join('')}</div>
      <button class="sm" data-act="addGroup" style="margin-top:10px">+ إضافة مجموعة</button></div>

    <div class="card"><h2>البيانات والنسخ الاحتياطي</h2>
      <div class="hint">نسخة احتياطية تلقائية يوميًا على هذا الجهاز (آخر 60) + نسخة قبل كل استيراد واعتماد واسترجاع.</div>
      <div class="row-flex" style="margin-top:10px">
        <button data-act="exportBackup">تصدير نسخة احتياطية</button><button data-act="restoreBackup">استرجاع نسخة</button><button data-act="openData">فتح مجلد البيانات</button>
      </div>
      <div class="row-flex" style="margin-top:10px"><button data-act="importLegacy">استيراد ملف الإكسيل القديم (يستبدل كل البيانات)</button><button class="danger" data-act="resetAll">مسح كل البيانات</button></div>
      <p class="small" id="appInfo"></p></div>
    </div>
    <div class="card"><h2>المجلد المشترك (Google Drive) والتحديثات</h2>
      <div class="hint">لمشاركة البيانات بين أكثر من جهاز: ثبّت «Google Drive for desktop» على كل جهاز، واختر نفس المجلد هنا (مثال: <code>G:\\My Drive\\PurchasePlanner</code>). أول مستخدم يفتح البرنامج يأخذ قفل التعديل، والباقي يفتحون للعرض فقط ويتحدث عندهم العرض تلقائيًا.</div>
      <table class="t" style="margin-top:10px"><tbody>
        <tr><td style="width:180px">مجلد البيانات على هذا الجهاز</td><td><code>${esc(ui.cfg ? ui.cfg.dataDir : '')}</code> ${ui.cfg && ui.cfg.isDefault ? '<span class="pill">محلي</span>' : '<span class="pill brand">مشترك</span>'}</td>
          <td><button class="sm" data-act="chooseShared">اختيار مجلد مشترك</button> ${ui.cfg && !ui.cfg.isDefault ? '<button class="sm" data-act="resetDataDir">الرجوع للمحلي</button>' : ''} <button class="sm" data-act="openData">فتح</button></td></tr>
        <tr><td>التحديثات</td><td>من GitHub تلقائيًا عند الدخول</td><td><button class="sm" data-act="checkUpdate">فحص التحديثات</button></td></tr>
        <tr><td>هذا الجهاز</td><td>${esc(ui.cfg ? ui.cfg.machine : '')} — الإصدار ${esc(ui.cfg ? ui.cfg.version : '')}</td><td></td></tr>
      </tbody></table>

    </div>`;
  };

  // ================= الاستيراد =================
  async function startImport(kind, mode) {
    let wb;
    try { wb = await api.openExcel({ title: 'اختر ملف ' + I.KINDS[kind].title }); }
    catch (e) { return toast('تعذر قراءة الملف: ' + e.message, 'bad'); }
    if (!wb) return;
    const sheets = wb.sheets.filter(s => s.rows.length);
    if (!sheets.length) return toast('الملف فارغ', 'bad');
    importWizard(kind, wb, sheets, mode);
  }

  function importWizard(kind, wb, sheets, mode) {
    const K = I.KINDS[kind];
    // اختيار أنسب ورقة
    let si = 0, bestScore = -1;
    sheets.forEach((s, i) => { const d = I.detectHeader(s.rows, kind); if (d.score > bestScore) { bestScore = d.score; si = i; } });
    const st = { si, det: I.detectHeader(sheets[si].rows, kind) };
    const s = db.settings;
    const defMonth = s.lastMonth ? monthAdd(s.lastMonth, 1) : new Date().toISOString().slice(0, 7);
    const colName = c => { let n = '', x = c + 1; while (x > 0) { const m = (x - 1) % 26; n = String.fromCharCode(65 + m) + n; x = Math.floor((x - 1) / 26); } return n; };
    let keyField = kind === 'po' || kind === 'poPay' ? 'poNo' : 'code';
    const curHint = () => { const hdr = sheets[st.si].rows[st.det.row] || []; return I.currencyFromHeader(hdr[st.det.map.value] || hdr[st.det.map.shipping] || ''); };
    const optionsHtml = () => {
      if (kind === 'po') return `<label class="f">تاريخ التقرير<input type="date" class="inp" id="w_date" value="${today()}"></label><div class="small" style="margin-top:22px">التقرير = كل الأوامر المفتوحة الآن. الأمر المفتوح اللي مو موجود فيه يتحول «وصل المخزون».</div>`;
      if (kind === 'track') return `<label class="f">الجهة (لجدول تحويل حالاتها)<select id="w_party" class="inp"><option value="">— عام —</option>${(db.parties || []).map(p => `<option value="${esc(p.id)}" ${p.kind === 'clearer' ? '' : ''}>${esc(p.name)} (${p.kind === 'clearer' ? 'مخلّص' : 'وكيل'})</option>`).join('')}</select></label>
        <label class="chk" style="margin-top:22px"><input type="checkbox" id="w_back"> اسمح بالرجوع لمرحلة سابقة</label>
        <div class="small" style="margin-top:22px">المطابقة: رقم الأمر ← رقم البوليصة ← رقم الحاوية.</div>`;
      if (kind === 'poPay') return `<div class="small full" style="margin-top:22px">دفعات «من الشيت» تُستبدل في كل استيراد، والدفعات اللي سجلتها يدويًا تبقى.</div>`;
      if (kind === 'sales') return `<label class="f">شهر المبيعات (إذا الملف ما فيه عمود شهر)<input type="month" class="inp" id="w_month" value="${defMonth}"></label>
        <label class="chk" style="margin-top:22px"><input type="checkbox" id="w_setLast" checked> تحديث «آخر شهر في التحليل» لهذا الشهر إذا كان أحدث</label>`;
      if (kind === 'stock') return `<label class="f">تاريخ رصيد المخزون<input type="date" class="inp" id="w_date" value="${today()}"></label>`;
      if (kind === 'transit') return `<label class="f">طريقة الاستيراد<select id="w_mode" class="inp"><option value="replace" ${mode !== 'append' ? 'selected' : ''}>استبدال البضاعة بالطريق الحالية</option><option value="append" ${mode === 'append' ? 'selected' : ''}>إضافة تحت الموجود (مصدر آخر)</option></select></label>
        <label class="f">المصدر (إذا الملف ما فيه عمود مصدر)<input id="w_src" value="${esc(wb.name.replace(/\.[^.]+$/, ''))}"></label>`;
      if (kind === 'items') return `<label class="f">طريقة الاستيراد<select id="w_mode" class="inp"><option value="merge">تحديث الأصناف الموجودة + إضافة الجديدة</option><option value="addOnly">إضافة الجديدة فقط</option></select></label>
        <div class="small" style="margin-top:22px">الخلايا الفارغة في الملف لا تمسح البيانات الموجودة.</div>`;
      return '';
    };
    const render = m => {
      const rows = sheets[st.si].rows;
      const ncol = Math.max(...rows.slice(st.det.row, st.det.row + 20).map(r => r.length), 1);
      const hdr = rows[st.det.row] || [];
      const colOpts = sel => `<option value="-1">— لا يوجد —</option>` + Array.from({ length: ncol }, (_, c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${colName(c)}: ${esc(hdr[c] == null ? '' : String(hdr[c]).slice(0, 30))}</option>`).join('');
      m.q('#w_map').innerHTML = K.fields.map(f => `<label class="f">${f.label}${f.required ? ' *' : ''}<select data-field="${f.key}">${colOpts(st.det.map[f.key] != null ? st.det.map[f.key] : -1)}</select></label>`).join('');
      const recs = I.rowsToRecords(rows, st.det.row, st.det.map, keyField);
      const known = new Set(db.items.map(i => i.code));
      if (kind === 'track') keyField = ['poNo', 'blNo', 'containerNo'].find(k => st.det.map[k] >= 0) || 'poNo';
      const newCodes = kind === 'track' ? 0 : kind === 'items' || kind === 'poPay' ? 0 : new Set(recs.filter(r => r.code && !known.has(r.code)).map(r => r.code)).size;
      const poInfo = kind === 'po' ? (() => { const nos = new Set(recs.filter(r => /\d/.test(r.poNo || '')).map(r => r.poNo)); const open = Object.values(db.po.orders).filter(o => o.status === 'open' && (o.lines || []).length); const gone = open.filter(o => !nos.has(o.no)).length; return ` — ${fmt(nos.size)} أمر، منها ${fmt([...nos].filter(n => !db.po.orders[n]).length)} جديد${gone ? ` — <b style="color:var(--warn)">${fmt(gone)} أمر مفتوح غير موجود في الملف سيتحول «وصل المخزون»</b>` : ''}`; })() : kind === 'poPay' ? ` — ${fmt(new Set(recs.map(r => r.poNo)).size)} أمر${curHint() ? ' — العملة من العنوان: ' + curHint() : ''}` : '';
      const shown = K.fields.filter(f => st.det.map[f.key] != null && st.det.map[f.key] >= 0);
      m.q('#w_prev').innerHTML = `<div class="small" style="margin-bottom:6px">${fmt(recs.length)} سطر صالح${poInfo}${newCodes ? ` — <b style="color:var(--warn)">${fmt(newCodes)} صنف غير موجود سيُضاف تلقائيًا كـ «غير مصنف»</b>` : ''}</div>
        <div class="tbl-wrap short" style="max-height:260px"><table class="t"><thead><tr>${shown.map(f => `<th>${f.label}</th>`).join('')}</tr></thead><tbody>
        ${recs.slice(0, 8).map(r => `<tr>${shown.map(f => { let v = r[f.key]; if (v instanceof Date) v = v.toISOString().slice(0, 10); return `<td>${esc(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
      m.q('#w_hdr').value = st.det.row + 1;
    };
    modal({
      title: `استيراد ${K.title} — ${esc(wb.name)}`, size: 'wide',
      body: `<div class="form f4">
          <label class="f">الورقة<select id="w_sheet">${sheets.map((s2, i) => `<option value="${i}" ${i === st.si ? 'selected' : ''}>${esc(s2.name)} (${fmt(s2.rows.length)} صف)</option>`).join('')}</select></label>
          <label class="f">صف العناوين<input type="number" id="w_hdr" min="1" step="1"></label>
          ${optionsHtml()}
        </div>
        <h3>ربط الأعمدة <span class="small">(تم التعرف تلقائيًا — عدّل لو لزم)</span></h3>
        <div class="form f4" id="w_map"></div>
        <h3>معاينة</h3><div id="w_prev"></div>`,
      foot: `<button class="primary" data-ok>استيراد</button><button data-close>إلغاء</button>`,
      onMount: m => {
        render(m);
        m.q('#w_sheet').onchange = e => { st.si = +e.target.value; st.det = I.detectHeader(sheets[st.si].rows, kind); render(m); };
        m.q('#w_hdr').onchange = e => { const r = Math.max(1, +e.target.value) - 1; const d = I.detectHeader(sheets[st.si].rows.slice(r, r + 1), kind); st.det = { row: r, map: d.map, score: d.score }; render(m); };
        m.q('#w_map').addEventListener('change', e => {
          const sel = e.target.closest('[data-field]'); if (!sel) return;
          const v = +sel.value;
          if (v < 0) delete st.det.map[sel.dataset.field]; else st.det.map[sel.dataset.field] = v;
          render(m);
        });
        m.q('[data-ok]').onclick = async () => {
          for (const f of K.fields) if (f.required && !(st.det.map[f.key] >= 0)) return toast(`حدد عمود «${f.label}»`, 'bad');
          if (kind === 'track') {
            keyField = ['poNo', 'blNo', 'containerNo'].find(k => st.det.map[k] >= 0);
            if (!keyField) return toast('حدد عمود رقم الأمر أو البوليصة أو الحاوية', 'bad');
            const recs0 = I.rowsToRecords(sheets[st.si].rows, st.det.row, st.det.map, keyField);
            if (!recs0.length) return toast('لا توجد أسطر صالحة', 'bad');
            await saveNow(); await api.snapshot('before-import-track');
            const opt = { date: today(), user: ui.user.name, file: wb.name, partyId: m.q('#w_party').value, allowBack: m.q('#w_back').checked };
            m.close();
            const run = () => {
              const r = I.applyTrack(db, recs0, opt);
              const msg = `تحديث المتابعة: ${fmt(r.rows)} سطر — ${fmt(r.matched.length)} أمر — تقدمت مرحلته ${fmt(new Set(r.advanced).size)} — حاويات جديدة ${fmt(r.containersAdded)}`;
              log(msg); ui.page = 'ship'; commit(); saveNow();
              const un = Object.keys(r.unmapped);
              modal({
                title: 'نتيجة تحديث المخلّص / الوكيل',
                body: `<div class="banner ok">${esc(msg)}</div>${r.notFound.length ? `<div class="banner warn">ما لقيت ${fmt(r.notFound.length)} سطر (لا رقم أمر ولا بوليصة ولا حاوية مطابقة): ${[...new Set(r.notFound)].slice(0, 30).map(esc).join('، ')}</div>` : ''}
                  ${un.length ? `<div class="banner warn">حالات ما لها مرحلة عندنا (${fmt(un.length)}): ${un.map(t => `«${esc(t)}» ×${r.unmapped[t]}`).join('، ')} — حدد مرحلتها وأعد التطبيق.</div>` : ''}`,
                foot: `<button class="primary" data-close>تم</button>${un.length ? '<button data-map>تحديد مراحل الحالات الجديدة</button>' : ''}`,
                onMount: mm => { const b = mm.q('[data-map]'); if (b) b.onclick = () => { mm.close(); const pi = (db.parties || []).findIndex(p => p.id === opt.partyId); statusMapModal(pi, un, run); }; }
              });
            };
            run();
            return;
          }
          if (kind === 'po' || kind === 'poPay') {
            const recs0 = I.rowsToRecords(sheets[st.si].rows, st.det.row, st.det.map, keyField);
            if (!recs0.length) return toast('لا توجد أسطر صالحة', 'bad');
            await saveNow(); await api.snapshot('before-import-' + kind);
            const opt = { date: kind === 'po' ? m.q('#w_date').value : today(), user: ui.user.name, file: wb.name, currencyHint: curHint() };
            const r = kind === 'po' ? I.applyPOs(db, recs0, opt) : I.applyPOPay(db, recs0, opt);
            const msg = kind === 'po' ? `أوامر الشراء: ${fmt(r.orders)} أمر (${fmt(r.lines)} سطر) — جديد ${fmt(r.newOrders.length)} — وصل المخزون ${fmt(r.closed.length + r.completed.length)}${r.reopened.length ? ' — أعيد فتح ' + fmt(r.reopened.length) : ''}` : `شيت الشحن والسداد: ${fmt(r.orders)} أمر — تم الشحن (جديد) ${fmt(r.shipped.length)} — مسدد بالكامل ${fmt(r.paidFull)} — دفعات من الملاحظات ${fmt(r.fromNote.length)}${r.created.length ? ' — أوامر جديدة ' + fmt(r.created.length) : ''}`;
            log(msg); m.close(); ui.page = 'po'; ui.poTab = 'orders'; commit(); await saveNow();
            poImportResult(kind, r, msg);
            return;
          }
          if (kind === 'sales' && !(st.det.map.issued >= 0) && !(st.det.map.net >= 0)) return toast('حدد عمود «المنصرف» أو «صافي المبيعات»', 'bad');
          const recs = I.rowsToRecords(sheets[st.si].rows, st.det.row, st.det.map, keyField);
          if (!recs.length) return toast('لا توجد أسطر صالحة', 'bad');
          await saveNow(); await api.snapshot('before-import-' + kind);
          let msg = '', added = [];
          if (kind === 'sales') {
            const month = m.q('#w_month').value;
            const r = I.applySales(db, recs, month);
            if (r.months.length > 1 || r.replaced.length) {
              // تم التطبيق بالفعل — للعلم فقط
            }
            added = r.added;
            const newest = r.months[r.months.length - 1];
            if (m.q('#w_setLast').checked && newest && (!db.settings.lastMonth || newest > db.settings.lastMonth)) db.settings.lastMonth = newest;
            pruneSales();
            db.meta.salesAt = nowStamp();
            msg = `تم استيراد ${fmt(r.rows)} سطر مبيعات (${r.months.map(monthLabel).join('، ')})${r.replaced.length ? ' — استُبدل: ' + r.replaced.map(monthLabel).join('، ') : ''}`;
          } else if (kind === 'stock') {
            const r = I.applyStock(db, recs, m.q('#w_date').value);
            db.settings.stockDate = db.stock.date;
            added = r.added; db.meta.stockAt = nowStamp();
            msg = `تم استيراد ${fmt(r.rows)} سطر مخزون`;
          } else if (kind === 'transit') {
            const r = I.applyTransit(db, recs, m.q('#w_mode').value, m.q('#w_src').value);
            added = r.added; db.meta.transitAt = nowStamp();
            msg = `تم استيراد ${fmt(r.rows)} سطر بالطريق`;
          } else if (kind === 'items') {
            const r = I.applyItems(db, recs, m.q('#w_mode').value);
            msg = `الأصناف: أضيف ${fmt(r.added)} — حُدّث ${fmt(r.updated)}`;
          }
          log(msg + (added.length ? ` — أضيف تلقائيًا ${added.length} صنف` : ''));
          m.close();
          commit();
          await saveNow();
          if (added.length) autoAddedAlert(added, msg);
          else toast(msg, 'ok');
        };
      }
    });
  }

  function autoAddedAlert(added, msg) {
    modal({
      title: '⚠ أصناف جديدة أُضيفت كـ «غير مصنف»',
      body: `<p>${esc(msg)}</p><div class="banner warn">وُجد <b>${fmt(added.length)}</b> صنف غير موجود في ملف الأصناف، وأُضيف تلقائيًا بالمجموعة «غير مصنف» والنوع الافتراضي «${esc(db.settings.defaultType)}». راجع نوعه (يحدد فترة التوصيل) ومجموعته ووحداته.</div>
        ${table('autoList', [{ k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'baseUnit', h: 'الوحدة' }, { k: 'notes', h: 'المصدر' }], added, { static: true, short: true, pageSize: 50 })}`,
      foot: `<button class="primary" data-go>مراجعة الأصناف الآن</button><button data-close>لاحقًا</button>`,
      onMount: m => { m.q('[data-go]').onclick = () => { m.close(); reviewAuto(); }; }
    });
  }
  function reviewAuto() {
    Object.assign(ui.f.items, { type: 'الكل', group: 'الكل', active: 'الكل', flag: 'تحتاج تصنيف', q: '' });
    go('items');
  }
  function pruneSales() {
    const keep = Math.max(num(db.settings.keepMonths) || 24, num(db.settings.nMonths) || 6);
    if (!db.settings.lastMonth) return;
    const cutoff = monthAdd(db.settings.lastMonth, -(keep - 1));
    const before = db.sales.length;
    db.sales = db.sales.filter(r => r.month >= cutoff);
    if (db.sales.length < before) toast(`حُذفت ${fmt(before - db.sales.length)} سطر مبيعات أقدم من ${keep} شهر`);
  }

  async function importLegacy() {
    let wb;
    try { wb = await api.openExcel({ title: 'اختر ملف تقرير المشتريات (Excel)', only: ['الأصناف', 'المبيعات', 'المخزون', 'بالطريق', 'الإعدادات', 'الحساب'] }); }
    catch (e) { return toast('تعذر قراءة الملف: ' + e.message, 'bad'); }
    if (!wb) return;
    if (!I.isLegacyWorkbook(wb.sheets)) return toast('الملف لا يحتوي الأوراق المطلوبة: الأصناف، المبيعات، المخزون، الإعدادات', 'bad');
    if (db.items.length && !await confirmBox('سيتم <b>استبدال كل البيانات الحالية</b> ببيانات الملف (الأرشيف يبقى). متأكد؟', { ok: 'استبدال', danger: true })) return;
    await saveNow(); await api.snapshot('before-legacy');
    const nd = I.importLegacy(wb.sheets);
    nd.archive = db.archive || [];
    nd.users = db.users || [];
    nd.log = db.log || [];
    const added = [].concat(I.autoAddItems(nd, nd.sales.filter(r => !r.month || true), 'المبيعات'), I.autoAddItems(nd, nd.stock.rows, 'المخزون'), I.autoAddItems(nd, nd.transit, 'بالطريق'));
    nd.meta = { salesAt: nowStamp(), stockAt: nowStamp(), transitAt: nowStamp(), legacyFrom: wb.name };
    db = migrate(nd);
    log(`استيراد ملف الإكسيل ${wb.name}: ${db.items.length} صنف، ${db.sales.length} سطر مبيعات`);
    commit(); await saveNow();
    const msg = `تم الاستيراد: ${fmt(db.items.length)} صنف — ${fmt(db.sales.length)} سطر مبيعات — ${fmt(db.stock.rows.length)} سطر مخزون — ${fmt(db.transit.length)} بالطريق`;
    if (added.length) autoAddedAlert(added, msg); else toast(msg, 'ok');
    go('dashboard');
  }

  // ================= التصدير =================
  async function exportSpec(spec, name) {
    try { const p = await api.saveExcel(spec, name); if (p) toast('تم الحفظ: ' + p, 'ok'); }
    catch (e) { toast('تعذر التصدير: ' + e.message, 'bad'); }
  }
  function orderExportRows(rows) {
    return rows.map((r, i) => ({
      i: i + 1, code: r.code, name: r.name, mainItem: r.mainItem, type: r.type, group: r.group, cls: r.cls, unit: r.purchaseUnit,
      avg: +(r.avg / r.pf).toFixed(2), stock: +(r.stock / r.pf).toFixed(2), transit: +(r.transit / r.pf).toFixed(2), max: +(r.maxLevel / r.pf).toFixed(2),
      suggested: r.suggested, delta: r.delta || null, final: r.final, cost: +(r.cost * r.pf).toFixed(4), coverage: r.coverageAfter == null ? null : +r.coverageAfter.toFixed(2),
      value: +r.orderValue.toFixed(2), reason: r.reason, approve: ''
    }));
  }
  const ORDER_XCOLS = [
    { header: 'م', key: 'i', width: 6 }, { header: 'رقم الصنف', key: 'code', width: 13 }, { header: 'اسم الصنف', key: 'name', width: 40 }, { header: 'الصنف الرئيسي', key: 'mainItem', width: 18 },
    { header: 'النوع', key: 'type', width: 9 }, { header: 'المجموعة', key: 'group', width: 18 }, { header: 'التصنيف', key: 'cls', width: 8 }, { header: 'الوحدة', key: 'unit', width: 9 },
    { header: 'متوسط شهري', key: 'avg', width: 12, fmt: '#,##0.0' }, { header: 'المخزون', key: 'stock', width: 12, fmt: '#,##0.0' }, { header: 'بالطريق', key: 'transit', width: 12, fmt: '#,##0.0' },
    { header: 'الحد الأقصى', key: 'max', width: 12, fmt: '#,##0.0' }, { header: 'الطلب المقترح', key: 'suggested', width: 12, fmt: '#,##0' }, { header: 'تعديل', key: 'delta', width: 9 },
    { header: 'الطلب النهائي', key: 'final', width: 12, fmt: '#,##0' }, { header: 'تكلفة الوحدة', key: 'cost', width: 12, fmt: '#,##0.00' }, { header: 'التغطية بعد الطلب (شهر)', key: 'coverage', width: 12, fmt: '0.0' },
    { header: 'قيمة الطلب', key: 'value', width: 14, fmt: '#,##0' }, { header: 'سبب التعديل', key: 'reason', width: 24 }, { header: 'اعتماد المشتريات', key: 'approve', width: 14, input: true }
  ];
  function exportOrder() {
    const rows = ui.tableRows.order || orderRows();
    const f = ui.f.order;
    const x = orderExportRows(rows);
    exportSpec({ sheets: [{ name: 'قائمة الطلب', title: `قائمة الطلب الشهرية — ${monthLabel(res.orderMonth)}`, subtitle: `النوع: ${f.type} — المجموعة: ${f.group} — التصنيف: ${f.cls} — المخزون كما في ${db.stock.date || '—'} — المبيعات ${monthLabel(res.months[0])} إلى ${monthLabel(res.months[res.months.length - 1])}`, columns: ORDER_XCOLS, rows: x, totals: { name: 'الإجمالي', value: x.reduce((a, r) => a + r.value, 0) } }] }, `طلب-الشراء-${res.orderMonth}${f.type !== 'الكل' ? '-' + f.type : ''}`);
  }
  async function printOrPdf(pdf) {
    ui.printing = true; render();
    try {
      if (pdf) { const p = await api.savePdf(`طلب-الشراء-${res.orderMonth}`); if (p) toast('تم الحفظ: ' + p, 'ok'); }
      else await api.print();
    } finally { ui.printing = false; render(); }
  }
  function exportCalc() {
    const rows = ui.tableRows.calc || calcRows();
    const cols = calcCols().map(c => ({ header: c.h, key: c.k, width: c.k === 'name' ? 40 : c.k === 'notes' ? 30 : 12, fmt: c.n ? (c.d ? '#,##0.00' : '#,##0') : undefined }));
    const out = rows.map(r => { const o = {}; for (const c of calcCols()) { let v = c.v ? c.v(r) : r[c.k]; if (c.k === 'cls') v = r.cls; if (c.k === 'service') v = r.service; if (Array.isArray(v)) v = v.join('؛ '); if (typeof v === 'number' && !isFinite(v)) v = null; o[c.k] = v; } return o; });
    exportSpec({ sheets: [{ name: 'الحساب', title: `الحساب التفصيلي — طلب ${monthLabel(res.orderMonth)}`, columns: cols, rows: out }] }, `الحساب-${res.orderMonth}`);
  }
  function exportSales() {
    exportSpec({ sheets: [{ name: 'المبيعات', columns: [{ header: 'الشهر', key: 'month', width: 10 }, { header: 'رقم الصنف', key: 'code', width: 13 }, { header: 'اسم الصنف', key: 'name', width: 40 }, { header: 'الوحدة', key: 'unit', width: 9 }, { header: 'الوارد (مرتجع)', key: 'returned', width: 12 }, { header: 'المنصرف', key: 'issued', width: 12 }], rows: db.sales.slice().sort((a, b) => a.month.localeCompare(b.month)) }] }, 'المبيعات');
  }
  // قالب تحديث المخلّص / الوكيل: معبّأ بمعاملاتنا النشطة + قائمة منسدلة بالحالات المعتمدة
  function trackTemplateSpec() {
    const st = db.shipStages || [];
    const ts = E.trackSummary(db, today()).filter(t => !t.closed && (t.foreign || db.po.orders[t.no].track));
    const rows = [];
    for (const t of ts) {
      const base = { poNo: t.no, blNo: t.blNo, status: t.stageName, statusDate: '', note: '' };
      if (t.containers.length) for (const c of t.containers) rows.push(Object.assign({}, base, { containerNo: c.no, portDate: c.portAt || '', warehouseDate: c.warehouseAt || '', emptyDate: c.emptyAt || '' }));
      else rows.push(Object.assign({}, base, { containerNo: '', portDate: '', warehouseDate: '', emptyDate: '' }));
    }
    const listRef = "'الحالات المعتمدة'!$A$2:$A$" + (st.length + 1);
    const cols = I.KINDS.track.fields.map(f => ({ header: f.label, key: f.key, width: f.key === 'status' ? 34 : f.key === 'note' ? 30 : 16, input: f.key !== 'poNo', listRef: f.key === 'status' ? listRef : undefined }));
    return { sheets: [
      { name: 'تحديث المعاملات', title: 'تحديث حالة المعاملات' + (db.settings.companyName ? ' — ' + db.settings.companyName : ''), subtitle: 'سطر لكل حاوية. اختر «حالة المعاملة» من القائمة، واكتب تاريخها والتواريخ بصيغة 2026-12-31. لا تغيّر رقم الأمر. أضف سطر لأي حاوية جديدة.', columns: cols, rows },
      { name: 'الحالات المعتمدة', columns: [{ header: 'الحالة', key: 'name', width: 46 }, { header: 'عند', key: 'party', width: 14 }, { header: 'الترتيب', key: 'i', width: 8 }], rows: st.map((x, i) => ({ name: x.name, party: x.party || '', i: i + 1 })) }
    ] };
  }
  function templateSpec(kind, withData) {
    if (kind === 'track') return trackTemplateSpec();
    const K = I.KINDS[kind];
    const fields = K.fields.filter(f => kind !== 'sales' || f.key !== 'net');
    const cols = fields.map(f => ({ header: f.label.replace(' (اختياري)', ''), key: f.key, width: f.key === 'name' ? 40 : 14, input: true }));
    let rows = [];
    if (withData && kind === 'items') rows = db.items.map(it => {
      const o = Object.assign({}, it, { active: it.active !== false ? 'يعمل' : 'لا يعمل' });
      it.units.slice(0, 3).forEach((u, j) => { o['u' + (j + 2)] = u.name; o['f' + (j + 2)] = u.factor; });
      return o;
    });
    const notes = {
      items: 'وحدة 2/3/4 + معامل = كم وحدة أساسية في هذه الوحدة (مثال: كرتون = 24). نشاط الصنف: يعمل / لا يعمل. فترة توصيل خاصة وأشهر إضافية: فارغ = حسب النوع.',
      sales: 'الشهر اختياري (مثال 2026-11) — إذا تركته فارغًا تختاره عند الاستيراد. الصافي = المنصرف − الوارد.',
      stock: 'الوحدة يجب أن تكون الوحدة الأساسية أو وحدة معرّفة للصنف.',
      transit: 'أوامر الشراء اللي لسه ما وصلت.',
      po: 'سطر لكل صنف في أمر الشراء. ارفع كل الأوامر المفتوحة في كل مرة: الأمر المفتوح اللي ما يكون في الملف يتحول «وصل المخزون». القيمة = إجمالي السطر بعملة الأمر.',
      track: 'سطر لكل حاوية أو أمر. المطابقة برقم الأمر أو البوليصة أو الحاوية. الحالة تتحول لمرحلتنا من جدول «تحويل الحالات» في الإعدادات. التواريخ بصيغة 2026-12-31.',
      poPay: 'سطر لكل أمر تم شحنه (له بوليصة) — وجوده هنا يحوّله «تم الشحن». حالة السداد: تم السداد / لم يتم السداد. المبلغ المدفوع (اختياري) للسداد الجزئي أو العربون. التاريخ بصيغة 2026-12-31.'
    };
    return { sheets: [{ name: K.title, title: 'قالب ' + K.title, subtitle: notes[kind], columns: cols, rows }] };
  }

  // ================= الاعتماد والأرشيف =================
  async function approve() {
    const existing = db.archive.find(a => a.orderMonth === res.orderMonth);
    const adjCount = Object.keys(db.adjustments).length;
    modal({
      title: `اعتماد طلب ${monthLabel(res.orderMonth)}`, size: 'narrow',
      body: `${res.blocking ? `<div class="banner bad">✗ يوجد ${res.blocking} فحص غير سليم — يُفضّل التصحيح قبل الاعتماد</div>` : '<div class="banner ok">✓ الفحوصات الأساسية سليمة</div>'}
        ${existing ? `<div class="banner warn">يوجد اعتماد سابق لنفس الشهر (${esc(existing.approvedAt.slice(0, 10))}) — سيتم استبداله</div>` : ''}
        <p>${fmt(res.totals.ordered)} صنف — قيمة ${money(res.totals.orderValue)} ${cur()}</p>
        <div class="form f2" style="grid-template-columns:1fr">
          <label class="f">المعتمد<input id="a_by" value="${esc(ui.user.name)}" readonly></label>
          <label class="f">ملاحظات<input id="a_note"></label>
          ${adjCount ? `<label class="chk"><input type="checkbox" id="a_clear" checked> مسح التعديلات اليدوية (${adjCount}) بعد الاعتماد لتبدأ الشهر القادم من جديد</label>` : ''}
        </div>`,
      foot: `<button class="ok" data-ok>اعتماد وحفظ في الأرشيف</button><button data-close>إلغاء</button>`,
      onMount: m => {
        m.q('[data-ok]').onclick = async () => {
          await saveNow(); await api.snapshot('before-approve');
          const lines = res.rows.filter(r => r.final > 0 || r.delta !== 0).map(r => ({
            code: r.code, name: r.name, mainItem: r.mainItem, type: r.type, group: r.group, cls: r.cls, purchaseUnit: r.purchaseUnit, pf: r.pf,
            avg: r.avg, std: r.std, stock: r.stock, transit: r.transit, maxLevel: r.maxLevel, suggested: r.suggested, delta: r.delta, reason: r.reason,
            final: r.final, cost: r.cost, orderValue: r.orderValue, coverageAfter: r.coverageAfter, lead: r.lead, extraMonths: r.extraMonths, service: r.service
          }));
          const entry = {
            id: 'A' + Date.now(), orderMonth: res.orderMonth, months: res.months, stockDate: db.stock.date, approvedAt: nowStamp(),
            approver: m.q('#a_by').value.trim(), note: m.q('#a_note').value.trim(),
            settings: JSON.parse(JSON.stringify(db.settings)), types: JSON.parse(JSON.stringify(db.types)), classes: JSON.parse(JSON.stringify(db.classes)),
            exceptions: JSON.parse(JSON.stringify(db.exceptions.filter(x => x.enabled))),
            totals: Object.assign({}, res.totals), byType: res.byType, checks: res.checks.map(c => ({ title: c.title, count: c.count, ok: c.ok, sev: c.sev })), lines
          };
          db.archive = db.archive.filter(a => a.orderMonth !== res.orderMonth).concat([entry]);
          db.meta.lastApprover = entry.approver;
          const clr = m.q('#a_clear');
          if (clr && clr.checked) db.adjustments = {};
          log(`اعتماد طلب ${monthLabel(res.orderMonth)} — ${lines.length} سطر — ${money(res.totals.orderValue)}`);
          m.close(); commit(); await saveNow();
          toast('تم الاعتماد والحفظ في الأرشيف', 'ok');
        };
      }
    });
  }
  function archLines(a) {
    return a.lines.map((r, i) => ({
      i: i + 1, code: r.code, name: r.name, mainItem: r.mainItem, type: r.type, group: r.group, cls: r.cls, unit: r.purchaseUnit,
      avg: +(r.avg / r.pf).toFixed(2), stock: +(r.stock / r.pf).toFixed(2), transit: +(r.transit / r.pf).toFixed(2), max: +(r.maxLevel / r.pf).toFixed(2),
      suggested: r.suggested, delta: r.delta || null, final: r.final, cost: +(r.cost * r.pf).toFixed(4), coverage: r.coverageAfter == null ? null : +r.coverageAfter.toFixed(2),
      value: +r.orderValue.toFixed(2), reason: r.reason, approve: ''
    })).sort((x, y) => y.value - x.value).map((r, i) => Object.assign(r, { i: i + 1 }));
  }
  function archView(id) {
    const a = db.archive.find(x => x.id === id); if (!a) return;
    const rows = archLines(a).filter(r => r.final > 0 || r.delta);
    modal({
      title: `طلب ${monthLabel(a.orderMonth)} — معتمد ${esc(a.approvedAt.slice(0, 10))}${a.approver ? ' — ' + esc(a.approver) : ''}`, size: 'wide',
      body: `<div class="row-flex" style="margin-bottom:10px"><span class="pill brand">${fmt(a.totals.ordered)} صنف</span><span class="pill brand">${money(a.totals.orderValue)} ${cur()}</span><span class="small">المبيعات ${monthLabel(a.months[0])} – ${monthLabel(a.months[a.months.length - 1])} — المخزون ${esc(a.stockDate || '—')} — المراجعة ${a.settings.reviewPeriod} شهر — ${a.types.map(t => `${esc(t.name)}: توصيل ${t.leadTime} + إضافي ${t.extraMonths}`).join(' | ')}${a.exceptions.length ? ' — استثنائية: ' + a.exceptions.map(x => esc(x.name)).join('، ') : ''}</span></div>
        ${a.note ? `<p>${esc(a.note)}</p>` : ''}
        ${table('archLines', [{ k: 'i', h: 'م', n: true }, { k: 'code', h: 'رقم الصنف' }, { k: 'name', h: 'اسم الصنف', cls: 'wrap' }, { k: 'type', h: 'النوع' }, { k: 'cls', h: 'التصنيف' }, { k: 'unit', h: 'الوحدة' },
          { k: 'avg', h: 'متوسط', n: true, d: 1 }, { k: 'stock', h: 'المخزون', n: true, d: 1 }, { k: 'transit', h: 'بالطريق', n: true, d: 1 }, { k: 'max', h: 'الحد الأقصى', n: true, d: 1 },
          { k: 'suggested', h: 'المقترح', n: true }, { k: 'delta', h: 'تعديل', n: true, d: 2 }, { k: 'final', h: 'النهائي', n: true, d: 2 }, { k: 'value', h: 'القيمة', n: true }, { k: 'reason', h: 'السبب' }], rows, { static: true, short: true, pageSize: 200 })}`,
      foot: `<button class="primary" data-x>تصدير Excel</button><button data-close>إغلاق</button>`,
      onMount: m => { m.q('[data-x]').onclick = () => archExport(id); }
    });
  }
  function archExport(id) {
    const a = db.archive.find(x => x.id === id); if (!a) return;
    const x = archLines(a).filter(r => r.final > 0 || r.delta);
    exportSpec({ sheets: [{ name: 'طلب معتمد', title: `طلب الشراء المعتمد — ${monthLabel(a.orderMonth)}`, subtitle: `اعتماد ${a.approvedAt.slice(0, 10)}${a.approver ? ' — ' + a.approver : ''} — المخزون كما في ${a.stockDate || '—'}${a.note ? ' — ' + a.note : ''}`, columns: ORDER_XCOLS, rows: x, totals: { name: 'الإجمالي', value: x.reduce((s, r) => s + r.value, 0) } }] }, `طلب-معتمد-${a.orderMonth}`);
  }

  // ================= الأحداث =================
  const ACT = {
    nav: el => go(el.dataset.p),
    pgExcel: () => { const e = EXPORTS[ui.page]; if (e.custom) return e.custom(); exportTables(typeof e.tables === 'function' ? e.tables() : e.tables, e.title()); },
    pgPdf: () => printOrPdfPage(true),
    pgPrint: () => printOrPdfPage(false),
    tryLock: () => tryLock(false),
    checkUpdate: () => checkUpdate(false),
    myPassword: () => myPassword(),
    logout: async () => { if (!ui.readOnly) { log('تسجيل خروج'); dirty = true; await saveNow(); } await api.releaseLock(); ui.user = null; ui.readOnly = true; render(); },
    addUser: () => userModal(null),
    editUser: el => userModal(el.dataset.k),
    chooseShared: async () => {
      if (ui.user && !can('data_admin')) return deny('data_admin');
      const r = await api.chooseDir('اختر المجلد المشترك على Google Drive');
      if (!r) return;
      let mode = 'use';
      if (r.hasData) {
        if (!await confirmBox(`المجلد فيه بيانات موجودة (data.json). سيستخدم البرنامج <b>بيانات المجلد</b> على هذا الجهاز.`, { ok: 'استخدام بيانات المجلد' })) return;
      } else if (db.items.length || db.users.length) {
        if (!await confirmBox('المجلد فارغ. سيتم <b>نسخ البيانات الحالية</b> إليه ليصبح هو مصدر البيانات المشترك.', { ok: 'نسخ واستخدام' })) return;
        mode = 'copy'; dirty = true; await saveNow();
      }
      await api.setDataDir(r.dir, mode);
      location.reload();
    },
    resetDataDir: async () => {
      if (!await confirmBox('الرجوع لمجلد البيانات المحلي على هذا الجهاز؟ (الملف المشترك لا يُحذف)', { ok: 'رجوع' })) return;
      await api.setDataDir(null, 'default'); location.reload();
    },
    shipGroup: el => { Object.assign(ui.f.ship, { group: el.dataset.k, alert: 'الكل' }); go('ship'); },
    shipAlert: el => { Object.assign(ui.f.ship, { group: 'الكل', alert: el.dataset.k }); go('ship'); },
    shipNext: el => {
      const o = db.po.orders[el.dataset.k]; const i = E.trackStageIndex(db, o); const nx = db.shipStages[i + 1]; if (!nx) return;
      modal({
        title: `أمر ${esc(o.no)}: ${esc(nx.name)}`, size: 'narrow',
        body: `<div class="form" style="grid-template-columns:1fr"><label class="f">التاريخ<input id="n_d" type="date" value="${today()}"></label><label class="f">ملاحظة<input id="n_n" placeholder="مثال: تأكيد بالإيميل"></label></div>`,
        foot: `<button class="primary" data-ok>نقل للمرحلة</button><button data-close>إلغاء</button>`,
        onMount: m => { m.q('[data-ok]').onclick = () => { E.setTrackStage(db, o, nx.id, { date: m.q('#n_d').value || today(), by: ui.user.name, note: m.q('#n_n').value.trim() }); log(`أمر الشراء ${o.no}: ${nx.name}`); m.close(); ui.keepScroll = true; commit(); }; }
      });
    },
    stgMove: el => { const i = +el.dataset.i, j = i + +el.dataset.d; const a = db.shipStages; [a[i], a[j]] = [a[j], a[i]]; commit(); },
    stgDel: async el => {
      const x = db.shipStages[+el.dataset.i];
      const n = E.trackSummary(db, today()).filter(t => t.stageId === x.id && !t.closed).length;
      if (!await confirmBox(`حذف المرحلة «${esc(x.name)}»؟${n ? ` فيها ${n} أمر حاليًا وبترجع لمرحلة ضمنية.` : ''}`, { ok: 'حذف', danger: true })) return;
      db.shipStages.splice(+el.dataset.i, 1); Object.values(db.po.orders).forEach(o => { if (o.track && o.track.stage === x.id) o.track.stage = ''; }); commit();
    },
    stgAdd: () => { db.shipStages.push({ id: 'S' + Date.now(), name: 'مرحلة جديدة', party: '', days: '', marks: '' }); commit(); },
    stgReset: async () => { if (!await confirmBox('استرجاع المراحل الافتراضية؟ المراحل المخصصة تنحذف.', { ok: 'استرجاع', danger: true })) return; db.shipStages = E.defaultShipStages(); commit(); },
    partyAdd: el => { db.parties.push({ id: 'P' + Date.now(), kind: el.dataset.k, name: el.dataset.k === 'clearer' ? 'مخلّص جديد' : 'وكيل جديد', contact: '', phone: '', email: '', freeDays: null, statusMap: [] }); commit(); },
    partyDel: async el => { const p = db.parties[+el.dataset.i]; if (!await confirmBox(`حذف «${esc(p.name)}»؟`, { ok: 'حذف', danger: true })) return; db.parties.splice(+el.dataset.i, 1); commit(); },
    partyMap: el => statusMapModal(+el.dataset.i),
    poTab: el => { ui.poTab = el.dataset.k; go('po'); },
    poQuickShip: el => {
      const no = el.dataset.k, o = db.po.orders[no];
      modal({
        title: `تم شحن أمر الشراء ${esc(no)}`, size: 'narrow',
        body: `<div class="form" style="grid-template-columns:1fr">
          <label class="f">رقم بوليصة الشحن<input id="s_bl"></label>
          <label class="f">تاريخ الشحن<input id="s_sd" type="date" value="${today()}"></label>
          <label class="f">الوصول المتوقع — فارغ = تاريخ الشحن + ${fmt(num(db.settings.shipTransitDays) || 30)} يوم<input id="s_eta" type="date"></label></div>
          <p class="small">تقدر ترفق البوليصة من شاشة الأمر بعدها.</p>`,
        foot: `<button class="primary" data-ok>حفظ</button><button data-close>إلغاء</button>`,
        onMount: m => { m.q('[data-ok]').onclick = () => {
          o.shipped = true; o.blNo = m.q('#s_bl').value.trim(); o.shipDate = m.q('#s_sd').value || today(); o.shippedAt = o.shipDate; o.shippedBy = 'manual';
          const e = m.q('#s_eta').value; if (e) { o.eta = e; o.etaManual = true; } else if (o.etaManual && o.eta && o.eta < o.shipDate) { o.etaManual = false; o.eta = ''; }
          log('أمر الشراء ' + no + ' تم الشحن' + (o.blNo ? ' — بوليصة ' + o.blNo : '')); m.close(); ui.keepScroll = true; commit();
        }; }
      });
    },
    poQuickRecv: async el => {
      const no = el.dataset.k, o = db.po.orders[no];
      if (!await confirmBox(`تعليم أمر الشراء ${esc(no)} «وصل المخزون»؟ كميته المتبقية تنشال من البضاعة بالطريق.`, { ok: 'وصل المخزون' })) return;
      o.status = 'received'; o.receivedAt = today(); o.receivedBy = 'manual'; o.receivedNote = 'يدوي — ' + ui.user.name; log('أمر الشراء ' + no + ' وصل المخزون (يدوي)'); ui.keepScroll = true; commit();
    },
    poQuickPay: el => {
      const no = el.dataset.k, o = db.po.orders[no], sm = E.poSummary(db, today()).find(x => x.no === no);
      modal({
        title: `سداد أمر الشراء ${esc(no)}`, size: 'narrow',
        body: `<p>المتبقي: <b>${fmt(sm.dueSar / sm.rate, 2)} ${esc(curName(o.currency))}</b> (${money(sm.dueSar)} ${cur()})</p><div class="form" style="grid-template-columns:1fr">
          <label class="f">النوع<select id="q_kind"><option>دفعة</option><option>عربون</option><option>سداد كامل</option><option>شحن</option></select></label>
          <label class="f">المبلغ<input id="q_amt" type="number" step="any" value="${+(sm.dueSar / sm.rate).toFixed(2)}"></label>
          <label class="f">العملة<select id="q_cur">${db.currencies.map(c => `<option value="${esc(c.code)}" ${o.currency === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="f">التاريخ<input id="q_date" type="date" value="${today()}"></label><label class="f">ملاحظة<input id="q_note"></label></div>`,
        foot: `<button class="primary" data-ok>تسجيل الدفعة</button><button data-close>إلغاء</button>`,
        onMount: m => { m.q('[data-ok]').onclick = () => {
          const a = num(m.q('#q_amt').value); if (!(a > 0)) return toast('أدخل المبلغ', 'bad');
          o.payments = o.payments || []; o.payments.push({ id: 'P' + Date.now(), date: m.q('#q_date').value || today(), amount: a, currency: m.q('#q_cur').value, kind: m.q('#q_kind').value, note: m.q('#q_note').value.trim(), source: 'manual', by: ui.user.name });
          log(`دفعة ${fmt(a, 2)} ${m.q('#q_cur').value} لأمر الشراء ${no}`); m.close(); ui.keepScroll = true; commit();
        }; }
      });
    },
    poNew: () => {
      modal({
        title: 'إضافة أمر شراء يدوي', size: 'narrow',
        body: `<div class="form" style="grid-template-columns:1fr">
          <label class="f">رقم الأمر<input id="n_no"></label>
          <label class="f">العملة<select id="n_cur">${db.currencies.map(c => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></label>
          <label class="f">قيمة الأمر<input id="n_val" type="number" step="any"></label><label class="f">رسوم الشحن<input id="n_ship" type="number" step="any"></label>
          <label class="f">المورد<input id="n_sup"></label><label class="f">المخلّص<input id="n_agent"></label>
          <label class="f">الوصول المتوقع<input id="n_eta" type="date"></label><label class="f">ملاحظة<input id="n_note"></label></div>
          <p class="small">الأصناف والكميات تنضاف من استيراد تقرير أوامر الشراء أو القالب. الأمر اليدوي بدون أصناف يدخل الكاش فقط.</p>`,
        foot: `<button class="primary" data-ok>إضافة</button><button data-close>إلغاء</button>`,
        onMount: m => { m.q('[data-ok]').onclick = () => {
          const no = E.normCode(m.q('#n_no').value); if (!no) return toast('رقم الأمر مطلوب', 'bad');
          if (db.po.orders[no]) return toast('رقم الأمر موجود', 'bad');
          const eta = m.q('#n_eta').value;
          db.po.orders[no] = { no, status: 'open', firstSeen: today(), lastSeen: today(), currency: m.q('#n_cur').value, lines: [], payments: [], manualValue: num(m.q('#n_val').value), shipping: num(m.q('#n_ship').value), supplier: m.q('#n_sup').value.trim(), agent: m.q('#n_agent').value.trim(), note: m.q('#n_note').value.trim(), eta, etaManual: !!eta, flags: [] };
          log('إضافة أمر شراء يدوي ' + no); m.close(); commit(); poModal(no);
        }; }
      });
    },
    dataTabGo: el => { ui.dataTab = el.dataset.k; go('data'); },
    clearManualTransit: async () => { if (!await confirmBox(`مسح ${fmt(db.transit.length)} سطر بضاعة بالطريق مُدخل يدويًا؟ (أوامر الشراء تبقى)`, { ok: 'مسح', danger: true })) return; db.transit = []; log('مسح البضاعة بالطريق اليدوية'); commit(); },
    clearColF: el => { const t = ui.tables[el.dataset.t]; t.filters = {}; t.page = 0; render(); },
    sort: el => { const t = ui.tables[el.dataset.t]; if (t.sort === el.dataset.k) t.dir = -t.dir; else { t.sort = el.dataset.k; t.dir = -1; } t.page = 0; render(); },
    page: el => { ui.tables[el.dataset.t].page = +el.dataset.p; render(); const w = $('#main .tbl-wrap'); if (w) w.scrollTop = 0; },
    row: (el, e) => { if (e.target.closest('input,select,button')) return; const h = ui.rowHandlers[el.dataset.t]; const r = (ui.tableRows[el.dataset.t] || [])[+el.dataset.i]; if (h && r) h(r); },
    import: el => { const need = IMPORT_PERM[el.dataset.k]; if (need && !can(need)) return deny(need); startImport(el.dataset.k, el.dataset.mode); },
    importLegacy: () => importLegacy(),
    tpl: el => exportSpec(templateSpec(el.dataset.k, false), 'قالب-' + I.KINDS[el.dataset.k].title),
    tplItemsFull: () => exportSpec(templateSpec('items', true), 'الأصناف'),
    reviewAuto: () => reviewAuto(),
    newItem: () => editItem(null),
    editItemBtn: el => editItem(el.dataset.code),
    bulkEdit: () => bulkEdit(),
    approve: () => approve(),
    exportOrder: () => exportOrder(),
    printOrder: () => printOrPdf(false),
    pdfOrder: () => printOrPdf(true),
    exportCalc: () => exportCalc(),
    exportSales: () => exportSales(),
    dataTab: el => { ui.dataTab = el.dataset.k; render(); },
    checkGo: el => {
      const k = el.dataset.k;
      if (k === 'units') { ui.dataTab = 'units'; go('data'); }
      else if (k === 'units_transit') { ui.dataTab = 'transit'; go('data'); }
      else if (k === 'po') { ui.poTab = 'orders'; go('po'); }
      else if (k === 'poLate') { ui.poTab = 'orders'; ui.f.po.status = 'late'; go('po'); }
      else if (k === 'shipLate' || k === 'shipDem' || k === 'shipSoon') { Object.assign(ui.f.ship, { group: 'الكل', party: 'الكل', q: '', alert: { shipLate: 'متأخرة', shipDem: 'غرامة', shipSoon: 'قربت' }[k] }); go('ship'); }
      else if (k === 'auto') reviewAuto();
      else if (k === 'noCost') { Object.assign(ui.f.items, { flag: 'بدون تكلفة', active: 'الكل', type: 'الكل', group: 'الكل', q: '' }); go('items'); }
      else if (k === 'unknownType') { Object.assign(ui.f.items, { flag: 'نوع غير معروف', active: 'الكل', type: 'الكل', group: 'الكل', q: '' }); go('items'); }
      else if (k === 'negStock') { Object.assign(ui.f.items, { flag: 'مخزون سالب', active: 'الكل', type: 'الكل', group: 'الكل', q: '' }); go('items'); }
      else if (k === 'adj') { Object.assign(ui.f.order, { show: 'adjusted', type: 'الكل', group: 'الكل', cls: 'الكل', q: '' }); go('order'); }
      else go(k);
    },
    delMonth: async el => {
      const m = el.dataset.k, n = db.sales.filter(r => r.month === m).length;
      if (!await confirmBox(`حذف مبيعات شهر ${monthLabel(m)} (${fmt(n)} سطر)؟`, { ok: 'حذف', danger: true })) return;
      await saveNow(); await api.snapshot('before-delmonth');
      db.sales = db.sales.filter(r => r.month !== m); log('حذف مبيعات ' + m); commit();
    },
    clearTransit: async () => {
      if (db.transit.length && !await confirmBox(`مسح كل البضاعة بالطريق (${fmt(db.transit.length)} سطر)؟`, { ok: 'مسح', danger: true })) return;
      db.transit = []; db.meta.transitAt = nowStamp(); log('مسح البضاعة بالطريق'); commit();
    },
    delTransit: el => { db.transit.splice(+el.dataset.i, 1); ui.keepScroll = true; commit(); },
    addTransit: () => {
      modal({
        title: 'إضافة سطر بضاعة بالطريق', size: 'narrow',
        body: `<div class="form" style="grid-template-columns:1fr"><label class="f">رقم الصنف<input id="t_code" list="dl_codes"></label><label class="f">الوحدة<select id="t_unit"></select></label><label class="f">الكمية<input id="t_qty" type="number" step="any"></label><label class="f">المصدر / رقم الأمر<input id="t_src"></label></div>
          <datalist id="dl_codes">${db.items.filter(i => i.active !== false).slice(0, 5000).map(i => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('')}</datalist><div class="small" id="t_name"></div>`,
        foot: `<button class="primary" data-ok>إضافة</button><button data-close>إلغاء</button>`,
        onMount: m => {
          const upd = () => { const it = db.items.find(i => i.code === E.normCode(m.q('#t_code').value)); m.q('#t_name').textContent = it ? it.name : ''; m.q('#t_unit').innerHTML = it ? E.allUnits(it).map(u => `<option>${esc(u.name)}</option>`).join('') : ''; };
          m.q('#t_code').addEventListener('input', upd);
          m.q('[data-ok]').onclick = () => {
            const it = db.items.find(i => i.code === E.normCode(m.q('#t_code').value));
            if (!it) return toast('الصنف غير موجود', 'bad');
            const q = num(m.q('#t_qty').value); if (!q) return toast('أدخل الكمية', 'bad');
            db.transit.push({ code: it.code, name: it.name, unit: m.q('#t_unit').value, qty: q, source: m.q('#t_src').value.trim() || 'يدوي' });
            db.meta.transitAt = nowStamp(); m.close(); commit();
          };
        }
      });
    },
    defineUnit: async el => {
      const code = el.dataset.code, unit = el.dataset.unit;
      const it = db.items.find(i => i.code === code); if (!it) return;
      const v = await promptBox(`تعريف الوحدة «${unit}» للصنف ${code}`, `1 ${unit} = كم ${it.baseUnit}؟`, '', 'number');
      if (v == null) return;
      const f = num(v); if (!(f > 0)) return toast('المعامل لازم يكون أكبر من صفر', 'bad');
      it.units.push({ name: unit, factor: f }); log(`تعريف وحدة ${unit}=${f} للصنف ${code}`); commit();
    },
    addType: () => { db.types.push({ name: 'نوع جديد', leadTime: 1, extraMonths: 0, note: '', currency: db.currencies[0].code }); commit(); },
    addCur: () => { db.currencies.push({ code: 'EUR', name: 'يورو', rate: 4 }); commit(); },
    delCur: el => { db.currencies.splice(+el.dataset.i, 1); commit(); },
    delType: async el => {
      const t = db.types[+el.dataset.i], n = db.items.filter(x => x.type === t.name).length;
      if (!await confirmBox(`حذف النوع «${esc(t.name)}»؟${n ? ` يوجد ${n} صنف بهذا النوع وسيظهر كـ «نوع غير معروف».` : ''}`, { ok: 'حذف', danger: true })) return;
      db.types.splice(+el.dataset.i, 1); commit();
    },
    addExc: () => { const om = res.orderMonth || ''; db.exceptions.push({ id: 'X' + Date.now(), name: 'فترة استثنائية', fromMonth: om, toMonth: om, scope: 'all', value: '', months: 1, enabled: true }); commit(); },
    delExc: el => { db.exceptions.splice(+el.dataset.i, 1); commit(); },
    addGroup: async () => { const g = await promptBox('إضافة مجموعة', 'اسم المجموعة'); if (g && g.trim() && !db.groups.includes(g.trim())) { db.groups.push(g.trim()); commit(); } },
    renGroup: async el => {
      const old = db.groups[+el.dataset.i];
      const g = await promptBox('إعادة تسمية مجموعة', 'الاسم الجديد', old); if (!g || !g.trim() || g.trim() === old) return;
      const nn = g.trim();
      db.items.forEach(it => { if (it.group === old) it.group = nn; });
      db.exceptions.forEach(x => { if (x.scope === 'group' && x.value === old) x.value = nn; });
      db.groups[+el.dataset.i] = nn; db.groups = [...new Set(db.groups)]; commit();
    },
    delGroup: async el => {
      const g = db.groups[+el.dataset.i], n = db.items.filter(x => x.group === g).length;
      if (n) return toast(`لا يمكن الحذف — يوجد ${n} صنف في المجموعة. انقلها أولًا (تعديل جماعي).`, 'bad');
      db.groups.splice(+el.dataset.i, 1); commit();
    },
    archView: el => archView(el.dataset.k),
    archExport: el => archExport(el.dataset.k),
    archDel: async el => {
      const a = db.archive.find(x => x.id === el.dataset.k);
      if (!await confirmBox(`حذف الطلب المعتمد لشهر ${monthLabel(a.orderMonth)} من الأرشيف؟`, { ok: 'حذف', danger: true })) return;
      db.archive = db.archive.filter(x => x !== a); commit();
    },
    exportBackup: async () => { const p = await api.exportBackup(JSON.stringify(db)); if (p) toast('تم الحفظ: ' + p, 'ok'); },
    restoreBackup: async () => {
      const s = await api.importBackup(); if (!s) return;
      let d; try { d = JSON.parse(s); } catch (e) { return toast('ملف غير صالح', 'bad'); }
      if (!d || !Array.isArray(d.items)) return toast('ملف غير صالح', 'bad');
      if (!await confirmBox(`استرجاع النسخة (${fmt(d.items.length)} صنف) واستبدال البيانات الحالية؟`, { ok: 'استرجاع', danger: true })) return;
      await saveNow(); await api.snapshot('before-restore');
      if (!Array.isArray(d.users) || !d.users.length) d.users = db.users;
      db = migrate(d); commit(); await saveNow(); toast('تم الاسترجاع', 'ok');
    },
    openData: () => api.openFolder('data'),
    resetAll: async () => {
      if (!await confirmBox('مسح <b>كل</b> البيانات (الأصناف، المبيعات، المخزون، الأرشيف، الإعدادات)؟ تُحفظ نسخة احتياطية قبل المسح.', { ok: 'مسح الكل', danger: true })) return;
      await saveNow(); await api.snapshot('before-reset');
      const users = db.users; db = migrate(E.emptyDb()); db.users = users; commit(); await saveNow();
    }
  };

  // الضغط مرتين على السطر = نفس الضغط مرة (يفتح التفاصيل)
  document.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-act="row"]');
    if (!el || e.target.closest('input,select,button') || document.querySelector('#modalRoot .modal-back')) return;
    ACT.row(el, e);
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || !$('#app').contains(el) && !el.closest('#modalRoot')) return;
    if (el.closest('#modalRoot')) return;
    const fn = ACT[el.dataset.act];
    const need = PERM[el.dataset.act];
    if (need && ui.user && !can(need)) return deny(need);
    if (fn) fn(el, e);
  });

  let searchTimer;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.colf) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { const t = ui.tables[el.dataset.colf]; t.filters[el.dataset.k] = el.value; t.page = 0; render(); }, 300);
      return;
    }
    if (el.dataset.search) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const [a, b] = el.dataset.search.split('.'); ui.f[a][b] = el.value;
        const tid = { order: 'order', calc: 'calc', items: 'items', sales: 'salesMat', stock: 'stockT', transit: 'transitT', po: 'poList', ship: 'shipList' }[a];
        if (ui.tables[tid]) ui.tables[tid].page = 0;
        render();
      }, 250);
    }
  });

  document.addEventListener('change', e => {
    const el = e.target, k = el.dataset.chg;
    if (!k || el.closest('#modalRoot')) return;
    const s = db.settings;
    if (CHG_PERM[k] && !can(CHG_PERM[k])) { deny(CHG_PERM[k]); return render(); }
    if (k === 'filter') {
      const [a, b] = el.dataset.f.split('.'); ui.f[a][b] = el.value;
      const tid = { order: 'order', calc: 'calc', items: 'items', po: 'poList', ship: 'shipList' }[a]; if (ui.tables[tid]) ui.tables[tid].page = 0;
      return render();
    }
    if (k === 'adj' || k === 'reason') {
      const code = el.dataset.code;
      const a = db.adjustments[code] || { delta: 0, reason: '' };
      if (k === 'adj') a.delta = el.value === '' ? 0 : num(el.value); else a.reason = el.value;
      if (!a.delta && !String(a.reason).trim()) delete db.adjustments[code]; else db.adjustments[code] = a;
      ui.keepScroll = true;
      return commit();
    }
    if (k === 'set') {
      const key = el.dataset.k;
      let v = el.value;
      if (el.type === 'number') v = num(v);
      if (key === 'nMonths') v = Math.max(1, Math.min(36, Math.round(v)));
      s[key] = v;
      return commit();
    }
    if (k === 'setBool') {
      s[el.dataset.k] = el.value === '1';
      log((s[el.dataset.k] ? 'تفعيل' : 'إيقاف') + ' خصم أوامر الشراء من الطلب');
      if (s.poAsTransit && db.transit.length && Object.values(db.po.orders).some(o => o.status === 'open' && (o.lines || []).length)) toast(`انتبه: يوجد ${fmt(db.transit.length)} سطر بضاعة بالطريق يدوي — إذا كانت نفس أوامر الشراء امسحها حتى لا تنخصم مرتين`, 'bad');
      return commit();
    }
    if (k === 'setPct') { s[el.dataset.k] = num(el.value) / 100; return commit(); }
    if (k === 'stockDate') { db.stock.date = el.value; s.stockDate = el.value; return commit(); }
    if (k === 'type') {
      const t = db.types[+el.dataset.i], key = el.dataset.k;
      if (key === 'name') {
        const nn = el.value.trim(); if (!nn) return render();
        const old = t.name;
        db.items.forEach(it => { if (it.type === old) it.type = nn; });
        db.exceptions.forEach(x => { if (x.scope === 'type' && x.value === old) x.value = nn; });
        if (s.defaultType === old) s.defaultType = nn;
        t.name = nn;
      }
      else if (key === 'note') t.note = el.value;
      else if (key === 'currency') t.currency = el.value;
      else t[key] = num(el.value);
      return commit();
    }
    if (k === 'stg') {
      const x = db.shipStages[+el.dataset.i], key = el.dataset.k;
      if (key === 'days') x.days = el.value === '' ? '' : num(el.value);
      else if (key === 'marks') {
        if (el.value) db.shipStages.forEach(y => { if (y !== x && y.marks === el.value) y.marks = ''; }); // كل أثر لمرحلة وحدة
        x.marks = el.value;
      } else x[key] = el.value.trim();
      return commit();
    }
    if (k === 'party') {
      const x = db.parties[+el.dataset.i], key = el.dataset.k;
      if (key === 'freeDays') x.freeDays = el.value === '' ? null : num(el.value); else x[key] = el.value.trim();
      return commit();
    }
    if (k === 'cur') {
      const c = db.currencies[+el.dataset.i], key = el.dataset.k;
      if (key === 'rate') c.rate = num(el.value); else if (key === 'code') { const old = c.code; c.code = el.value.trim().toUpperCase() || old; db.types.forEach(t => { if (t.currency === old) t.currency = c.code; }); Object.values(db.po.orders).forEach(o => { if (o.currency === old) o.currency = c.code; }); } else c.name = el.value.trim();
      return commit();
    }
    if (k === 'cls') { const v = num(el.value) / 100; db.classes[+el.dataset.i].service = Math.max(0, Math.min(0.9999, v)); return commit(); }
    if (k === 'exc') {
      const x = db.exceptions[+el.dataset.i], key = el.dataset.k;
      if (key === 'enabled') x.enabled = el.checked;
      else if (key === 'months') x.months = num(el.value);
      else x[key] = el.value;
      if (key === 'scope') x.value = x.scope === 'type' ? (db.types[0] || {}).name || '' : x.scope === 'group' ? db.groups[0] || '' : '';
      return commit();
    }
  });

  document.addEventListener('submit', e => { if (e.target.id === 'authForm') submitAuth(e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const m = document.querySelector('#modalRoot .modal-back:last-child'); if (m) m.remove(); }
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cell-input')) e.target.blur();
  });

  // ================= التشغيل =================
  async function boot() {
    try {
      ui.cfg = await api.cfg();
      const r = ui.cfg.reachable ? await api.loadDb() : { json: null, mtime: 0 };
      db = r.json ? migrate(JSON.parse(r.json)) : migrate(E.emptyDb());
      ui.mtime = r.mtime;
    } catch (e) {
      db = migrate(E.emptyDb());
      toast('تعذر قراءة ملف البيانات — بدأ البرنامج فارغًا. استرجع نسخة احتياطية من الإعدادات. ' + e.message, 'bad');
    }
    recompute();
    render();
    api.onLockLost(l => { toast(`فقدت قفل التعديل — ${l.name || l.user} يعدّل الآن`, 'bad'); enterReadOnly(l); });
  }
  boot();
})();
