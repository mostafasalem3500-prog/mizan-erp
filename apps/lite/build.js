// يجمع المصادر في ملف واحد dist/index.html يعمل بلا إنترنت
var fs=require('fs'),path=require('path'),T=(fs.existsSync(path.join(__dirname,'node_modules'))?path.join(__dirname,'node_modules'):'/home/claude/tools/node_modules')+'/';
function r(f){return fs.readFileSync(path.join(__dirname,'src',f),'utf8');}
var css=r('style.css')
 .replace(/margin-inline-start/g,'margin-right').replace(/margin-inline-end/g,'margin-left')
 .replace(/padding-inline-start/g,'padding-right').replace(/padding-inline-end/g,'padding-left')
 .replace(/border-inline-start/g,'border-right').replace(/border-inline-end/g,'border-left')
 .replace(/inset-inline-start:5px;left:auto/g,'right:5px').replace(/inset:0;/g,'')
 .replace(/text-align:start/g,'text-align:right').replace(/text-align:end/g,'text-align:left');
if(/inline-(start|end)|[^-]inset/.test(css)) throw new Error('خاصية منطقية لم تُحوَّل');
var fonts=[400,500,700,800].map(function(w){var b=fs.readFileSync(T+'@fontsource/tajawal/files/tajawal-arabic-'+w+'-normal.woff2').toString('base64');
 return "@font-face{font-family:'Tajawal';font-style:normal;font-weight:"+w+";font-display:swap;src:url(data:font/woff2;base64,"+b+") format('woff2')}";}).join('\n');
var qr=fs.readFileSync(T+'qrcode-generator/qrcode.js','utf8');
var ui=['ui1.js','print.js','ui2.js','ui3.js','ui4.js'].map(r).join('\n');
var html='<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#14274e">\n<title>ميزان لايت</title>\n<style>\n'+fonts+'\n'+css+'\n</style>\n</head>\n<body>\n<div id="stage"><div id="app"><aside id="nav"></aside><main id="main"><header id="top"></header><section id="view"></section><nav id="tabbar"></nav></main></div></div>\n<div id="modal"></div><div id="toast" role="status" aria-live="polite"></div><div id="print-root"></div>\n<script>\n'+qr.replace(/<\/script/g,'<\\/script')+'\n</script>\n<script>\n'+r('core.js')+'\n</script>\n<script>\n(function(){\n"use strict";\n'+ui+'\n})();\n</script>\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.mkdirSync(path.join(__dirname,'preview'),{recursive:true});fs.writeFileSync(path.join(__dirname,'preview','index.html'),html.replace(', viewport-fit=cover','').replace('<title>ميزان لايت</title>','<title>ميزان لايت — معاينة</title>').replace('<div id="stage">','<script>window.MIZAN_PREVIEW=true<\/script>\n<div id="stage">'));fs.writeFileSync(path.join(__dirname,'dist','index.html'),html);
var as=path.join(__dirname,'android','app','src','main','assets');fs.mkdirSync(as,{recursive:true});fs.writeFileSync(path.join(as,'index.html'),html);
console.log('dist/index.html',Math.round(html.length/1024)+' KB');
