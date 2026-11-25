/* ميزان لايت — قوالب الطباعة والفاتورة الضريبية */
var TEMPLATES = [['t80', 'حراري 80 مم', 'th'], ['t58', 'حراري 58 مم', 'th'], ['a4classic', 'A4 كلاسيكي', 'a'], ['a4modern', 'A4 عصري', 'a'], ['a5', 'A5 مختصر', 'a'], ['a5modern', 'A5 عصري', 'a']];
var DOC_TITLES = {
  sale: { simplified: ['فاتورة ضريبية مبسطة', 'Simplified Tax Invoice'], standard: ['فاتورة ضريبية', 'Tax Invoice'] },
  sret: ['إشعار دائن (مرتجع مبيعات)', 'Credit Note'], pur: ['فاتورة مشتريات', 'Purchase Invoice'], pret: ['إشعار مدين (مرتجع مشتريات)', 'Debit Note']
};
function qrSvg(text) { try { var q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch (e) { return ''; } }
function docTitle(d) { var t = DOC_TITLES[d.t]; if (d.t === 'sale') t = S.settings.vat ? t[d.kind] : ['فاتورة مبيعات', 'Sales Invoice']; return t; }
function bi(ar, en) { return S.settings.bilingual ? ar + '<small> ' + en + '</small>' : ar; }
function payText(d) { return d.pays.filter(function (p) { return p.amt > 0; }).map(function (p) { return M.METHOD_NAMES[p.m] + (d.pays.length > 1 ? ' ' + M.fmt(p.amt) : ''); }).join(' + '); }
function defaultTpl(d) { return d.t === 'sale' && d.kind === 'standard' ? S.settings.tplInvoice : (d.t === 'pur' || d.t === 'pret' ? S.settings.tplInvoice : S.settings.tplReceipt); }

function thermalPaper(d, tpl) {
  var s = S.settings, t = docTitle(d), showQr = (d.t === 'sale' || d.t === 'sret') && s.vat;
  return '<div class="paper th ' + tpl + '"><div class="hd">' + (s.showLogo && s.logo ? '<img src="' + s.logo + '" alt="">' : '') + '<b>' + esc(s.name) + '</b>' + (s.address || s.city ? '<div>' + esc([s.address, s.city].filter(Boolean).join('، ')) + '</div>' : '') + (s.phone ? '<div>هاتف: <span class="n">' + esc(s.phone) + '</span></div>' : '') + (s.vat ? '<div>الرقم الضريبي: <span class="n">' + esc(s.vat) + '</span></div>' : '') + (s.cr ? '<div>س.ت: <span class="n">' + esc(s.cr) + '</span></div>' : '') + '</div>' +
    '<div class="ttl">' + t[0] + (s.bilingual ? '<div style="font-weight:500;font-size:.8em">' + t[1] + '</div>' : '') + '</div>' +
    '<div class="kv"><span>الرقم</span><span class="n">' + d.no + '</span></div><div class="kv"><span>التاريخ</span><span class="n">' + dfmt(d.date) + ' ' + tfmt(d.ts) + '</span></div>' + (d.ref ? '<div class="kv"><span>الفاتورة الأصلية</span><span class="n">' + d.ref + '</span></div>' : '') +
    (d.partyName ? '<div class="kv"><span>' + (d.t === 'pur' || d.t === 'pret' ? 'المورد' : 'العميل') + '</span><span>' + esc(d.partyName) + '</span></div>' : '') + (d.partyVat ? '<div class="kv"><span>ضريبي العميل</span><span class="n">' + esc(d.partyVat) + '</span></div>' : '') +
    '<table><thead><tr><th>الصنف</th><th class="e">الكمية</th><th class="e">السعر</th><th class="e">الإجمالي</th></tr></thead><tbody>' + d.lines.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="e"><span class="n">' + qtyf(l.qty) + '</span></td><td class="e"><span class="n">' + M.fmt(l.price) + '</span></td><td class="e"><span class="n">' + M.fmt(l.total) + '</span></td></tr>'; }).join('') + '</tbody></table>' +
    '<div class="sum"><div class="kv"><span>الإجمالي قبل الضريبة</span><span class="n">' + M.fmt(d.net) + '</span></div>' + (d.discount ? '<div class="kv"><span>الخصم (مشمول أعلاه)</span><span class="n">' + M.fmt(d.discount) + '</span></div>' : '') + '<div class="kv"><span>ضريبة القيمة المضافة ' + s.vatRate + '%</span><span class="n">' + M.fmt(d.vat) + '</span></div><div class="kv g"><span>الإجمالي شامل الضريبة</span><span class="n">' + M.fmt(d.total) + '</span></div><div class="kv"><span>طريقة الدفع</span><span>' + payText(d) + '</span></div></div>' +
    (showQr ? '<div class="qr">' + qrSvg(M.zatcaQr(d)) + '</div>' : '') + (s.footer ? '<div class="ft">' + esc(s.footer) + '</div>' : '') + '</div>';
}
function a4Paper(d, tpl) {
  var s = S.settings, t = docTitle(d), showQr = (d.t === 'sale' || d.t === 'sret') && s.vat, size = tpl.indexOf('a5') === 0 ? 'a5' : 'a4', modern = tpl.indexOf('modern') > 0;
  function kv(k, v, n) { return v ? '<div><span>' + k + '</span><span' + (n ? ' class="n"' : '') + '>' + esc(v) + '</span></div>' : ''; }
  return '<div class="paper a ' + size + (modern ? ' modern' : '') + '"><div class="top"><div class="co"><b>' + esc(s.name) + '</b>' + (s.nameEn ? '<div>' + esc(s.nameEn) + '</div>' : '') + '<div>' + esc([s.address, s.city].filter(Boolean).join('، ')) + '</div>' + (s.phone ? '<div>هاتف: <span class="n">' + esc(s.phone) + '</span></div>' : '') + (s.vat ? '<div>الرقم الضريبي: <span class="n">' + esc(s.vat) + '</span></div>' : '') + (s.cr ? '<div>السجل التجاري: <span class="n">' + esc(s.cr) + '</span></div>' : '') + '</div>' + (s.showLogo && s.logo ? '<img src="' + s.logo + '" alt="">' : '<h2>' + esc((s.name || 'م').charAt(0)) + '</h2>') + '</div>' +
    '<div class="ttl">' + t[0] + (s.bilingual ? '<small>' + t[1] + '</small>' : '') + '</div>' +
    '<div class="meta"><div class="box"><h4>بيانات المستند</h4>' + kv('الرقم', d.no, 1) + kv('التاريخ', dfmt(d.date) + ' ' + tfmt(d.ts), 1) + (s.showHijri ? kv('الموافق', hijri(d.date)) : '') + kv('الفاتورة الأصلية', d.ref, 1) + kv('مرجع المورد', d.supplierRef, 1) + kv('طريقة الدفع', payText(d)) + '</div><div class="box"><h4>' + (d.t === 'pur' || d.t === 'pret' ? 'بيانات المورد' : 'بيانات العميل') + '</h4>' + kv('الاسم', d.partyName || (d.t === 'pur' || d.t === 'pret' ? '—' : 'عميل نقدي')) + kv('الرقم الضريبي', d.partyVat, 1) + kv('العنوان', d.partyAddress) + '</div></div>' +
    '<table class="it"><thead><tr><th>#</th><th>' + bi('الصنف', 'Item') + '</th><th class="c">' + bi('الكمية', 'Qty') + '</th><th class="e">' + bi('السعر', 'Price') + '</th><th class="e">' + bi('قبل الضريبة', 'Taxable') + '</th><th class="e">' + bi('الضريبة', 'VAT') + '</th><th class="e">' + bi('الإجمالي', 'Total') + '</th></tr></thead><tbody>' +
    d.lines.map(function (l, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td class="c"><span class="n">' + qtyf(l.qty) + '</span></td><td class="e"><span class="n">' + M.fmt(l.price) + '</span></td><td class="e"><span class="n">' + M.fmt(l.net) + '</span></td><td class="e"><span class="n">' + M.fmt(l.vat) + '</span> <small>(' + l.rate + '%)</small></td><td class="e"><span class="n">' + M.fmt(l.total) + '</span></td></tr>'; }).join('') + '</tbody></table>' +
    '<div class="bot"><div class="qr">' + (showQr ? qrSvg(M.zatcaQr(d)) : '') + '</div><div class="tot"><div><span>الإجمالي قبل الضريبة</span><span class="n">' + M.fmt(d.net) + '</span></div>' + (d.discount ? '<div><span>الخصم (مشمول)</span><span class="n">' + M.fmt(d.discount) + '</span></div>' : '') + '<div><span>ضريبة القيمة المضافة ' + s.vatRate + '%</span><span class="n">' + M.fmt(d.vat) + '</span></div><div class="g"><span>الإجمالي المستحق</span><span class="n">' + M.fmt(d.total) + ' ر.س</span></div></div></div>' +
    '<div class="wrd">' + M.tafqeet(d.total) + '</div>' + (d.note ? '<div style="margin-top:6px">ملاحظات: ' + esc(d.note) + '</div>' : '') + (size === 'a4' ? '<div class="sig"><div>المستلم</div><div>البائع / الختم</div></div>' : '') + (s.footer ? '<div class="ft">' + esc(s.footer) + '</div>' : '') + '</div>';
}
function docPaper(d, tpl) { return tpl === 't80' || tpl === 't58' ? thermalPaper(d, tpl) : a4Paper(d, tpl); }
function voucherPaper(v) {
  var s = S.settings, T = { exp: 'سند صرف — مصروف', rcv: 'سند قبض', pay: 'سند صرف', trf: 'تحويل بين الصندوق والبنك' }[v.t], a = M.account(v.acc);
  function kv(k, val, n) { return val ? '<div><span>' + k + '</span><span' + (n ? ' class="n"' : '') + '>' + esc(val) + '</span></div>' : ''; }
  return '<div class="paper a a5"><div class="top"><div class="co"><b>' + esc(s.name) + '</b><div>' + esc([s.address, s.city].filter(Boolean).join('، ')) + '</div>' + (s.vat ? '<div>الرقم الضريبي: <span class="n">' + esc(s.vat) + '</span></div>' : '') + '</div>' + (s.showLogo && s.logo ? '<img src="' + s.logo + '" alt="">' : '') + '</div><div class="ttl">' + T + '</div>' +
    '<div class="box" style="width:100%">' + kv('الرقم', v.no, 1) + kv('التاريخ', dfmt(v.date), 1) + kv(v.t === 'rcv' ? 'استلمنا من' : 'صُرف إلى', v.partyName || v.payee) + kv('الحساب', a ? a.code + ' — ' + a.name : '') + kv('البيان', v.desc) + kv('طريقة الدفع', M.METHOD_NAMES[v.method]) + (v.vat ? kv('منها ضريبة القيمة المضافة', M.fmt(v.vat), 1) : '') + '</div>' +
    '<div class="tot" style="width:100%;margin-top:10px"><div class="g"><span>المبلغ</span><span class="n">' + M.fmt(v.amount) + ' ر.س</span></div></div><div class="wrd">' + M.tafqeet(v.amount) + '</div><div class="sig"><div>المستلم</div><div>المحاسب</div></div></div>';
}

/* ---------- الطباعة ---------- */
function pageCss(tpl, html) {
  if (tpl === 't80' || tpl === 't58') {
    var tmp = document.createElement('div'); tmp.style.cssText = 'position:absolute;top:0;left:-9999px;visibility:hidden'; tmp.innerHTML = html; document.body.appendChild(tmp);
    var mm = Math.ceil(tmp.firstChild.offsetHeight * 25.4 / 96) + 6; document.body.removeChild(tmp);
    return '@page{size:' + (tpl === 't80' ? '80' : '58') + 'mm ' + Math.max(mm, 60) + 'mm;margin:0}';
  }
  return '@page{size:' + (tpl.indexOf('a5') === 0 || tpl === 'voucher' ? 'A5' : 'A4') + ';margin:0}';
}
function setPageStyle(css) { var st = $('#pgsz'); if (!st) { st = document.createElement('style'); st.id = 'pgsz'; document.head.appendChild(st); } st.textContent = css; }
function firePrint(title) {
  if (window.MIZAN_PREVIEW) return toast('الطباعة تعمل في تطبيق أندرويد — غير متاحة داخل هذه المعاينة');
  if (NATIVE && NATIVE.print) { try { NATIVE.print(title); return; } catch (e) { } }
  setTimeout(function () { try { window.print(); } catch (e) { toast('الطباعة غير متاحة على هذا المتصفح', true); } }, 60);
}
function printHtml(html, tpl, title) {
  setPageStyle(pageCss(tpl, html)); $('#print-root').innerHTML = html;
  document.body.classList.remove('print-view'); document.body.classList.add('print-doc'); firePrint(title);
}
function printDoc(d, tpl) { printHtml(docPaper(d, tpl), tpl, d.no); }
function printView(title) { setPageStyle('@page{size:A4;margin:12mm}'); document.body.classList.remove('print-doc'); document.body.classList.add('print-view'); firePrint(title); }
actions['print-view'] = function () { printView(pages[route.name].title); };

/* ---------- عرض المستند ---------- */
var viewDoc = { d: null, tpl: '' };
function docPreview() { var th = viewDoc.tpl === 't80' || viewDoc.tpl === 't58', w = Math.min(window.innerWidth, 860) - 70, pw = th ? (viewDoc.tpl === 't80' ? 302 : 219) : (viewDoc.tpl.indexOf('a5') === 0 ? 559 : 794), z = Math.min(1, w / pw); return '<div class="preview-wrap"><div style="zoom:' + z.toFixed(3) + '">' + docPaper(viewDoc.d, viewDoc.tpl) + '</div></div>'; }
function showDoc(d, change) {
  viewDoc = { d: d, tpl: defaultTpl(d) };
  var canRet = d.t === 'sale' && M.can('sale.return') && d.lines.some(function (l) { return (l.rq || 0) < l.qty; }), canPret = d.t === 'pur' && d.status === 'posted' && M.can('manage') && d.lines.some(function (l) { return (l.rq || 0) < l.qty; });
  modal(docTitle(d)[0] + ' ' + d.no, (change ? '<div class="note c b">الباقي للعميل: ' + money(change) + ' ر.س</div>' : '') + (d.status === 'cancelled' ? '<div class="note bad b">مستند ملغى — ' + esc(d.cancelReason) + '</div>' : '') +
    '<div class="chips">' + TEMPLATES.map(function (t) { return '<button class="chip' + (t[0] === viewDoc.tpl ? ' on' : '') + '" data-act="doc-tpl" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="doc-pv">' + docPreview() + '</div>',
    (canRet ? '<button class="btn ghost" data-act="doc-return">مرتجع</button>' : '') + (canPret ? '<button class="btn ghost" data-act="doc-pret">مرتجع مشتريات</button>' : '') + (d.t === 'pur' && d.status === 'posted' && M.can('manage') && !d.lines.some(function (l) { return l.rq > 0; }) ? '<button class="btn ghost" data-act="doc-cancel">إلغاء الفاتورة</button>' : '') + '<button class="btn ghost" data-act="doc-share">مشاركة</button><button class="btn gold" data-act="doc-print">' + ic('print') + 'طباعة</button>' + (change != null ? '<button class="btn" data-act="close">بيع جديد</button>' : ''), true);
}
actions['doc-tpl'] = function (el) { viewDoc.tpl = el.getAttribute('data-t'); $$('#modal .chip').forEach(function (c) { c.classList.toggle('on', c === el); }); $('#doc-pv').innerHTML = docPreview(); };
actions['doc-print'] = function () { printDoc(viewDoc.d, viewDoc.tpl); };
actions['doc-share'] = function () {
  var d = viewDoc.d, s = S.settings, txt = docTitle(d)[0] + ' رقم ' + d.no + '\n' + s.name + (s.vat ? '\nالرقم الضريبي: ' + s.vat : '') + '\nالتاريخ: ' + dfmt(d.date) + '\n' + d.lines.map(function (l) { return '• ' + l.name + ' × ' + qtyf(l.qty) + ' = ' + M.fmt(l.total); }).join('\n') + '\nقبل الضريبة: ' + M.fmt(d.net) + '\nالضريبة: ' + M.fmt(d.vat) + '\nالإجمالي: ' + M.fmt(d.total) + ' ر.س';
  if (NATIVE && NATIVE.shareText) return NATIVE.shareText(txt);
  if (navigator.share) return navigator.share({ text: txt }).catch(function () { });
  try { navigator.clipboard.writeText(txt).then(function () { toast('نُسخ نص الفاتورة'); }); } catch (e) { toast('المشاركة غير متاحة على هذا المتصفح', true); }
};
actions['doc-return'] = function () {
  var d = viewDoc.d;
  modal('مرتجع من الفاتورة ' + d.no, '<table class="tbl"><thead><tr><th>الصنف</th><th>المتاح</th><th>كمية المرتجع</th></tr></thead><tbody>' + d.lines.map(function (l, i) { var rem = Math.round((l.qty - (l.rq || 0)) * 1000) / 1000; return '<tr><td>' + esc(l.name) + '</td><td class="num">' + qtyf(rem) + '</td><td>' + (rem > 0 ? '<input class="n" inputmode="decimal" name="q' + i + '" style="width:90px" placeholder="0">' : '—') + '</td></tr>'; }).join('') + '</tbody></table><div style="height:10px"></div>' +
    sel('ردّ المبلغ', 'method', [['cash', 'نقداً من الصندوق'], ['card', 'على الشبكة / البنك']].concat(d.partyId ? [['credit', 'خصم من حساب العميل']] : []), d.pays[0].m === 'credit' ? 'credit' : 'cash') + '<button class="btn ghost sm" data-act="ret-all">إرجاع كل الكميات</button>', '<button class="btn" data-act="ret-ok">إصدار إشعار دائن</button>');
};
actions['ret-all'] = function () { viewDoc.d.lines.forEach(function (l, i) { var el = $('#modal [name=q' + i + ']'); if (el) el.value = qtyf(l.qty - (l.rq || 0)); }); };
actions['ret-ok'] = function () {
  var f = form(), items = []; viewDoc.d.lines.forEach(function (l, i) { var q = M.num(f['q' + i] || 0); if (q > 0) items.push({ i: i, qty: q }); });
  var r = guard(function () { return M.saleReturn(viewDoc.d.id, items, f.method); }); if (!r) return;
  closeModal(); render(); showDoc(r); toast('صدر الإشعار الدائن ' + r.no);
};
actions['doc-cancel'] = function () { modal('إلغاء ' + viewDoc.d.no, fld('سبب الإلغاء *', 'reason', '', 'autofocus') + '<div class="sm mut">يُعكس القيد وتُخصم الكميات من المخزون. لا يُحذف المستند.</div>', '<button class="btn red" data-act="doc-cancel-ok">تأكيد الإلغاء</button>'); };
actions['doc-cancel-ok'] = function () { var r = form().reason; if (guard(function () { return M.cancel('pur', viewDoc.d.id, r); })) { closeModal(); render(); toast('تم الإلغاء بقيد عكسي'); } };
