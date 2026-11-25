// ميزان لايت 1.1: مرتجع المشتريات، الورديات وعجز/زيادة الصندوق، المستخدمون بالرمز السري، قارئ الباركود
var M=require('../src/core.js'),assert=require('assert');var n=0;function ok(c,m){n++;if(!c){console.error('FAIL',m);process.exitCode=1;}}
function throws(f,re,m){n++;try{f();console.error('FAIL (لم يُرفض)',m);process.exitCode=1;}catch(e){if(re&&!re.test(e.message)){console.error('FAIL',m,'→',e.message);process.exitCode=1;}}}
function gl(c){var x=M.balances()[c]||{dr:0,cr:0};return x.dr-x.cr;}
ok(M.VERSION==='1.1.0','الإصدار 1.1.0');
M.init();var S=M.state;S.settings.name='اختبار';S.settings.vat='310123456700003';
ok(M.account('5210')&&M.account('5210').type==='X','حساب عجز وزيادة الصندوق');
var p=M.saveProduct({name:'صنف أ',price:2300,cost:1000,stock:10,barcode:'6281000000401'}),su=M.saveParty({role:'s',name:'مورد'}),cu=M.saveParty({role:'c',name:'عميل'});

// ═══ مرتجع المشتريات ═══
var pu=M.purchase({partyId:su.id,lines:[{pid:p.id,qty:10,price:1200,rate:15}],pays:[{m:'credit',amt:13800}]});
ok(p.stock===20&&p.cost===1100,'شراء: الرصيد 20 بمتوسط 11');
var r1=M.purchaseReturn(pu.id,[{i:0,qty:4}],'credit');
ok(r1.t==='pret'&&r1.net===4800&&r1.vat===720&&r1.total===5520,'مرتجع 4 × 12 = 48 + 7.20 ضريبة');
ok(M.partyBalance(su.id)===8280,'يُخصم من حساب المورد: 138 − 55.20 = 82.80');
ok(p.stock===16&&p.cost===1075&&gl('1104')===17200&&M.stockValue()===17200,'المخزون 16 بتكلفة 10.75 = حساب المخزون 172');
throws(function(){M.purchaseReturn(pu.id,[{i:0,qty:7}],'cash');},/أكبر من المتاح/,'لا يُرجع أكثر من المتبقي (6)');
throws(function(){M.cancel('pur',pu.id,'x');},/مرتجع/,'لا تُلغى فاتورة عليها مرتجع');
var r2=M.purchaseReturn(pu.id,[{i:0,qty:6}],'cash');
ok(r2.net===7200&&r2.vat===1080&&gl('1101')===8280&&p.stock===10&&p.cost===1000,'مرتجع الباقي نقداً: التكلفة تعود 10 والرصيد 10');
var vr=M.vatReport();ok(vr.inputVat===0&&vr.ledgerInput===0&&vr.purchaseReturnsVat===1800,'ضريبة المدخلات بعد المرتجعات = صفر = الأستاذ');
M.sale({lines:[{pid:p.id,name:p.name,qty:8,price:2300,rate:15}],pays:[{m:'cash',amt:18400}]});
var pu2=M.purchase({lines:[{pid:p.id,qty:5,price:1000,rate:15}],pays:[{m:'cash',amt:5750}]});
M.sale({lines:[{pid:p.id,name:p.name,qty:6,price:2300,rate:15}],pays:[{m:'cash',amt:13800}]});
throws(function(){M.purchaseReturn(pu2.id,[{i:0,qty:5}],'cash');},/الرصيد لا يكفي/,'لا يُرجع للمورد ما بيع');
M.integrity().forEach(function(x){ok(x.ok,'مرتجع المشتريات: '+x.name);});

// ═══ الورديات ═══
var cash0=gl('1101');
var sh=M.shiftOpen({float:20000});ok(sh.status==='open'&&sh.no==='SH-000001'&&M.openShift()===sh,'فتح وردية بمبلغ 200');
throws(function(){M.shiftOpen({float:0});},/وردية مفتوحة/,'وردية واحدة مفتوحة في الجهاز');
M.adjustStock(p.id,50,'جرد');
var s1=M.sale({lines:[{pid:p.id,name:p.name,qty:2,price:2300,rate:15}],pays:[{m:'cash',amt:4600}]});
var s2=M.sale({partyId:cu.id,lines:[{pid:p.id,name:p.name,qty:1,price:2300,rate:15}],pays:[{m:'card',amt:1000},{m:'credit',amt:1300}]});
M.saleReturn(s1.id,[{i:0,qty:1}],'cash');
M.expense({acc:'5204',amount:1500,method:'cash'});M.voucher({kind:'in',partyId:cu.id,amount:1300,method:'cash'});
var x=M.shiftSummary();
ok(s1.shift===sh.id&&x.count===2&&x.sales===6900&&x.cashSales===4600&&x.cardSales===1000&&x.creditSales===1300,'الوردية: فاتورتان 69، نقدي 46، شبكة 10، آجل 13');
ok(x.cashReturns===2300&&x.expenses===1500&&x.receipts===1300&&x.expected===20000+4600+1300-2300-1500,'المتوقع في الدرج = 200 + 46 + 13 − 23 − 15 = 221');
var c1=M.shiftClose({counted:x.expected-500});
ok(c1.status==='closed'&&c1.diff===-500&&gl('5210')===500&&gl('1101')===cash0+4600+1300-2300-1500-500,'عجز 5: من ح/ عجز وزيادة الصندوق إلى ح/ الصندوق');
var sh2=M.shiftOpen({float:22100});var t2=M.sale({lines:[{pid:p.id,name:p.name,qty:1,price:2300,rate:15}],pays:[{m:'cash',amt:2300}]});
var c2=M.shiftClose({counted:22100+2300+200});ok(c2.diff===200&&gl('5210')===300,'زيادة 2: من ح/ الصندوق إلى ح/ عجز وزيادة الصندوق');
ok(M.shiftSummary(sh.id).sales===6900&&M.shiftSummary(sh2.id).count===1,'تقرير وردية مغلقة');
S.settings.requireShift=true;throws(function(){M.sale({lines:[{pid:p.id,name:p.name,qty:1,price:2300,rate:15}],pays:[{m:'cash',amt:2300}]});},/افتح وردية/,'البيع يتطلب وردية مفتوحة عند تفعيل الخيار');
M.shiftOpen({float:0});ok(M.sale({lines:[{pid:p.id,name:p.name,qty:1,price:2300,rate:15}],pays:[{m:'cash',amt:2300}]}).shift===M.openShift().id,'ومع وردية مفتوحة يتم');
M.integrity().forEach(function(x){ok(x.ok,'الورديات: '+x.name);});

// ═══ المستخدمون ═══
ok(M.can('accounting')&&!M.user,'بلا مستخدمين: جهاز بمستخدم واحد بلا قفل');
throws(function(){M.saveUser({name:'م',pin:'12'});},/4 إلى 6/,'الرمز 4 إلى 6 أرقام');
var ow=M.saveUser({name:'المالك',role:'cashier',pin:'9999'});ok(ow.role==='owner'&&M.user===ow,'أول مستخدم مالك ويدخل تلقائياً');
var ca=M.saveUser({name:'كاشير',role:'cashier',pin:'1234'});
throws(function(){M.saveUser({name:'آخر',role:'cashier',pin:'1234'});},/مستخدم لمستخدم آخر/,'لا يتكرر الرمز');
ok(JSON.stringify(S.users).indexOf('1234')<0&&ca.hash.length===64,'الرمز محفوظ مجزّأً لا نصاً');
M.logout();ok(!M.can('pos'),'بعد الخروج لا شيء متاح');
throws(function(){M.login('0000');},/غير صحيح/,'رمز خاطئ');
M.login('1234');ok(M.user.name==='كاشير'&&M.can('pos')&&M.can('shifts')&&!M.can('accounting')&&!M.can('settings')&&!M.can('reports'),'الكاشير: البيع والورديات فقط');
throws(function(){M.saveUser({name:'ثالث',pin:'5555'});},/للمالك فقط/,'الكاشير لا يدير المستخدمين');
var t3=M.sale({lines:[{pid:p.id,name:p.name,qty:1,price:2300,rate:15}],pays:[{m:'cash',amt:2300}]});ok(t3.by==='كاشير'&&M.byId(S.journals,t3.jid).by==='كاشير','الفاتورة والقيد باسم الكاشير');
ok(M.shiftSummary().byUser['كاشير']===2300,'مبيعات الوردية حسب المستخدم');
M.logout();M.login('9999');throws(function(){M.removeUser(ow.id);},/المالك الوحيد/,'لا يُحذف المالك الوحيد');
M.saveUser({id:ca.id,name:'كاشير',role:'cashier',pin:'4321'});M.logout();throws(function(){M.login('1234');},/غير صحيح/,'تغيير الرمز يلغي القديم');M.login('4321');M.logout();M.login('9999');
var keepUsers=S.users.length;M.reset(true);ok(M.state.users.length===keepUsers,'حذف البيانات يُبقي المستخدمين');S=M.state;

// ═══ قارئ الباركود ═══
var EAN_L=['3211','2221','2122','1411','1132','1231','1114','1312','1213','3112'],PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function widthsToBits(ws,startDark){var b=[],d=startDark;ws.forEach(function(w){for(var i=0;i<w;i++)b.push(d?1:0);d=!d;});return b;}
function ean13(code){var f=+code[0],bits=[1,0,1];for(var i=1;i<=6;i++){var w=EAN_L[+code[i]].split('').map(Number);if(PAR[f][i-1]==='G')w=w.reverse();bits=bits.concat(widthsToBits(w,false));}bits=bits.concat([0,1,0,1,0]);for(i=7;i<=12;i++)bits=bits.concat(widthsToBits(EAN_L[+code[i]].split('').map(Number),true));return bits.concat([1,0,1]);}
function ean8(code){var bits=[1,0,1];for(var i=0;i<4;i++)bits=bits.concat(widthsToBits(EAN_L[+code[i]].split('').map(Number),false));bits=bits.concat([0,1,0,1,0]);for(i=4;i<8;i++)bits=bits.concat(widthsToBits(EAN_L[+code[i]].split('').map(Number),true));return bits.concat([1,0,1]);}
var seed=3;function rnd(){seed=(seed*9301+49297)%233280;return seed/233280;}
function image(bits,mod,w,h,rev){var g=new Uint8Array(w*h),x0=(w-bits.length*mod)/2;for(var y=0;y<h;y++)for(var x=0;x<w;x++){var u=(x-x0)/mod,a=Math.floor(u),fr=u-a,v1=bits[a]===1,v2=bits[a+1]===1;var dark=(a>=0&&a<bits.length)?(v1?1-fr:0)+(v2?fr:0):0;dark=Math.min(1,dark);var val=200-dark*170+(rnd()-0.5)*50;g[y*w+(rev?w-1-x:x)]=Math.max(0,Math.min(255,val));}return g;}
function check13(c){for(var d=0;d<10;d++)if(M.eanCheck(c+d))return c+d;}
var code=check13('628100000040');ok(code==='6281000000403'&&M.eanCheck('4006381333931')&&!M.eanCheck('4006381333932'),'رقم الفحص');
ok(M.scanBarcode(image(ean13(code),2.6,400,60),400,60)===code,'EAN-13 من صورة بعرض 2.6 بكسل للوحدة مع تشويش');
ok(M.scanBarcode(image(ean13(code),3.3,480,60,true),480,60)===code,'ومقلوبة');
var c2=check13('000012345678');ok(M.scanBarcode(image(ean13(c2),2.2,320,40),320,40)===c2,'UPC-A يُقرأ EAN-13 بصفر في أوله');
var e8='9638507';for(var d=0;d<10;d++)if(M.eanCheck(e8+d)){e8+=d;break;}
ok(M.scanBarcode(image(ean8(e8),3,300,40),300,40)===e8,'EAN-8');
var flat=new Uint8Array(300*40);for(var i=0;i<flat.length;i++)flat[i]=128+(rnd()-0.5)*30;ok(M.scanBarcode(flat,300,40)===null,'صورة بلا باركود: لا شيء');
var bad=ean13(code);bad[50]=1-bad[50];bad[51]=1-bad[51];ok(M.scanBarcode(image(bad,3,400,40),400,40)!==code,'باركود تالف لا يُقرأ رقماً خاطئاً');
var up=M.saveProduct({name:'علبة',price:500,cost:300,barcode:c2.slice(1)});ok(M.productByBarcode(c2)===up,'الصنف المسجل بـ UPC-A يُطابق القراءة');

// ═══ ترقية بيانات 1.0 ═══
var old={app:'mizan-lite',version:'1.0.0',state:{v:1,setup:true,settings:{name:'قديم',vatRate:15},accounts:[{code:'1101',name:'الصندوق',type:'A'},{code:'3101',name:'رأس المال',type:'E'}],journals:[],products:[],docs:[],vouchers:[],parties:[]}};
M.importJSON(JSON.stringify(old));ok(Array.isArray(M.state.users)&&Array.isArray(M.state.shifts)&&M.account('5210')&&M.state.settings.requireShift===false,'نسخة 1.0 تُرقّى: المستخدمون والورديات والحساب الجديد');
M.init();M.loadDemo();var bc=M.state.products.filter(function(p){return p.barcode;});ok(bc.length>10&&bc.every(function(p){return M.eanCheck(p.barcode);}),'باركود الأصناف التجريبية صحيح (رقم فحص EAN-13)');
console.log((process.exitCode?'FAILED':'PASS'),n,'فحصاً');
