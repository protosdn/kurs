var VERSION = "10";

/* Резервні курси НБУ — якщо не вдалося завантажити ні rates.json, ні API Нацбанку */
var FALLBACK_DATE = "10.11.2026";
var FALLBACK = {
  USD:[45.4123,"Долар США"], EUR:[50.8152,"Євро"], GBP:[60.9233,"Фунт стерлінгів"],
  PLN:[11.5861,"Польський злотий"], CHF:[55.4917,"Швейцарський франк"],
  CZK:[2.0869,"Чеська крона"], CAD:[32.2334,"Канадський долар"],
  AUD:[31.3306,"Австралійський долар"], JPY:[0.28745,"Японська єна"],
  CNY:[6.8100,"Китайський юань"], SEK:[4.6205,"Шведська крона"],
  RON:[9.5126,"Румунський лей"], HUF:[0.139994,"Угорський форинт"],
  MDL:[2.5240,"Молдовський лей"], TRY:[0.9050,"Турецька ліра"]
};
var MAIN = ["USD","EUR","PLN","GBP","CHF","CZK","CAD","AUD","JPY","CNY","SEK","NOK","DKK","RON","HUF","MDL","TRY"];
var K_PAIR = "kurs-pair-v1", K_MODE = "kurs-mode-v1", K_SRC = "kurs-src-v1", K_SIDE = "kurs-side-v1";
var SIDE_NAME = { buy:"купівля", sell:"продаж" };
var side = "auto";

var DATA = { nbu:null, banks:[], updated:null, stale:false };
var srcId = "nbu", expr = "", done = false;

function $(id){ return document.getElementById(id); }
function fmt(x,d){ return x.toLocaleString("uk-UA",{minimumFractionDigits:d,maximumFractionDigits:d}); }
function money(x){ return fmt(x, (Math.abs(x) < 1 && x !== 0) ? 4 : 2); }
function store(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function recall(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

/* ---------- джерела ---------- */
function bank(){
  if(srcId === "nbu") return null;
  for(var i=0;i<DATA.banks.length;i++) if(DATA.banks[i].id === srcId) return DATA.banks[i];
  return null;
}
function nameOf(c){
  if(c === "UAH") return "Українська гривня";
  return (DATA.nbu && DATA.nbu.names && DATA.nbu.names[c]) || c;
}
function codeOrder(a,b){
  var ia = MAIN.indexOf(a), ib = MAIN.indexOf(b);
  if(ia>-1 && ib>-1) return ia-ib;
  if(ia>-1) return -1; if(ib>-1) return 1;
  return a.localeCompare(b);
}
function codes(){
  var b = bank();
  if(b) return ["UAH"].concat(Object.keys(b.pairs).sort(codeOrder));
  var r = DATA.nbu ? Object.keys(DATA.nbu.rates) : [];
  return ["UAH"].concat(r.filter(function(c){ return c !== "UAH"; }).sort(codeOrder));
}

/* Переведення суми. Для банку: ти продаєш валюту — банк купує (buy);
   ти купуєш валюту — банк продає (sell). */
function convert(v, from, to){
  if(from === to) return { value:v, note:"та сама валюта" };
  var b = bank();
  if(!b){
    if(!DATA.nbu) return null;
    var rf = from === "UAH" ? 1 : DATA.nbu.rates[from];
    var rt = to === "UAH" ? 1 : DATA.nbu.rates[to];
    if(!rf || !rt) return null;
    var k = rf/rt;
    return {
      value: v*k,
      note: "1 " + from + " = " + fmt(k,4) + " " + to + " · 1 " + to + " = " + fmt(1/k,4) + " " + from
    };
  }
  if(from === "UAH"){
    var p = b.pairs[to];
    if(!p) return null;
    var sp = (side === "auto") ? "sell" : side;
    return { value: v/p[sp], note: "<em>" + SIDE_NAME[sp] + "</em> " + fmt(p[sp],4) + " ₴ за 1 " + to };
  }
  if(to === "UAH"){
    var q = b.pairs[from];
    if(!q) return null;
    var sq = (side === "auto") ? "buy" : side;
    return { value: v*q[sq], note: "<em>" + SIDE_NAME[sq] + "</em> " + fmt(q[sq],4) + " ₴ за 1 " + from };
  }
  var a = b.pairs[from], z = b.pairs[to];
  if(!a || !z) return null;
  var sa = (side === "auto") ? "buy" : side, sz = (side === "auto") ? "sell" : side;
  return {
    value: v*a[sa]/z[sz],
    note: "через гривню: " + from + " <em>" + SIDE_NAME[sa] + "</em> " + fmt(a[sa],4) +
          " · " + to + " <em>" + SIDE_NAME[sz] + "</em> " + fmt(z[sz],4)
  };
}

/* ---------- завантаження ---------- */
function applyFallback(){
  var rates = { UAH:1 }, names = { UAH:"Українська гривня" };
  for(var c in FALLBACK){ rates[c] = FALLBACK[c][0]; names[c] = FALLBACK[c][1]; }
  DATA = { nbu:{ date:FALLBACK_DATE, rates:rates, names:names }, banks:[], updated:null, stale:true };
}
function fromNbuApi(d){
  var rates = { UAH:1 }, names = { UAH:"Українська гривня" };
  for(var i=0;i<d.length;i++){
    var x = d[i];
    if(x.cc && typeof x.rate === "number" && x.rate > 0){ rates[x.cc] = x.rate; names[x.cc] = x.txt || x.cc; }
  }
  if(Object.keys(rates).length < 5) return null;
  return { date: d[0].exchangedate || null, rates:rates, names:names };
}
function load(){
  $("whenLine").textContent = "завантаження…";
  fetch("rates.json?t=" + Date.now(), { cache:"no-store" })
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(j){
      if(!j || !j.nbu || !j.nbu.rates) throw 0;
      if(!j.nbu.rates.UAH) j.nbu.rates.UAH = 1;
      if(!j.nbu.names) j.nbu.names = {};
      j.nbu.names.UAH = "Українська гривня";
      DATA = { nbu:j.nbu, banks:Array.isArray(j.banks) ? j.banks : [], updated:j.updated || null, stale:false };
      render();
    })
    .catch(function(){
      /* rates.json ще не створений або недоступний — беремо курс НБУ напряму */
      fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json", { cache:"no-store" })
        .then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(function(d){
          var n = Array.isArray(d) && d.length ? fromNbuApi(d) : null;
          if(!n) throw 0;
          DATA = { nbu:n, banks:[], updated:null, stale:false };
          render();
        })
        .catch(function(){ applyFallback(); render(); });
    });
}

/* ---------- інтерфейс ---------- */
function fillSrc(){
  var sel = $("src");
  sel.innerHTML = "";
  var opts = [["nbu","НБУ · офіційний"]];
  DATA.banks.forEach(function(b){ opts.push([b.id, b.name]); });
  opts.forEach(function(o){
    var el = document.createElement("option");
    el.value = o[0]; el.textContent = o[1];
    sel.appendChild(el);
  });
  var ok = false;
  for(var i=0;i<opts.length;i++) if(opts[i][0] === srcId) ok = true;
  if(!ok) srcId = "nbu";
  sel.value = srcId;
}
function fillPair(){
  var cs = codes(), pair = ["USD","UAH"];
  var saved = (recall(K_PAIR) || "").split("|");
  if(saved.length === 2) pair = saved;
  ["from","to"].forEach(function(id,i){
    var sel = $(id), keep = sel.value || pair[i];
    sel.innerHTML = "";
    cs.forEach(function(c){
      var o = document.createElement("option");
      o.value = c; o.textContent = c; o.title = nameOf(c);
      sel.appendChild(o);
    });
    if(cs.indexOf(keep) > -1) sel.value = keep;
    else sel.value = (i === 0) ? (cs.indexOf("USD") > -1 ? "USD" : cs[1] || cs[0]) : "UAH";
  });
}
function whenText(){
  var b = bank();
  if(b){
    var t = DATA.updated ? new Date(DATA.updated) : null;
    return "курс банку" + (t ? ", оновлено " + t.toLocaleString("uk-UA",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"}) : "");
  }
  var d = DATA.nbu && DATA.nbu.date ? DATA.nbu.date : "—";
  return "офіційний курс на <b" + (DATA.stale ? " class='stale'" : "") + ">" + d + (DATA.stale ? " (збережений)" : "") + "</b>";
}

/* Зменшує кегль, поки число не вміститься в рядок — інакше довгі суми обрізаються */
function fit(el, max, min){
  el.style.fontSize = max + "px";
  var s = max;
  while(el.scrollWidth > el.clientWidth && s > min){ s -= 1; el.style.fontSize = s + "px"; }
}

function show(){
  var ex = $("expr");
  ex.textContent = expr.replace(/\./g, ",");
  /* тримаємо видимим кінець виразу */
  ex.scrollLeft = ex.scrollWidth;
  var v = compute(expr);
  var from = $("from").value, to = $("to").value;

  if(v === null){ $("val").textContent = "0"; v = 0; }
  else if(isNaN(v) || !isFinite(v)){
    $("val").textContent = "—"; $("conv").textContent = "—"; $("xrate").textContent = "";
    fit($("val"),36,18); fit($("conv"),28,15); return;
  }
  else $("val").textContent = money(v);
  fit($("val"), 36, 18);

  var c = convert(v, from, to);
  if(!c){
    $("conv").textContent = "—";
    fit($("conv"), 28, 15);
    $("xrate").innerHTML = "цей банк не дає курсу для " + (bank() && !bank().pairs[from] ? from : to);
    return;
  }
  $("conv").textContent = money(c.value);
  fit($("conv"), 28, 15);
  $("xrate").innerHTML = c.note;
}

function drawTable(){
  var tb = $("tbl"), b = bank(), rows = "";
  $("rTitle").textContent = b ? b.name : "Офіційний курс НБУ";
  if(b){
    rows = "<tr><th>Валюта</th><th class='r'>Купівля</th><th class='r'>Продаж</th></tr>";
    Object.keys(b.pairs).sort(codeOrder).forEach(function(c){
      var p = b.pairs[c];
      rows += "<tr><td class='c'>"+c+"</td><td class='v r'>"+fmt(p.buy,2)+" ₴</td><td class='v r'>"+fmt(p.sell,2)+" ₴</td></tr>";
    });
    $("rNote").innerHTML = "Купівля — скільки банк платить за вашу валюту, продаж — скільки ви платите за неї. " +
      "Готівковий курс різниться навіть між відділеннями одного банку, тому це орієнтир, а не каса. " +
      "Дані оновлюються щогодини.";
  } else {
    rows = "<tr><th>Валюта</th><th></th><th class='r'>Курс</th></tr>";
    codes().forEach(function(c){
      if(c === "UAH") return;
      var r = DATA.nbu.rates[c];
      if(!r) return;
      rows += "<tr><td class='c'>"+c+"</td><td class='n'>"+nameOf(c)+"</td><td class='v r'>"+fmt(r,4)+" ₴</td></tr>";
    });
    $("rNote").innerHTML = "Скільки гривень коштує одна одиниця валюти за курсом Національного банку. " +
      "Джерело — <a href='https://bank.gov.ua' target='_blank' rel='noopener'>bank.gov.ua</a>. " +
      "У касах банків курс купівлі й продажу інший — вибери банк у списку вгорі.";
  }
  tb.innerHTML = rows;
}

function setSide(s, remember){
  side = s;
  $("sideAuto").classList.toggle("on", s === "auto");
  $("sideBuy").classList.toggle("on", s === "buy");
  $("sideSell").classList.toggle("on", s === "sell");
  if(remember) store(K_SIDE, s);
  show();
}

function render(){
  fillSrc(); fillPair();
  document.body.classList.toggle("bankmode", !!bank());
  $("whenLine").innerHTML = whenText();
  show();
  if($("rates").style.display === "block") drawTable();
}

/* ---------- обчислення ---------- */
/* Рахує підряд, зліва направо, як кишеньковий калькулятор:
   12−2×9 = 90 (12−2 = 10, потім ×9).
   Відсоток: 200−10% = 180, 200×10% = 20. */
function compute(s){
  s = s.replace(/×/g,"*").replace(/÷/g,"/").replace(/−/g,"-");
  var t = s.match(/\d*\.?\d+%?|[*\/+\-]/g);
  if(!t) return null;
  while(t.length && /^[*\/+\-]$/.test(t[t.length-1])) t.pop();
  if(!t.length) return null;
  if(/^[*\/+\-]$/.test(t[0])){ if(t[0] === "-") t.unshift("0"); else t.shift(); }
  if(!t.length) return null;

  var first = parseFloat(t[0]);
  if(isNaN(first)) return null;
  var res = (t[0].indexOf("%") > -1) ? first/100 : first;

  for(var i=1;i<t.length;i+=2){
    var op = t[i], tok = t[i+1];
    if(tok === undefined) break;
    var v = parseFloat(tok);
    if(isNaN(v)) break;
    var pct = tok.indexOf("%") > -1;
    if(op === "+")      res += pct ? res*v/100 : v;
    else if(op === "-") res -= pct ? res*v/100 : v;
    else if(op === "*") res *= pct ? v/100 : v;
    else {
      var d = pct ? v/100 : v;
      if(d === 0) return NaN;
      res /= d;
    }
  }
  return res;
}

function tail(){ return expr.slice(-1); }
function isOp(c){ return c !== "" && "+−×÷".indexOf(c) > -1; }
function curNum(){ var m = expr.match(/[\d.]*$/); return m ? m[0] : ""; }

function press(k){
  if(k === "C"){ expr = ""; done = false; show(); return; }
  if(k === "back"){ expr = expr.slice(0,-1); done = false; show(); return; }
  if(k === "="){
    var v = compute(expr);
    if(v !== null && !isNaN(v) && isFinite(v)){ expr = String(parseFloat(v.toFixed(6))); done = true; }
    show(); return;
  }
  if(/[0-9]/.test(k)){ if(done){ expr = ""; done = false; } expr += k; show(); return; }
  if(k === "."){
    if(done){ expr = ""; done = false; }
    if(curNum().indexOf(".") > -1) return;
    if(curNum() === "") expr += "0";
    expr += "."; show(); return;
  }
  if(k === "%"){
    if(curNum() === "" || curNum() === ".") return;
    expr += "%"; done = false; show(); return;
  }
  if(isOp(k)){
    done = false;
    if(expr === ""){ if(k === "−"){ expr = "−"; show(); } return; }
    if(isOp(tail()) || tail() === ".") expr = expr.slice(0,-1);
    expr += k; show(); return;
  }
}

/* Натиск на pointerdown скасовує стандартний жест:
   інакше два тапи поспіль iOS читає як подвійний тап і масштабує екран. */
document.querySelectorAll(".pad button").forEach(function(b){
  if(window.PointerEvent){
    b.addEventListener("pointerdown", function(e){
      if(e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); press(b.dataset.k);
    });
  } else {
    var viaTouch = false;
    b.addEventListener("touchstart", function(e){ e.preventDefault(); viaTouch = true; press(b.dataset.k); }, {passive:false});
    b.addEventListener("click", function(){ if(viaTouch){ viaTouch = false; return; } press(b.dataset.k); });
  }
});
(function(){
  var last = 0;
  document.addEventListener("touchend", function(e){
    var t = Date.now(), tag = e.target.tagName;
    if(t - last < 400 && tag !== "SELECT" && tag !== "INPUT" && tag !== "A") e.preventDefault();
    last = t;
  }, {passive:false});
})();
document.addEventListener("keydown", function(e){
  var m = {"/":"÷","*":"×","-":"−","+":"+","=":"=","Enter":"=","Backspace":"back","Escape":"C"};
  if(/^[0-9]$/.test(e.key)) press(e.key);
  else if(e.key === "." || e.key === ",") press(".");
  else if(e.key === "%") press("%");
  else if(m[e.key]){ e.preventDefault(); press(m[e.key]); }
});

function setMode(m, remember){
  var calc = (m === "calc");
  document.body.classList.toggle("calc", calc);
  $("modeCalc").classList.toggle("on", calc);
  $("modeCur").classList.toggle("on", !calc);
  if(remember) store(K_MODE, m);
  show();
}
$("modeCur").addEventListener("click", function(){ setMode("cur", true); });
$("modeCalc").addEventListener("click", function(){ setMode("calc", true); });

$("src").addEventListener("change", function(){
  srcId = this.value;
  store(K_SRC, srcId);
  fillPair();
  document.body.classList.toggle("bankmode", !!bank());
  $("whenLine").innerHTML = whenText();
  show();
  if($("rates").style.display === "block") drawTable();
});
$("sideAuto").addEventListener("click", function(){ setSide("auto", true); });
$("sideBuy").addEventListener("click", function(){ setSide("buy", true); });
$("sideSell").addEventListener("click", function(){ setSide("sell", true); });
$("ratesBtn").addEventListener("click", function(){
  var box = $("rates"), open = box.style.display === "block";
  box.style.display = open ? "none" : "block";
  this.textContent = open ? "Курси" : "Сховати";
  if(!open) drawTable();
});
$("reloadBtn").addEventListener("click", load);
$("swapBtn").addEventListener("click", function(){
  var f = $("from").value; $("from").value = $("to").value; $("to").value = f;
  store(K_PAIR, $("from").value + "|" + $("to").value);
  show();
});
["from","to"].forEach(function(id){
  $(id).addEventListener("change", function(){
    store(K_PAIR, $("from").value + "|" + $("to").value);
    show();
  });
});

var verEl = document.querySelector(".ver");
if(verEl) verEl.textContent = "версія " + VERSION;

srcId = recall(K_SRC) || "nbu";
var sv = recall(K_SIDE);
setSide(sv === "buy" || sv === "sell" ? sv : "auto", false);
setMode(recall(K_MODE) === "calc" ? "calc" : "cur", false);
applyFallback();
render();
load();
