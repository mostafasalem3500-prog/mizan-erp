/* ميزان لايت — المحرك المحاسبي (قيد مزدوج، المبالغ بالهللة كأعداد صحيحة) */
var Mizan = (function () {
  'use strict';
  var VERSION = '1.1.0';
  var DB_NAME = 'mizan-lite', KEY = 'state.v1';
  var DEFAULT_UPDATE = 'https://raw.githubusercontent.com/mostafasalem3500-prog/mizan-erp/main/apps/lite/version.json';

  // type: A أصول، L خصوم، E حقوق ملكية، R إيرادات، X مصروفات
  var COA = [
    ['1101', 'الصندوق (نقدي)', 'A'], ['1102', 'البنك / الشبكة', 'A'], ['1103', 'العملاء', 'A'],
    ['1104', 'المخزون', 'A'], ['1105', 'ضريبة القيمة المضافة — مدخلات', 'A'], ['1201', 'الأصول الثابتة', 'A'],
    ['2101', 'الموردون', 'L'], ['2102', 'ضريبة القيمة المضافة — مخرجات', 'L'], ['2103', 'مصروفات مستحقة', 'L'], ['2104', 'قروض', 'L'],
    ['3101', 'رأس المال', 'E'], ['3102', 'جاري المالك (مسحوبات)', 'E'], ['3103', 'أرباح مبقاة', 'E'], ['3104', 'أرصدة افتتاحية', 'E'],
    ['4101', 'المبيعات', 'R'], ['4102', 'مردودات المبيعات', 'R'], ['4201', 'إيرادات أخرى', 'R'],
    ['5101', 'تكلفة المبيعات', 'X'], ['5201', 'الرواتب والأجور', 'X'], ['5202', 'الإيجار', 'X'], ['5203', 'كهرباء وماء واتصالات', 'X'],
    ['5204', 'مصروفات عمومية وإدارية', 'X'], ['5205', 'صيانة', 'X'], ['5206', 'دعاية وتسويق', 'X'], ['5207', 'رسوم بنكية وعمولات شبكة', 'X'],
    ['5208', 'تسويات وفروقات المخزون', 'X'], ['5209', 'رسوم حكومية وتراخيص', 'X'], ['5210', 'عجز وزيادة الصندوق', 'X']
  ];
  var TYPE_NAMES = { A: 'الأصول', L: 'الخصوم', E: 'حقوق الملكية', R: 'الإيرادات', X: 'المصروفات' };
  var METHOD_ACC = { cash: '1101', card: '1102', bank: '1102' };
  var METHOD_NAMES = { cash: 'نقدي', card: 'شبكة', bank: 'تحويل بنكي', credit: 'آجل' };

  var S = null, saveTimer = null, idb = null, storageKind = 'memory', listeners = [], CU = null;

  function defaults() {
    return {
      v: 1, setup: false, demo: false,
      settings: {
        name: '', nameEn: '', vat: '', cr: '', address: '', city: '', phone: '', logo: '',
        vatRate: 15, pricesIncl: true, oversell: 'ask', mode: 'auto', scale: 100, theme: 'light',
        tplReceipt: 't80', tplInvoice: 'a4classic', footer: 'شكراً لتعاملكم معنا', showHijri: true,
        bilingual: true, showLogo: true, autoPrint: false, updateUrl: DEFAULT_UPDATE, requireShift: false, scanBeep: true
      },
      accounts: COA.map(function (a) { return { code: a[0], name: a[1], type: a[2], sys: true }; }),
      cats: [], products: [], parties: [], docs: [], vouchers: [], journals: [], held: [], seq: {}, audit: [], users: [], shifts: []
    };
  }

  /* ---------- أدوات ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function addDays(ds, n) { var p = ds.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function nowIso() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  // تحويل نص/رقم بالريال إلى هللات (يقبل الأرقام العربية والفاصلة)
  function toH(x) {
    if (typeof x === 'string') {
      x = x.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); }).replace(/[٫,]/g, function (c) { return c === '٫' ? '.' : ''; }).trim();
    }
    var n = Number(x); if (!isFinite(n)) return 0; return Math.round(n * 100);
  }
  function num(x) { if (typeof x === 'string') x = x.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); }).replace('٫', '.').replace(/,/g, ''); var n = Number(x); return isFinite(n) ? n : 0; }
  function fmt(h) {
    h = Math.round(h || 0); var neg = h < 0; h = Math.abs(h);
    var r = Math.floor(h / 100), f = pad(h % 100, 2);
    return (neg ? '-' : '') + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f;
  }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function need(c, msg) { if (!c) throw err('VALID', msg); }
  function seqNext(key, prefix) { S.seq[key] = (S.seq[key] || 0) + 1; return prefix + '-' + pad(S.seq[key], 6); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function account(code) { for (var i = 0; i < S.accounts.length; i++) if (S.accounts[i].code === code) return S.accounts[i]; return null; }
  function audit(act, ref) { S.audit.push({ ts: nowIso(), act: act, ref: ref || '', by: CU ? CU.name : '' }); if (S.audit.length > 500) S.audit.splice(0, S.audit.length - 500); }
  function validVat(v) { return /^3\d{13}3$/.test(String(v || '')); }
  function openShift() { for (var i = S.shifts.length - 1; i >= 0; i--) if (S.shifts[i].status === 'open') return S.shifts[i]; return null; }
  // من سجّل المستند وفي أي وردية
  function stamp(o) { if (CU) o.by = CU.name; var sh = openShift(); if (sh) o.shift = sh.id; return o; }
  function needShift() { need(!S.settings.requireShift || openShift(), 'افتح وردية أولاً (الورديات ← فتح وردية)'); }

  /* ---------- التخزين ---------- */
  function openIdb(cb) {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return cb(null);
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { cb(rq.result); };
      rq.onerror = function () { cb(null); };
      rq.onblocked = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function migrate(st) {
    var d = defaults(), k;
    for (k in d) if (!(k in st)) st[k] = d[k];
    for (k in d.settings) if (!(k in st.settings)) st.settings[k] = d.settings[k];
    COA.forEach(function (a) { if (!st.accounts.some(function (x) { return x.code === a[0]; })) st.accounts.push({ code: a[0], name: a[1], type: a[2], sys: true }); });
    return st;
  }
  function load(cb) {
    openIdb(function (db) {
      idb = db;
      function fromLocal() {
        try {
          var raw = localStorage.getItem(KEY);
          storageKind = 'local';
          return raw ? JSON.parse(raw) : null;
        } catch (e) { storageKind = 'memory'; return null; }
      }
      if (!db) { S = migrate(fromLocal() || defaults()); return cb(S); }
      try {
        var rq = db.transaction('kv', 'readonly').objectStore('kv').get(KEY);
        rq.onsuccess = function () { storageKind = 'idb'; S = migrate(rq.result || defaults()); cb(S); };
        rq.onerror = function () { idb = null; S = migrate(fromLocal() || defaults()); cb(S); };
      } catch (e) { idb = null; S = migrate(fromLocal() || defaults()); cb(S); }
    });
  }
  function persistNow() {
    saveTimer = null;
    if (idb) { try { idb.transaction('kv', 'readwrite').objectStore('kv').put(S, KEY); return; } catch (e) { /* يسقط للمحلي */ } }
    if (storageKind === 'local') { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { storageKind = 'memory'; } }
  }
  function save() {
    for (var i = 0; i < listeners.length; i++) try { listeners[i](); } catch (e) { }
    if (typeof setTimeout === 'undefined') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 250);
  }
  function exportJSON() { return JSON.stringify({ app: 'mizan-lite', version: VERSION, exportedAt: nowIso(), state: S }); }
  function importJSON(text) {
    var o; try { o = JSON.parse(text); } catch (e) { throw err('VALID', 'الملف ليس نسخة احتياطية صالحة'); }
    var st = o && o.app === 'mizan-lite' ? o.state : null;
    need(st && st.settings && Array.isArray(st.journals) && Array.isArray(st.products) && Array.isArray(st.accounts), 'الملف ليس نسخة احتياطية من ميزان لايت');
    for (var i = 0; i < st.journals.length; i++) {
      var d = 0, c = 0; st.journals[i].lines.forEach(function (l) { d += l.dr; c += l.cr; });
      need(d === c, 'النسخة الاحتياطية تحتوي قيداً غير متوازن — رُفض الاستيراد');
    }
    S = migrate(st); CU = null; save(); return S;
  }
  function reset(keepSettings) {
    var old = S; S = defaults();
    if (keepSettings && old) { S.settings = old.settings; S.setup = old.setup; S.users = old.users || []; }
    save(); return S;
  }

  /* ---------- القيود ---------- */
  function postJournal(date, ref, desc, lines, src) {
    var out = [], d = 0, c = 0;
    lines.forEach(function (l) {
      var dr = Math.round(l.dr || 0), cr = Math.round(l.cr || 0);
      if (!dr && !cr) return;
      need(dr >= 0 && cr >= 0 && !(dr && cr), 'سطر قيد غير صحيح');
      need(account(l.a), 'حساب غير موجود: ' + l.a);
      var o = { a: l.a, dr: dr, cr: cr }; if (l.p) o.p = l.p; if (l.n) o.n = l.n;
      out.push(o); d += dr; c += cr;
    });
    need(out.length >= 2, 'القيد يحتاج سطرين على الأقل');
    if (d !== c) throw err('UNBALANCED', 'القيد غير متوازن: مدين ' + fmt(d) + ' ≠ دائن ' + fmt(c));
    var j = { id: uid(), no: seqNext('JV', 'JV'), date: date, ts: nowIso(), ref: ref || '', desc: desc || '', src: src || null, lines: out };
    if (CU) j.by = CU.name;
    S.journals.push(j); return j;
  }
  function reverseJournal(jid, desc, date) {
    var j = byId(S.journals, jid); need(j, 'القيد غير موجود'); need(!j.reversedBy, 'القيد معكوس مسبقاً');
    var r = postJournal(date || today(), j.ref, desc || ('عكس القيد ' + j.no), j.lines.map(function (l) { return { a: l.a, dr: l.cr, cr: l.dr, p: l.p }; }), { t: 'rev', id: j.id });
    j.reversedBy = r.id; return r;
  }
  function manualJournal(inp) {
    need(inp.desc, 'اكتب بيان القيد');
    var j = postJournal(inp.date || today(), inp.ref || '', inp.desc, inp.lines, { t: 'manual' });
    audit('قيد يدوي', j.no); save(); return j;
  }

  /* ---------- الأصناف ---------- */
  function saveCat(c) {
    need(c.name, 'اكتب اسم التصنيف');
    if (c.id) { var o = byId(S.cats, c.id); o.name = c.name; } else { c = { id: uid(), name: c.name }; S.cats.push(c); }
    save(); return c;
  }
  function saveProduct(p) {
    need(p.name && p.name.trim(), 'اكتب اسم الصنف');
    need(p.price >= 0, 'السعر غير صحيح');
    if (p.barcode) { for (var i = 0; i < S.products.length; i++) need(S.products[i].barcode !== p.barcode || S.products[i].id === p.id, 'الباركود مستخدم لصنف آخر'); }
    var o;
    if (p.id) {
      o = byId(S.products, p.id); need(o, 'الصنف غير موجود');
      ['name', 'price', 'barcode', 'cat', 'rate', 'img', 'min', 'unit', 'service', 'active'].forEach(function (k) { if (k in p) o[k] = p[k]; });
    } else {
      o = { id: uid(), name: p.name.trim(), price: Math.round(p.price), barcode: p.barcode || '', cat: p.cat || '', rate: p.rate == null ? S.settings.vatRate : p.rate, img: p.img || '', min: p.min || 0, unit: p.unit || 'حبة', service: !!p.service, active: true, stock: 0, cost: Math.round(p.cost || 0) };
      S.products.push(o);
      if (!o.service && p.stock > 0) {
        var val = Math.round(p.stock * o.cost);
        o.stock = p.stock;
        if (val > 0) postJournal(today(), o.name, 'رصيد افتتاحي للصنف: ' + o.name, [{ a: '1104', dr: val }, { a: '3104', cr: val }], { t: 'open', id: o.id });
      }
    }
    save(); return o;
  }
  function adjustStock(pid, newQty, reason) {
    var p = byId(S.products, pid); need(p && !p.service, 'الصنف غير موجود'); need(newQty >= 0, 'الكمية غير صحيحة');
    var diff = newQty - p.stock; if (!diff) return null;
    var val = Math.round(Math.abs(diff) * p.cost), j = null;
    if (val) j = postJournal(today(), p.name, 'تسوية مخزون: ' + p.name + (reason ? ' — ' + reason : ''), diff > 0 ? [{ a: '1104', dr: val }, { a: '5208', cr: val }] : [{ a: '5208', dr: val }, { a: '1104', cr: val }], { t: 'adj', id: p.id });
    p.stock = newQty; audit('تسوية مخزون', p.name); save(); return j;
  }

  /* ---------- العملاء والموردون ---------- */
  function saveParty(p) {
    need(p.name && p.name.trim(), 'اكتب الاسم');
    need(p.role === 'c' || p.role === 's', 'حدد النوع');
    need(!p.vat || validVat(p.vat), 'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3');
    var o;
    if (p.id) { o = byId(S.parties, p.id); need(o, 'غير موجود');['name', 'phone', 'vat', 'address', 'cr'].forEach(function (k) { if (k in p) o[k] = p[k]; }); }
    else { o = { id: uid(), role: p.role, name: p.name.trim(), phone: p.phone || '', vat: p.vat || '', address: p.address || '', cr: p.cr || '' }; S.parties.push(o); }
    save(); return o;
  }
  function partyBalance(id) {
    var p = byId(S.parties, id), bal = 0, acc = p.role === 'c' ? '1103' : '2101';
    S.journals.forEach(function (j) { j.lines.forEach(function (l) { if (l.p === id && l.a === acc) bal += p.role === 'c' ? l.dr - l.cr : l.cr - l.dr; }); });
    return bal;
  }

  /* ---------- احتساب السطور ---------- */
  // lines: [{pid,name,qty,price(هللة),disc(هللة),rate}] ؛ discount: خصم على الفاتورة بالهللة
  function computeLines(lines, discount, incl) {
    var base = lines.map(function (l) { return Math.round(l.qty * l.price) - Math.round(l.disc || 0); });
    var sum = base.reduce(function (a, b) { return a + b; }, 0);
    discount = Math.max(0, Math.min(Math.round(discount || 0), sum));
    var left = discount, out = [], net = 0, vat = 0;
    lines.forEach(function (l, i) {
      var share = i === lines.length - 1 ? left : (sum ? Math.round(discount * base[i] / sum) : 0);
      share = Math.min(share, left); left -= share;
      var amt = base[i] - share, n, v, rate = l.rate || 0;
      if (incl) { n = Math.round(amt * 100 / (100 + rate)); v = amt - n; } else { n = amt; v = Math.round(n * rate / 100); }
      out.push({ pid: l.pid || '', name: l.name, qty: l.qty, price: l.price, disc: Math.round(l.disc || 0) + share, rate: rate, net: n, vat: v, total: n + v });
      net += n; vat += v;
    });
    return { lines: out, net: net, vat: vat, total: net + vat, discount: discount };
  }

  function paysTotal(pays) { return pays.reduce(function (a, p) { return a + Math.round(p.amt); }, 0); }
  function payLines(pays, side, partyId) {
    return pays.filter(function (p) { return p.amt > 0; }).map(function (p) {
      var l = { a: p.m === 'credit' ? (side === 'dr' ? '1103' : '2101') : METHOD_ACC[p.m] };
      need(l.a, 'طريقة دفع غير معروفة'); l[side] = Math.round(p.amt); if (p.m === 'credit') l.p = partyId; return l;
    });
  }

  /* ---------- المبيعات ---------- */
  function sale(inp, opts) {
    opts = opts || {};
    need(inp.lines && inp.lines.length, 'أضف صنفاً واحداً على الأقل');
    needShift();
    var party = inp.partyId ? byId(S.parties, inp.partyId) : null;
    inp.lines.forEach(function (l) { need(l.qty > 0, 'الكمية يجب أن تكون أكبر من صفر'); need(l.price >= 0, 'السعر غير صحيح'); });
    var c = computeLines(inp.lines, inp.discount, S.settings.pricesIncl);
    need(c.total > 0, 'إجمالي الفاتورة صفر');
    var pays = inp.pays || [{ m: 'cash', amt: c.total }];
    need(paysTotal(pays) === c.total, 'مجموع المدفوع لا يساوي إجمالي الفاتورة');
    if (pays.some(function (p) { return p.m === 'credit' && p.amt > 0; })) need(party && party.role === 'c', 'البيع الآجل يحتاج اختيار عميل');
    var cogs = 0, short = [];
    c.lines.forEach(function (l) {
      var p = l.pid ? byId(S.products, l.pid) : null;
      l.cost = 0;
      if (p && !p.service) { if (p.stock < l.qty) short.push(p.name); l.cost = Math.round(l.qty * p.cost); cogs += l.cost; }
    });
    if (short.length && S.settings.oversell !== 'allow' && !opts.allowOversell) {
      var e = err('STOCK', 'الرصيد لا يكفي: ' + short.join('، ')); e.items = short; e.blocked = S.settings.oversell === 'block'; throw e;
    }
    var date = inp.date || today(), no = seqNext('INV', 'INV');
    var lines = payLines(pays, 'dr', party && party.id).concat([{ a: '4101', cr: c.net }, { a: '2102', cr: c.vat }, { a: '5101', dr: cogs }, { a: '1104', cr: cogs }]);
    var doc = { id: uid(), t: 'sale', no: no, date: date, ts: nowIso(), partyId: party ? party.id : '', partyName: party ? party.name : '', partyVat: party ? party.vat : '', partyAddress: party ? party.address : '', kind: party && party.vat ? 'standard' : 'simplified', lines: c.lines, discount: c.discount, net: c.net, vat: c.vat, total: c.total, pays: pays, note: inp.note || '', status: 'posted', oversold: short.length > 0 };
    var j = postJournal(date, no, 'فاتورة مبيعات ' + no + (party ? ' — ' + party.name : ''), lines, { t: 'sale', id: doc.id });
    doc.jid = j.id;
    c.lines.forEach(function (l) { var p = l.pid ? byId(S.products, l.pid) : null; if (p && !p.service) p.stock = Math.round((p.stock - l.qty) * 1000) / 1000; });
    stamp(doc); S.docs.push(doc); if (short.length) audit('بيع بتخطي الرصيد', no); save(); return doc;
  }
  // items: [{i: رقم السطر, qty}]
  function saleReturn(docId, items, method) {
    var d = byId(S.docs, docId); need(d && d.t === 'sale', 'الفاتورة غير موجودة'); needShift();
    var party = d.partyId ? byId(S.parties, d.partyId) : null;
    if (method === 'credit') need(party, 'الإرجاع على الحساب يحتاج عميلاً');
    var rl = [], net = 0, vat = 0, cost = 0;
    items.forEach(function (it) {
      var l = d.lines[it.i]; need(l, 'سطر غير موجود'); if (!(it.qty > 0)) return;
      var rem = Math.round((l.qty - (l.rq || 0)) * 1000) / 1000; need(it.qty <= rem, 'كمية المرتجع أكبر من المتاح للصنف: ' + l.name);
      var last = it.qty === rem, n, v, k;
      n = last ? l.net - (l.rnet || 0) : Math.round(l.net * it.qty / l.qty);
      v = last ? l.vat - (l.rvat || 0) : Math.round(l.vat * it.qty / l.qty);
      k = last ? l.cost - (l.rcost || 0) : Math.round(l.cost * it.qty / l.qty);
      rl.push({ i: it.i, pid: l.pid, name: l.name, qty: it.qty, price: l.price, disc: 0, rate: l.rate, net: n, vat: v, total: n + v, cost: k });
      net += n; vat += v; cost += k;
    });
    need(rl.length, 'حدد كمية للإرجاع');
    var total = net + vat, no = seqNext('CRN', 'CRN'), date = today();
    var cr = method === 'credit' ? { a: '1103', cr: total, p: party.id } : { a: METHOD_ACC[method] || '1101', cr: total };
    var doc = { id: uid(), t: 'sret', no: no, date: date, ts: nowIso(), ref: d.no, refId: d.id, partyId: d.partyId, partyName: d.partyName, partyVat: d.partyVat, partyAddress: d.partyAddress, kind: d.kind, lines: rl, discount: 0, net: net, vat: vat, total: total, pays: [{ m: method, amt: total }], status: 'posted' };
    var j = postJournal(date, no, 'مرتجع مبيعات ' + no + ' للفاتورة ' + d.no, [{ a: '4102', dr: net }, { a: '2102', dr: vat }, cr, { a: '1104', dr: cost }, { a: '5101', cr: cost }], { t: 'sret', id: doc.id });
    doc.jid = j.id;
    rl.forEach(function (r) {
      var l = d.lines[r.i]; l.rq = Math.round(((l.rq || 0) + r.qty) * 1000) / 1000; l.rnet = (l.rnet || 0) + r.net; l.rvat = (l.rvat || 0) + r.vat; l.rcost = (l.rcost || 0) + r.cost;
      var p = r.pid ? byId(S.products, r.pid) : null;
      if (p && !p.service) {
        var val = Math.max(p.stock, 0) * p.cost + r.cost, q = Math.max(p.stock, 0) + r.qty;
        p.cost = q > 0 ? Math.round(val / q) : p.cost; p.stock = Math.round((p.stock + r.qty) * 1000) / 1000;
      }
    });
    stamp(doc); S.docs.push(doc); audit('مرتجع مبيعات', no); save(); return doc;
  }

  /* ---------- المشتريات ---------- */
  // lines: [{pid, qty, price (تكلفة الوحدة قبل الضريبة بالهللة), rate}]
  function purchase(inp) {
    var party = inp.partyId ? byId(S.parties, inp.partyId) : null;
    need(inp.lines && inp.lines.length, 'أضف صنفاً واحداً على الأقل');
    inp.lines.forEach(function (l) { var p = byId(S.products, l.pid); need(p && !p.service, 'اختر صنفاً مخزنياً'); need(l.qty > 0 && l.price >= 0, 'الكمية أو السعر غير صحيح'); l.name = p.name; });
    var c = computeLines(inp.lines, 0, false); need(c.total > 0, 'إجمالي الفاتورة صفر');
    var pays = inp.pays || [{ m: 'cash', amt: c.total }];
    need(paysTotal(pays) === c.total, 'مجموع المدفوع لا يساوي إجمالي الفاتورة');
    if (pays.some(function (p) { return p.m === 'credit' && p.amt > 0; })) need(party && party.role === 's', 'الشراء الآجل يحتاج اختيار مورد');
    var date = inp.date || today(), no = seqNext('PUR', 'PUR');
    var doc = { id: uid(), t: 'pur', no: no, date: date, ts: nowIso(), partyId: party ? party.id : '', partyName: party ? party.name : (inp.partyName || ''), partyVat: party ? party.vat : '', supplierRef: inp.supplierRef || '', lines: c.lines, discount: 0, net: c.net, vat: c.vat, total: c.total, pays: pays, status: 'posted' };
    var j = postJournal(date, no, 'فاتورة مشتريات ' + no + (doc.partyName ? ' — ' + doc.partyName : ''), [{ a: '1104', dr: c.net }, { a: '1105', dr: c.vat }].concat(payLines(pays, 'cr', party && party.id)), { t: 'pur', id: doc.id });
    doc.jid = j.id;
    c.lines.forEach(function (l) {
      var p = byId(S.products, l.pid), old = Math.max(p.stock, 0), q = old + l.qty;
      p.cost = Math.round((old * p.cost + l.net) / q); p.stock = Math.round((p.stock + l.qty) * 1000) / 1000;
    });
    stamp(doc); S.docs.push(doc); save(); return doc;
  }

  /* ---------- المصروفات والسندات ---------- */
  function expense(inp) {
    var a = account(inp.acc); need(a && a.type === 'X', 'اختر حساب المصروف');
    var g = Math.round(inp.amount); need(g > 0, 'اكتب المبلغ'); need(METHOD_ACC[inp.method], 'اختر طريقة الدفع');
    var rate = S.settings.vatRate, net = inp.hasVat ? Math.round(g * 100 / (100 + rate)) : g, vat = g - net;
    var no = seqNext('EXP', 'EXP'), date = inp.date || today();
    var v = { id: uid(), t: 'exp', no: no, date: date, ts: nowIso(), acc: inp.acc, amount: g, net: net, vat: vat, method: inp.method, desc: inp.desc || a.name, payee: inp.payee || '', status: 'posted' };
    v.jid = postJournal(date, no, 'مصروف: ' + v.desc, [{ a: inp.acc, dr: net }, { a: '1105', dr: vat }, { a: METHOD_ACC[inp.method], cr: g }], { t: 'exp', id: v.id }).id;
    stamp(v); S.vouchers.push(v); save(); return v;
  }
  // kind: in قبض | out صرف
  function voucher(inp) {
    var amt = Math.round(inp.amount); need(amt > 0, 'اكتب المبلغ'); need(METHOD_ACC[inp.method], 'اختر طريقة الدفع');
    var party = inp.partyId ? byId(S.parties, inp.partyId) : null, other;
    if (party) other = { a: party.role === 'c' ? '1103' : '2101', p: party.id };
    else { need(account(inp.acc), 'اختر الطرف أو الحساب'); need(inp.acc !== '1101' && inp.acc !== '1102', 'اختر حساباً غير الصندوق والبنك'); other = { a: inp.acc }; }
    var isIn = inp.kind === 'in', no = seqNext(isIn ? 'RCV' : 'PAY', isIn ? 'RCV' : 'PAY'), date = inp.date || today();
    var cashLine = { a: METHOD_ACC[inp.method] }; cashLine[isIn ? 'dr' : 'cr'] = amt; other[isIn ? 'cr' : 'dr'] = amt;
    var v = { id: uid(), t: isIn ? 'rcv' : 'pay', no: no, date: date, ts: nowIso(), partyId: party ? party.id : '', partyName: party ? party.name : '', acc: other.a, amount: amt, method: inp.method, desc: inp.desc || '', status: 'posted' };
    v.jid = postJournal(date, no, (isIn ? 'سند قبض ' : 'سند صرف ') + no + (party ? ' — ' + party.name : '') + (v.desc ? ' — ' + v.desc : ''), [cashLine, other], { t: v.t, id: v.id }).id;
    stamp(v); S.vouchers.push(v); save(); return v;
  }
  function transfer(inp) {
    var amt = Math.round(inp.amount); need(amt > 0, 'اكتب المبلغ'); need(inp.from !== inp.to && METHOD_ACC[inp.from] && METHOD_ACC[inp.to], 'اختر حسابين مختلفين');
    var no = seqNext('TRF', 'TRF'), date = inp.date || today();
    var v = { id: uid(), t: 'trf', no: no, date: date, ts: nowIso(), amount: amt, method: inp.from, to: inp.to, desc: inp.desc || 'تحويل بين الصندوق والبنك', status: 'posted' };
    v.jid = postJournal(date, no, v.desc, [{ a: METHOD_ACC[inp.to], dr: amt }, { a: METHOD_ACC[inp.from], cr: amt }], { t: 'trf', id: v.id }).id;
    stamp(v); S.vouchers.push(v); save(); return v;
  }
  function cancel(kind, id, reason) {
    need(reason && reason.trim(), 'اكتب سبب الإلغاء');
    var list = kind === 'pur' ? S.docs : S.vouchers, d = byId(list, id);
    need(d && d.status === 'posted', 'المستند غير موجود أو ملغى');
    if (kind === 'pur') {
      need(!d.lines.some(function (l) { return l.rq > 0; }), 'على الفاتورة مرتجع مشتريات — لا تُلغى، سجّل مرتجعاً لما بقي');
      d.lines.forEach(function (l) { var p = byId(S.products, l.pid); need(p && p.stock >= l.qty, 'لا يمكن الإلغاء: بيع جزء من كمية الصنف ' + l.name); });
      d.lines.forEach(function (l) {
        var p = byId(S.products, l.pid), q = Math.round((p.stock - l.qty) * 1000) / 1000, val = p.stock * p.cost - l.net;
        if (q > 0 && val > 0) p.cost = Math.round(val / q); p.stock = q;
      });
    }
    reverseJournal(d.jid, 'إلغاء ' + d.no + ' — ' + reason.trim());
    d.status = 'cancelled'; d.cancelReason = reason.trim(); audit('إلغاء مستند', d.no); save(); return d;
  }


  /* ---------- مرتجع المشتريات ---------- */
  // items: [{i: رقم السطر, qty}] ؛ method: cash | bank | credit (يُخصم من حساب المورد)
  function purchaseReturn(docId, items, method) {
    var d = byId(S.docs, docId); need(d && d.t === 'pur' && d.status === 'posted', 'فاتورة المشتريات غير موجودة أو ملغاة');
    var party = d.partyId ? byId(S.parties, d.partyId) : null;
    if (method === 'credit') need(party, 'الخصم من الحساب يحتاج مورداً');
    else need(METHOD_ACC[method], 'اختر طريقة استرداد المبلغ');
    var rl = [], net = 0, vat = 0;
    items.forEach(function (it) {
      var l = d.lines[it.i]; need(l, 'سطر غير موجود'); if (!(it.qty > 0)) return;
      var rem = Math.round((l.qty - (l.rq || 0)) * 1000) / 1000; need(it.qty <= rem, 'كمية المرتجع أكبر من المتاح للصنف: ' + l.name);
      var p = byId(S.products, l.pid); need(p && p.stock >= it.qty, 'الرصيد لا يكفي لإرجاع ' + l.name + ' (المتاح ' + (p ? p.stock : 0) + ')');
      var last = it.qty === rem, n = last ? l.net - (l.rnet || 0) : Math.round(l.net * it.qty / l.qty), v = last ? l.vat - (l.rvat || 0) : Math.round(l.vat * it.qty / l.qty);
      rl.push({ i: it.i, pid: l.pid, name: l.name, qty: it.qty, price: l.price, disc: 0, rate: l.rate, net: n, vat: v, total: n + v });
      net += n; vat += v;
    });
    need(rl.length, 'حدد كمية للإرجاع');
    var total = net + vat, no = seqNext('PRN', 'PRN'), date = today();
    var dr = method === 'credit' ? { a: '2101', dr: total, p: party.id } : { a: METHOD_ACC[method], dr: total };
    var doc = { id: uid(), t: 'pret', no: no, date: date, ts: nowIso(), ref: d.no, refId: d.id, partyId: d.partyId, partyName: d.partyName, partyVat: d.partyVat, supplierRef: d.supplierRef, lines: rl, discount: 0, net: net, vat: vat, total: total, pays: [{ m: method, amt: total }], status: 'posted' };
    var j = postJournal(date, no, 'مرتجع مشتريات ' + no + ' للفاتورة ' + d.no + (d.partyName ? ' — ' + d.partyName : ''), [dr, { a: '1104', cr: net }, { a: '1105', cr: vat }], { t: 'pret', id: doc.id });
    doc.jid = j.id;
    rl.forEach(function (r) {
      var l = d.lines[r.i]; l.rq = Math.round(((l.rq || 0) + r.qty) * 1000) / 1000; l.rnet = (l.rnet || 0) + r.net; l.rvat = (l.rvat || 0) + r.vat;
      var p = byId(S.products, r.pid), q = Math.round((p.stock - r.qty) * 1000) / 1000, val = Math.max(p.stock, 0) * p.cost - r.net;
      if (q > 0) p.cost = Math.max(0, Math.round(val / q)); p.stock = q;
    });
    stamp(doc); S.docs.push(doc); audit('مرتجع مشتريات', no); save(); return doc;
  }

  /* ---------- المستخدمون والرمز السري ---------- */
  // SHA-256 (للرمز السري فقط — قفل للجهاز وليس تشفيراً للبيانات)
  function sha256(str) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], b = utf8(str), l = b.length * 8, i, j, w = [];
    b.push(0x80); while (b.length % 64 !== 56) b.push(0);
    for (i = 7; i >= 0; i--) b.push(i > 3 ? 0 : (l >>> (i * 8)) & 255);
    function r(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (i = 0; i < b.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (b[i + j * 4] << 24) | (b[i + j * 4 + 1] << 16) | (b[i + j * 4 + 2] << 8) | b[i + j * 4 + 3];
      for (j = 16; j < 64; j++) { var s0 = r(w[j - 15], 7) ^ r(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = r(w[j - 2], 17) ^ r(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
      var a = H[0], c = H[1], d = H[2], e = H[3], f = H[4], g = H[5], h = H[6], k = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (k + (r(f, 6) ^ r(f, 11) ^ r(f, 25)) + ((f & g) ^ (~f & h)) + K[j] + w[j]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & c) ^ (a & d) ^ (c & d))) | 0;
        k = h; h = g; g = f; f = (e + t1) | 0; e = d; d = c; c = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + c) | 0; H[2] = (H[2] + d) | 0; H[3] = (H[3] + e) | 0; H[4] = (H[4] + f) | 0; H[5] = (H[5] + g) | 0; H[6] = (H[6] + h) | 0; H[7] = (H[7] + k) | 0;
    }
    return H.map(function (x) { return ('0000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  var ROLES = { owner: 'المالك / المدير', cashier: 'كاشير' };
  // صلاحيات الكاشير: البيع والمرتجع والورديات وإضافة عميل؛ المالك كل شيء. بلا مستخدمين = جهاز بمستخدم واحد بلا قفل.
  var CASHIER = { pos: 1, docs: 1, 'sale.return': 1, shifts: 1, 'party.add': 1, home: 1, guide: 1, more: 1, parties: 1 };
  function can(what) { if (!S.users.length) return true; if (!CU) return false; return CU.role === 'owner' || !!CASHIER[what]; }
  function pinHash(u, pin) { return sha256(u.salt + ':' + pin); }
  function findByPin(pin, except) { for (var i = 0; i < S.users.length; i++) { var u = S.users[i]; if (u.id !== except && u.active !== false && u.hash === pinHash(u, pin)) return u; } return null; }
  function saveUser(inp) {
    need(!S.users.length || can('users'), 'إدارة المستخدمين للمالك فقط');
    need(inp.name && String(inp.name).trim(), 'اكتب اسم المستخدم');
    var role = ROLES[inp.role] ? inp.role : 'cashier', o = inp.id ? byId(S.users, inp.id) : null;
    if (!S.users.length) role = 'owner';
    if (inp.pin || !o) {
      need(/^\d{4,6}$/.test(String(inp.pin || '')), 'الرمز السري 4 إلى 6 أرقام');
      need(!findByPin(String(inp.pin), o && o.id), 'هذا الرمز مستخدم لمستخدم آخر — اختر رمزاً مختلفاً');
    }
    if (o) {
      if (o.role === 'owner' && role !== 'owner') need(S.users.some(function (u) { return u.id !== o.id && u.role === 'owner' && u.active !== false; }), 'يجب أن يبقى مالك واحد على الأقل');
      o.name = String(inp.name).trim(); o.role = role; if (inp.pin) { o.salt = uid(); o.hash = pinHash(o, String(inp.pin)); }
    } else {
      o = { id: uid(), name: String(inp.name).trim(), role: role, salt: uid(), active: true, created: nowIso() }; o.hash = pinHash(o, String(inp.pin));
      S.users.push(o); if (!CU) CU = o;
    }
    audit('مستخدم: ' + o.name, ROLES[o.role]); save(); return o;
  }
  function removeUser(id) {
    need(can('users'), 'إدارة المستخدمين للمالك فقط');
    var u = byId(S.users, id); need(u, 'المستخدم غير موجود');
    if (u.role === 'owner') need(S.users.some(function (x) { return x.id !== id && x.role === 'owner'; }), 'لا يُحذف المالك الوحيد — أضف مالكاً آخر أولاً أو احذف كل المستخدمين لإلغاء القفل');
    S.users.splice(S.users.indexOf(u), 1); if (CU && CU.id === id) CU = null; audit('حذف مستخدم', u.name); save();
  }
  function clearUsers() { need(can('users'), 'إدارة المستخدمين للمالك فقط'); S.users = []; CU = null; audit('إلغاء القفل والمستخدمين'); save(); }
  function login(pin) { var u = findByPin(String(pin || '')); need(u, 'الرمز السري غير صحيح'); CU = u; audit('دخول', u.name); return u; }
  function logout() { CU = null; }

  /* ---------- الورديات ---------- */
  function shiftOpen(inp) {
    inp = inp || {};
    need(!openShift(), 'توجد وردية مفتوحة — أغلقها أولاً');
    var fl = Math.round(inp.float || 0); need(fl >= 0, 'مبلغ الافتتاح غير صحيح');
    var sh = { id: uid(), no: seqNext('SH', 'SH'), status: 'open', openedAt: nowIso(), date: today(), by: CU ? CU.name : '', float: fl, note: inp.note || '' };
    S.shifts.push(sh); audit('فتح وردية', sh.no); save(); return sh;
  }
  // ملخص الوردية: كل ما سُجّل فيها، والنقدية المتوقعة في الدرج
  function shiftSummary(id) {
    var sh = id ? byId(S.shifts, id) : openShift(); need(sh, 'لا توجد وردية');
    var r = { shift: sh, sales: 0, count: 0, returns: 0, retCount: 0, cashSales: 0, cardSales: 0, creditSales: 0, cashReturns: 0, cardReturns: 0, cashIn: 0, cashOut: 0, expenses: 0, receipts: 0, payments: 0, purchasesCash: 0, transfersIn: 0, transfersOut: 0, discount: 0, vat: 0, byUser: {} };
    S.docs.forEach(function (d) {
      if (d.shift !== sh.id || d.status !== 'posted') return;
      if (d.t === 'sale') {
        r.sales += d.total; r.count++; r.discount += d.discount || 0; r.vat += d.vat;
        d.pays.forEach(function (p) { if (p.m === 'cash') r.cashSales += p.amt; else if (p.m === 'credit') r.creditSales += p.amt; else r.cardSales += p.amt; });
        var u = d.by || '—'; r.byUser[u] = (r.byUser[u] || 0) + d.total;
      } else if (d.t === 'sret') { r.returns += d.total; r.retCount++; r.vat -= d.vat; d.pays.forEach(function (p) { if (p.m === 'cash') r.cashReturns += p.amt; else if (p.m !== 'credit') r.cardReturns += p.amt; }); }
      else if (d.t === 'pur') d.pays.forEach(function (p) { if (p.m === 'cash') r.purchasesCash += p.amt; });
      else if (d.t === 'pret') d.pays.forEach(function (p) { if (p.m === 'cash') r.purchasesCash -= p.amt; });
    });
    S.vouchers.forEach(function (v) {
      if (v.shift !== sh.id || v.status !== 'posted') return;
      if (v.t === 'exp' && v.method === 'cash') r.expenses += v.amount;
      else if (v.t === 'rcv' && v.method === 'cash') r.receipts += v.amount;
      else if (v.t === 'pay' && v.method === 'cash') r.payments += v.amount;
      else if (v.t === 'trf') { if (v.to === 'cash') r.transfersIn += v.amount; if (v.method === 'cash') r.transfersOut += v.amount; }
    });
    r.cashIn = r.cashSales + r.receipts + r.transfersIn;
    r.cashOut = r.cashReturns + r.expenses + r.payments + r.purchasesCash + r.transfersOut;
    r.expected = sh.float + r.cashIn - r.cashOut;
    return r;
  }
  // إغلاق الوردية بعدّ النقدية: العجز أو الزيادة بقيد على «عجز وزيادة الصندوق»
  function shiftClose(inp) {
    var sh = openShift(); need(sh, 'لا توجد وردية مفتوحة');
    need(inp && inp.counted !== '' && inp.counted != null && isFinite(inp.counted), 'اكتب النقدية المعدودة في الدرج');
    var counted = Math.round(inp.counted); need(counted >= 0, 'المبلغ غير صحيح');
    var r = shiftSummary(sh.id), diff = counted - r.expected, j = null;
    if (diff) j = postJournal(today(), sh.no, (diff < 0 ? 'عجز الصندوق' : 'زيادة الصندوق') + ' — إغلاق الوردية ' + sh.no + (sh.by ? ' (' + sh.by + ')' : ''), diff < 0 ? [{ a: '5210', dr: -diff }, { a: '1101', cr: -diff }] : [{ a: '1101', dr: diff }, { a: '5210', cr: diff }], { t: 'shift', id: sh.id });
    sh.status = 'closed'; sh.closedAt = nowIso(); sh.closedBy = CU ? CU.name : ''; sh.counted = counted; sh.expected = r.expected; sh.diff = diff; sh.jid = j ? j.id : null; sh.note = inp.note || sh.note;
    sh.totals = { sales: r.sales, count: r.count, returns: r.returns, cashSales: r.cashSales, cardSales: r.cardSales, creditSales: r.creditSales, expenses: r.expenses, receipts: r.receipts, payments: r.payments };
    audit('إغلاق وردية', sh.no); save(); return sh;
  }

  /* ---------- قارئ الباركود بالكاميرا (EAN-13 / EAN-8 / UPC-A) ---------- */
  var EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
  var EAN_PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  function eanCheck(code) { var s = 0, n = code.length; for (var i = 0; i < n - 1; i++) s += (+code[n - 2 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - s % 10) % 10 === +code[n - 1]; }
  // أربعة أشرطة لرقم واحد ← نمط 7 وحدات
  function digitOf(runs) {
    var t = runs[0] + runs[1] + runs[2] + runs[3], m = t / 7, w = runs.map(function (x) { return Math.max(1, Math.min(4, Math.round(x / m))); }), sum = w[0] + w[1] + w[2] + w[3];
    while (sum !== 7) { var bi = 0, be = -1e9; for (var i = 0; i < 4; i++) { var e = sum > 7 ? w[i] - runs[i] / m : runs[i] / m - w[i]; if ((sum > 7 ? w[i] > 1 : w[i] < 4) && e > be) { be = e; bi = i; } } w[bi] += sum > 7 ? -1 : 1; sum += sum > 7 ? -1 : 1; }
    var k = w.join(''), d = EAN_L.indexOf(k); if (d >= 0) return { d: d, p: 'L' };
    d = EAN_L.indexOf(k.split('').reverse().join('')); if (d >= 0) return { d: d, p: 'G' };
    return null;
  }
  function guardOk(runs, m) { for (var i = 0; i < runs.length; i++) if (runs[i] < m * 0.45 || runs[i] > m * 1.8) return false; return true; }
  // runs: أطوال متتالية تبدأ بشريط داكن
  function decodeRuns(runs) {
    var i, k, out;
    for (i = 0; i + 43 <= runs.length; i += 2) {
      // EAN-13: 59 شريطاً، 95 وحدة
      if (i + 59 <= runs.length) {
        var seg = runs.slice(i, i + 59), tot = 0; for (k = 0; k < 59; k++) tot += seg[k];
        var m = tot / 95;
        if (guardOk(seg.slice(0, 3), m) && guardOk(seg.slice(27, 32), m) && guardOk(seg.slice(56, 59), m) && (i === 0 || runs[i - 1] > m * 4)) {
          out = ''; var par = '';
          for (k = 0; k < 6 && out !== null; k++) { var r = digitOf(seg.slice(3 + k * 4, 7 + k * 4)); if (!r) out = null; else { out += r.d; par += r.p; } }
          for (k = 0; k < 6 && out !== null; k++) { var q = digitOf(seg.slice(32 + k * 4, 36 + k * 4)); if (!q || q.p !== 'L') out = null; else out += q.d; }
          if (out !== null) { var f = EAN_PAR.indexOf(par); if (f >= 0 && eanCheck(f + out)) return f + out; }
        }
      }
      // EAN-8: 43 شريطاً، 67 وحدة
      var s8 = runs.slice(i, i + 43), t8 = 0; for (k = 0; k < 43; k++) t8 += s8[k];
      var m8 = t8 / 67;
      if (guardOk(s8.slice(0, 3), m8) && guardOk(s8.slice(19, 24), m8) && guardOk(s8.slice(40, 43), m8) && (i === 0 || runs[i - 1] > m8 * 4)) {
        out = '';
        for (k = 0; k < 4 && out !== null; k++) { var a = digitOf(s8.slice(3 + k * 4, 7 + k * 4)); if (!a || a.p !== 'L') out = null; else out += a.d; }
        for (k = 0; k < 4 && out !== null; k++) { var b = digitOf(s8.slice(24 + k * 4, 28 + k * 4)); if (!b || b.p !== 'L') out = null; else out += b.d; }
        if (out !== null && eanCheck(out)) return out;
      }
    }
    return null;
  }
  function runsOf(row) {
    var mn = 255, mx = 0, i; for (i = 0; i < row.length; i++) { if (row[i] < mn) mn = row[i]; if (row[i] > mx) mx = row[i]; }
    if (mx - mn < 40) return null;
    var th = (mn + mx) / 2, runs = [], cur = row[0] < th, len = 0, started = false;
    for (i = 0; i < row.length; i++) {
      var dark = row[i] < th;
      if (dark === cur) len++; else { if (started || cur) { runs.push(len); started = true; } cur = dark; len = 1; }
    }
    if (started) runs.push(len);
    return runs;
  }
  // gray: صورة رمادية (Uint8Array عرض × ارتفاع). يجرّب عدة أسطر أفقية من المنتصف وفي الاتجاهين.
  function scanBarcode(gray, w, h) {
    var rows = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75];
    for (var k = 0; k < rows.length; k++) {
      var y = Math.floor(h * rows[k]), row = Array.prototype.slice.call(gray, y * w, y * w + w);
      for (var dir = 0; dir < 2; dir++) {
        var runs = runsOf(dir ? row.slice().reverse() : row); if (!runs) break;
        var c = decodeRuns(runs); if (c) return c;
      }
    }
    return null;
  }
  // البحث عن صنف بالباركود: يقبل UPC-A المقروء كـ EAN-13 بصفر في أوله
  function productByBarcode(code) {
    code = String(code || '').trim(); if (!code) return null;
    for (var i = 0; i < S.products.length; i++) { var p = S.products[i]; if (p.active !== false && p.barcode && (p.barcode === code || (code.length === 13 && code[0] === '0' && p.barcode === code.slice(1)) || (p.barcode.length === 13 && p.barcode[0] === '0' && p.barcode.slice(1) === code))) return p; }
    return null;
  }

  /* ---------- التقارير ---------- */
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  function balances(from, to) {
    var m = {};
    S.journals.forEach(function (j) { if (!inRange(j.date, from, to)) return; j.lines.forEach(function (l) { var x = m[l.a] || (m[l.a] = { dr: 0, cr: 0 }); x.dr += l.dr; x.cr += l.cr; }); });
    return m;
  }
  function trialBalance(to) {
    var m = balances(null, to), rows = [], td = 0, tc = 0;
    S.accounts.slice().sort(function (a, b) { return a.code < b.code ? -1 : 1; }).forEach(function (a) {
      var x = m[a.code]; if (!x) return; var b = x.dr - x.cr; if (!b && !x.dr) return;
      var r = { code: a.code, name: a.name, type: a.type, dr: b > 0 ? b : 0, cr: b < 0 ? -b : 0, mdr: x.dr, mcr: x.cr }; rows.push(r); td += r.dr; tc += r.cr;
    });
    return { rows: rows, dr: td, cr: tc, balanced: td === tc };
  }
  function incomeStatement(from, to) {
    var m = balances(from, to), rev = [], exp = [], sales = 0, cogs = 0, tr = 0, tx = 0;
    S.accounts.forEach(function (a) {
      var x = m[a.code]; if (!x) return;
      if (a.type === 'R') { var v = x.cr - x.dr; if (v) rev.push({ code: a.code, name: a.name, amount: v }); tr += v; if (a.code === '4101' || a.code === '4102') sales += v; }
      if (a.type === 'X') { var w = x.dr - x.cr; if (a.code === '5101') cogs += w; else if (w) exp.push({ code: a.code, name: a.name, amount: w }); tx += w; }
    });
    return { revenue: rev, expenses: exp, netSales: sales, cogs: cogs, gross: sales - cogs, otherRevenue: tr - sales, totalRevenue: tr, opex: tx - cogs, net: tr - tx };
  }
  function balanceSheet(to) {
    var m = balances(null, to), A = [], L = [], E = [], ta = 0, tl = 0, te = 0, pl = 0;
    S.accounts.forEach(function (a) {
      var x = m[a.code]; if (!x) return; var d = x.dr - x.cr; if (!d) return;
      if (a.type === 'A') { A.push({ code: a.code, name: a.name, amount: d }); ta += d; }
      else if (a.type === 'L') { L.push({ code: a.code, name: a.name, amount: -d }); tl -= d; }
      else if (a.type === 'E') { E.push({ code: a.code, name: a.name, amount: -d }); te -= d; }
      else pl -= d;
    });
    if (pl) { E.push({ code: '', name: 'صافي ربح (خسارة) الفترة', amount: pl }); te += pl; }
    return { assets: A, liabilities: L, equity: E, totalAssets: ta, totalLiabilities: tl, totalEquity: te, balanced: ta === tl + te };
  }
  function vatReport(from, to) {
    var r = { salesStd: 0, salesStdVat: 0, salesZero: 0, returns: 0, returnsVat: 0, purchases: 0, purchasesVat: 0, purchaseReturns: 0, purchaseReturnsVat: 0, expenses: 0, expensesVat: 0 };
    S.docs.forEach(function (d) {
      if (d.status !== 'posted' || !inRange(d.date, from, to)) return;
      d.lines.forEach(function (l) {
        if (d.t === 'sale') { if (l.rate > 0) { r.salesStd += l.net; r.salesStdVat += l.vat; } else r.salesZero += l.net; }
        else if (d.t === 'sret') { r.returns += l.net; r.returnsVat += l.vat; }
        else if (d.t === 'pur') { r.purchases += l.net; r.purchasesVat += l.vat; }
        else if (d.t === 'pret') { r.purchaseReturns += l.net; r.purchaseReturnsVat += l.vat; }
      });
    });
    S.vouchers.forEach(function (v) { if (v.t === 'exp' && v.status === 'posted' && v.vat > 0 && inRange(v.date, from, to)) { r.expenses += v.net; r.expensesVat += v.vat; } });
    r.outputVat = r.salesStdVat - r.returnsVat; r.inputVat = r.purchasesVat - r.purchaseReturnsVat + r.expensesVat; r.netVat = r.outputVat - r.inputVat;
    var m = balances(from, to), o = m['2102'] || { dr: 0, cr: 0 }, i = m['1105'] || { dr: 0, cr: 0 };
    r.ledgerOutput = o.cr - o.dr; r.ledgerInput = i.dr - i.cr;
    return r;
  }
  function ledger(code, from, to, partyId) {
    var a = account(code), sign = a && (a.type === 'A' || a.type === 'X') ? 1 : -1, open = 0, rows = [], bal;
    S.journals.forEach(function (j) {
      j.lines.forEach(function (l) {
        if (l.a !== code || (partyId && l.p !== partyId)) return;
        if (from && j.date < from) { open += (l.dr - l.cr) * sign; return; }
        if (to && j.date > to) return;
        rows.push({ date: j.date, no: j.no, ref: j.ref, desc: j.desc, dr: l.dr, cr: l.cr, jid: j.id });
      });
    });
    bal = open; rows.forEach(function (r) { bal += (r.dr - r.cr) * sign; r.bal = bal; });
    return { open: open, rows: rows, close: bal, sign: sign };
  }
  function daily(date) {
    var r = { date: date, sales: 0, count: 0, returns: 0, purchases: 0, expenses: 0, methods: { cash: 0, card: 0, credit: 0 }, cogs: 0, top: [] }, tp = {};
    S.docs.forEach(function (d) {
      if (d.date !== date || d.status !== 'posted') return;
      if (d.t === 'sale') {
        r.sales += d.total; r.count++; d.pays.forEach(function (p) { r.methods[p.m === 'bank' ? 'card' : p.m] += p.amt; });
        d.lines.forEach(function (l) { r.cogs += l.cost || 0; var k = l.name; tp[k] = tp[k] || { name: k, qty: 0, total: 0 }; tp[k].qty += l.qty; tp[k].total += l.total; });
      } else if (d.t === 'sret') { r.returns += d.total; r.cogs -= d.lines.reduce(function (a, l) { return a + (l.cost || 0); }, 0); }
      else if (d.t === 'pur') r.purchases += d.total;
      else if (d.t === 'pret') r.purchases -= d.total;
    });
    S.vouchers.forEach(function (v) { if (v.date === date && v.status === 'posted' && v.t === 'exp') r.expenses += v.amount; });
    for (var k in tp) r.top.push(tp[k]); r.top.sort(function (a, b) { return b.total - a.total; }); r.top = r.top.slice(0, 8);
    var m = balances(date, date), mb = balances(null, addDays(date, -1)), ma = balances(null, date);
    function b(mm, c) { var x = mm[c]; return x ? x.dr - x.cr : 0; }
    r.cash = { open: b(mb, '1101'), in: (m['1101'] || { dr: 0 }).dr, out: (m['1101'] || { cr: 0 }).cr, close: b(ma, '1101') };
    r.bank = { open: b(mb, '1102'), in: (m['1102'] || { dr: 0 }).dr, out: (m['1102'] || { cr: 0 }).cr, close: b(ma, '1102') };
    return r;
  }
  function salesByProduct(from, to) {
    var m = {}, out = [];
    S.docs.forEach(function (d) {
      if (d.status !== 'posted' || !inRange(d.date, from, to) || (d.t !== 'sale' && d.t !== 'sret')) return;
      var s = d.t === 'sale' ? 1 : -1;
      d.lines.forEach(function (l) { var x = m[l.name] || (m[l.name] = { name: l.name, qty: 0, net: 0, vat: 0, total: 0, cost: 0 }); x.qty += s * l.qty; x.net += s * l.net; x.vat += s * l.vat; x.total += s * l.total; x.cost += s * (l.cost || 0); });
    });
    for (var k in m) { m[k].profit = m[k].net - m[k].cost; out.push(m[k]); }
    return out.sort(function (a, b) { return b.total - a.total; });
  }
  function stockValue() { return S.products.reduce(function (a, p) { return a + (p.service ? 0 : Math.round(Math.max(p.stock, 0) * p.cost)); }, 0); }
  function lowStock() { return S.products.filter(function (p) { return !p.service && p.active !== false && p.stock <= (p.min || 0); }); }
  // فحص سلامة الدفاتر
  function integrity() {
    var bad = 0; S.journals.forEach(function (j) { var d = 0, c = 0; j.lines.forEach(function (l) { d += l.dr; c += l.cr; }); if (d !== c) bad++; });
    var tb = trialBalance(), bs = balanceSheet(), vr = vatReport(), m = balances();
    var ar = 0, ap = 0; S.parties.forEach(function (p) { var b = partyBalance(p.id); if (p.role === 'c') ar += b; else ap += b; });
    function gl(c, s) { var x = m[c]; return x ? (x.dr - x.cr) * s : 0; }
    return [
      { name: 'كل القيود متوازنة', ok: bad === 0 },
      { name: 'ميزان المراجعة متوازن', ok: tb.balanced },
      { name: 'الميزانية: الأصول = الخصوم + حقوق الملكية', ok: bs.balanced },
      { name: 'ضريبة المخرجات في المستندات = الأستاذ', ok: vr.outputVat === vr.ledgerOutput },
      { name: 'ضريبة المدخلات في المستندات = الأستاذ', ok: vr.inputVat === vr.ledgerInput },
      { name: 'أرصدة العملاء = حساب العملاء', ok: ar === gl('1103', 1) },
      { name: 'أرصدة الموردين = حساب الموردين', ok: ap === gl('2101', -1) },
      { name: 'فروقات الورديات المغلقة مقيدة على «عجز وزيادة الصندوق»', ok: S.shifts.reduce(function (a, sh) { return a + (sh.status === 'closed' ? -(sh.diff || 0) : 0); }, 0) === S.journals.reduce(function (a, j) { return a + (j.src && j.src.t === 'shift' ? j.lines.reduce(function (b, l) { return b + (l.a === '5210' ? l.dr - l.cr : 0); }, 0) : 0); }, 0) }
    ];
  }

  /* ---------- رمز QR للهيئة (المرحلة الأولى — TLV ثم Base64) ---------- */
  function utf8(s) {
    var o = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) o.push(c); else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c < 0xdc00) { c = 0x10000 + ((c & 0x3ff) << 10) + (s.charCodeAt(++i) & 0x3ff); o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      else o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return o;
  }
  function b64(bytes) {
    var t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = '', i, a, b, c;
    for (i = 0; i < bytes.length; i += 3) {
      a = bytes[i]; b = bytes[i + 1]; c = bytes[i + 2];
      o += t[a >> 2] + t[((a & 3) << 4) | ((b || 0) >> 4)] + (i + 1 < bytes.length ? t[((b & 15) << 2) | ((c || 0) >> 6)] : '=') + (i + 2 < bytes.length ? t[c & 63] : '=');
    }
    return o;
  }
  function zatcaQr(doc) {
    var f = [S.settings.name || '-', S.settings.vat || '', doc.ts, (doc.total / 100).toFixed(2), (doc.vat / 100).toFixed(2)], out = [];
    f.forEach(function (v, i) { var b = utf8(String(v)); out.push(i + 1, b.length); out = out.concat(b); });
    return b64(out);
  }

  /* ---------- التفقيط ---------- */
  function words(n) {
    var ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    var tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    var hund = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
    function tri(x) { var p = [], h = Math.floor(x / 100), r = x % 100; if (h) p.push(hund[h]); if (r) { if (r < 20) p.push(ones[r]); else { var o = r % 10, t = Math.floor(r / 10); p.push(o ? ones[o] + ' و' + tens[t] : tens[t]); } } return p.join(' و'); }
    function grp(x, one, two, pl, sg) { if (!x) return ''; if (x === 1) return one; if (x === 2) return two; if (x >= 3 && x <= 10) return tri(x) + ' ' + pl; return tri(x) + ' ' + sg; }
    if (n === 0) return 'صفر';
    var m = Math.floor(n / 1e6), t = Math.floor(n / 1000) % 1000, r = n % 1000, p = [];
    if (m) p.push(grp(m, 'مليون', 'مليونان', 'ملايين', 'مليون')); if (t) p.push(grp(t, 'ألف', 'ألفان', 'آلاف', 'ألف')); if (r) p.push(tri(r));
    return p.join(' و');
  }
  function tafqeet(h) {
    h = Math.abs(Math.round(h)); var r = Math.floor(h / 100), f = h % 100;
    return 'فقط ' + words(r) + ' ريال' + (f ? ' و' + words(f) + ' هللة' : '') + ' لا غير';
  }

  /* ---------- بيانات تجريبية ---------- */
  function withCheck(c12) { for (var d = 0; d < 10; d++) if (eanCheck(c12 + d)) return c12 + d; return c12; }
  function loadDemo() {
    var keep = S.settings, wasSetup = S.setup, users = S.users || [], rs = keep.requireShift; S = defaults(); S.settings = keep; S.setup = wasSetup; S.users = users; S.demo = true; keep.requireShift = false;
    if (!S.settings.name) { S.settings.name = 'مؤسسة الواحة التجارية'; S.settings.vat = '310123456700003'; S.settings.cr = '4030123456'; S.settings.address = 'شارع إبراهيم الخليل'; S.settings.city = 'مكة المكرمة'; S.settings.phone = '0500000000'; }
    var t = today(), cats = {}, P = {};
    ['مشروبات', 'مخبوزات', 'بقالة', 'منظفات', 'خدمات'].forEach(function (n) { cats[n] = saveCat({ name: n }).id; });
    [['قهوة عربية', 1200, 'مشروبات', 0, 0, 1], ['شاي كرك', 500, 'مشروبات', 0, 0, 1], ['ماء 330 مل', 100, 'مشروبات', 40, 0], ['عصير برتقال', 800, 'مشروبات', 380, 0], ['مشروب غازي', 300, 'مشروبات', 170, 0],
    ['خبز تميس', 200, 'مخبوزات', 90, 0], ['كرواسون', 600, 'مخبوزات', 250, 0], ['كيك شوكولاتة', 1500, 'مخبوزات', 700, 0],
    ['أرز بسمتي 5 كجم', 4500, 'بقالة', 3300, 0], ['زيت طبخ 1.5 لتر', 2300, 'بقالة', 1700, 0], ['سكر 2 كجم', 1100, 'بقالة', 800, 0], ['تمر سكري 1 كجم', 3500, 'بقالة', 2200, 0], ['حليب طويل الأجل', 650, 'بقالة', 450, 0],
    ['صابون سائل', 1400, 'منظفات', 900, 0], ['مناديل 10 علب', 2000, 'منظفات', 1350, 0], ['توصيل طلب', 1000, 'خدمات', 0, 0, 1]].forEach(function (r, i) {
      P[r[0]] = saveProduct({ name: r[0], price: r[1], cat: cats[r[2]], cost: r[3], service: !!r[5], barcode: r[5] ? '' : withCheck(String(628100000000 + i)), min: r[5] ? 0 : 5 });
    });
    var cu1 = saveParty({ role: 'c', name: 'مطعم البيت السعيد', phone: '0551112233', vat: '300987654300003', address: 'حي العزيزية، مكة المكرمة' });
    var cu2 = saveParty({ role: 'c', name: 'أحمد عبدالله', phone: '0567778899' });
    var su1 = saveParty({ role: 's', name: 'شركة التوريدات الغذائية', phone: '0125550001', vat: '311222333400003', address: 'جدة' });
    var su2 = saveParty({ role: 's', name: 'مؤسسة النظافة الحديثة', phone: '0125550002', vat: '310555666700003', address: 'مكة المكرمة' });
    voucher({ kind: 'in', acc: '3101', amount: 3000000, method: 'bank', desc: 'رأس المال', date: addDays(t, -12) });
    function buy(day, sup, items, credit) {
      var lines = items.map(function (x) { return { pid: P[x[0]].id, qty: x[1], price: x[2], rate: 15 }; });
      var c = computeLines(lines, 0, false);
      return purchase({ date: addDays(t, day), partyId: sup.id, supplierRef: 'S-' + (1000 - day), lines: lines, pays: [{ m: credit ? 'credit' : 'bank', amt: c.total }] });
    }
    buy(-11, su1, [['ماء 330 مل', 480, 40], ['عصير برتقال', 120, 380], ['مشروب غازي', 240, 170], ['خبز تميس', 200, 90], ['كرواسون', 80, 250], ['كيك شوكولاتة', 30, 700], ['أرز بسمتي 5 كجم', 40, 3300], ['زيت طبخ 1.5 لتر', 36, 1700], ['سكر 2 كجم', 50, 800], ['تمر سكري 1 كجم', 30, 2200], ['حليب طويل الأجل', 96, 450]], false);
    buy(-10, su2, [['صابون سائل', 48, 900], ['مناديل 10 علب', 40, 1350]], true);
    transfer({ from: 'bank', to: 'cash', amount: 200000, date: addDays(t, -10), desc: 'تغذية الصندوق' });
    var names = Object.keys(P), seed = 7;
    function rnd(n) { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); }
    for (var d = -9; d <= 0; d++) {
      var n = 5 + rnd(5);
      for (var k = 0; k < n; k++) {
        var cnt = 1 + rnd(3), lines = [], used = {};
        for (var q = 0; q < cnt; q++) { var nm = names[rnd(names.length)]; if (used[nm]) continue; used[nm] = 1; lines.push({ pid: P[nm].id, name: nm, qty: 1 + rnd(3), price: P[nm].price, rate: 15 }); }
        var c = computeLines(lines, 0, true), r = rnd(10), pays, party = '';
        if (r < 5) pays = [{ m: 'cash', amt: c.total }]; else if (r < 9) pays = [{ m: 'card', amt: c.total }]; else { pays = [{ m: 'credit', amt: c.total }]; party = cu1.id; }
        sale({ date: addDays(t, d), lines: lines, pays: pays, partyId: party }, { allowOversell: true });
      }
    }
    expense({ date: addDays(t, -9), acc: '5202', amount: 20000, method: 'bank', desc: 'إيجار المحل' });
    expense({ date: addDays(t, -6), acc: '5203', amount: 46000, method: 'bank', hasVat: true, desc: 'فاتورة الكهرباء' });
    expense({ date: addDays(t, -3), acc: '5204', amount: 11500, method: 'cash', hasVat: true, desc: 'قرطاسية ومستلزمات' });
    expense({ date: addDays(t, -1), acc: '5201', amount: 15000, method: 'bank', desc: 'رواتب العاملين' });
    var bal = partyBalance(cu1.id); if (bal > 20000) voucher({ kind: 'in', partyId: cu1.id, amount: Math.round(bal / 2 / 100) * 100, method: 'cash', desc: 'دفعة من الحساب', date: addDays(t, -2) });
    voucher({ kind: 'out', partyId: su2.id, amount: 60000, method: 'bank', desc: 'دفعة للمورد', date: addDays(t, -4) });
    keep.requireShift = rs; S.demo = true; audit('تحميل بيانات تجريبية'); save(); return S;
  }

  return {
    VERSION: VERSION, TYPE_NAMES: TYPE_NAMES, METHOD_NAMES: METHOD_NAMES, DEFAULT_UPDATE: DEFAULT_UPDATE,
    get state() { return S; }, storage: function () { return storageKind; }, onChange: function (f) { listeners.push(f); },
    init: function () { S = defaults(); return S; }, load: load, save: save, flush: persistNow, exportJSON: exportJSON, importJSON: importJSON, reset: reset,
    uid: uid, today: today, addDays: addDays, toH: toH, num: num, fmt: fmt, byId: byId, account: account, validVat: validVat,
    postJournal: postJournal, manualJournal: manualJournal, reverseJournal: reverseJournal,
    saveCat: saveCat, saveProduct: saveProduct, adjustStock: adjustStock, saveParty: saveParty, partyBalance: partyBalance,
    computeLines: computeLines, sale: sale, saleReturn: saleReturn, purchase: purchase, purchaseReturn: purchaseReturn, expense: expense,
    ROLES: ROLES, can: can, saveUser: saveUser, removeUser: removeUser, clearUsers: clearUsers, login: login, logout: logout, get user() { return CU; }, sha256: sha256,
    openShift: openShift, shiftOpen: shiftOpen, shiftClose: shiftClose, shiftSummary: shiftSummary,
    scanBarcode: scanBarcode, decodeRuns: decodeRuns, eanCheck: eanCheck, productByBarcode: productByBarcode,
    voucher: voucher, transfer: transfer, cancel: cancel,
    addAccount: function (a) { need(/^\d{4,6}$/.test(a.code), 'رمز الحساب 4–6 أرقام'); need(!account(a.code), 'الرمز مستخدم'); need(a.name, 'اكتب اسم الحساب'); need({ 1: 'A', 2: 'L', 3: 'E', 4: 'R', 5: 'X' }[a.code[0]] === a.type, 'الرمز يجب أن يبدأ برقم نوع الحساب (1 أصول، 2 خصوم، 3 ملكية، 4 إيرادات، 5 مصروفات)'); S.accounts.push({ code: a.code, name: a.name, type: a.type }); save(); },
    balances: balances, trialBalance: trialBalance, incomeStatement: incomeStatement, balanceSheet: balanceSheet, vatReport: vatReport, ledger: ledger, daily: daily, salesByProduct: salesByProduct, stockValue: stockValue, lowStock: lowStock, integrity: integrity,
    zatcaQr: zatcaQr, tafqeet: tafqeet, loadDemo: loadDemo
  };
})();
if (typeof module !== 'undefined') module.exports = Mizan;
