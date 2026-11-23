/* ميزان لايت — المحرك المحاسبي (قيد مزدوج، المبالغ بالهللة كأعداد صحيحة) */
var Mizan = (function () {
  'use strict';
  var VERSION = '1.0.0';
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
    ['5208', 'تسويات وفروقات المخزون', 'X'], ['5209', 'رسوم حكومية وتراخيص', 'X']
  ];
  var TYPE_NAMES = { A: 'الأصول', L: 'الخصوم', E: 'حقوق الملكية', R: 'الإيرادات', X: 'المصروفات' };
  var METHOD_ACC = { cash: '1101', card: '1102', bank: '1102' };
  var METHOD_NAMES = { cash: 'نقدي', card: 'شبكة', bank: 'تحويل بنكي', credit: 'آجل' };

  var S = null, saveTimer = null, idb = null, storageKind = 'memory', listeners = [];

  function defaults() {
    return {
      v: 1, setup: false, demo: false,
      settings: {
        name: '', nameEn: '', vat: '', cr: '', address: '', city: '', phone: '', logo: '',
        vatRate: 15, pricesIncl: true, oversell: 'ask', mode: 'auto', scale: 100, theme: 'light',
        tplReceipt: 't80', tplInvoice: 'a4classic', footer: 'شكراً لتعاملكم معنا', showHijri: true,
        bilingual: true, showLogo: true, autoPrint: false, updateUrl: DEFAULT_UPDATE
      },
      accounts: COA.map(function (a) { return { code: a[0], name: a[1], type: a[2], sys: true }; }),
      cats: [], products: [], parties: [], docs: [], vouchers: [], journals: [], held: [], seq: {}, audit: []
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
  function audit(act, ref) { S.audit.push({ ts: nowIso(), act: act, ref: ref || '' }); if (S.audit.length > 500) S.audit.splice(0, S.audit.length - 500); }
  function validVat(v) { return /^3\d{13}3$/.test(String(v || '')); }

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
    S = migrate(st); save(); return S;
  }
  function reset(keepSettings) {
    var old = S; S = defaults();
    if (keepSettings && old) { S.settings = old.settings; S.setup = old.setup; }
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
    S.docs.push(doc); if (short.length) audit('بيع بتخطي الرصيد', no); save(); return doc;
  }
  // items: [{i: رقم السطر, qty}]
  function saleReturn(docId, items, method) {
    var d = byId(S.docs, docId); need(d && d.t === 'sale', 'الفاتورة غير موجودة');
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
    S.docs.push(doc); audit('مرتجع مبيعات', no); save(); return doc;
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
    S.docs.push(doc); save(); return doc;
  }

  /* ---------- المصروفات والسندات ---------- */
  function expense(inp) {
    var a = account(inp.acc); need(a && a.type === 'X', 'اختر حساب المصروف');
    var g = Math.round(inp.amount); need(g > 0, 'اكتب المبلغ'); need(METHOD_ACC[inp.method], 'اختر طريقة الدفع');
    var rate = S.settings.vatRate, net = inp.hasVat ? Math.round(g * 100 / (100 + rate)) : g, vat = g - net;
    var no = seqNext('EXP', 'EXP'), date = inp.date || today();
    var v = { id: uid(), t: 'exp', no: no, date: date, ts: nowIso(), acc: inp.acc, amount: g, net: net, vat: vat, method: inp.method, desc: inp.desc || a.name, payee: inp.payee || '', status: 'posted' };
    v.jid = postJournal(date, no, 'مصروف: ' + v.desc, [{ a: inp.acc, dr: net }, { a: '1105', dr: vat }, { a: METHOD_ACC[inp.method], cr: g }], { t: 'exp', id: v.id }).id;
    S.vouchers.push(v); save(); return v;
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
    S.vouchers.push(v); save(); return v;
  }
  function transfer(inp) {
    var amt = Math.round(inp.amount); need(amt > 0, 'اكتب المبلغ'); need(inp.from !== inp.to && METHOD_ACC[inp.from] && METHOD_ACC[inp.to], 'اختر حسابين مختلفين');
    var no = seqNext('TRF', 'TRF'), date = inp.date || today();
    var v = { id: uid(), t: 'trf', no: no, date: date, ts: nowIso(), amount: amt, method: inp.from, to: inp.to, desc: inp.desc || 'تحويل بين الصندوق والبنك', status: 'posted' };
    v.jid = postJournal(date, no, v.desc, [{ a: METHOD_ACC[inp.to], dr: amt }, { a: METHOD_ACC[inp.from], cr: amt }], { t: 'trf', id: v.id }).id;
    S.vouchers.push(v); save(); return v;
  }
  function cancel(kind, id, reason) {
    need(reason && reason.trim(), 'اكتب سبب الإلغاء');
    var list = kind === 'pur' ? S.docs : S.vouchers, d = byId(list, id);
    need(d && d.status === 'posted', 'المستند غير موجود أو ملغى');
    if (kind === 'pur') {
      d.lines.forEach(function (l) { var p = byId(S.products, l.pid); need(p && p.stock >= l.qty, 'لا يمكن الإلغاء: بيع جزء من كمية الصنف ' + l.name); });
      d.lines.forEach(function (l) {
        var p = byId(S.products, l.pid), q = Math.round((p.stock - l.qty) * 1000) / 1000, val = p.stock * p.cost - l.net;
        if (q > 0 && val > 0) p.cost = Math.round(val / q); p.stock = q;
      });
    }
    reverseJournal(d.jid, 'إلغاء ' + d.no + ' — ' + reason.trim());
    d.status = 'cancelled'; d.cancelReason = reason.trim(); audit('إلغاء مستند', d.no); save(); return d;
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
    var r = { salesStd: 0, salesStdVat: 0, salesZero: 0, returns: 0, returnsVat: 0, purchases: 0, purchasesVat: 0, expenses: 0, expensesVat: 0 };
    S.docs.forEach(function (d) {
      if (d.status !== 'posted' || !inRange(d.date, from, to)) return;
      d.lines.forEach(function (l) {
        if (d.t === 'sale') { if (l.rate > 0) { r.salesStd += l.net; r.salesStdVat += l.vat; } else r.salesZero += l.net; }
        else if (d.t === 'sret') { r.returns += l.net; r.returnsVat += l.vat; }
        else if (d.t === 'pur') { r.purchases += l.net; r.purchasesVat += l.vat; }
      });
    });
    S.vouchers.forEach(function (v) { if (v.t === 'exp' && v.status === 'posted' && v.vat > 0 && inRange(v.date, from, to)) { r.expenses += v.net; r.expensesVat += v.vat; } });
    r.outputVat = r.salesStdVat - r.returnsVat; r.inputVat = r.purchasesVat + r.expensesVat; r.netVat = r.outputVat - r.inputVat;
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
      { name: 'أرصدة الموردين = حساب الموردين', ok: ap === gl('2101', -1) }
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
  function loadDemo() {
    var keep = S.settings, wasSetup = S.setup; S = defaults(); S.settings = keep; S.setup = wasSetup; S.demo = true;
    if (!S.settings.name) { S.settings.name = 'مؤسسة الواحة التجارية'; S.settings.vat = '310123456700003'; S.settings.cr = '4030123456'; S.settings.address = 'شارع إبراهيم الخليل'; S.settings.city = 'مكة المكرمة'; S.settings.phone = '0500000000'; }
    var t = today(), cats = {}, P = {};
    ['مشروبات', 'مخبوزات', 'بقالة', 'منظفات', 'خدمات'].forEach(function (n) { cats[n] = saveCat({ name: n }).id; });
    [['قهوة عربية', 1200, 'مشروبات', 0, 0, 1], ['شاي كرك', 500, 'مشروبات', 0, 0, 1], ['ماء 330 مل', 100, 'مشروبات', 40, 0], ['عصير برتقال', 800, 'مشروبات', 380, 0], ['مشروب غازي', 300, 'مشروبات', 170, 0],
    ['خبز تميس', 200, 'مخبوزات', 90, 0], ['كرواسون', 600, 'مخبوزات', 250, 0], ['كيك شوكولاتة', 1500, 'مخبوزات', 700, 0],
    ['أرز بسمتي 5 كجم', 4500, 'بقالة', 3300, 0], ['زيت طبخ 1.5 لتر', 2300, 'بقالة', 1700, 0], ['سكر 2 كجم', 1100, 'بقالة', 800, 0], ['تمر سكري 1 كجم', 3500, 'بقالة', 2200, 0], ['حليب طويل الأجل', 650, 'بقالة', 450, 0],
    ['صابون سائل', 1400, 'منظفات', 900, 0], ['مناديل 10 علب', 2000, 'منظفات', 1350, 0], ['توصيل طلب', 1000, 'خدمات', 0, 0, 1]].forEach(function (r, i) {
      P[r[0]] = saveProduct({ name: r[0], price: r[1], cat: cats[r[2]], cost: r[3], service: !!r[5], barcode: r[5] ? '' : String(6281000000001 + i), min: r[5] ? 0 : 5 });
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
    S.demo = true; audit('تحميل بيانات تجريبية'); save(); return S;
  }

  return {
    VERSION: VERSION, TYPE_NAMES: TYPE_NAMES, METHOD_NAMES: METHOD_NAMES, DEFAULT_UPDATE: DEFAULT_UPDATE,
    get state() { return S; }, storage: function () { return storageKind; }, onChange: function (f) { listeners.push(f); },
    init: function () { S = defaults(); return S; }, load: load, save: save, flush: persistNow, exportJSON: exportJSON, importJSON: importJSON, reset: reset,
    uid: uid, today: today, addDays: addDays, toH: toH, num: num, fmt: fmt, byId: byId, account: account, validVat: validVat,
    postJournal: postJournal, manualJournal: manualJournal, reverseJournal: reverseJournal,
    saveCat: saveCat, saveProduct: saveProduct, adjustStock: adjustStock, saveParty: saveParty, partyBalance: partyBalance,
    computeLines: computeLines, sale: sale, saleReturn: saleReturn, purchase: purchase, expense: expense,
    voucher: voucher, transfer: transfer, cancel: cancel,
    addAccount: function (a) { need(/^\d{4,6}$/.test(a.code), 'رمز الحساب 4–6 أرقام'); need(!account(a.code), 'الرمز مستخدم'); need(a.name, 'اكتب اسم الحساب'); need({ 1: 'A', 2: 'L', 3: 'E', 4: 'R', 5: 'X' }[a.code[0]] === a.type, 'الرمز يجب أن يبدأ برقم نوع الحساب (1 أصول، 2 خصوم، 3 ملكية، 4 إيرادات، 5 مصروفات)'); S.accounts.push({ code: a.code, name: a.name, type: a.type }); save(); },
    balances: balances, trialBalance: trialBalance, incomeStatement: incomeStatement, balanceSheet: balanceSheet, vatReport: vatReport, ledger: ledger, daily: daily, salesByProduct: salesByProduct, stockValue: stockValue, lowStock: lowStock, integrity: integrity,
    zatcaQr: zatcaQr, tafqeet: tafqeet, loadDemo: loadDemo
  };
})();
if (typeof module !== 'undefined') module.exports = Mizan;
