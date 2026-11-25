/* ميزان لايت — الواجهة (2): الفواتير، الأصناف، الأطراف، المشتريات، المصروفات والسندات */
var flt = { docs: { t: 'sale', q: '' }, prod: '', party: 'c', money: '' };
function tabs(act, list, cur) { return '<div class="chips">' + list.map(function (x) { return '<button class="chip' + (x[0] === cur ? ' on' : '') + '" data-act="' + act + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; }

/* ---------- الفواتير ---------- */
pages.docs = {
  title: 'الفواتير',
  acts: function () { return '<button class="btn ghost sm" data-act="new-purchase">' + ic('plus') + 'فاتورة مشتريات</button>'; },
  render: function () {
    var f = flt.docs, q = norm(f.q), list = S.docs.filter(function (d) { return d.t === f.t && (!q || norm(d.no + ' ' + d.partyName).indexOf(q) >= 0); }).slice().reverse();
    return tabs('docs-t', [['sale', 'المبيعات'], ['sret', 'المرتجعات'], ['pur', 'المشتريات'], ['pret', 'مرتجعات المشتريات']], f.t) + '<div class="tools"><input data-in="docs-q" placeholder="بحث بالرقم أو الاسم" value="' + esc(f.q) + '"></div><div class="card" id="docs-list">' + docsList(list) + '</div>';
  }
};
function docsList(list) {
  if (!list.length) return '<div class="empty">لا توجد مستندات</div>';
  return '<div class="list">' + list.slice(0, 200).map(function (d) {
    var ret = d.t === 'sale' && d.lines.some(function (l) { return l.rq > 0; });
    return '<div data-act="open-doc" data-id="' + d.id + '"><div class="grow"><div class="t"><span class="num">' + d.no + '</span> ' + (d.partyName ? '· ' + esc(d.partyName) : '') + '</div><div class="sm mut"><span class="num">' + dfmt(d.date) + ' ' + tfmt(d.ts) + '</span> · ' + payText(d) + (d.status === 'cancelled' ? ' <span class="tag r">ملغى</span>' : '') + (ret ? ' <span class="tag y">به مرتجع</span>' : '') + (d.kind === 'standard' && d.t === 'sale' ? ' <span class="tag">ضريبية</span>' : '') + '</div></div>' + money(d.total, 'b') + '</div>';
  }).join('') + '</div>';
}
actions['docs-t'] = function (el) { flt.docs.t = el.getAttribute('data-v'); render(); };
inputs['docs-q'] = function (el) { flt.docs.q = el.value; var f = flt.docs, q = norm(f.q); $('#docs-list').innerHTML = docsList(S.docs.filter(function (d) { return d.t === f.t && (!q || norm(d.no + ' ' + d.partyName).indexOf(q) >= 0); }).slice().reverse()); };
actions['open-doc'] = function (el) { var d = M.byId(S.docs, el.getAttribute('data-id')); if (d) showDoc(d); };

/* ---------- الأصناف ---------- */
function prodList() {
  var q = norm(flt.prod), list = S.products.filter(function (p) { return !q || norm(p.name).indexOf(q) >= 0 || p.barcode.indexOf(q) >= 0; });
  if (!list.length) return '<div class="empty">لا توجد أصناف — اضغط «صنف جديد»</div>';
  return '<div class="list">' + list.map(function (p) {
    return '<div data-act="edit-product" data-id="' + p.id + '"><div class="tile" style="width:46px;min-height:46px;padding:0;margin-inline-end:10px;border:0"><div class="im" style="height:46px;margin:0;font-size:1.1rem' + (p.img ? ';background-image:url(' + p.img + ')' : '') + '">' + (p.img ? '' : esc(p.name.charAt(0))) + '</div></div><div class="grow"><div class="t">' + esc(p.name) + (p.active === false ? ' <span class="tag r">موقوف</span>' : '') + '</div><div class="sm mut">' + (p.service ? 'خدمة' : 'الرصيد <b class="num ' + (p.stock <= (p.min || 0) ? 'bad' : '') + '">' + qtyf(p.stock) + '</b> · التكلفة <span class="num">' + M.fmt(p.cost) + '</span>') + (p.barcode ? ' · <span class="num">' + esc(p.barcode) + '</span>' : '') + '</div></div>' + money(p.price, 'b') + '</div>';
  }).join('') + '</div>';
}
pages.products = {
  title: 'الأصناف',
  acts: function () { return '<button class="btn ghost sm" data-act="cats">التصنيفات</button><button class="btn sm" data-act="edit-product">' + ic('plus') + 'صنف جديد</button>'; },
  render: function () { return '<div class="tools"><input data-in="prod-q" placeholder="بحث بالاسم أو الباركود" value="' + esc(flt.prod) + '"></div><div class="grid g3" style="margin-bottom:12px"><div class="kpi"><small>عدد الأصناف</small><b class="num">' + S.products.length + '</b></div><div class="kpi"><small>قيمة المخزون بالتكلفة</small><b>' + money(M.stockValue()) + '</b></div><div class="kpi"><small>عند حد الطلب</small><b class="num">' + M.lowStock().length + '</b></div></div><div class="card" id="prod-list">' + prodList() + '</div>'; }
};
inputs['prod-q'] = function (el) { flt.prod = el.value; $('#prod-list').innerHTML = prodList(); };
var imgTmp = '';
actions['edit-product'] = function (el) {
  var p = M.byId(S.products, el.getAttribute('data-id')) || {}, isNew = !p.id; imgTmp = p.img || '';
  modal(isNew ? 'صنف جديد' : 'تعديل: ' + p.name, fld('اسم الصنف *', 'name', p.name, 'autofocus') + '<div class="grid g2">' + nfld('سعر البيع ' + (S.settings.pricesIncl ? '(شامل الضريبة)' : '(قبل الضريبة)') + ' *', 'price', p.price != null ? (p.price / 100).toFixed(2) : '') + sel('الضريبة', 'rate', [[S.settings.vatRate, S.settings.vatRate + '% خاضع'], [0, '0% صفري / معفى']], p.rate == null ? S.settings.vatRate : p.rate) + '</div>' +
    (isNew ? '<div class="grid g2">' + nfld('تكلفة الشراء للوحدة (قبل الضريبة)', 'cost', '') + nfld('الكمية الحالية (رصيد افتتاحي)', 'stock', '') + '</div>' : '') +
    '<div class="grid g2"><div class="row" style="align-items:flex-end;gap:6px"><div class="grow">' + fld('الباركود', 'barcode', p.barcode, 'class="n" inputmode="numeric"') + '</div><button class="btn ghost" data-act="scan" data-for="prod" aria-label="قراءة الباركود بالكاميرا" style="margin-bottom:12px" data-scan-prod>' + ic('cam') + '</button></div>' + sel('التصنيف', 'cat', [['', 'بدون']].concat(S.cats.map(function (c) { return [c.id, c.name]; })), p.cat) + '</div><div class="grid g2">' + fld('الوحدة', 'unit', p.unit || 'حبة') + nfld('حد إعادة الطلب', 'min', p.min || '') + '</div>' +
    (isNew ? chk('خدمة (بلا مخزون)', 'service', false) : chk('الصنف فعّال ويظهر في نقطة البيع', 'active', p.active !== false)) +
    '<div class="row"><div class="tile" style="width:64px;min-height:64px;padding:0;border:0"><div class="im" id="img-pv" style="height:64px;margin:0' + (imgTmp ? ';background-image:url(' + imgTmp + ')' : '') + '"></div></div><label class="btn ghost sm">صورة الصنف<input type="file" accept="image/*" data-in="prod-img" style="display:none"></label>' + (imgTmp ? '<button class="btn ghost sm" data-act="prod-img-del">حذف الصورة</button>' : '') + '</div>',
    (isNew || p.service ? '' : '<button class="btn ghost" data-act="adj-stock" data-id="' + p.id + '">جرد / تسوية الكمية</button>') + '<button class="btn" data-act="save-product" data-id="' + (p.id || '') + '">حفظ</button>');
};
function shrink(file, max, cb) {
  var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); cb(c.toDataURL('image/jpeg', 0.78)); }; im.onerror = function () { toast('تعذر قراءة الصورة', true); }; im.src = r.result; }; r.readAsDataURL(file);
}
inputs['prod-img'] = function (el) { if (el.files && el.files[0]) shrink(el.files[0], 260, function (u) { imgTmp = u; $('#img-pv').style.backgroundImage = 'url(' + u + ')'; }); };
actions['prod-img-del'] = function () { imgTmp = ''; $('#img-pv').style.backgroundImage = ''; };
actions['save-product'] = function (el) {
  var f = form(), id = el.getAttribute('data-id'), o = { name: f.name, price: M.toH(f.price), rate: +f.rate, barcode: f.barcode, cat: f.cat, unit: f.unit, min: M.num(f.min), img: imgTmp };
  if (!f.price) return toast('اكتب سعر البيع', true);
  if (id) { o.id = id; o.active = f.active; } else { o.cost = M.toH(f.cost); o.stock = M.num(f.stock); o.service = f.service; if (!o.service && o.stock > 0 && !(o.cost > 0)) return toast('اكتب تكلفة الوحدة للرصيد الافتتاحي', true); }
  if (guard(function () { return M.saveProduct(o); })) { closeModal(); render(); toast('تم الحفظ'); }
};
actions['adj-stock'] = function (el) { var p = M.byId(S.products, el.getAttribute('data-id')); modal('جرد: ' + p.name, '<div class="note">الرصيد في النظام: <b class="num">' + qtyf(p.stock) + '</b> — الفرق يُسجَّل بقيد على حساب «تسويات المخزون» بمتوسط التكلفة.</div>' + nfld('الكمية الفعلية بعد الجرد', 'q', '', 'autofocus') + fld('السبب', 'reason', '', 'placeholder="جرد، تالف، منتهي…"'), '<button class="btn" data-act="adj-ok" data-id="' + p.id + '">تسجيل</button>'); };
actions['adj-ok'] = function (el) { var f = form(); if (f.q === '') return toast('اكتب الكمية', true); guard(function () { M.adjustStock(el.getAttribute('data-id'), M.num(f.q), f.reason); closeModal(); render(); toast('تم تسجيل التسوية'); }); };
actions.cats = function () { modal('التصنيفات', '<div class="row" style="margin-bottom:10px"><input class="grow" name="cname" placeholder="اسم تصنيف جديد"><button class="btn" data-act="cat-add">إضافة</button></div><div class="list">' + S.cats.map(function (c) { return '<div><div class="grow t">' + esc(c.name) + '</div><span class="tag num">' + S.products.filter(function (p) { return p.cat === c.id; }).length + '</span></div>'; }).join('') + '</div>'); };
actions['cat-add'] = function () { var n = form().cname; if (guard(function () { return M.saveCat({ name: n }); })) actions.cats(); };

/* ---------- العملاء والموردون ---------- */
pages.parties = {
  title: 'العملاء والموردون',
  acts: function () { return '<button class="btn sm" data-act="new-party" data-role="' + flt.party + '">' + ic('plus') + (flt.party === 'c' ? 'عميل جديد' : 'مورد جديد') + '</button>'; },
  render: function () {
    var list = S.parties.filter(function (p) { return p.role === flt.party; }), tot = 0, rows = list.map(function (p) { var b = M.partyBalance(p.id); tot += b; return '<div data-act="party" data-id="' + p.id + '"><div class="grow"><div class="t">' + esc(p.name) + '</div><div class="sm mut num">' + esc(p.phone || '') + (p.vat ? ' · ' + esc(p.vat) : '') + '</div></div>' + money(b, 'b ' + (b > 0 ? (p.role === 'c' ? 'ok' : 'bad') : '')) + '</div>'; }).join('');
    return tabs('party-t', [['c', 'العملاء'], ['s', 'الموردون']], flt.party) + '<div class="kpi" style="margin-bottom:12px"><small>' + (flt.party === 'c' ? 'إجمالي المستحق لنا عند العملاء' : 'إجمالي المستحق علينا للموردين') + '</small><b>' + money(tot) + '</b></div><div class="card">' + (rows ? '<div class="list">' + rows + '</div>' : '<div class="empty">لا يوجد</div>') + '</div>';
  }
};
actions['party-t'] = function (el) { flt.party = el.getAttribute('data-v'); render(); };
actions['new-party'] = function (el) {
  var p = M.byId(S.parties, el.getAttribute('data-id')) || { role: el.getAttribute('data-role') };
  modal(p.id ? 'تعديل: ' + p.name : (p.role === 'c' ? 'عميل جديد' : 'مورد جديد'), fld('الاسم *', 'name', p.name, 'autofocus') + '<div class="grid g2">' + fld('الجوال', 'phone', p.phone, 'class="n" inputmode="tel"') + fld('الرقم الضريبي (للمنشآت)', 'vat', p.vat, 'class="n" inputmode="numeric" maxlength="15"') + '</div>' + fld('العنوان', 'address', p.address) + (p.role === 'c' ? '<div class="sm mut">العميل الذي له رقم ضريبي تصدر له «فاتورة ضريبية» كاملة ببياناته، وغيره «فاتورة ضريبية مبسطة».</div>' : ''), '<button class="btn" data-act="save-party" data-id="' + (p.id || '') + '" data-role="' + p.role + '" data-pos="' + (el.getAttribute('data-pos') || '') + '">حفظ</button>');
};
actions['save-party'] = function (el) {
  var f = form(); f.role = el.getAttribute('data-role'); if (el.getAttribute('data-id')) f.id = el.getAttribute('data-id');
  var p = guard(function () { return M.saveParty(f); }); if (!p) return;
  closeModal(); if (el.getAttribute('data-pos')) { cart.partyId = p.id; drawCart(); } else render(); toast('تم الحفظ');
};
actions.party = function (el) {
  var p = M.byId(S.parties, el.getAttribute('data-id')), L = M.ledger(p.role === 'c' ? '1103' : '2101', null, null, p.id);
  modal('كشف حساب: ' + p.name, '<div class="row sp" style="margin-bottom:8px"><div class="sm mut num">' + esc(p.phone || '') + (p.vat ? ' · ' + esc(p.vat) : '') + '</div><div class="b">الرصيد: ' + money(L.close) + '</div></div><div class="tw"><table class="tbl"><thead><tr><th>التاريخ</th><th>البيان</th><th class="e">مدين</th><th class="e">دائن</th><th class="e">الرصيد</th></tr></thead><tbody>' + (L.rows.map(function (r) { return '<tr><td class="num nw">' + dfmt(r.date) + '</td><td>' + esc(r.desc) + '</td><td class="e">' + (r.dr ? money(r.dr) : '') + '</td><td class="e">' + (r.cr ? money(r.cr) : '') + '</td><td class="e">' + money(r.bal) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="empty">لا حركات</td></tr>') + '</tbody></table></div>',
    '<button class="btn ghost" data-act="new-party" data-id="' + p.id + '">تعديل البيانات</button><button class="btn" data-act="new-voucher" data-k="' + (p.role === 'c' ? 'in' : 'out') + '" data-party="' + p.id + '">' + (p.role === 'c' ? 'سند قبض من العميل' : 'سند صرف للمورد') + '</button>', true);
};

/* ---------- فاتورة مشتريات ---------- */
var pur = null;
function purBody() {
  var c = M.computeLines(pur.lines.filter(function (l) { return l.pid && l.qty > 0; }), 0, false), po = [['', 'اختر الصنف']].concat(S.products.filter(function (p) { return !p.service; }).map(function (p) { return [p.id, p.name]; }));
  return '<div class="grid g2">' + sel('المورد', 'partyId', partyOpts('s', 'بدون (شراء نقدي)'), pur.partyId, 'data-in="pur-f"') + fld('رقم فاتورة المورد', 'supplierRef', pur.supplierRef, 'data-in="pur-f"') + '</div>' +
    '<div class="tw"><table class="tbl"><thead><tr><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة (قبل الضريبة)</th><th></th></tr></thead><tbody>' + pur.lines.map(function (l, i) { return '<tr><td style="min-width:150px"><select data-in="pur-l" data-i="' + i + '" data-k="pid">' + po.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === l.pid ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></td><td><input class="n" inputmode="decimal" style="width:80px" data-in="pur-l" data-i="' + i + '" data-k="qty" value="' + (l.qty || '') + '"></td><td><input class="n" inputmode="decimal" style="width:110px" data-in="pur-l" data-i="' + i + '" data-k="price" value="' + (l.priceTxt || '') + '"></td><td><button class="btn ghost sm" data-act="pur-del" data-i="' + i + '">✕</button></td></tr>'; }).join('') + '</tbody></table></div>' +
    '<button class="btn ghost sm" data-act="pur-add" style="margin:8px 0">＋ سطر</button><div class="grid g2">' + sel('الدفع', 'method', [['cash', 'نقداً من الصندوق'], ['bank', 'من البنك'], ['credit', 'آجل على حساب المورد']], pur.method, 'data-in="pur-f"') + '<div class="kpi" id="pur-tot"><small>قبل الضريبة <span class="num">' + M.fmt(c.net) + '</span> + ضريبة <span class="num">' + M.fmt(c.vat) + '</span></small><b>' + money(c.total) + '</b></div></div>';
}
actions['new-purchase'] = function () {
  if (!S.products.some(function (p) { return !p.service; })) return toast('أضف الأصناف أولاً من شاشة الأصناف', true);
  pur = { partyId: '', supplierRef: '', method: 'cash', lines: [{ pid: '', qty: 0, price: 0, priceTxt: '', rate: S.settings.vatRate }] };
  modal('فاتورة مشتريات', '<div id="pur-b">' + purBody() + '</div>', '<button class="btn" data-act="pur-ok">ترحيل الفاتورة</button>', true);
};
inputs['pur-f'] = function (el) { pur[el.name] = el.value; };
inputs['pur-l'] = function (el) {
  var l = pur.lines[+el.getAttribute('data-i')], k = el.getAttribute('data-k');
  if (k === 'pid') { l.pid = el.value; var p = M.byId(S.products, l.pid); if (p && !l.priceTxt && p.cost) { l.price = p.cost; l.priceTxt = (p.cost / 100).toFixed(2); $('#pur-b').innerHTML = purBody(); return; } }
  else if (k === 'qty') l.qty = M.num(el.value); else { l.priceTxt = el.value; l.price = M.toH(el.value); }
  var c = M.computeLines(pur.lines.filter(function (x) { return x.pid && x.qty > 0; }), 0, false);
  $('#pur-tot').innerHTML = '<small>قبل الضريبة <span class="num">' + M.fmt(c.net) + '</span> + ضريبة <span class="num">' + M.fmt(c.vat) + '</span></small><b>' + money(c.total) + '</b>';
};
actions['pur-add'] = function () { pur.lines.push({ pid: '', qty: 0, price: 0, priceTxt: '', rate: S.settings.vatRate }); $('#pur-b').innerHTML = purBody(); };
actions['pur-del'] = function (el) { pur.lines.splice(+el.getAttribute('data-i'), 1); if (!pur.lines.length) actions['pur-add'](); else $('#pur-b').innerHTML = purBody(); };
actions['pur-ok'] = function () {
  var lines = pur.lines.filter(function (l) { return l.pid && l.qty > 0; }).map(function (l) { return { pid: l.pid, qty: l.qty, price: l.price, rate: l.rate }; });
  var d = guard(function () { var c = M.computeLines(lines, 0, false); return M.purchase({ partyId: pur.partyId, supplierRef: pur.supplierRef, lines: lines, pays: [{ m: pur.method, amt: c.total }] }); });
  if (d) { closeModal(); flt.docs.t = 'pur'; render(); toast('رُحّلت فاتورة المشتريات ' + d.no + ' ودخلت الكميات المخزون'); }
};

/* ---------- المصروفات والسندات ---------- */
var VT = { exp: 'مصروف', rcv: 'سند قبض', pay: 'سند صرف', trf: 'تحويل' };
pages.money = {
  title: 'المصروفات والسندات',
  render: function () {
    var list = S.vouchers.filter(function (v) { return !flt.money || v.t === flt.money; }).slice().reverse();
    return '<div class="grid g4" style="margin-bottom:12px"><button class="btn" data-act="new-expense">＋ مصروف</button><button class="btn ghost" data-act="new-voucher" data-k="in">＋ سند قبض</button><button class="btn ghost" data-act="new-voucher" data-k="out">＋ سند صرف</button><button class="btn ghost" data-act="new-transfer">تحويل صندوق ⇄ بنك</button></div>' +
      tabs('money-t', [['', 'الكل'], ['exp', 'المصروفات'], ['rcv', 'القبض'], ['pay', 'الصرف'], ['trf', 'التحويلات']], flt.money) + '<div class="card">' + (list.length ? '<div class="list">' + list.slice(0, 200).map(function (v) { return '<div data-act="open-voucher" data-id="' + v.id + '"><div class="grow"><div class="t"><span class="tag ' + (v.t === 'rcv' ? 'g' : v.t === 'trf' ? '' : 'y') + '">' + VT[v.t] + '</span> ' + esc(v.partyName || v.desc || '') + '</div><div class="sm mut"><span class="num">' + v.no + ' · ' + dfmt(v.date) + '</span> · ' + M.METHOD_NAMES[v.method] + (v.status === 'cancelled' ? ' <span class="tag r">ملغى</span>' : '') + '</div></div>' + money(v.amount, 'b') + '</div>'; }).join('') + '</div>' : '<div class="empty">لا توجد حركات</div>') + '</div>';
  }
};
actions['money-t'] = function (el) { flt.money = el.getAttribute('data-v'); render(); };
actions['new-expense'] = function () {
  modal('تسجيل مصروف', sel('نوع المصروف', 'acc', S.accounts.filter(function (a) { return a.type === 'X' && a.code !== '5101' && a.code !== '5208'; }).map(function (a) { return [a.code, a.name]; }), '5204') + nfld('المبلغ المدفوع (الإجمالي) *', 'amount', '', 'autofocus') + chk('الفاتورة فيها ضريبة قيمة مضافة ' + S.settings.vatRate + '% (تُفصل كضريبة مدخلات)', 'hasVat', false) + '<div class="grid g2">' + sel('الدفع من', 'method', [['cash', 'الصندوق'], ['bank', 'البنك']], 'cash') + fld('التاريخ', 'date', M.today(), 'type="date"') + '</div>' + fld('البيان', 'desc', '') + fld('الجهة المستفيدة', 'payee', ''), '<button class="btn" data-act="exp-ok">تسجيل</button>');
};
actions['exp-ok'] = function () { var f = form(); f.amount = M.toH(f.amount); if (guard(function () { return M.expense(f); })) { closeModal(); render(); toast('سُجّل المصروف'); } };
actions['new-voucher'] = function (el) {
  var k = el.getAttribute('data-k'), pid = el.getAttribute('data-party') || '', isIn = k === 'in';
  var accs = S.accounts.filter(function (a) { return a.code !== '1101' && a.code !== '1102' && a.code !== '1103' && a.code !== '2101' && a.code !== '1104'; }).map(function (a) { return [a.code, a.code + ' — ' + a.name]; });
  modal(isIn ? 'سند قبض' : 'سند صرف', sel(isIn ? 'استلمنا من (عميل)' : 'صرفنا إلى (مورد)', 'partyId', partyOpts(isIn ? 'c' : 's', '— ليس ' + (isIn ? 'عميلاً' : 'مورداً') + ' (اختر الحساب) —'), pid) + sel('أو الحساب المقابل', 'acc', accs, isIn ? '3101' : '3102') + '<div class="sm mut" style="margin:-6px 0 10px">أمثلة: رأس المال عند إيداع المالك، جاري المالك عند سحبه، قروض، إيرادات أخرى.</div>' + nfld('المبلغ *', 'amount', '', 'autofocus') + '<div class="grid g2">' + sel(isIn ? 'القبض في' : 'الصرف من', 'method', [['cash', 'الصندوق'], ['bank', 'البنك']], 'cash') + fld('التاريخ', 'date', M.today(), 'type="date"') + '</div>' + fld('البيان', 'desc', ''), '<button class="btn" data-act="vch-ok" data-k="' + k + '">تسجيل</button>');
};
actions['vch-ok'] = function (el) { var f = form(); f.kind = el.getAttribute('data-k'); f.amount = M.toH(f.amount); var v = guard(function () { return M.voucher(f); }); if (v) { closeModal(); render(); toast('سُجّل ' + v.no); } };
actions['new-transfer'] = function () { modal('تحويل بين الصندوق والبنك', sel('الاتجاه', 'dir', [['cash>bank', 'إيداع من الصندوق في البنك'], ['bank>cash', 'سحب من البنك إلى الصندوق']], 'cash>bank') + nfld('المبلغ *', 'amount', '', 'autofocus') + fld('التاريخ', 'date', M.today(), 'type="date"'), '<button class="btn" data-act="trf-ok">تسجيل</button>'); };
actions['trf-ok'] = function () { var f = form(), d = f.dir.split('>'); if (guard(function () { return M.transfer({ from: d[0], to: d[1], amount: M.toH(f.amount), date: f.date }); })) { closeModal(); render(); toast('تم التحويل'); } };
var viewV = null;
actions['open-voucher'] = function (el) {
  viewV = M.byId(S.vouchers, el.getAttribute('data-id')); var z = Math.min(1, (Math.min(window.innerWidth, 860) - 70) / 559);
  modal(VT[viewV.t] + ' ' + viewV.no, (viewV.status === 'cancelled' ? '<div class="note bad b">ملغى — ' + esc(viewV.cancelReason) + '</div>' : '') + '<div class="preview-wrap"><div style="zoom:' + z.toFixed(3) + '">' + voucherPaper(viewV) + '</div></div>', (viewV.status === 'posted' && viewV.t !== 'trf' ? '<button class="btn ghost" data-act="vch-cancel">إلغاء</button>' : '') + '<button class="btn gold" data-act="vch-print">' + ic('print') + 'طباعة</button>', true);
};
actions['vch-print'] = function () { printHtml(voucherPaper(viewV), 'voucher', viewV.no); };
actions['vch-cancel'] = function () { modal('إلغاء ' + viewV.no, fld('سبب الإلغاء *', 'reason', '', 'autofocus') + '<div class="sm mut">يُعكس القيد ولا يُحذف المستند.</div>', '<button class="btn red" data-act="vch-cancel-ok">تأكيد الإلغاء</button>'); };
actions['vch-cancel-ok'] = function () { var r = form().reason; if (guard(function () { return M.cancel(viewV.t, viewV.id, r); })) { closeModal(); render(); toast('تم الإلغاء بقيد عكسي'); } };
