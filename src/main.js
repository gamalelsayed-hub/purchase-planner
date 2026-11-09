'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { readWorkbook, writeWorkbook } = require('./xlsxio');

let win;
const machine = os.hostname();
// مجلد ثابت لبيانات البرنامج على الجهاز: %APPDATA%\\PurchasePlanner
app.setName('PurchasePlanner');
app.setPath('userData', path.join(app.getPath('appData'), 'PurchasePlanner'));
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------- الإعدادات المحلية للجهاز (مكان البيانات ومجلد التحديثات) ----------
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const defaultDataDir = () => path.join(app.getPath('userData'), 'data');
function readCfg() {
  try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; }
}
function writeCfg(c) { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); }
const dataDir = () => readCfg().dataDir || defaultDataDir();
const updatesDir = () => readCfg().updatesDir || path.join(dataDir(), 'updates');
const dataFile = () => path.join(dataDir(), 'data.json');
const lockFile = () => path.join(dataDir(), 'data.lock');
// النسخ الاحتياطية محلية على الجهاز (لا تُزحم الدرايف)
const backupDir = () => path.join(app.getPath('userData'), 'backups');

function ensureDirs() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(backupDir(), { recursive: true });
}
function mtime(f) { try { return fs.statSync(f).mtimeMs; } catch (e) { return 0; } }

function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile())) return;
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir(), `data-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
    const files = fs.readdirSync(backupDir()).filter(f => /^data-\d{4}-\d{2}-\d{2}.*\.json$/.test(f)).sort();
    while (files.length > 60) fs.unlinkSync(path.join(backupDir(), files.shift()));
  } catch (e) { console.error('backup failed', e); }
}

// ---------- قفل التعديل ----------
const LOCK_STALE_MS = 5 * 60 * 1000;
let lockHeld = null; // { user, name }
let heartbeat = null;
let lastMtime = 0;

function readLock() {
  try { return JSON.parse(fs.readFileSync(lockFile(), 'utf8')); } catch (e) { return null; }
}
function lockIsMine(l) { return l && lockHeld && l.machine === machine && l.user === lockHeld.user && l.pid === process.pid; }
function writeLock() {
  const l = { user: lockHeld.user, name: lockHeld.name, machine, pid: process.pid, since: lockHeld.since, at: new Date().toISOString() };
  fs.writeFileSync(lockFile(), JSON.stringify(l));
}
function releaseLock() {
  clearInterval(heartbeat); heartbeat = null;
  try { const l = readLock(); if (lockIsMine(l)) fs.unlinkSync(lockFile()); } catch (e) { /* */ }
  lockHeld = null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'نظام تخطيط المشتريات',
    backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const menu = Menu.buildFromTemplate([
    { label: 'ملف', submenu: [{ role: 'reload', label: 'إعادة تحميل' }, { type: 'separator' }, { role: 'quit', label: 'خروج' }] },
    { label: 'عرض', submenu: [{ role: 'zoomIn', label: 'تكبير' }, { role: 'zoomOut', label: 'تصغير' }, { role: 'resetZoom', label: 'الحجم الافتراضي' }, { role: 'togglefullscreen', label: 'ملء الشاشة' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'أدوات المطور' }] }
  ]);
  Menu.setApplicationMenu(menu);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  try { ensureDirs(); } catch (e) { /* المجلد المشترك غير متاح — الواجهة تعرض الخطأ */ }
  dailyBackup();
  createWindow();
});
app.on('before-quit', releaseLock);
app.on('window-all-closed', () => { releaseLock(); app.quit(); });

// ---------- الإعدادات ----------
ipcMain.handle('cfg:get', async () => {
  const dir = dataDir();
  let reachable = true;
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch (e) { reachable = false; }
  return { dataDir: dir, defaultDataDir: defaultDataDir(), isDefault: !readCfg().dataDir, updatesDir: updatesDir(), machine, version: app.getVersion(), reachable, backupDir: backupDir() };
});
ipcMain.handle('cfg:chooseDir', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  return { dir, hasData: fs.existsSync(path.join(dir, 'data.json')) };
});
// mode: 'use' = استخدام بيانات المجلد كما هي ، 'copy' = نسخ البيانات الحالية للمجلد ، 'default' = الرجوع للمجلد المحلي
ipcMain.handle('cfg:setDataDir', async (_e, dir, mode) => {
  const old = dataFile();
  releaseLock();
  const c = readCfg();
  if (mode === 'default') delete c.dataDir; else c.dataDir = dir;
  writeCfg(c);
  ensureDirs();
  if (mode === 'copy' && fs.existsSync(old) && old !== dataFile()) {
    if (fs.existsSync(dataFile())) fs.copyFileSync(dataFile(), path.join(backupDir(), `data-replaced-${Date.now()}.json`));
    fs.copyFileSync(old, dataFile());
  }
  return true;
});
ipcMain.handle('cfg:setUpdatesDir', async (_e, dir) => {
  const c = readCfg();
  if (dir) c.updatesDir = dir; else delete c.updatesDir;
  writeCfg(c);
  return updatesDir();
});

// ---------- قاعدة البيانات ----------
ipcMain.handle('db:load', async () => {
  ensureDirs();
  if (!fs.existsSync(dataFile())) { lastMtime = 0; return { json: null, mtime: 0 }; }
  const json = fs.readFileSync(dataFile(), 'utf8');
  lastMtime = mtime(dataFile());
  return { json, mtime: lastMtime };
});
ipcMain.handle('db:stat', async () => ({ mtime: mtime(dataFile()), lock: readLock() }));
ipcMain.handle('db:save', async (_e, json, opts = {}) => {
  ensureDirs();
  if (!opts.force) {
    if (!lockHeld) return { ok: false, reason: 'readonly' };
    const l = readLock();
    if (l && !lockIsMine(l)) return { ok: false, reason: 'lockLost', lock: l };
    const m = mtime(dataFile());
    if (lastMtime && m && Math.abs(m - lastMtime) > 1) return { ok: false, reason: 'changed' };
  }
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dataFile());
  lastMtime = mtime(dataFile());
  return { ok: true, mtime: lastMtime };
});
ipcMain.handle('db:snapshot', async (_e, label) => {
  ensureDirs();
  if (!fs.existsSync(dataFile())) return false;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.copyFileSync(dataFile(), path.join(backupDir(), `data-${ts.slice(0, 10)}-${ts.slice(11)}-${(label || 'snap').replace(/[^\w-]/g, '')}.json`));
  return true;
});

// ---------- القفل ----------
ipcMain.handle('lock:acquire', async (_e, user, name) => {
  ensureDirs();
  const l = readLock();
  const stale = !l || (Date.now() - new Date(l.at).getTime() > LOCK_STALE_MS);
  const sameSession = l && l.machine === machine && l.pid === process.pid;
  if (!l || stale || sameSession) {
    lockHeld = { user, name, since: new Date().toISOString() };
    writeLock();
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      try {
        const cur = readLock();
        if (cur && !lockIsMine(cur)) { clearInterval(heartbeat); lockHeld = null; if (win) win.webContents.send('lock:lost', cur); return; }
        writeLock();
      } catch (e) { /* الدرايف غير متاح مؤقتًا */ }
    }, 60 * 1000);
    lastMtime = mtime(dataFile());
    return { ok: true };
  }
  return { ok: false, holder: l };
});
ipcMain.handle('lock:release', async () => { releaseLock(); return true; });

// ---------- التحديثات ----------
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
ipcMain.handle('update:check', async () => {
  const dir = updatesDir();
  const f = path.join(dir, 'latest.json');
  if (!fs.existsSync(f)) return { ok: false, reason: 'noFile', dir, current: app.getVersion() };
  let info;
  try { info = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { ok: false, reason: 'badFile', dir, current: app.getVersion() }; }
  const installer = info.file ? path.join(dir, info.file) : null;
  return {
    ok: true, dir, current: app.getVersion(), latest: info.version, notes: info.notes || '', date: info.date || '',
    newer: cmpVer(info.version, app.getVersion()) > 0, installerExists: !!(installer && fs.existsSync(installer))
  };
});
ipcMain.handle('update:install', async () => {
  const dir = updatesDir();
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  const installer = path.join(dir, info.file);
  if (!fs.existsSync(installer)) return { ok: false };
  // ننسخ المثبت محليًا أولًا (الدرايف قد يكون بطيئًا أو يقفل الملف)
  const local = path.join(app.getPath('temp'), info.file);
  fs.copyFileSync(installer, local);
  releaseLock();
  const err = await shell.openPath(local);
  if (err) return { ok: false, error: err };
  setTimeout(() => app.quit(), 1500);
  return { ok: true };
});

// ---------- ملفات ----------
ipcMain.handle('file:openExcel', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'اختر ملف Excel',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm', 'csv'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const wb = await readWorkbook(file, opts);
  return { file, name: path.basename(file), sheets: wb.sheets };
});
ipcMain.handle('file:saveExcel', async (_e, spec, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'حفظ ملف Excel',
    defaultPath: path.join(app.getPath('documents'), (defaultName || 'export') + '.xlsx'),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (r.canceled || !r.filePath) return null;
  await writeWorkbook(r.filePath, spec);
  return r.filePath;
});
ipcMain.handle('file:savePdf', async (_e, defaultName, landscape = true) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'حفظ PDF',
    defaultPath: path.join(app.getPath('documents'), (defaultName || 'report') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const pdf = await win.webContents.printToPDF({ landscape, printBackground: true, pageSize: 'A4', margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.3, right: 0.3 } });
  fs.writeFileSync(r.filePath, pdf);
  shell.openPath(r.filePath);
  return r.filePath;
});
ipcMain.handle('file:print', async () => new Promise(resolve => win.webContents.print({ landscape: true, printBackground: true }, ok => resolve(ok))));

ipcMain.handle('backup:export', async (_e, json) => {
  const day = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'تصدير نسخة احتياطية',
    defaultPath: path.join(app.getPath('documents'), `purchase-planner-backup-${day}.json`),
    filters: [{ name: 'Backup', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, json, 'utf8');
  return r.filePath;
});
ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'استرجاع نسخة احتياطية', properties: ['openFile'], defaultPath: backupDir(), filters: [{ name: 'Backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});
ipcMain.handle('app:openFolder', async (_e, which) => {
  const p = which === 'backups' ? backupDir() : which === 'updates' ? updatesDir() : dataDir();
  fs.mkdirSync(p, { recursive: true });
  return shell.openPath(p);
});
