/* ميزان لايت — الواجهة (1): الهيكل، الإعداد الأول، الرئيسية، نقطة البيع */
var M = Mizan, S = null, route = { name: 'home', arg: null }, pages = {}, actions = {}, inputs = {}, NATIVE = window.MizanNative || null;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(q, r) { return (r || document).querySelector(q); }
function $$(q, r) { return Array.prototype.slice.call((r || document).querySelectorAll(q)); }
function money(h, cls) { return '<span class="num ' + (cls || '') + '">' + M.fmt(h) + '</span>'; }
function qtyf(q) { return String(Math.round(q * 1000) / 1000); }
function norm(s) { return String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); }); }
function dfmt(d) { var p = String(d).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function hijri(d) { try { var p = d.split('-'); return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return ''; } }
function tfmt(ts) { var d = new Date(ts); function z(n) { return n < 10 ? '0' + n : n; } return z(d.getHours()) + ':' + z(d.getMinutes()); }
var ICON = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6', pos: 'M4 4h16v10H4zM2 20h20M8 20l1-6M16 20l-1-6M8 8h3M8 11h8', docs: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
  items: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10', people: 'M16 20v-2a4 4 0 00-8 0v2M12 11a4 4 0 100-8 4 4 0 000 8M22 20v-2a4 4 0 00-3-3.8M2 20v-2a4 4 0 013-3.8',
  buy: 'M3 3h2l3 12h11l2-8H7M9 20a1 1 0 100-2 1 1 0 000 2M18 20a1 1 0 100-2 1 1 0 000 2', money: 'M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6M6 9v.01M18 15v.01',
  acc: 'M4 3h16v18H4zM8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2M16 15v3', rep: 'M4 20V10M10 20V4M16 20v-7M22 20H2', set: 'M12 15a3 3 0 100-6 3 3 0 000 6M19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17v.01', more: 'M5 12h.01M12 12h.01M19 12h.01', print: 'M6 9V3h12v6M6 18H3v-8h18v8h-3M7 14h10v7H7z', plus: 'M12 5v14M5 12h14'
};
function ic(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICON[n] + '"/></svg>'; }
var NAV = [['home', 'الرئيسية', 'home'], ['pos', 'نقطة البيع', 'pos'], ['docs', 'الفواتير', 'docs'], ['products', 'الأصناف', 'items'], ['parties', 'العملاء والموردون', 'people'], ['money', 'المصروفات والسندات', 'money'], ['accounting', 'المحاسبة', 'acc'], ['reports', 'التقارير', 'rep'], ['settings', 'الإعدادات', 'set'], ['guide', 'دليل الاستخدام', 'help']];
var TABS = [['home', 'الرئيسية', 'home'], ['pos', 'البيع', 'pos'], ['docs', 'الفواتير', 'docs'], ['products', 'الأصناف', 'items'], ['more', 'المزيد', 'more']];

/* ---------- الوضع والمقاس ---------- */
function resolveMode() {
  var m = S.settings.mode, w = window.innerWidth;
  if (m === 'auto') m = w < 640 ? 'phone' : w < 1080 ? 'tablet' : 'desktop';
  return m;
}
function applyDisplay() {
  var h = document.documentElement, m = resolveMode(), w = window.innerWidth;
  h.className = 'm-' + m + (S.settings.theme === 'dark' ? ' dark' : '') + (((m === 'phone' || m === 'handheld') && w > 560) || (m === 'tablet' && w > 1250 && S.settings.mode === 'tablet') ? ' framed' : '');
  h.style.setProperty('--fs', Math.round(16 * (S.settings.scale || 100) / 100 * (m === 'handheld' ? 1.06 : 1)) + 'px');
}

/* ---------- الهيكل ---------- */
function shell() {
  $('#nav').innerHTML = '<div class="brand"><i>م</i><span>ميزان لايت</span></div>' + NAV.map(function (n) { return '<a data-act="go" data-to="' + n[0] + '" data-nav="' + n[0] + '">' + ic(n[2]) + '<span>' + n[1] + '</span></a>'; }).join('') + '<div class="ver">الإصدار ' + M.VERSION + '</div>';
  $('#tabbar').innerHTML = TABS.map(function (n) { return '<a data-act="go" data-to="' + n[0] + '" data-nav="' + n[0] + '">' + ic(n[2]) + '<span>' + n[1] + '</span></a>'; }).join('');
}
function go(name, arg) { route = { name: name, arg: arg == null ? null : arg }; render(); var v = $('#view'); if (v) v.scrollTop = 0; }
function render() {
  S = M.state; applyDisplay();
  var app = $('#app');
  if (!S.setup) { app.classList.add('nosh'); $('#nav').style.display = 'none'; $('#tabbar').style.display = 'none'; $('#top').style.display = 'none'; $('#view').className = ''; $('#view').innerHTML = pages.setup.render(); return; }
  $('#nav').style.display = ''; $('#tabbar').style.display = ''; $('#top').style.display = '';
  var p = pages[route.name] || pages.home, phoneTab = TABS.some(function (t) { return t[0] === route.name; }) ? route.name : 'more';
  $$('[data-nav]').forEach(function (a) { var k = a.getAttribute('data-nav'); a.classList.toggle('on', a.parentNode.id === 'tabbar' ? k === phoneTab : k === route.name); });
  $('#top').innerHTML = '<h1>' + esc(typeof p.title === 'function' ? p.title() : p.title) + '</h1><div class="acts row">' + (p.acts ? p.acts() : '') + '</div>';
  $('#view').className = p.flush ? 'flush' : '';
  $('#view').innerHTML = p.render(route.arg);
  if (p.after) p.after();
}
function toast(msg, isErr) { var t = $('#toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, isErr ? 3800 : 2200); }
function guard(fn) { try { return fn(); } catch (e) { if (e && e.code) toast(e.message, true); else { toast('حدث خطأ غير متوقع: ' + (e && e.message), true); if (window.console) console.error(e); } return undefined; } }
function modal(title, body, foot, wide) {
  $('#modal').innerHTML = '<div class="dlg' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true"><div class="dlg-h"><span>' + esc(title) + '</span><button data-act="close" aria-label="إغلاق">✕</button></div><div class="dlg-b">' + body + '</div>' + (foot ? '<div class="dlg-f">' + foot + '</div>' : '') + '</div>';
  $('#modal').classList.add('open');
  var f = $('#modal [autofocus]'); if (f && resolveMode() !== 'phone' && resolveMode() !== 'handheld') f.focus();
}
function closeModal() { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; }
function form(root) {
  var o = {}; $$('[name]', root || $('#modal')).forEach(function (el) { o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); }); return o;
}
function fld(label, name, val, attrs) { return '<label class="f"><span>' + label + '</span><input name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '></label>'; }
function nfld(label, name, val, attrs) { return fld(label, name, val, 'class="n" inputmode="decimal" autocomplete="off" ' + (attrs || '')); }
function sel(label, name, opts, val, attrs) { return '<label class="f"><span>' + label + '</span><select name="' + name + '" ' + (attrs || '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
function chk(label, name, on) { return '<label class="chk"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '>' + label + '</label>'; }
function confirmBox(title, text, yesLabel, cb, danger) { confirmBox.cb = cb; modal(title, '<p>' + text + '</p>', '<button class="btn ghost" data-act="close">تراجع</button><button class="btn ' + (danger ? 'red' : '') + '" data-act="confirm-yes">' + yesLabel + '</button>'); }
actions['confirm-yes'] = function () { var cb = confirmBox.cb; closeModal(); if (cb) guard(cb); };
actions.close = closeModal;
actions.go = function (el) { closeModal(); go(el.getAttribute('data-to'), el.getAttribute('data-arg')); };
var METHODS = [['cash', 'نقدي'], ['card', 'شبكة'], ['bank', 'تحويل بنكي']];
function partyOpts(role, none) { var o = none ? [['', none]] : []; S.parties.forEach(function (p) { if (p.role === role) o.push([p.id, p.name]); }); return o; }

/* ---------- الإعداد الأول ---------- */
var DEVICES = [
  ['phone', 'جوال', 'شاشة صغيرة — شريط سفلي', '<rect x="20" y="3" width="20" height="38" rx="4"/><path d="M27 37h6"/>'],
  ['handheld', 'جهاز دفع محمول', 'أندرويد بطابعة مدمجة 58مم', '<rect x="19" y="14" width="22" height="28" rx="3"/><rect x="23" y="3" width="14" height="11" rx="1"/><path d="M24 20h12M24 25h12M24 30h4M30 30h6"/>'],
  ['tablet', 'كاشير صغير / تابلت', 'شاشة 7–10 بوصة', '<rect x="9" y="8" width="42" height="30" rx="3"/><path d="M28 34h4"/>'],
  ['desktop', 'كاشير كبير / لابتوب', 'شاشة 11 بوصة فأكثر', '<rect x="8" y="5" width="44" height="27" rx="2"/><path d="M4 38h52M24 32v6M36 32v6"/>']
];
function deviceGrid(cur) {
  return '<div class="devs">' + DEVICES.map(function (d) { return '<button class="dev' + (cur === d[0] ? ' on' : '') + '" data-act="pick-mode" data-m="' + d[0] + '"><svg viewBox="0 0 60 45" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' + d[3] + '</svg><b>' + d[1] + '</b><small>' + d[2] + '</small></button>'; }).join('') + '</div>' +
    '<button class="dev' + (cur === 'auto' ? ' on' : '') + '" data-act="pick-mode" data-m="auto" style="margin-bottom:12px"><b>تلقائي حسب مقاس الشاشة</b><small>يتغيّر الشكل مع دوران الجهاز أو تغيير حجم النافذة</small></button>';
}
actions['pick-mode'] = function (el) {
  var m = el.getAttribute('data-m'), keep = S.setup ? null : form($('#view'));
  S.settings.mode = m;
  if (keep) { ['name', 'vat', 'cr', 'city', 'address', 'phone', 'tplReceipt'].forEach(function (k) { S.settings[k] = keep[k]; }); if (m === 'handheld') S.settings.tplReceipt = 't58'; }
  M.save(); render();
};
pages.setup = {
  render: function () {
    var s = S.settings;
    return '<div class="wiz"><div class="hero"><h2>مرحباً بك في <b>ميزان لايت</b></h2><div>نقطة بيع ومحاسبة أساسية — تعمل على جهازك بلا إنترنت وبلا تسجيل دخول</div></div>' +
      '<div class="card"><h3>١ — بيانات المنشأة (تظهر على الفاتورة)</h3>' + fld('اسم المنشأة *', 'name', s.name) + fld('الرقم الضريبي (15 رقماً — اتركه فارغاً إن لم تكن مسجلاً)', 'vat', s.vat, 'class="n" inputmode="numeric" maxlength="15"') +
      '<div class="grid g2">' + fld('السجل التجاري', 'cr', s.cr, 'class="n" inputmode="numeric"') + fld('الجوال', 'phone', s.phone, 'class="n" inputmode="tel"') + '</div><div class="grid g2">' + fld('المدينة', 'city', s.city) + fld('العنوان', 'address', s.address) + '</div></div>' +
      '<div class="card"><h3>٢ — نوع الجهاز ومقاس الشاشة</h3>' + deviceGrid(s.mode) + '<div class="sm mut">يمكن تغييره لاحقاً من الإعدادات ← الجهاز والعرض.</div></div>' +
      '<div class="card"><h3>٣ — مقاس ورق الإيصال</h3>' + sel('طابعة الإيصالات', 'tplReceipt', [['t80', 'حرارية 80 مم'], ['t58', 'حرارية 58 مم'], ['a4classic', 'ورق A4'], ['a5', 'ورق A5']], s.tplReceipt) + '</div>' +
      '<button class="btn gold blk big" data-act="setup-go">ابدأ العمل</button><div style="height:8px"></div><button class="btn ghost blk" data-act="setup-demo">جرّب ببيانات تجريبية أولاً</button><div style="height:20px"></div></div>';
  }
};
function setupSave(demo) {
  var f = form($('#view'));
  if (!demo && !f.name) return toast('اكتب اسم المنشأة', true);
  if (f.vat && !M.validVat(f.vat)) return toast('الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3', true);
  for (var k in f) S.settings[k] = f[k];
  S.setup = true; if (demo) M.loadDemo(); M.save(); go('home');
  toast(demo ? 'تم تحميل بيانات تجريبية — احذفها من الإعدادات عند البدء الفعلي' : 'تم الحفظ — أضف أصنافك وابدأ البيع');
}
actions['setup-go'] = function () { setupSave(false); };
actions['setup-demo'] = function () { setupSave(true); };

/* ---------- الرئيسية ---------- */
pages.home = {
  title: function () { return S.settings.name || 'ميزان لايت'; },
  acts: function () { return '<button class="btn gold sm" data-act="go" data-to="pos">' + ic('pos') + 'بيع جديد</button>'; },
  render: function () {
    var t = M.today(), d = M.daily(t), b = M.balances(), ar = 0, ap = 0, low = M.lowStock(), days = [], mx = 1, i;
    S.parties.forEach(function (p) { var x = M.partyBalance(p.id); if (p.role === 'c') ar += x; else ap += x; });
    for (i = 6; i >= 0; i--) { var dd = M.addDays(t, -i), v = 0; S.docs.forEach(function (x) { if (x.date === dd && x.status === 'posted') { if (x.t === 'sale') v += x.total; else if (x.t === 'sret') v -= x.total; } }); days.push([dd, v]); if (v > mx) mx = v; }
    return (S.demo ? '<div class="note">أنت تعمل على <b>بيانات تجريبية</b>. عند البدء الفعلي: الإعدادات ← البيانات ← حذف كل البيانات.</div>' : '') +
      (!S.products.length ? '<div class="note">ابدأ بإضافة أصنافك: <a data-act="go" data-to="products" class="b" style="text-decoration:underline;cursor:pointer">الأصناف ← صنف جديد</a></div>' : '') +
      '<div class="grid g4" style="margin-bottom:12px"><div class="kpi"><small>مبيعات اليوم</small><b>' + money(d.sales - d.returns) + '</b></div><div class="kpi"><small>عدد الفواتير</small><b class="num">' + d.count + '</b></div><div class="kpi"><small>رصيد الصندوق</small><b>' + money(d.cash.close) + '</b></div><div class="kpi"><small>رصيد البنك / الشبكة</small><b>' + money(d.bank.close) + '</b></div>' +
      '<div class="kpi"><small>مجمل ربح اليوم</small><b>' + money(Math.round((d.sales - d.returns) * 100 / (100 + S.settings.vatRate)) - d.cogs) + '</b></div><div class="kpi"><small>مصروفات اليوم</small><b>' + money(d.expenses) + '</b></div><div class="kpi"><small>لنا عند العملاء</small><b>' + money(ar) + '</b></div><div class="kpi"><small>علينا للموردين</small><b>' + money(ap) + '</b></div></div>' +
      '<div class="grid g4" style="margin-bottom:12px"><button class="btn" data-act="go" data-to="pos">بيع</button><button class="btn ghost" data-act="new-purchase">شراء</button><button class="btn ghost" data-act="new-expense">مصروف</button><button class="btn ghost" data-act="new-voucher" data-k="in">سند قبض</button></div>' +
      '<div class="grid g2 stack"><div class="card"><h3>مبيعات آخر 7 أيام</h3><div class="bars">' + days.map(function (x) { return '<div><span class="num">' + (x[1] ? Math.round(x[1] / 100) : '') + '</span><i style="height:' + Math.round(x[1] / mx * 78) + '%"></i>' + x[0].slice(8) + '/' + x[0].slice(5, 7) + '</div>'; }).join('') + '</div></div>' +
      '<div class="card"><h3>أصناف وصلت حد الطلب (' + low.length + ')</h3>' + (low.length ? '<div class="list">' + low.slice(0, 6).map(function (p) { return '<div data-act="edit-product" data-id="' + p.id + '"><div class="grow t">' + esc(p.name) + '</div><span class="tag r num">' + qtyf(p.stock) + '</span></div>'; }).join('') + '</div>' : '<div class="empty">لا يوجد</div>') + '</div></div>';
  }
};

/* ---------- نقطة البيع ---------- */
var cart = { lines: [], discount: 0, partyId: '' }, posCat = '', posQ = '';
function cartCalc() { return M.computeLines(cart.lines.length ? cart.lines : [], cart.discount, S.settings.pricesIncl); }
function cartCount() { return cart.lines.reduce(function (a, l) { return a + l.qty; }, 0); }
function addToCart(p) {
  var l = null; cart.lines.forEach(function (x) { if (x.pid === p.id && !x.disc && x.price === p.price) l = x; });
  if (l) l.qty = Math.round((l.qty + 1) * 1000) / 1000; else cart.lines.push({ pid: p.id, name: p.name, qty: 1, price: p.price, disc: 0, rate: p.rate });
  drawCart();
}
function posTiles() {
  var q = norm(posQ), list = S.products.filter(function (p) { return p.active !== false && (!posCat || p.cat === posCat) && (!q || norm(p.name).indexOf(q) >= 0 || (p.barcode && p.barcode.indexOf(q) >= 0)); });
  if (!list.length) return '<div class="empty" style="grid-column:1/-1">' + (S.products.length ? 'لا أصناف مطابقة' : 'لا توجد أصناف بعد — أضفها من شاشة الأصناف') + '</div>';
  return list.slice(0, 300).map(function (p) {
    return '<button class="tile" data-act="pos-add" data-id="' + p.id + '">' + (!p.service && p.stock <= 0 ? '<span class="st">نفد</span>' : '') + '<div class="im"' + (p.img ? ' style="background-image:url(' + p.img + ')"' : '') + '>' + (p.img ? '' : esc(p.name.charAt(0))) + '</div><div class="nm">' + esc(p.name) + '</div><div class="pr num">' + M.fmt(p.price) + '</div></button>';
  }).join('');
}
function cartHtml() {
  var c = cartCalc();
  return '<div class="cart-h row"><button class="btn ghost sm noback" data-act="pos-hidecart" id="cart-back">‹ الأصناف</button><div class="grow"><select data-in="pos-party" aria-label="العميل">' + partyOpts('c', 'عميل نقدي').map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cart.partyId ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div><button class="btn ghost sm" data-act="new-party" data-role="c" data-pos="1" aria-label="عميل جديد">＋</button></div>' +
    '<div class="cart-l">' + (cart.lines.length ? cart.lines.map(function (l, i) {
      return '<div class="cl"><div class="grow" data-act="pos-line" data-i="' + i + '"><div class="t">' + esc(l.name) + '</div><div class="sm mut"><span class="num">' + M.fmt(l.price) + '</span>' + (l.disc ? ' · خصم <span class="num">' + M.fmt(l.disc) + '</span>' : '') + ' · <b class="num">' + M.fmt(Math.round(l.qty * l.price) - l.disc) + '</b></div></div><div class="qty"><button data-act="pos-qty" data-i="' + i + '" data-d="-1" aria-label="إنقاص">−</button><span class="num">' + qtyf(l.qty) + '</span><button data-act="pos-qty" data-i="' + i + '" data-d="1" aria-label="زيادة">＋</button></div></div>';
    }).join('') : '<div class="empty">السلة فارغة<br><span class="sm">اضغط على الصنف لإضافته</span></div>') + '</div>' +
    '<div class="cart-f"><div class="ln"><span>قبل الضريبة</span>' + money(c.net) + '</div>' + (c.discount ? '<div class="ln"><span>خصم الفاتورة</span>' + money(c.discount) + '</div>' : '') + '<div class="ln"><span>ضريبة القيمة المضافة ' + S.settings.vatRate + '%</span>' + money(c.vat) + '</div><div class="ln tt"><span>الإجمالي</span>' + money(c.total) + '</div>' +
    '<div class="row"><button class="btn green big grow" data-act="pos-pay"' + (cart.lines.length ? '' : ' disabled') + '>دفع</button></div><div class="cbtns"><button class="btn ghost sm grow" data-act="pos-disc">خصم</button><button class="btn ghost sm grow" data-act="pos-hold">تعليق</button><button class="btn ghost sm grow" data-act="pos-held">المعلّقة (' + S.held.length + ')</button><button class="btn ghost sm" data-act="pos-clear">مسح</button></div></div>';
}
function drawCart() {
  var el = $('#pos-cart'); if (!el) return; el.innerHTML = cartHtml();
  var bar = $('#cartbar'); if (bar) bar.innerHTML = '<span><i class="num">' + qtyf(cartCount()) + '</i>عرض السلة والدفع</span>' + money(cartCalc().total);
  var ph = resolveMode() === 'phone' || resolveMode() === 'handheld'; $('#cart-back').style.display = ph ? '' : 'none';
}
pages.pos = {
  title: 'نقطة البيع', flush: true,
  acts: function () { return '<button class="btn ghost sm" data-act="go" data-to="docs">آخر الفواتير</button>'; },
  render: function () {
    return '<div class="pos" id="pos"><div class="pos-cat"><div class="row" style="margin-bottom:8px"><input class="grow" id="pos-q" data-in="pos-q" placeholder="ابحث بالاسم أو امسح الباركود" value="' + esc(posQ) + '" autocomplete="off" enterkeyhint="search"></div>' +
      '<div class="chips"><button class="chip' + (posCat ? '' : ' on') + '" data-act="pos-cat" data-id="">الكل</button>' + S.cats.map(function (c) { return '<button class="chip' + (posCat === c.id ? ' on' : '') + '" data-act="pos-cat" data-id="' + c.id + '">' + esc(c.name) + '</button>'; }).join('') + '</div>' +
      '<div class="pos-grid" id="pos-grid">' + posTiles() + '</div><button class="cartbar" id="cartbar" data-act="pos-showcart"></button></div><div class="pos-cart" id="pos-cart"></div></div>';
  },
  after: function () { drawCart(); var m = resolveMode(); if (m === 'tablet' || m === 'desktop') { var q = $('#pos-q'); if (q) q.focus(); } }
};
inputs['pos-q'] = function (el) { posQ = el.value; $('#pos-grid').innerHTML = posTiles(); };
inputs['pos-party'] = function (el) { cart.partyId = el.value; };
actions['pos-cat'] = function (el) { posCat = el.getAttribute('data-id'); render(); };
actions['pos-add'] = function (el) { var p = M.byId(S.products, el.getAttribute('data-id')); if (p) addToCart(p); };
actions['pos-qty'] = function (el) { var l = cart.lines[+el.getAttribute('data-i')]; l.qty = Math.round((l.qty + (+el.getAttribute('data-d'))) * 1000) / 1000; if (l.qty <= 0) cart.lines.splice(+el.getAttribute('data-i'), 1); drawCart(); };
actions['pos-showcart'] = function () { $('#pos').classList.add('show-cart'); };
actions['pos-hidecart'] = function () { $('#pos').classList.remove('show-cart'); };
actions['pos-clear'] = function () { if (!cart.lines.length) return; confirmBox('مسح السلة', 'هل تريد مسح كل أصناف السلة؟', 'مسح', function () { cart = { lines: [], discount: 0, partyId: '' }; drawCart(); }, true); };
actions['pos-line'] = function (el) {
  var i = +el.getAttribute('data-i'), l = cart.lines[i];
  modal(l.name, '<div class="grid g2">' + nfld('الكمية', 'qty', qtyf(l.qty), 'autofocus') + nfld('سعر الوحدة', 'price', (l.price / 100).toFixed(2)) + '</div>' + nfld('خصم على السطر (ريال)', 'disc', l.disc ? (l.disc / 100).toFixed(2) : ''), '<button class="btn red" data-act="pos-line-del" data-i="' + i + '">حذف السطر</button><button class="btn" data-act="pos-line-save" data-i="' + i + '">حفظ</button>');
};
actions['pos-line-save'] = function (el) {
  var f = form(), l = cart.lines[+el.getAttribute('data-i')], q = M.num(f.qty), pr = M.toH(f.price), ds = M.toH(f.disc);
  if (!(q > 0)) return toast('الكمية غير صحيحة', true); if (pr < 0 || ds < 0 || ds > Math.round(q * pr)) return toast('السعر أو الخصم غير صحيح', true);
  l.qty = q; l.price = pr; l.disc = ds; closeModal(); drawCart();
};
actions['pos-line-del'] = function (el) { cart.lines.splice(+el.getAttribute('data-i'), 1); closeModal(); drawCart(); };
actions['pos-disc'] = function () { modal('خصم على الفاتورة', nfld('مبلغ الخصم (ريال)', 'd', cart.discount ? (cart.discount / 100).toFixed(2) : '', 'autofocus') + '<div class="sm mut">يوزَّع الخصم على الأصناف وتُحسب الضريبة بعد الخصم.</div>', '<button class="btn" data-act="pos-disc-save">تطبيق</button>'); };
actions['pos-disc-save'] = function () { cart.discount = Math.max(0, M.toH(form().d)); closeModal(); drawCart(); };
actions['pos-hold'] = function () { if (!cart.lines.length) return; S.held.push({ id: M.uid(), ts: new Date().toISOString(), cart: cart }); cart = { lines: [], discount: 0, partyId: '' }; M.save(); drawCart(); toast('تم تعليق الفاتورة'); };
actions['pos-held'] = function () {
  modal('الفواتير المعلّقة', S.held.length ? '<div class="list">' + S.held.map(function (h, i) { var c = M.computeLines(h.cart.lines, h.cart.discount, S.settings.pricesIncl); return '<div data-act="pos-unhold" data-i="' + i + '"><div class="grow"><div class="t">' + h.cart.lines.length + ' صنف — ' + tfmt(h.ts) + '</div><div class="sm mut">' + esc(h.cart.lines.map(function (l) { return l.name; }).slice(0, 3).join('، ')) + '</div></div>' + money(c.total, 'b') + '</div>'; }).join('') + '</div>' : '<div class="empty">لا توجد فواتير معلّقة</div>');
};
actions['pos-unhold'] = function (el) { var i = +el.getAttribute('data-i'); if (cart.lines.length) S.held.push({ id: M.uid(), ts: new Date().toISOString(), cart: cart }); cart = S.held.splice(i, 1)[0].cart; M.save(); closeModal(); drawCart(); };

var pay = { m: 'cash', cash: '' };
function payBody() {
  var c = cartCalc(), t = c.total, given = M.toH(pay.cash), q = [t], r;
  [500, 1000, 2000, 5000, 10000, 20000, 50000].forEach(function (s) { r = Math.ceil(t / s) * s; if (q.indexOf(r) < 0 && q.length < 6) q.push(r); });
  var h = '<div class="c" style="margin-bottom:10px"><div class="mut">المطلوب</div><div style="font-size:2rem;font-weight:800">' + money(t) + '</div></div><div class="paym">' + [['cash', 'نقدي'], ['card', 'شبكة'], ['mixed', 'نقدي + شبكة'], ['credit', 'آجل']].map(function (x) { return '<button class="' + (pay.m === x[0] ? 'on' : '') + '" data-act="pay-m" data-m="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  if (pay.m === 'cash') h += nfld('المبلغ المستلم', 'cash', pay.cash, 'data-in="pay-cash" placeholder="' + M.fmt(t) + '"') + '<div class="quick">' + q.map(function (x) { return '<button data-act="pay-quick" data-v="' + x + '">' + M.fmt(x) + '</button>'; }).join('') + '</div><div class="row sp b" id="pay-change"><span>الباقي للعميل</span>' + money(given > t ? given - t : 0, 'ok') + '</div>';
  if (pay.m === 'mixed') h += nfld('الجزء النقدي', 'cash', pay.cash, 'data-in="pay-cash"') + '<div class="row sp b" id="pay-change"><span>الباقي على الشبكة</span>' + money(Math.max(0, t - given)) + '</div>';
  if (pay.m === 'credit') h += cart.partyId ? '<div class="note">سيُسجَّل المبلغ على حساب العميل: <b>' + esc(M.byId(S.parties, cart.partyId).name) + '</b></div>' : '<div class="note">البيع الآجل يحتاج اختيار عميل من أعلى السلة أولاً.</div>';
  return h;
}
actions['pos-pay'] = function () { if (!cart.lines.length) return; pay = { m: 'cash', cash: '' }; modal('الدفع', '<div id="pay-b">' + payBody() + '</div>', '<button class="btn ghost" data-act="close">رجوع</button><button class="btn green big" data-act="pay-ok">تأكيد وإصدار الفاتورة</button>'); };
actions['pay-m'] = function (el) { pay.m = el.getAttribute('data-m'); pay.cash = ''; $('#pay-b').innerHTML = payBody(); };
actions['pay-quick'] = function (el) { pay.cash = (+el.getAttribute('data-v') / 100).toFixed(2); $('#pay-b').innerHTML = payBody(); };
inputs['pay-cash'] = function (el) { pay.cash = el.value; var t = cartCalc().total, g = M.toH(pay.cash); $('#pay-change').lastChild.textContent = M.fmt(pay.m === 'cash' ? (g > t ? g - t : 0) : Math.max(0, t - g)); };
function doSale(force) {
  var c = cartCalc(), t = c.total, g = M.toH(pay.cash), pays;
  if (pay.m === 'cash') { if (pay.cash && g < t) return toast('المبلغ المستلم أقل من المطلوب', true); pays = [{ m: 'cash', amt: t }]; }
  else if (pay.m === 'card') pays = [{ m: 'card', amt: t }];
  else if (pay.m === 'mixed') { if (!(g > 0 && g < t)) return toast('اكتب الجزء النقدي (أقل من الإجمالي)', true); pays = [{ m: 'cash', amt: g }, { m: 'card', amt: t - g }]; }
  else pays = [{ m: 'credit', amt: t }];
  var doc;
  try { doc = M.sale({ lines: cart.lines, discount: cart.discount, partyId: cart.partyId, pays: pays }, { allowOversell: force }); }
  catch (e) {
    if (e.code === 'STOCK' && !e.blocked) return confirmBox('الرصيد لا يكفي', esc(e.message) + '<br>هل تريد إتمام البيع مع تخطي الرصيد؟', 'بيع على أي حال', function () { doSale(true); });
    return toast(e.message || 'خطأ', true);
  }
  var change = pay.m === 'cash' && g > t ? g - t : 0;
  cart = { lines: [], discount: 0, partyId: '' }; posQ = ''; closeModal(); render();
  showDoc(doc, change); if (S.settings.autoPrint) printDoc(doc, defaultTpl(doc));
}
actions['pay-ok'] = function () { doSale(false); };
