/**
 * Збирає курси та кладе їх у rates.json поруч зі сторінкою.
 * Запускається у GitHub Actions щогодини — на сервері, тому CORS тут не діє
 * і доступні джерела, які браузер напряму не пустить.
 *
 * Якщо якесь джерело не відповіло, його попередні дані зберігаються,
 * щоб один збій не стирав банк із таблиці.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "rates.json";
const WANT = ["USD", "EUR", "PLN", "GBP", "CHF"];
const MONO_CODES = { 840: "USD", 978: "EUR", 985: "PLN", 826: "GBP", 756: "CHF" };

const prev = (() => {
  try { return JSON.parse(readFileSync(OUT, "utf8")); }
  catch { return { nbu: null, banks: [] }; }
})();

async function get(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "kurs-kalkulyator/1.0 (+https://protosdn.github.io/kurs/)" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      console.warn(`${label}: спроба ${attempt} не вдалася — ${e.message}`);
      if (attempt === 3) return null;
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
}

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ---------- НБУ: офіційний курс ---------- */
async function nbu() {
  const d = await get("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json", "НБУ");
  if (!Array.isArray(d) || !d.length) return prev.nbu;
  const rates = {}, names = {};
  for (const x of d) {
    const r = num(x.rate);
    if (x.cc && r) { rates[x.cc] = r; names[x.cc] = x.txt || x.cc; }
  }
  if (Object.keys(rates).length < 5) return prev.nbu;
  return { date: d[0].exchangedate || null, rates, names };
}

/* ---------- Банки ---------- */
function keepPrev(id) {
  return prev.banks?.find((b) => b.id === id) || null;
}

async function privat(coursid, id, name) {
  const d = await get(
    `https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=${coursid}`,
    name
  );
  if (!Array.isArray(d) || !d.length) return keepPrev(id);
  const pairs = {};
  for (const x of d) {
    if (x.base_ccy !== "UAH" || !WANT.includes(x.ccy)) continue;
    const buy = num(x.buy), sell = num(x.sale);
    if (buy && sell) pairs[x.ccy] = { buy, sell };
  }
  if (!Object.keys(pairs).length) return keepPrev(id);
  return { id, name, pairs };
}

async function mono() {
  const id = "mono", name = "monobank · картка";
  const d = await get("https://api.monobank.ua/bank/currency", name);
  if (!Array.isArray(d) || !d.length) return keepPrev(id);
  const pairs = {};
  for (const x of d) {
    if (x.currencyCodeB !== 980) continue;
    const code = MONO_CODES[x.currencyCodeA];
    if (!code) continue;
    const buy = num(x.rateBuy) || num(x.rateCross);
    const sell = num(x.rateSell) || num(x.rateCross);
    if (buy && sell) pairs[code] = { buy, sell };
  }
  if (!Object.keys(pairs).length) return keepPrev(id);
  return { id, name, pairs };
}

/**
 * Агрегатор Minfin — підключається, лише якщо в репозиторії заданий секрет
 * MINFIN_TOKEN. Через нього доступні банки без власних API:
 * Ощадбанк, Райффайзен, ПУМБ, Укрсиббанк.
 */
const MINFIN_BANKS = {
  oschad: "Ощадбанк",
  raiffeisen: "Райффайзен Банк",
  pumb: "ПУМБ",
  ukrsibbank: "Укрсиббанк",
};
async function minfin() {
  const token = process.env.MINFIN_TOKEN;
  if (!token) return [];
  const out = [];
  for (const [slug, title] of Object.entries(MINFIN_BANKS)) {
    const id = "minfin-" + slug;
    const pairs = {};
    for (const code of ["usd", "eur", "pln", "gbp"]) {
      const d = await get(`https://api.minfin.com.ua/exchrates/${token}/${code}/`, title);
      const row = Array.isArray(d) ? d.find((x) => (x.slug || x.bank || "") === slug) : null;
      const buy = num(row?.bid ?? row?.buy), sell = num(row?.ask ?? row?.sale);
      if (buy && sell) pairs[code.toUpperCase()] = { buy, sell };
    }
    out.push(Object.keys(pairs).length ? { id, name: title, pairs } : keepPrev(id));
  }
  return out.filter(Boolean);
}

/* ---------- Збірка ---------- */
const [official, privatCash, privatCard, monoBank, aggregated] = await Promise.all([
  nbu(),
  privat(5, "privat-cash", "ПриватБанк · каса"),
  privat(11, "privat-card", "ПриватБанк · картка"),
  mono(),
  minfin(),
]);

if (!official) {
  console.error("Немає курсу НБУ й немає попередніх даних — файл не перезаписую.");
  process.exit(1);
}

const banks = [privatCash, privatCard, monoBank, ...aggregated].filter(Boolean);

const next = {
  updated: new Date().toISOString(),
  nbu: official,
  banks,
};

const stable = (o) => JSON.stringify({ ...o, updated: null });
if (stable(next) === stable(prev)) {
  console.log("Курси не змінилися — коміту не буде.");
  writeFileSync("/tmp/unchanged", "1");
} else {
  writeFileSync(OUT, JSON.stringify(next, null, 1) + "\n");
  console.log(`Записано: НБУ на ${official.date}, банків — ${banks.length}`);
  for (const b of banks) console.log(`  ${b.name}: ${Object.keys(b.pairs).join(", ")}`);
}
