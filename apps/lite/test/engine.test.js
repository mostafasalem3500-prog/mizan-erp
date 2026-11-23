var M=require('../src/core.js'),assert=require('assert');var n=0;function ok(c,m){n++;assert(c,m);}
M.init();var S=M.state;S.settings.name='اختبار';S.settings.vat='310123456700003';
// صنف برصيد افتتاحي 10 بتكلفة 10 ريال
var p=M.saveProduct({name:'صنف أ',price:2300,cost:1000,stock:10});var sv=M.saveProduct({name:'خدمة',price:1000,service:true});
var cu=M.saveParty({role:'c',name:'عميل',vat:'300987654300003'}),su=M.saveParty({role:'s',name:'مورد'});
function gl(c){var x=M.balances()[c]||{dr:0,cr:0};return x.dr-x.cr;}
ok(gl('1104')===10000&&gl('3104')===-10000,'افتتاحي');
// بيع 2 × 23 شامل = 46 → صافي 40 ضريبة 6، تكلفة 20
var d=M.sale({lines:[{pid:p.id,name:p.name,qty:2,price:2300,rate:15}],pays:[{m:'cash',amt:4600}]});
ok(d.net===4000&&d.vat===600&&d.total===4600,'بيع شامل');ok(gl('1101')===4600&&gl('4101')===-4000&&gl('2102')===-600&&gl('5101')===2000&&gl('1104')===8000,'قيد البيع');ok(p.stock===8);
// تقريب حدّي: 3 × 0.99 شامل
var c=M.computeLines([{name:'x',qty:3,price:99,rate:15},{name:'y',qty:1,price:1,rate:15}],0,true);ok(c.total===298&&c.net+c.vat===298,'تقريب');
var c2=M.computeLines([{name:'x',qty:1,price:1000,rate:15},{name:'y',qty:2,price:333,rate:0}],100,true);ok(c2.total===1566&&c2.lines[0].disc+c2.lines[1].disc===100,'توزيع الخصم');
// بيع آجل بخصم + خدمة
var d2=M.sale({partyId:cu.id,discount:300,lines:[{pid:p.id,name:p.name,qty:3,price:2300,rate:15},{pid:sv.id,name:'خدمة',qty:1,price:1000,rate:15}],pays:[{m:'credit',amt:5000},{m:'card',amt:2600}]});
ok(d2.total===7600&&d2.kind==='standard','آجل');ok(M.partyBalance(cu.id)===5000);ok(p.stock===5);
// مرتجع جزئي ثم كامل
var r1=M.saleReturn(d2.id,[{i:0,qty:1}],'credit');var r2=M.saleReturn(d2.id,[{i:0,qty:2},{i:1,qty:1}],'cash');
ok(r1.total+r2.total===7600,'المرتجع = الفاتورة');ok(p.stock===8&&p.cost===1000);
assert.throws(function(){M.saleReturn(d2.id,[{i:0,qty:1}],'cash');});
ok(M.partyBalance(cu.id)===5000-r1.total);
// شراء آجل 10 × 12 + 15% ← متوسط التكلفة (8×10+120)/18
var pu=M.purchase({partyId:su.id,lines:[{pid:p.id,qty:10,price:1200,rate:15}],pays:[{m:'credit',amt:13800}]});
ok(pu.vat===1800&&p.stock===18&&p.cost===1111,'شراء ومتوسط');ok(M.partyBalance(su.id)===13800);
// تخطي الرصيد
assert.throws(function(){M.sale({lines:[{pid:p.id,name:p.name,qty:50,price:2300,rate:15}]});},function(e){return e.code==='STOCK';});
// مصروف بضريبة، سندات، تحويل، قيد يدوي، تسوية
var e=M.expense({acc:'5203',amount:1150,method:'cash',hasVat:true});ok(e.net===1000&&e.vat===150);
M.voucher({kind:'in',partyId:cu.id,amount:1000,method:'cash'});M.voucher({kind:'out',partyId:su.id,amount:3800,method:'cash'});
M.voucher({kind:'in',acc:'3101',amount:500000,method:'bank'});M.transfer({from:'bank',to:'cash',amount:10000});
M.manualJournal({desc:'إهلاك',lines:[{a:'5204',dr:500},{a:'1201',cr:500}]});
assert.throws(function(){M.manualJournal({desc:'x',lines:[{a:'5204',dr:500},{a:'1201',cr:400}]});},function(x){return x.code==='UNBALANCED';});
M.adjustStock(p.id,17,'تالف');ok(gl('5208')===1111);
// إلغاء
M.cancel('exp',e.id,'خطأ');ok(gl('5203')===0);assert.throws(function(){M.cancel('exp',e.id,'x');});
var pu2=M.purchase({partyId:su.id,lines:[{pid:p.id,qty:3,price:1500,rate:15}],pays:[{m:'bank',amt:5175}]});M.cancel('pur',pu2.id,'مرتجع للمورد');ok(p.stock===17);
// سلامة
M.integrity().forEach(function(x){ok(x.ok,x.name);});
var tb=M.trialBalance(),bs=M.balanceSheet(),is=M.incomeStatement(),vr=M.vatReport();
ok(tb.balanced&&tb.dr>0);ok(bs.balanced);ok(is.net===bs.equity.filter(function(x){return !x.code})[0].amount,'صافي الربح');
ok(vr.outputVat===600&&vr.inputVat===1800,'الإقرار '+vr.outputVat+' '+vr.inputVat);
// QR و التفقيط
var tlv=Buffer.from(M.zatcaQr(d),'base64');ok(tlv[0]===1&&tlv.slice(2,2+tlv[1]).toString('utf8')==='اختبار');var o=2+tlv[1];ok(tlv[o]===2&&tlv.slice(o+2,o+2+15).toString()==='310123456700003');ok(tlv.toString('utf8').indexOf('46.00')>0&&tlv.toString('utf8').indexOf('6.00')>0);
ok(M.tafqeet(123456)==='فقط ألف ومائتان وأربعة وثلاثون ريال وستة وخمسون هللة لا غير',M.tafqeet(123456));ok(M.toH('١٢٫٥٠')===1250&&M.fmt(123456789)==='1,234,567.89');
// استيراد/تصدير
var js=M.exportJSON();M.init();M.importJSON(js);ok(M.trialBalance().dr===tb.dr);assert.throws(function(){M.importJSON('{"a":1}');});
// بيانات تجريبية
M.init();M.loadDemo();M.integrity().forEach(function(x){ok(x.ok,'تجريبي: '+x.name);});var b=M.balances();ok(b['1101'].dr-b['1101'].cr>0&&b['1102'].dr-b['1102'].cr>0,'نقدية موجبة');
console.log('PASS',n,'فحصاً | فواتير تجريبية:',M.state.docs.length,'| صافي الربح التجريبي:',M.fmt(M.incomeStatement().net));
