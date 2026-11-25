/* ميزان لايت — الواجهة (4): القفل والمستخدمون، الورديات، مرتجع المشتريات، قارئ الباركود بالكاميرا، الإقلاع */

/* ---------- القفل بالرمز السري ---------- */
var pinBuf = '';
function pinDots() { var h = ''; for (var i = 0; i < 6; i++) h += '<i class="' + (i < pinBuf.length ? 'on' : '') + (i >= 4 ? ' opt' : '') + '"></i>'; return h; }
pages.lock = {
  render: function () {
    return '<div class="lock"><div class="lk-brand"><i>م</i><b>' + esc(S.settings.name || 'ميزان لايت') + '</b></div><div class="mut">أدخل رمزك السري</div><div class="pin-dots" id="pin-dots">' + pinDots() + '</div>' +
      '<div class="pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(function (k) { return '<button data-act="pin-key" data-k="' + k + '" class="' + (k === 'OK' ? 'ok' : k === 'C' ? 'clr' : '') + '">' + (k === 'C' ? 'مسح' : k === 'OK' ? 'دخول' : k) + '</button>'; }).join('') + '</div>' +
      '<div class="sm mut c">نسيت الرمز؟ يغيّره المالك من الإعدادات ← المستخدمون والورديات.</div></div>';
  }
};
function tryPin(final) {
  try { M.login(pinBuf); pinBuf = ''; route = { name: M.can('home') && M.user.role === 'owner' ? 'home' : 'pos', arg: null }; render(); toast('مرحباً ' + M.user.name); return true; }
  catch (e) { if (final) { pinBuf = ''; var d = $('#pin-dots'); if (d) { d.innerHTML = pinDots(); d.classList.add('shake'); setTimeout(function () { d.classList.remove('shake'); }, 400); } toast(e.message, true); } return false; }
}
actions['pin-key'] = function (el) {
  var k = el.getAttribute('data-k');
  if (k === 'C') pinBuf = ''; else if (k === 'OK') { tryPin(true); return; } else if (pinBuf.length < 6) pinBuf += k;
  $('#pin-dots').innerHTML = pinDots();
  if (pinBuf.length >= 4 && tryPin(pinBuf.length === 6)) return;
};
document.addEventListener('keydown', function (ev) {
  if (!S || !S.setup || !S.users.length || M.user) return;
  if (/^[0-9]$/.test(ev.key)) { var b = $('[data-act=pin-key][data-k="' + ev.key + '"]'); if (b) actions['pin-key'](b); }
  else if (ev.key === 'Backspace') { pinBuf = pinBuf.slice(0, -1); $('#pin-dots').innerHTML = pinDots(); }
  else if (ev.key === 'Enter') tryPin(true);
});
actions.lock = function () { closeModal(); stopScan(); M.logout(); pinBuf = ''; render(); };

// إجراءات للمالك فقط حين يكون للجهاز مستخدمون
['edit-product', 'save-product', 'adj-stock', 'cats', 'cat-add', 'new-purchase', 'pur-ok', 'new-expense', 'exp-ok', 'new-voucher', 'vch-ok', 'new-transfer', 'trf-ok', 'vch-cancel', 'vch-cancel-ok', 'doc-cancel', 'doc-cancel-ok', 'doc-pret', 'pret-ok', 'new-journal', 'jv-ok', 'rev-journal', 'new-account', 'acc-ok', 'wipe', 'demo-load', 'backup', 'set-save', 'user-save', 'user-del', 'users-clear'].forEach(function (k) {
  var f = actions[k]; if (!f) return;
  actions[k] = function (el, ev) { if (!M.can('manage')) return toast('هذا الإجراء للمالك فقط', true); return f(el, ev); };
});
(function () { var r = inputs.restore; inputs.restore = function (el, ev) { if (!M.can('manage')) { el.value = ''; return toast('هذا الإجراء للمالك فقط', true); } return r(el, ev); }; })();

// الرئيسية للكاشير: الوردية ومبيعاته، بلا أرصدة المنشأة
(function () {
  var orig = pages.home.render;
  pages.home.render = function () {
    var sh = M.openShift(), top = shiftBanner();
    if (M.can('reports')) return top + orig();
    var x = sh ? M.shiftSummary() : null, mine = x ? (x.byUser[M.user.name] || 0) : 0;
    return top + '<div class="grid g2" style="margin-bottom:12px"><div class="kpi"><small>مبيعاتي في الوردية</small><b>' + money(mine) + '</b></div><div class="kpi"><small>فواتير الوردية</small><b class="num">' + (x ? x.count : 0) + '</b></div></div>' +
      '<div class="grid g2"><button class="btn big" data-act="go" data-to="pos">' + ic('pos') + 'بيع جديد</button><button class="btn ghost big" data-act="go" data-to="shifts">' + ic('shift') + 'الوردية</button></div>';
  };
})();
function shiftBanner() {
  var sh = M.openShift();
  if (sh) return '<div class="note row sp" data-shift-banner><span>الوردية <b class="num">' + sh.no + '</b> مفتوحة منذ <span class="num">' + tfmt(sh.openedAt) + '</span>' + (sh.by ? ' — ' + esc(sh.by) : '') + '</span><button class="btn ghost sm" data-act="go" data-to="shifts">التفاصيل</button></div>';
  return S.settings.requireShift ? '<div class="note row sp" data-shift-banner><span>لا توجد وردية مفتوحة — البيع يتطلب فتح وردية.</span><button class="btn sm" data-act="shift-open">فتح وردية</button></div>' : '';
}

/* ---------- المستخدمون (الإعدادات) ---------- */
function usersTab() {
  var U = S.users;
  var h = '<div class="card"><h3>المستخدمون والقفل بالرمز السري</h3>' + (U.length ? '<div class="list" data-users>' + U.map(function (u) { return '<div style="cursor:default"><div class="grow"><div class="t">' + esc(u.name) + (M.user && M.user.id === u.id ? ' <span class="tag g">أنت</span>' : '') + '</div><div class="sm mut">' + M.ROLES[u.role] + '</div></div><button class="btn ghost sm" data-act="user-edit" data-id="' + u.id + '">تعديل</button><button class="btn ghost sm" data-act="user-del" data-id="' + u.id + '">حذف</button></div>'; }).join('') + '</div><div style="height:10px"></div><button class="btn sm" data-act="user-edit">＋ مستخدم</button> <button class="btn ghost sm" data-act="users-clear">إلغاء القفل وحذف كل المستخدمين</button>'
    : '<div class="note">الجهاز الآن بمستخدم واحد بلا قفل. أضف <b>المالك</b> برمز سري ثم الكاشيرية: يُطلب الرمز عند فتح التطبيق، وتُسجّل كل فاتورة باسم من أصدرها، ويرى الكاشير البيع والمرتجع والوردية فقط.</div><button class="btn" data-act="user-edit" data-first="1">إضافة المالك</button>') + '</div>';
  h += '<div class="card" id="set-shift"><h3>الورديات</h3>' + chk('البيع يتطلب وردية مفتوحة (عدّ النقدية عند الفتح والإغلاق)', 'requireShift', S.settings.requireShift) + chk('صوت عند قراءة الباركود بالكاميرا', 'scanBeep', S.settings.scanBeep) + '<button class="btn sm" data-act="shift-set-save">حفظ</button></div>';
  h += '<div class="card"><h3>الصلاحيات</h3><div class="sm"><b>المالك / المدير</b>: كل الشاشات والإعدادات.<br><b>الكاشير</b>: نقطة البيع، الفواتير والمرتجع، الورديات، وإضافة عميل. لا يرى المحاسبة والتقارير والإعدادات، ولا يعدّل الأصناف أو المشتريات أو السندات.</div><div class="sm mut" style="margin-top:6px">الرمز السري قفل للجهاز يمنع غير المصرَّح لهم؛ البيانات نفسها على الجهاز ونسختها الاحتياطية غير مشفّرة.</div></div>';
  return h;
}
actions['shift-set-save'] = function () { var f = form($('#set-shift')); S.settings.requireShift = !!f.requireShift; S.settings.scanBeep = !!f.scanBeep; M.save(); render(); toast('تم الحفظ'); };
actions['user-edit'] = function (el) {
  var u = M.byId(S.users, el.getAttribute('data-id')) || {}, first = !S.users.length;
  modal(u.id ? 'تعديل: ' + u.name : (first ? 'المالك' : 'مستخدم جديد'), fld('الاسم *', 'name', u.name, 'autofocus') + (first ? '' : sel('الدور', 'role', [['cashier', 'كاشير'], ['owner', 'المالك / المدير']], u.role || 'cashier')) +
    '<div class="grid g2">' + fld(u.id ? 'رمز جديد (اتركه فارغاً للإبقاء)' : 'الرمز السري (4–6 أرقام) *', 'pin', '', 'class="n" inputmode="numeric" type="password" maxlength="6" autocomplete="off"') + fld('تأكيد الرمز', 'pin2', '', 'class="n" inputmode="numeric" type="password" maxlength="6" autocomplete="off"') + '</div>' + (first ? '<div class="sm mut">بعد الحفظ يُطلب الرمز عند فتح التطبيق. احفظه جيداً: لا يمكن استرجاعه.</div>' : ''),
    '<button class="btn" data-act="user-save" data-id="' + (u.id || '') + '">حفظ</button>');
};
actions['user-save'] = function (el) {
  var f = form(), id = el.getAttribute('data-id');
  if (f.pin !== f.pin2) return toast('الرمزان غير متطابقين', true);
  var u = guard(function () { return M.saveUser({ id: id || null, name: f.name, role: f.role || 'owner', pin: f.pin }); });
  if (u) { closeModal(); render(); toast('حُفظ المستخدم ' + u.name); }
};
actions['user-del'] = function (el) { var u = M.byId(S.users, el.getAttribute('data-id')); confirmBox('حذف المستخدم', 'حذف «' + esc(u.name) + '»؟ تبقى فواتيره باسمه.', 'حذف', function () { M.removeUser(u.id); render(); toast('حُذف'); }, true); };
actions['users-clear'] = function () { confirmBox('إلغاء القفل', 'يُحذف كل المستخدمين ويعود الجهاز بلا رمز سري.', 'إلغاء القفل', function () { M.clearUsers(); render(); toast('أُلغي القفل'); }, true); };

/* ---------- الورديات ---------- */
ICON.shift = 'M12 22a10 10 0 100-20 10 10 0 000 20M12 6v6l4 2';
ICON.cam = 'M3 8h3l2-3h8l2 3h3v12H3zM12 17a4 4 0 100-8 4 4 0 000 8';
ICON.lock = 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4';
NAV.splice(2, 0, ['shifts', 'الورديات', 'shift']);
function shiftRows(x) {
  return [['مبيعات نقدية', x.cashSales], ['مبيعات شبكة / تحويل', x.cardSales], ['مبيعات آجلة', x.creditSales], ['مرتجعات نقدية', -x.cashReturns], ['مقبوضات نقدية', x.receipts], ['مصروفات نقدية', -x.expenses], ['مدفوعات نقدية', -x.payments - x.purchasesCash], ['تحويلات (داخل − خارج)', x.transfersIn - x.transfersOut]].filter(function (r) { return r[1]; });
}
pages.shifts = {
  title: 'الورديات',
  acts: function () { return M.openShift() ? '<button class="btn ghost sm" data-act="shift-x">' + ic('print') + 'تقرير مؤقت</button>' : '<button class="btn sm" data-act="shift-open">فتح وردية</button>'; },
  render: function () {
    var sh = M.openShift(), h = '';
    if (sh) {
      var x = M.shiftSummary();
      h += '<div class="card" data-shift-open><div class="row sp"><h3>الوردية <span class="num">' + sh.no + '</span> مفتوحة</h3><span class="tag g">مفتوحة</span></div><div class="sm mut" style="margin-bottom:8px">منذ <span class="num">' + dfmt(sh.date) + ' ' + tfmt(sh.openedAt) + '</span>' + (sh.by ? ' — ' + esc(sh.by) : '') + '</div>' +
        '<div class="grid g3" style="margin-bottom:10px"><div class="kpi"><small>المبيعات</small><b>' + money(x.sales) + '</b><small class="num">' + x.count + ' فاتورة</small></div><div class="kpi"><small>مبلغ الافتتاح</small><b>' + money(sh.float) + '</b></div><div class="kpi" data-shift-expected><small>المتوقع في الدرج الآن</small><b>' + money(x.expected) + '</b></div></div>' +
        '<table class="tbl"><tbody>' + shiftRows(x).map(function (r) { return rrow(r[0], r[1]); }).join('') + '</tbody></table><div style="height:10px"></div><button class="btn red blk" data-act="shift-close">إغلاق الوردية وعدّ النقدية</button></div>';
    } else h += '<div class="card c"><div class="empty">لا توجد وردية مفتوحة</div><button class="btn big" data-act="shift-open">فتح وردية</button><div class="sm mut" style="margin-top:8px">عدّ النقدية في الدرج عند الفتح، ويقارنها البرنامج بما يجب أن يكون عند الإغلاق.</div></div>';
    var past = S.shifts.filter(function (s) { return s.status === 'closed'; }).slice().reverse().slice(0, 40);
    h += '<div class="card"><h3>الورديات السابقة</h3>' + (past.length ? '<div class="list" data-shifts>' + past.map(function (s) { return '<div data-act="shift-view" data-id="' + s.id + '"><div class="grow"><div class="t"><span class="num">' + s.no + '</span>' + (s.by ? ' · ' + esc(s.by) : '') + '</div><div class="sm mut"><span class="num">' + dfmt(s.date) + ' ' + tfmt(s.openedAt) + ' ← ' + tfmt(s.closedAt) + '</span> · المبيعات <span class="num">' + M.fmt(s.totals.sales) + '</span></div></div>' + (s.diff ? '<span class="tag ' + (s.diff < 0 ? 'r' : 'y') + '">' + (s.diff < 0 ? 'عجز ' : 'زيادة ') + '<span class="num">' + M.fmt(Math.abs(s.diff)) + '</span></span>' : '<span class="tag g">مطابق</span>') + '</div>'; }).join('') + '</div>' : '<div class="empty">لا يوجد</div>') + '</div>';
    return h;
  }
};
actions['shift-open'] = function () { modal('فتح وردية', nfld('النقدية في الدرج عند الفتح (ريال)', 'float', '', 'autofocus') + '<div class="sm mut">عدّ النقدية الموجودة في درج الكاشير الآن.</div>', '<button class="btn" data-act="shift-open-ok">فتح الوردية</button>'); };
actions['shift-open-ok'] = function () { var f = form(), sh = guard(function () { return M.shiftOpen({ float: M.toH(f.float) }); }); if (sh) { closeModal(); render(); toast('فُتحت الوردية ' + sh.no); } };
actions['shift-close'] = function () {
  var x = M.shiftSummary();
  modal('إغلاق الوردية ' + x.shift.no, '<div class="kpi" style="margin-bottom:10px"><small>المتوقع في الدرج</small><b>' + money(x.expected) + '</b><small>الافتتاح ' + M.fmt(x.shift.float) + ' + الداخل ' + M.fmt(x.cashIn) + ' − الخارج ' + M.fmt(x.cashOut) + '</small></div>' + nfld('النقدية المعدودة في الدرج *', 'counted', '', 'autofocus data-in="shift-count"') + '<div id="shift-diff" class="b"></div>' + fld('ملاحظة', 'note', ''),
    '<button class="btn ghost" data-act="close">رجوع</button><button class="btn red" data-act="shift-close-ok">إغلاق الوردية</button>');
};
inputs['shift-count'] = function (el) { var x = M.shiftSummary(), d = M.toH(el.value) - x.expected, b = $('#shift-diff'); if (el.value === '') { b.textContent = ''; return; } b.className = 'b ' + (d ? 'bad' : 'ok'); b.textContent = d === 0 ? 'مطابق ✓' : (d < 0 ? 'عجز ' : 'زيادة ') + M.fmt(Math.abs(d)); };
actions['shift-close-ok'] = function () {
  var f = form(); if (f.counted === '') return toast('اكتب النقدية المعدودة', true);
  var sh = guard(function () { return M.shiftClose({ counted: M.toH(f.counted), note: f.note }); }); if (!sh) return;
  closeModal(); render(); showShift(sh.id); toast(sh.diff ? (sh.diff < 0 ? 'أُغلقت بعجز ' : 'أُغلقت بزيادة ') + M.fmt(Math.abs(sh.diff)) + ' — سُجّل قيده' : 'أُغلقت الوردية — النقدية مطابقة');
};
function shiftPaper(x) {
  var s = S.settings, sh = x.shift, closed = sh.status === 'closed';
  function kv(k, v, cls) { return '<div class="kv' + (cls ? ' ' + cls : '') + '"><span>' + k + '</span><span class="n">' + v + '</span></div>'; }
  return '<div class="paper th t80"><div class="hd"><b>' + esc(s.name) + '</b>' + (s.vat ? '<div>الرقم الضريبي: <span class="n">' + esc(s.vat) + '</span></div>' : '') + '</div><div class="ttl">' + (closed ? 'تقرير إغلاق الوردية (Z)' : 'تقرير مؤقت للوردية (X)') + '</div>' +
    kv('الوردية', sh.no) + kv('الفتح', dfmt(sh.date) + ' ' + tfmt(sh.openedAt)) + (closed ? kv('الإغلاق', tfmt(sh.closedAt)) : '') + (sh.by ? '<div class="kv"><span>الكاشير</span><span>' + esc(sh.by) + '</span></div>' : '') +
    '<div class="sum">' + kv('عدد الفواتير', x.count) + kv('إجمالي المبيعات', M.fmt(x.sales)) + kv('منها الضريبة', M.fmt(x.vat)) + (x.discount ? kv('الخصومات', M.fmt(x.discount)) : '') + kv('المرتجعات (' + x.retCount + ')', M.fmt(x.returns)) + '</div>' +
    '<div class="sum">' + kv('نقدي', M.fmt(x.cashSales)) + kv('شبكة / تحويل', M.fmt(x.cardSales)) + kv('آجل', M.fmt(x.creditSales)) + '</div>' +
    '<div class="sum">' + kv('مبلغ الافتتاح', M.fmt(sh.float)) + shiftRows(x).filter(function (r) { return !/^مبيعات (شبكة|آجلة)/.test(r[0]); }).map(function (r) { return kv(r[0], M.fmt(r[1])); }).join('') + kv('المتوقع في الدرج', M.fmt(x.expected), 'g') + (closed ? kv('المعدود', M.fmt(sh.counted)) + kv(sh.diff < 0 ? 'العجز' : sh.diff > 0 ? 'الزيادة' : 'الفرق', M.fmt(Math.abs(sh.diff || 0)), sh.diff ? 'g' : '') : '') + '</div>' +
    (Object.keys(x.byUser).length > 1 ? '<div class="sum">' + Object.keys(x.byUser).map(function (u) { return kv(esc(u), M.fmt(x.byUser[u])); }).join('') + '</div>' : '') + (sh.note ? '<div class="ft">' + esc(sh.note) + '</div>' : '') + '<div class="ft">توقيع الكاشير ............ توقيع المسؤول ............</div></div>';
}
var viewShift = null;
function showShift(id) {
  var x = M.shiftSummary(id); viewShift = x;
  modal('الوردية ' + x.shift.no, '<div class="preview-wrap"><div>' + shiftPaper(x) + '</div></div>', '<button class="btn gold" data-act="shift-print">' + ic('print') + 'طباعة</button>');
}
actions['shift-view'] = function (el) { showShift(el.getAttribute('data-id')); };
actions['shift-x'] = function () { showShift(M.openShift().id); };
actions['shift-print'] = function () { printHtml(shiftPaper(viewShift), 't80', viewShift.shift.no); };

/* ---------- مرتجع المشتريات ---------- */
actions['doc-pret'] = function () {
  var d = viewDoc.d;
  modal('مرتجع مشتريات من ' + d.no, '<table class="tbl"><thead><tr><th>الصنف</th><th>المتاح للإرجاع</th><th>الكمية</th></tr></thead><tbody>' + d.lines.map(function (l, i) { var p = M.byId(S.products, l.pid), rem = Math.min(Math.round((l.qty - (l.rq || 0)) * 1000) / 1000, p ? Math.max(p.stock, 0) : 0); return '<tr><td>' + esc(l.name) + '</td><td class="num">' + qtyf(rem) + '</td><td>' + (rem > 0 ? '<input class="n" inputmode="decimal" name="q' + i + '" style="width:90px" placeholder="0">' : '—') + '</td></tr>'; }).join('') + '</tbody></table><div style="height:10px"></div>' +
    sel('استرداد المبلغ', 'method', [['cash', 'نقداً إلى الصندوق'], ['bank', 'إلى البنك']].concat(d.partyId ? [['credit', 'خصم من حساب المورد']] : []), d.pays[0].m === 'credit' ? 'credit' : 'cash') + '<div class="sm mut">تخرج الكميات من المخزون بتكلفة الشراء، وتُعكس ضريبة المدخلات.</div>', '<button class="btn" data-act="pret-ok">إصدار إشعار مدين</button>');
};
actions['pret-ok'] = function () {
  var f = form(), items = []; viewDoc.d.lines.forEach(function (l, i) { var q = M.num(f['q' + i] || 0); if (q > 0) items.push({ i: i, qty: q }); });
  var r = guard(function () { return M.purchaseReturn(viewDoc.d.id, items, f.method); }); if (!r) return;
  closeModal(); flt.docs.t = 'pret'; render(); showDoc(r); toast('صدر إشعار المدين ' + r.no);
};

/* ---------- قارئ الباركود بالكاميرا ---------- */
var scan = { stream: null, timer: null, target: null, last: '', hold: 0, cv: null, det: undefined };
function scanDetector() {
  if (scan.det !== undefined) return scan.det;
  scan.det = null;
  try { if (window.BarcodeDetector) scan.det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] }); } catch (e) { scan.det = null; }
  return scan.det;
}
function beep() {
  if (!S.settings.scanBeep) return;
  try { var A = window.AudioContext || window.webkitAudioContext; if (!A) return; var c = beep.c || (beep.c = new A()), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1600; g.gain.value = 0.08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.08); } catch (e) { }
  try { if (navigator.vibrate) navigator.vibrate(50); } catch (e) { }
}
actions.scan = function (el) { scan.target = el.getAttribute('data-for'); openScanner(); };
function openScanner() {
  stopScan();
  var o = document.createElement('div'); o.id = 'scanner'; o.innerHTML = '<div class="scan-box"><div class="scan-h"><b>قراءة الباركود بالكاميرا</b><button data-act="scan-stop" aria-label="إغلاق">✕</button></div><div class="scan-v"><video id="scan-v" playsinline muted autoplay></video><i class="scan-line"></i></div><div class="scan-msg" id="scan-msg">وجّه الكاميرا إلى الباركود…</div>' + (scan.target === 'pos' ? '<div class="scan-got" id="scan-got"></div>' : '') + '<button class="btn ghost blk" data-act="scan-stop">' + (scan.target === 'pos' ? 'تم' : 'إغلاق') + '</button></div>';
  document.body.appendChild(o);
  var md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { $('#scan-msg').textContent = 'الكاميرا غير متاحة على هذا الجهاز — استخدم قارئ باركود خارجياً أو اكتب الرقم'; return; }
  md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (st) {
    if (!$('#scanner')) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
    scan.stream = st; var v = $('#scan-v'); v.srcObject = st; var pl = v.play(); if (pl && pl.catch) pl.catch(function () { }); scan.last = ''; scanLoop();
  }).catch(function () { var m = $('#scan-msg'); if (m) m.textContent = 'لم يُسمح باستخدام الكاميرا — اسمح لميزان لايت بالكاميرا من إعدادات الجهاز ثم أعد المحاولة'; });
}
function stopScan() {
  clearTimeout(scan.timer); scan.timer = null;
  if (scan.stream) { scan.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } }); scan.stream = null; }
  var o = $('#scanner'); if (o) o.parentNode.removeChild(o);
}
actions['scan-stop'] = stopScan;
function scanNext(ms) { scan.timer = setTimeout(scanLoop, ms || 120); }
function scanLoop() {
  var v = $('#scan-v'); if (!v || !scan.stream) return;
  if (Date.now() < scan.hold || v.readyState < 2 || !v.videoWidth) return scanNext();
  var det = scanDetector();
  if (det) { det.detect(v).then(function (r) { if (r && r.length) scanHit(r[0].rawValue, true); else scanNext(); }).catch(function () { scan.det = null; scanNext(); }); return; }
  var w = Math.min(800, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth), c = scan.cv || (scan.cv = document.createElement('canvas'));
  c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(v, 0, 0, w, h);
  var d = x.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  var code = M.scanBarcode(g, w, h);
  if (code) scanHit(code, false); else { scan.last = ''; scanNext(); }
}
// يُقبل الرقم المقروء بالمحلّل المدمج بعد قراءتين متطابقتين (لا قراءة خاطئة من إطار واحد مشوّش)
function scanHit(code, sure) {
  if (!sure && scan.last !== code) { scan.last = code; return scanNext(40); }
  scan.last = ''; beep();
  if (scan.target === 'pos') {
    var p = M.productByBarcode(code), g = $('#scan-got');
    if (p) { addToCart(p); if (g) g.innerHTML = '<span class="ok b">✓ ' + esc(p.name) + '</span> <span class="num mut">' + esc(code) + '</span> — السلة <b class="num">' + qtyf(cartCount()) + '</b>'; }
    else if (g) g.innerHTML = '<span class="bad b">لا يوجد صنف بالباركود</span> <span class="num">' + esc(code) + '</span>';
    scan.hold = Date.now() + 1300; return scanNext();
  }
  var el = $('#modal [name=barcode]'); if (el) { el.value = code; el.dispatchEvent(new Event('input', { bubbles: true })); }
  stopScan(); toast('قُرئ الباركود ' + code);
}
(function () {
  var back = window.mizanBack;
  window.mizanBack = function () { if ($('#scanner')) { stopScan(); return true; } return back(); };
  window.addEventListener('pagehide', stopScan);
})();

/* ---------- الإقلاع ---------- */
M.load(function (st) { S = st; shell(); render(); });
