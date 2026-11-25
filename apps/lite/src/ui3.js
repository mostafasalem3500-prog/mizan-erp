/* ميزان لايت — الواجهة (3): المحاسبة، التقارير، الإعدادات، الدليل، الإقلاع */
var accTab = 'coa', rep = { tab: 'daily', from: '', to: '', day: '' }, setTab = 'co';
function monthStart() { return M.today().slice(0, 8) + '01'; }

/* ---------- المحاسبة ---------- */
pages.accounting = {
  title: 'المحاسبة',
  acts: function () { return '<button class="btn sm" data-act="new-journal">' + ic('plus') + 'قيد يومية</button>'; },
  render: function () {
    var h = tabs('acc-t', [['coa', 'دليل الحسابات'], ['jv', 'دفتر اليومية']], accTab);
    if (accTab === 'coa') {
      var b = M.balances(), cur = '';
      h += '<div class="card"><div class="tw"><table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th class="e">الرصيد</th></tr></thead><tbody>' + S.accounts.slice().sort(function (a, c) { return a.code < c.code ? -1 : 1; }).map(function (a) {
        var x = b[a.code] || { dr: 0, cr: 0 }, v = (x.dr - x.cr) * (a.type === 'A' || a.type === 'X' ? 1 : -1), sec = '';
        if (a.type !== cur) { cur = a.type; sec = '<tr class="sec"><td colspan="3">' + M.TYPE_NAMES[a.type] + '</td></tr>'; }
        return sec + '<tr data-act="ledger" data-code="' + a.code + '"><td class="num">' + a.code + '</td><td>' + esc(a.name) + '</td><td class="e">' + money(v) + '</td></tr>';
      }).join('') + '</tbody></table></div><button class="btn ghost sm" data-act="new-account" style="margin-top:10px">＋ حساب جديد</button></div><div class="sm mut">اضغط على أي حساب لعرض كشفه (الأستاذ).</div>';
    } else {
      var list = S.journals.slice().reverse().slice(0, 150);
      h += list.length ? list.map(function (j) { return '<div class="card"><div class="row sp"><b><span class="num">' + j.no + '</span> · <span class="num">' + dfmt(j.date) + '</span></b>' + (j.reversedBy ? '<span class="tag r">معكوس</span>' : (j.src && j.src.t === 'manual' ? '<button class="btn ghost sm" data-act="rev-journal" data-id="' + j.id + '">عكس القيد</button>' : '')) + '</div><div class="sm mut" style="margin-bottom:6px">' + esc(j.desc) + '</div><table class="tbl"><tbody>' + j.lines.map(function (l) { var a = M.account(l.a); return '<tr><td>' + (l.cr ? '&emsp;&emsp;إلى ح/ ' : 'من ح/ ') + esc(a ? a.name : l.a) + '</td><td class="e">' + (l.dr ? money(l.dr) : '') + '</td><td class="e">' + (l.cr ? money(l.cr) : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'; }).join('') : '<div class="empty">لا توجد قيود</div>';
    }
    return h;
  }
};
actions['acc-t'] = function (el) { accTab = el.getAttribute('data-v'); render(); };
actions.ledger = function (el) {
  var a = M.account(el.getAttribute('data-code')), L = M.ledger(a.code);
  modal('كشف حساب: ' + a.code + ' — ' + a.name, '<div class="b" style="margin-bottom:8px">الرصيد: ' + money(L.close) + '</div><div class="tw"><table class="tbl"><thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th class="e">مدين</th><th class="e">دائن</th><th class="e">الرصيد</th></tr></thead><tbody>' + (L.rows.map(function (r) { return '<tr><td class="num nw">' + dfmt(r.date) + '</td><td class="num">' + r.no + '</td><td>' + esc(r.desc) + '</td><td class="e">' + (r.dr ? money(r.dr) : '') + '</td><td class="e">' + (r.cr ? money(r.cr) : '') + '</td><td class="e">' + money(r.bal) + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="empty">لا حركات</td></tr>') + '</tbody></table></div>', '', true);
};
actions['new-account'] = function () { modal('حساب جديد', sel('النوع', 'type', [['X', 'مصروفات (يبدأ بـ 5)'], ['R', 'إيرادات (4)'], ['A', 'أصول (1)'], ['L', 'خصوم (2)'], ['E', 'حقوق ملكية (3)']], 'X') + fld('رمز الحساب *', 'code', '', 'class="n" inputmode="numeric" placeholder="مثال: 5210"') + fld('اسم الحساب *', 'name', ''), '<button class="btn" data-act="acc-ok">حفظ</button>'); };
actions['acc-ok'] = function () { var f = form(); guard(function () { M.addAccount(f); closeModal(); render(); toast('أُضيف الحساب'); }); };
var jv = null;
function jvBody() {
  var ao = [['', 'اختر الحساب']].concat(S.accounts.map(function (a) { return [a.code, a.code + ' — ' + a.name]; })), d = 0, c = 0; jv.lines.forEach(function (l) { d += l.dr; c += l.cr; });
  return '<div class="grid g2">' + fld('التاريخ', 'date', jv.date, 'type="date" data-in="jv-f"') + fld('البيان *', 'desc', jv.desc, 'data-in="jv-f"') + '</div><div class="tw"><table class="tbl"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' + jv.lines.map(function (l, i) { return '<tr><td style="min-width:170px"><select data-in="jv-l" data-i="' + i + '" data-k="a">' + ao.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === l.a ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></td><td><input class="n" inputmode="decimal" style="width:100px" data-in="jv-l" data-i="' + i + '" data-k="dr" value="' + (l.drT || '') + '"></td><td><input class="n" inputmode="decimal" style="width:100px" data-in="jv-l" data-i="' + i + '" data-k="cr" value="' + (l.crT || '') + '"></td></tr>'; }).join('') + '</tbody></table></div><div class="row sp" style="margin-top:8px"><button class="btn ghost sm" data-act="jv-add">＋ سطر</button><b id="jv-bal" class="' + (d === c && d ? 'ok' : 'bad') + '">مدين ' + M.fmt(d) + ' — دائن ' + M.fmt(c) + (d === c && d ? ' ✓ متوازن' : ' ✕ غير متوازن') + '</b></div>';
}
actions['new-journal'] = function () { jv = { date: M.today(), desc: '', lines: [{ a: '', dr: 0, cr: 0 }, { a: '', dr: 0, cr: 0 }] }; modal('قيد يومية يدوي', '<div id="jv-b">' + jvBody() + '</div>', '<button class="btn" data-act="jv-ok">ترحيل القيد</button>', true); };
inputs['jv-f'] = function (el) { jv[el.name] = el.value; };
inputs['jv-l'] = function (el) {
  var l = jv.lines[+el.getAttribute('data-i')], k = el.getAttribute('data-k'); if (k === 'a') l.a = el.value; else { l[k + 'T'] = el.value; l[k] = Math.max(0, M.toH(el.value)); }
  var d = 0, c = 0; jv.lines.forEach(function (x) { d += x.dr; c += x.cr; }); var b = $('#jv-bal'); b.className = d === c && d ? 'ok' : 'bad'; b.textContent = 'مدين ' + M.fmt(d) + ' — دائن ' + M.fmt(c) + (d === c && d ? ' ✓ متوازن' : ' ✕ غير متوازن');
};
actions['jv-add'] = function () { jv.lines.push({ a: '', dr: 0, cr: 0 }); $('#jv-b').innerHTML = jvBody(); };
actions['jv-ok'] = function () { var lines = jv.lines.filter(function (l) { return l.a && (l.dr || l.cr); }); if (guard(function () { return M.manualJournal({ date: jv.date, desc: jv.desc, lines: lines }); })) { closeModal(); accTab = 'jv'; render(); toast('رُحّل القيد'); } };
actions['rev-journal'] = function (el) { var id = el.getAttribute('data-id'); confirmBox('عكس القيد', 'سيُنشأ قيد عكسي بتاريخ اليوم. القيد الأصلي لا يُحذف.', 'عكس', function () { M.reverseJournal(id); M.save(); render(); toast('تم عكس القيد'); }); };

/* ---------- التقارير ---------- */
function rrow(n, v, cls) { return '<tr class="' + (cls || '') + '"><td>' + n + '</td><td class="e">' + money(v) + '</td></tr>'; }
var REPORTS = {
  daily: function () {
    var d = M.daily(rep.day), net = d.sales - d.returns, exVat = Math.round(net * 100 / (100 + S.settings.vatRate));
    return '<div class="grid g4" style="margin-bottom:12px"><div class="kpi"><small>المبيعات</small><b>' + money(d.sales) + '</b></div><div class="kpi"><small>المرتجعات</small><b>' + money(d.returns) + '</b></div><div class="kpi"><small>عدد الفواتير</small><b class="num">' + d.count + '</b></div><div class="kpi"><small>مجمل الربح</small><b>' + money(exVat - d.cogs) + '</b></div></div>' +
      '<div class="grid g2 stack"><div class="card"><h3>المبيعات حسب طريقة الدفع</h3><table class="tbl"><tbody>' + rrow('نقدي', d.methods.cash) + rrow('شبكة', d.methods.card) + rrow('آجل', d.methods.credit) + rrow('المشتريات', d.purchases) + rrow('المصروفات', d.expenses) + '</tbody></table></div>' +
      '<div class="card"><h3>حركة النقدية</h3><table class="tbl"><thead><tr><th></th><th class="e">أول اليوم</th><th class="e">دخل</th><th class="e">خرج</th><th class="e">آخر اليوم</th></tr></thead><tbody>' + [['الصندوق', d.cash], ['البنك / الشبكة', d.bank]].map(function (x) { return '<tr><td>' + x[0] + '</td><td class="e">' + money(x[1].open) + '</td><td class="e">' + money(x[1].in) + '</td><td class="e">' + money(x[1].out) + '</td><td class="e b">' + money(x[1].close) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><h3>الأكثر مبيعاً</h3>' + (d.top.length ? '<table class="tbl"><tbody>' + d.top.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="e num">' + qtyf(t.qty) + '</td><td class="e">' + money(t.total) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">لا مبيعات في هذا اليوم</div>') + '</div>';
  },
  sales: function () {
    var r = M.salesByProduct(rep.from, rep.to), T = { qty: 0, net: 0, vat: 0, total: 0, profit: 0 }; r.forEach(function (x) { for (var k in T) T[k] += x[k]; });
    return '<div class="card"><div class="tw"><table class="tbl"><thead><tr><th>الصنف</th><th class="e">الكمية</th><th class="e">قبل الضريبة</th><th class="e">الضريبة</th><th class="e">الإجمالي</th><th class="e">الربح</th></tr></thead><tbody>' + (r.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="e num">' + qtyf(x.qty) + '</td><td class="e">' + money(x.net) + '</td><td class="e">' + money(x.vat) + '</td><td class="e">' + money(x.total) + '</td><td class="e">' + money(x.profit) + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="empty">لا مبيعات</td></tr>') + '<tr class="tot"><td>الإجمالي</td><td class="e num">' + qtyf(T.qty) + '</td><td class="e">' + money(T.net) + '</td><td class="e">' + money(T.vat) + '</td><td class="e">' + money(T.total) + '</td><td class="e">' + money(T.profit) + '</td></tr></tbody></table></div></div>';
  },
  income: function () {
    var r = M.incomeStatement(rep.from, rep.to);
    return '<div class="card"><table class="tbl"><tbody>' + rrow('صافي المبيعات (بعد المرتجعات)', r.netSales) + rrow('تكلفة المبيعات', -r.cogs) + rrow('مجمل الربح', r.gross, 'tot') + (r.otherRevenue ? rrow('إيرادات أخرى', r.otherRevenue) : '') + '<tr class="sec"><td colspan="2">المصروفات التشغيلية</td></tr>' + r.expenses.map(function (x) { return rrow('<span class="num mut">' + x.code + '</span> ' + esc(x.name), -x.amount); }).join('') + rrow('إجمالي المصروفات', -r.opex) + rrow(r.net >= 0 ? 'صافي الربح' : 'صافي الخسارة', r.net, 'tot') + '</tbody></table></div>';
  },
  balance: function () {
    var r = M.balanceSheet(rep.to);
    function sec(t, list, tot) { return '<tr class="sec"><td colspan="2">' + t + '</td></tr>' + list.map(function (x) { return rrow((x.code ? '<span class="num mut">' + x.code + '</span> ' : '') + esc(x.name), x.amount); }).join('') + rrow('إجمالي ' + t, tot, 'tot'); }
    return '<div class="note">' + (r.balanced ? '✓ الميزانية متوازنة: الأصول = الخصوم + حقوق الملكية' : '✕ الميزانية غير متوازنة — راجع فحص سلامة الدفاتر') + '</div><div class="grid g2 stack"><div class="card"><table class="tbl"><tbody>' + sec('الأصول', r.assets, r.totalAssets) + '</tbody></table></div><div class="card"><table class="tbl"><tbody>' + sec('الخصوم', r.liabilities, r.totalLiabilities) + sec('حقوق الملكية', r.equity, r.totalEquity) + rrow('الخصوم + حقوق الملكية', r.totalLiabilities + r.totalEquity, 'tot') + '</tbody></table></div></div>';
  },
  trial: function () {
    var r = M.trialBalance(rep.to);
    return '<div class="card"><div class="tw"><table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th class="e">مدين</th><th class="e">دائن</th></tr></thead><tbody>' + r.rows.map(function (x) { return '<tr data-act="ledger" data-code="' + x.code + '"><td class="num">' + x.code + '</td><td>' + esc(x.name) + '</td><td class="e">' + (x.dr ? money(x.dr) : '') + '</td><td class="e">' + (x.cr ? money(x.cr) : '') + '</td></tr>'; }).join('') + '<tr class="tot"><td colspan="2">الإجمالي ' + (r.balanced ? '<span class="tag g">متوازن</span>' : '<span class="tag r">غير متوازن</span>') + '</td><td class="e">' + money(r.dr) + '</td><td class="e">' + money(r.cr) + '</td></tr></tbody></table></div></div>';
  },
  vat: function () {
    var r = M.vatReport(rep.from, rep.to);
    return '<div class="card"><div class="tw"><table class="tbl"><thead><tr><th>البند</th><th class="e">المبلغ</th><th class="e">الضريبة</th></tr></thead><tbody><tr class="sec"><td colspan="3">ضريبة المخرجات (المبيعات)</td></tr><tr><td>مبيعات خاضعة للنسبة الأساسية</td><td class="e">' + money(r.salesStd) + '</td><td class="e">' + money(r.salesStdVat) + '</td></tr><tr><td>مبيعات صفرية / معفاة</td><td class="e">' + money(r.salesZero) + '</td><td class="e">' + money(0) + '</td></tr><tr><td>مرتجعات المبيعات (تسوية)</td><td class="e">' + money(-r.returns) + '</td><td class="e">' + money(-r.returnsVat) + '</td></tr><tr class="tot"><td>إجمالي ضريبة المخرجات</td><td></td><td class="e">' + money(r.outputVat) + '</td></tr><tr class="sec"><td colspan="3">ضريبة المدخلات (المشتريات والمصروفات)</td></tr><tr><td>المشتريات</td><td class="e">' + money(r.purchases) + '</td><td class="e">' + money(r.purchasesVat) + '</td></tr><tr><td>المصروفات الخاضعة</td><td class="e">' + money(r.expenses) + '</td><td class="e">' + money(r.expensesVat) + '</td></tr><tr class="tot"><td>إجمالي ضريبة المدخلات</td><td></td><td class="e">' + money(r.inputVat) + '</td></tr><tr class="tot"><td>' + (r.netVat >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'رصيد دائن لصالح المنشأة') + '</td><td></td><td class="e">' + money(Math.abs(r.netVat)) + '</td></tr></tbody></table></div></div><div class="sm mut">ملخص مساعد لتعبئة الإقرار في بوابة الهيئة — راجعه مع محاسبك قبل التقديم.</div>';
  },
  stock: function () {
    var list = S.products.filter(function (p) { return !p.service; }), tot = 0;
    return '<div class="card"><div class="tw"><table class="tbl"><thead><tr><th>الصنف</th><th class="e">الرصيد</th><th class="e">متوسط التكلفة</th><th class="e">القيمة</th><th class="e">سعر البيع</th></tr></thead><tbody>' + list.map(function (p) { var v = Math.round(Math.max(p.stock, 0) * p.cost); tot += v; return '<tr><td>' + esc(p.name) + '</td><td class="e num ' + (p.stock <= (p.min || 0) ? 'bad b' : '') + '">' + qtyf(p.stock) + '</td><td class="e">' + money(p.cost) + '</td><td class="e">' + money(v) + '</td><td class="e">' + money(p.price) + '</td></tr>'; }).join('') + '<tr class="tot"><td colspan="3">قيمة المخزون</td><td class="e">' + money(tot) + '</td><td></td></tr></tbody></table></div></div>';
  },
  check: function () { return '<div class="card"><div class="list">' + M.integrity().map(function (x) { return '<div style="cursor:default"><div class="grow t">' + x.name + '</div><span class="tag ' + (x.ok ? 'g">سليم ✓' : 'r">خلل ✕') + '</span></div>'; }).join('') + '</div></div><div class="sm mut">هذه الفحوص تتأكد أن كل ما سُجّل في الشاشات مربوط بقيوده وأن الدفاتر متوازنة.</div>'; }
};
var REP_TABS = [['daily', 'اليومي'], ['sales', 'المبيعات بالصنف'], ['income', 'قائمة الدخل'], ['balance', 'الميزانية'], ['trial', 'ميزان المراجعة'], ['vat', 'الضريبة'], ['stock', 'المخزون'], ['check', 'فحص الدفاتر']];
pages.reports = {
  title: function () { for (var i = 0; i < REP_TABS.length; i++) if (REP_TABS[i][0] === rep.tab) return 'تقرير: ' + REP_TABS[i][1]; return 'التقارير'; },
  acts: function () { return '<button class="btn ghost sm" data-act="print-view">' + ic('print') + 'طباعة</button>'; },
  render: function () {
    if (!rep.from) { rep.from = monthStart(); rep.to = M.today(); rep.day = M.today(); }
    var range = rep.tab === 'sales' || rep.tab === 'income' || rep.tab === 'vat', asof = rep.tab === 'balance' || rep.tab === 'trial';
    return '<div class="noprint">' + tabs('rep-t', REP_TABS, rep.tab) + '<div class="tools">' + (rep.tab === 'daily' ? '<button class="btn ghost sm" data-act="rep-day" data-d="-1">‹ السابق</button><input type="date" data-in="rep-d" data-k="day" value="' + rep.day + '"><button class="btn ghost sm" data-act="rep-day" data-d="1">التالي ›</button>' : '') + (range ? '<input type="date" data-in="rep-d" data-k="from" value="' + rep.from + '" aria-label="من"><input type="date" data-in="rep-d" data-k="to" value="' + rep.to + '" aria-label="إلى">' : '') + (asof ? '<span class="mut">حتى تاريخ</span><input type="date" data-in="rep-d" data-k="to" value="' + rep.to + '">' : '') + '</div></div>' +
      '<div class="rep-h"><h2>' + esc(S.settings.name) + '</h2><div>' + esc(this.title()) + ' — ' + (rep.tab === 'daily' ? dfmt(rep.day) : range ? 'من ' + dfmt(rep.from) + ' إلى ' + dfmt(rep.to) : asof ? 'حتى ' + dfmt(rep.to) : dfmt(M.today())) + '</div></div>' + REPORTS[rep.tab]();
  }
};
actions['rep-t'] = function (el) { rep.tab = el.getAttribute('data-v'); render(); };
actions['rep-day'] = function (el) { rep.day = M.addDays(rep.day, +el.getAttribute('data-d')); render(); };
inputs['rep-d'] = function (el) { if (el.value) { rep[el.getAttribute('data-k')] = el.value; render(); } };

/* ---------- الإعدادات ---------- */
function sampleDoc() { var c = M.computeLines([{ name: 'صنف تجريبي أول', qty: 2, price: 2300, rate: 15 }, { name: 'صنف تجريبي ثانٍ', qty: 1, price: 1150, rate: 15 }], 0, true); return { t: 'sale', kind: 'standard', no: 'INV-000123', date: M.today(), ts: new Date().toISOString(), partyName: 'عميل تجريبي', partyVat: '300000000000003', partyAddress: 'مكة المكرمة', lines: c.lines, discount: 0, net: c.net, vat: c.vat, total: c.total, pays: [{ m: 'cash', amt: c.total }] }; }
pages.settings = {
  title: 'الإعدادات',
  render: function () {
    var s = S.settings, h = tabs('set-t', [['co', 'المنشأة'], ['users', 'المستخدمون والورديات'], ['dev', 'الجهاز والعرض'], ['tpl', 'قوالب الطباعة'], ['data', 'البيانات والنسخ'], ['upd', 'التحديث وعن النسخة']], setTab);
    if (setTab === 'users') h += usersTab();
    if (setTab === 'co') h += '<div class="card" id="set-f">' + fld('اسم المنشأة *', 'name', s.name) + fld('الاسم بالإنجليزية (اختياري)', 'nameEn', s.nameEn, 'dir="ltr"') + '<div class="grid g2">' + fld('الرقم الضريبي', 'vat', s.vat, 'class="n" inputmode="numeric" maxlength="15"') + fld('السجل التجاري', 'cr', s.cr, 'class="n" inputmode="numeric"') + '</div><div class="grid g2">' + fld('المدينة', 'city', s.city) + fld('العنوان', 'address', s.address) + '</div>' + fld('الجوال', 'phone', s.phone, 'class="n" inputmode="tel"') + '<div class="row" style="margin-bottom:12px">' + (s.logo ? '<img src="' + s.logo + '" alt="الشعار" style="height:54px;border-radius:8px;border:1px solid var(--line)">' : '') + '<label class="btn ghost sm">' + (s.logo ? 'تغيير الشعار' : 'رفع الشعار') + '<input type="file" accept="image/*" data-in="logo" style="display:none"></label>' + (s.logo ? '<button class="btn ghost sm" data-act="logo-del">حذف</button>' : '') + '</div>' +
      chk('أسعار البيع شاملة ضريبة القيمة المضافة', 'pricesIncl', s.pricesIncl) + sel('عند بيع صنف رصيده لا يكفي', 'oversell', [['ask', 'اسأل الكاشير ثم اسمح'], ['allow', 'اسمح دائماً'], ['block', 'امنع البيع']], s.oversell) + '<button class="btn" data-act="set-save">حفظ</button></div>';
    if (setTab === 'dev') h += '<div class="card"><h3>نوع الجهاز ومقاس الشاشة</h3>' + deviceGrid(s.mode) + '<div class="sm mut">المقاس الحالي للشاشة: <span class="num">' + window.innerWidth + '×' + window.innerHeight + '</span> — الوضع المطبَّق: ' + { phone: 'جوال', handheld: 'جهاز دفع محمول', tablet: 'كاشير صغير / تابلت', desktop: 'كاشير كبير / لابتوب' }[resolveMode()] + '</div></div>' +
      '<div class="card"><h3>حجم الخط والأزرار</h3>' + tabs('set-scale', [[85, 'صغير'], [100, 'عادي'], [115, 'كبير'], [130, 'أكبر']], s.scale) + '<h3 style="margin-top:8px">المظهر</h3>' + tabs('set-theme', [['light', 'فاتح'], ['dark', 'داكن']], s.theme) + '</div>';
    if (setTab === 'tpl') {
      var sd = sampleDoc();
      function gal(key, label) { return '<div class="card"><h3>' + label + '</h3><div class="tpls">' + TEMPLATES.map(function (t) { var w = t[2] === 'th' ? (t[0] === 't80' ? 302 : 219) : (t[0].indexOf('a5') === 0 ? 559 : 794); return '<button class="tpl' + (s[key] === t[0] ? ' on' : '') + '" data-act="set-tpl" data-k="' + key + '" data-t="' + t[0] + '"><div class="pv"><div style="transform:scale(' + (118 / w).toFixed(3) + ');width:' + w + 'px">' + docPaper(sd, t[0]) + '</div></div><b class="sm">' + t[1] + '</b></button>'; }).join('') + '</div></div>'; }
      h += gal('tplReceipt', 'قالب إيصال نقطة البيع (الفاتورة المبسطة)') + gal('tplInvoice', 'قالب الفاتورة الضريبية للعملاء المنشآت والمشتريات') + '<div class="card" id="set-f"><h3>خيارات القوالب</h3>' + chk('إظهار الشعار', 'showLogo', s.showLogo) + chk('عناوين ثنائية اللغة (عربي / English)', 'bilingual', s.bilingual) + chk('إظهار التاريخ الهجري في فواتير A4', 'showHijri', s.showHijri) + chk('طباعة الإيصال تلقائياً بعد كل بيع', 'autoPrint', s.autoPrint) + fld('نص تذييل الفاتورة', 'footer', s.footer) + '<div class="row"><button class="btn" data-act="set-save">حفظ</button><button class="btn ghost" data-act="tpl-test">طباعة تجريبية</button></div></div>';
    }
    if (setTab === 'data') h += '<div class="card"><h3>النسخ الاحتياطي</h3><div class="note">بياناتك محفوظة على <b>هذا الجهاز فقط</b>' + (M.storage() === 'memory' ? ' — <b class="bad">تنبيه: التخزين الدائم غير متاح في هذه المعاينة، والبيانات تزول عند الإغلاق</b>' : '') + '. خذ نسخة احتياطية بانتظام واحفظها خارج الجهاز؛ حذف التطبيق أو بياناته يمسح كل شيء.</div><div class="row" style="flex-wrap:wrap"><button class="btn" data-act="backup">تنزيل نسخة احتياطية</button><label class="btn ghost">استرجاع من نسخة<input type="file" accept=".json,application/json" data-in="restore" style="display:none"></label></div></div>' +
      '<div class="card"><h3>البيانات التجريبية والحذف</h3><div class="row" style="flex-wrap:wrap"><button class="btn ghost" data-act="demo-load">تحميل بيانات تجريبية</button><button class="btn red" data-act="wipe">حذف كل البيانات والبدء من جديد</button></div><div class="sm mut" style="margin-top:8px">الحذف يُبقي بيانات المنشأة والإعدادات ويمسح الأصناف والفواتير والقيود.</div></div>' +
      '<div class="card"><h3>الانتقال إلى ميزان الكامل</h3><div class="sm">عند حاجتك لتعدد المستخدمين والفروع والربط مع الهيئة (المرحلة الثانية) والرواتب، خذ نسخة احتياطية من هنا لتُنقل أصنافك وعملاؤك وأرصدتك إلى النسخة الكاملة.</div></div>';
    if (setTab === 'upd') h += '<div class="card"><h3>ميزان لايت — الإصدار <span class="num">' + M.VERSION + '</span></h3><div class="sm mut" style="margin-bottom:10px">نسخة الأساسيات من نظام ميزان: نقطة بيع ومحاسبة تعمل على الجهاز بلا إنترنت.</div><div id="upd-res" class="note">اضغط للتحقق من وجود إصدار أحدث (يحتاج اتصالاً بالإنترنت).</div><button class="btn" data-act="upd-check">التحقق من التحديثات</button></div><div class="card" id="set-f"><h3>مصدر التحديثات</h3>' + fld('رابط ملف الإصدارات', 'updateUrl', s.updateUrl, 'dir="ltr" class="n"') + '<button class="btn ghost sm" data-act="set-save">حفظ</button></div>' +
      '<div class="card"><h3>حدود هذه النسخة</h3><div class="sm">• الفاتورة برمز QR وفق المرحلة الأولى من الفوترة الإلكترونية. الربط المباشر مع منصة «فاتورة» (المرحلة الثانية) متاح في ميزان الكامل.<br>• مستخدم واحد وجهاز واحد، ولا مزامنة بين الأجهزة.<br>• لا يوجد إقفال سنوي؛ التقارير تُعرض لأي فترة تختارها.</div></div>';
    return h;
  }
};
actions['set-t'] = function (el) { setTab = el.getAttribute('data-v'); render(); };
actions['set-save'] = function () { var f = form($('#set-f')); if ('vat' in f && f.vat && !M.validVat(f.vat)) return toast('الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3', true); if ('name' in f && !f.name) return toast('اكتب اسم المنشأة', true); for (var k in f) S.settings[k] = f[k]; M.save(); render(); toast('تم الحفظ'); };
actions['set-scale'] = function (el) { S.settings.scale = +el.getAttribute('data-v'); M.save(); render(); };
actions['set-theme'] = function (el) { S.settings.theme = el.getAttribute('data-v'); M.save(); render(); };
actions['set-tpl'] = function (el) { S.settings[el.getAttribute('data-k')] = el.getAttribute('data-t'); M.save(); var y = $('#view').scrollTop; render(); $('#view').scrollTop = y; };
actions['tpl-test'] = function () { printDoc(sampleDoc(), S.settings.tplReceipt); };
inputs.logo = function (el) { if (el.files && el.files[0]) shrink(el.files[0], 420, function (u) { S.settings.logo = u; M.save(); render(); }); };
actions['logo-del'] = function () { S.settings.logo = ''; M.save(); render(); };
function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }
actions.backup = function () {
  var name = 'mizan-lite-backup-' + M.today() + '.json', txt = M.exportJSON();
  if (window.MIZAN_PREVIEW) return toast('تنزيل النسخة الاحتياطية يعمل في تطبيق أندرويد — غير متاح داخل هذه المعاينة');
  if (NATIVE && NATIVE.saveFile) { try { NATIVE.saveFile(name, 'application/json', b64utf8(txt)); return; } catch (e) { } }
  try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); toast('تم تجهيز النسخة الاحتياطية'); } catch (e) { toast('تعذر التنزيل على هذا المتصفح', true); }
};
inputs.restore = function (el) {
  var f = el.files && el.files[0]; if (!f) return; var r = new FileReader();
  r.onload = function () { confirmBox('استرجاع نسخة احتياطية', 'سيُستبدل كل ما على هذا الجهاز بمحتوى النسخة. هل تتابع؟', 'استرجاع', function () { M.importJSON(String(r.result)); S = M.state; go('home'); toast('تم الاسترجاع'); }, true); }; r.readAsText(f);
};
actions['demo-load'] = function () { confirmBox('تحميل بيانات تجريبية', 'سيُمسح ما سجّلته من أصناف وفواتير ويُحمَّل مكانه بيانات وهمية للتجربة.', 'تحميل', function () { M.loadDemo(); go('home'); toast('حُمّلت البيانات التجريبية'); }, true); };
actions.wipe = function () { confirmBox('حذف كل البيانات', 'سيُحذف نهائياً: الأصناف، العملاء والموردون، الفواتير، السندات والقيود. خذ نسخة احتياطية أولاً إن احتجت. لا يمكن التراجع.', 'حذف نهائي', function () { M.reset(true); cart = { lines: [], discount: 0, partyId: '' }; go('home'); toast('تم الحذف — ابدأ بإضافة أصنافك'); }, true); };
function verCmp(a, b) { a = String(a).split('.'); b = String(b).split('.'); for (var i = 0; i < 3; i++) { var d = (+a[i] || 0) - (+b[i] || 0); if (d) return d; } return 0; }
actions['upd-check'] = function () {
  var box = $('#upd-res'); box.textContent = 'جارٍ التحقق…';
  function get(url) {
    if (NATIVE && NATIVE.httpGet) return new Promise(function (ok, no) { window.mizanHttp = function (body) { try { if (body == null) throw 0; ok(JSON.parse(body)); } catch (e) { no(e); } }; NATIVE.httpGet(url, 'mizanHttp'); });
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }
  try {
    get(S.settings.updateUrl).then(function (j) {
      if (verCmp(j.version, M.VERSION) > 0) box.innerHTML = '<b>يتوفر إصدار أحدث: <span class="num">' + esc(j.version) + '</span></b>' + (j.notes ? '<div>' + esc(j.notes) + '</div>' : '') + (j.apk && /^https:\/\//.test(j.apk) ? '<div style="margin-top:8px"><a class="btn gold sm" data-act="open-url" data-url="' + esc(j.apk) + '">تنزيل التحديث</a></div><div class="sm">ثبّته فوق النسخة الحالية — بياناتك تبقى كما هي. خذ نسخة احتياطية أولاً للاحتياط.</div>' : '');
      else box.textContent = 'أنت على أحدث إصدار ✓';
    }).catch(function () { box.textContent = 'تعذر الوصول إلى مصدر التحديثات. تحقق من الاتصال أو من الرابط أدناه.'; });
  } catch (e) { box.textContent = 'تعذر التحقق على هذا المتصفح.'; }
};
actions['open-url'] = function (el) { var u = el.getAttribute('data-url'); if (NATIVE && NATIVE.openUrl) NATIVE.openUrl(u); else window.open(u, '_blank'); };

/* ---------- المزيد (الجوال) ---------- */
pages.more = { title: 'المزيد', render: function () { return '<div class="card"><div class="list">' + NAV.filter(function (n) { return M.can(n[0]) && !TABS.some(function (t) { return t[0] === n[0]; }); }).map(function (n) { return '<div data-act="go" data-to="' + n[0] + '"><span style="width:26px;height:26px;margin-inline-end:12px;color:var(--navy2)">' + ic(n[2]) + '</span><div class="grow t">' + n[1] + '</div><span class="mut">‹</span></div>'; }).join('') + '</div></div><div class="c sm mut">ميزان لايت — الإصدار ' + M.VERSION + '</div>'; } };

/* ---------- دليل الاستخدام المصوّر ---------- */
function shot(inner) { return '<div class="shot"><svg viewBox="0 0 320 150" font-family="Tajawal,Tahoma" direction="rtl">' + inner + '</svg></div>'; }
var G = { bx: function (x, y, w, h, f, r) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (r == null ? 6 : r) + '" fill="' + f + '"/>'; }, tx: function (x, y, t, s, f, a) { return '<text x="' + x + '" y="' + y + '" font-size="' + (s || 10) + '" fill="' + (f || '#17202e') + '" text-anchor="' + (a || 'middle') + '" font-weight="700">' + t + '</text>'; } };
function step(n, t) { return '<div class="step"><i>' + n + '</i><div>' + t + '</div></div>'; }
pages.guide = {
  title: 'دليل الاستخدام',
  render: function () {
    var tiles = '', i; for (i = 0; i < 6; i++) tiles += G.bx(196 - (i % 3) * 62, 34 + Math.floor(i / 3) * 54, 56, 48, '#fff') + G.bx(204 - (i % 3) * 62, 40 + Math.floor(i / 3) * 54, 40, 18, '#eef2f9', 4) + G.tx(224 - (i % 3) * 62, 70 + Math.floor(i / 3) * 54, ['قهوة', 'شاي', 'ماء', 'خبز', 'كيك', 'عصير'][i], 8) + G.tx(224 - (i % 3) * 62, 78 + Math.floor(i / 3) * 54, ['12.00', '5.00', '1.00', '2.00', '15.00', '8.00'][i], 7, '#12805c');
    return '<div class="guide"><div class="card"><h3>١ — البيع من نقطة البيع</h3>' + shot(G.bx(0, 0, 320, 150, '#f3f5f9', 10) + G.bx(72, 8, 240, 20, '#fff') + G.tx(300, 22, 'ابحث أو امسح الباركود', 8, '#64708a', 'start') + tiles + G.bx(8, 8, 58, 134, '#fff') + G.tx(37, 24, 'السلة', 9) + G.tx(37, 44, 'قهوة ×2', 8, '#64708a') + G.tx(37, 58, 'كيك ×1', 8, '#64708a') + G.tx(37, 100, '39.00', 11) + G.bx(13, 112, 48, 22, '#12805c') + G.tx(37, 127, 'دفع', 10, '#fff')) +
      step(1, 'افتح <b>نقطة البيع</b> واضغط على الصنف ليُضاف إلى السلة، أو امسح الباركود بالقارئ.') + step(2, 'عدّل الكمية بزرَّي ＋ و − أو اضغط على السطر لتغيير السعر والخصم.') + step(3, 'اضغط <b>دفع</b> واختر: نقدي، شبكة، نقدي + شبكة، أو آجل (يحتاج اختيار عميل).') + step(4, 'تصدر الفاتورة الضريبية برمز QR وتظهر للطباعة فوراً. القيد المحاسبي والمخزون يُحدَّثان تلقائياً.') + '</div>' +
      '<div class="card"><h3>٢ — الأصناف والمشتريات</h3>' + shot(G.bx(0, 0, 320, 150, '#f3f5f9', 10) + G.bx(10, 10, 300, 28, '#fff') + G.tx(298, 28, 'اسم الصنف', 9, '#64708a', 'start') + G.bx(164, 46, 146, 28, '#fff') + G.tx(298, 64, 'سعر البيع', 9, '#64708a', 'start') + G.bx(10, 46, 146, 28, '#fff') + G.tx(144, 64, 'الباركود', 9, '#64708a', 'start') + G.bx(164, 82, 146, 28, '#fff') + G.tx(298, 100, 'التكلفة', 9, '#64708a', 'start') + G.bx(10, 82, 146, 28, '#fff') + G.tx(144, 100, 'الكمية الحالية', 9, '#64708a', 'start') + G.bx(10, 118, 70, 24, '#1f3a6e') + G.tx(45, 134, 'حفظ', 10, '#fff')) +
      step(1, 'من <b>الأصناف ← صنف جديد</b> اكتب الاسم والسعر، ومعهما التكلفة والكمية الحالية إن كان عندك مخزون.') + step(2, 'عند شراء بضاعة جديدة سجّل <b>فاتورة مشتريات</b> من شاشة الفواتير: تزيد الكميات ويُحسب متوسط التكلفة وضريبة المدخلات.') + step(3, 'لتصحيح الكمية بعد الجرد: افتح الصنف ← <b>جرد / تسوية الكمية</b>.') + '</div>' +
      '<div class="card"><h3>٣ — المصروفات والسندات</h3>' + step(1, '<b>مصروف</b>: إيجار، كهرباء، رواتب… اختر النوع والمبلغ وهل فيه ضريبة.') + step(2, '<b>سند قبض</b>: تحصيل من عميل آجل، أو إيداع رأس مال من المالك.') + step(3, '<b>سند صرف</b>: سداد لمورد، أو سحب المالك من المحل (جاري المالك) — وليس مصروفاً.') + step(4, '<b>تحويل</b>: إيداع نقدية الصندوق في البنك أو العكس.') + '</div>' +
      '<div class="card"><h3>٤ — الطباعة والقوالب</h3>' + shot(G.bx(0, 0, 320, 150, '#f3f5f9', 10) + G.bx(238, 12, 66, 126, '#fff', 3) + G.tx(271, 28, 'إيصال 80مم', 8) + G.bx(250, 96, 42, 34, '#17202e', 2) + G.bx(170, 22, 52, 116, '#fff', 3) + G.tx(196, 38, '58مم', 8) + G.bx(182, 104, 28, 26, '#17202e', 2) + G.bx(16, 12, 138, 126, '#fff', 3) + G.bx(16, 12, 138, 20, '#14274e', 3) + G.tx(85, 26, 'فاتورة ضريبية A4', 9, '#fff') + G.bx(26, 96, 30, 30, '#17202e', 2) + G.bx(70, 104, 74, 12, '#c9a227', 2)) +
      step(1, 'من <b>الإعدادات ← قوالب الطباعة</b> اختر قالب الإيصال (58 أو 80 مم) وقالب فاتورة A4/A5.') + step(2, 'في نافذة أي فاتورة يمكنك التبديل بين القوالب قبل الطباعة.') + step(3, 'الطابعات الحرارية على أندرويد تعمل عبر «خدمة طباعة» مثبّتة على الجهاز (تطبيق الشركة المصنّعة أو تطبيق وسيط مثل RawBT للبلوتوث و USB).') + '</div>' +
      '<div class="card"><h3>٥ — مقاس الجهاز</h3>' + step(1, 'من <b>الإعدادات ← الجهاز والعرض</b> اختر: جوال، جهاز دفع محمول، كاشير صغير، أو كاشير كبير / لابتوب.') + step(2, 'تتغير القوائم وشبكة الأصناف والسلة لتناسب الشاشة، ويمكن تكبير الخط والأزرار.') + '</div>' +
      '<div class="card"><h3>٦ — الورديات والمستخدمون والكاميرا</h3>' + step(1, '<b>الورديات</b>: افتح وردية بعدّ النقدية في الدرج، وعند الإغلاق اكتب المعدود: يحسب البرنامج المتوقع (الافتتاح + النقدي الداخل − الخارج) ويقيّد العجز أو الزيادة، ويطبع تقرير الإغلاق (Z).') + step(2, 'من <b>الإعدادات ← المستخدمون والورديات</b> أضف المالك ثم الكاشيرية برمز سري: يُطلب الرمز عند الفتح، وتُسجّل كل فاتورة باسم من أصدرها، والكاشير لا يرى إلا البيع والمرتجع والوردية.') + step(3, 'زر الكاميرا بجوار البحث في نقطة البيع يقرأ باركود الأصناف (EAN-13 و EAN-8 و UPC-A) ويضيفها للسلة واحداً بعد الآخر. وفي نموذج الصنف يملأ خانة الباركود.') + step(4, '<b>مرتجع المشتريات</b>: افتح فاتورة المشتريات ← «مرتجع مشتريات»، فتخرج الكميات وتُعكس ضريبة المدخلات ويُخصم من حساب المورد أو يُسترد نقداً.') + '</div>' +
      '<div class="card"><h3>٧ — التقارير والنسخ الاحتياطي</h3>' + step(1, '<b>التقارير</b>: اليومي، المبيعات بالصنف، قائمة الدخل، الميزانية، ميزان المراجعة، ملخص الضريبة، المخزون.') + step(2, '<b>فحص الدفاتر</b> يؤكد أن كل الحركات مربوطة بقيودها ومتوازنة.') + step(3, 'البيانات على الجهاز فقط: خذ <b>نسخة احتياطية</b> بانتظام من الإعدادات ← البيانات والنسخ.') + '</div></div>';
  }
};

/* ---------- الأحداث والإقلاع ---------- */
document.addEventListener('click', function (ev) {
  var el = ev.target; while (el && el !== document.body && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
  if (!el || el === document.body || !el.getAttribute) { if (ev.target.id === 'modal') { /* النوافذ لا تُغلق بالنقر خارجها */ } return; }
  if (el.disabled) return; var f = actions[el.getAttribute('data-act')]; if (f) { ev.preventDefault(); guard(function () { f(el, ev); }); }
});
function onInput(ev) { var el = ev.target, k = el.getAttribute && el.getAttribute('data-in'); if (k && inputs[k]) guard(function () { inputs[k](el, ev); }); }
document.addEventListener('input', onInput);
document.addEventListener('change', function (ev) { var t = ev.target; if (t.tagName === 'SELECT' || t.type === 'file' || t.type === 'date') onInput(ev); });
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && $('#modal').classList.contains('open')) return closeModal();
  if (ev.key === 'Enter' && ev.target.id === 'pos-q') {
    var q = ev.target.value.trim(); if (!q) return; var hit = M.productByBarcode(q);
    if (!hit) { var l = S.products.filter(function (p) { return p.active !== false && norm(p.name).indexOf(norm(q)) >= 0; }); if (l.length === 1) hit = l[0]; }
    if (hit) { addToCart(hit); posQ = ''; ev.target.value = ''; $('#pos-grid').innerHTML = posTiles(); } else toast('لا يوجد صنف بهذا الباركود', true);
  }
  if (route.name === 'pos' && !$('#modal').classList.contains('open')) { if (ev.key === 'F2') { ev.preventDefault(); $('#pos-q').focus(); } if (ev.key === 'F8') { ev.preventDefault(); actions['pos-pay'](); } }
});
var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (S && !$('#modal').classList.contains('open')) { var m = document.documentElement.className; applyDisplay(); if (document.documentElement.className !== m) render(); } }, 150); });
window.addEventListener('pagehide', function () { M.flush(); });
document.addEventListener('visibilitychange', function () { if (document.hidden) M.flush(); });
// زر الرجوع في أندرويد: يعيد true إذا عولج داخل التطبيق
window.mizanBack = function () {
  if ($('#modal').classList.contains('open')) { closeModal(); return true; }
  var p = $('#pos'); if (p && p.classList.contains('show-cart')) { p.classList.remove('show-cart'); return true; }
  if (S && S.setup && route.name !== 'home') { go('home'); return true; }
  return false;
};
