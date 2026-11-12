// Eenmalige controle: ziet een ingelogde woningzoekende op Dak meer (of eerder) woningen dan de openbare lijst?
// Logt in met DAK_USER / DAK_PASS (GitHub-geheimen) en vergelijkt beide lijsten. Verstuurt niets en bewaart niets.
// In het logboek komen alleen veldnamen, adressen en aantallen, nooit de inloggegevens.
import { chromium } from "playwright-core";

const PAGE_URL = "https://amsterdam.mijndak.nl/Woningaanbod";
const USER = process.env.DAK_USER || "";
const PASS = process.env.DAK_PASS || "";
if (!USER || !PASS) {
  console.error(`FOUT: DAK_USER ${USER ? "gevonden" : "ONTBREEKT"}, DAK_PASS ${PASS ? "gevonden" : "ONTBREEKT"}. Zet ze als repository secret onder Settings > Secrets and variables > Actions > tabblad Secrets.`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome" });

// Laadt het aanbod in een context en geeft Map id -> advertentie, plus welke DataAction-aanroepen er waren.
async function collect(context, label) {
  const page = await context.newPage();
  const items = new Map();
  const actions = new Map();
  page.on("response", async (r) => {
    const m = r.url().match(/screenservices\/[^?]*\/(DataAction\w+|ServiceAPI\w+|Action\w+)/);
    if (!m) return;
    let n = "";
    try {
      const json = await r.json();
      const list = json?.data?.PublicatieLijst?.List;
      if (Array.isArray(list)) { for (const p of list) items.set(String(p.Id), p); n = `${list.length} advertentie(s)`; }
    } catch {}
    actions.set(m[1], `${r.status()}${n ? ", " + n : ""}`);
  });
  for (let attempt = 1; attempt <= 3 && items.size === 0; attempt++) {
    if (attempt === 1) await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
    else await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(4000);
    try { await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 }); } catch {}
  }
  console.log(`[${label}] ${items.size} advertentie(s). Aanroepen: ${[...actions].map(([k, v]) => `${k} (${v})`).join("; ")}`);
  await page.close();
  return items;
}

const title = (p) => {
  const a = p.Adres || {};
  return [a.Straatnaam, a.Huisnummer, a.Huisletter, a.HuisnummerToevoeging].filter(Boolean).join(" ") || (p.Cluster || {}).Naam || `Advertentie ${p.Id}`;
};

// 1. Openbaar
const pub = await collect(await browser.newContext({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1000 } }), "openbaar");

// 2. Inloggen
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
try { await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 }); } catch {}
const loginTargets = await page.$$eval("a, button", (els) => els.map((e) => `${(e.innerText || "").trim().replace(/\s+/g, " ")} -> ${e.getAttribute("href") || "(knop)"}`).filter((t) => /inlog|log in|aanmeld|mijn/i.test(t)));
console.log("Inlogknoppen op de pagina:", JSON.stringify(loginTargets));
try {
  await page.getByText(/^\s*(inloggen|log in)\s*$/i).first().click({ timeout: 5000 });
} catch {
  await page.goto("https://amsterdam.mijndak.nl/Inloggen", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
}
await page.waitForTimeout(4000);
console.log("Inlogpagina:", page.url());
const fields = await page.$$eval("input", (els) => els.map((e) => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, visible: !!(e.offsetWidth || e.offsetHeight) })));
console.log("Invoervelden:", JSON.stringify(fields));
const userBox = page.locator("input[type=email]:visible, input[type=text]:visible").first();
const passBox = page.locator("input[type=password]:visible").first();
await userBox.fill(USER);
await passBox.fill(PASS);
await passBox.press("Enter");
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
const after = await page.innerText("body").catch(() => "");
const loggedIn = /uitloggen|log uit|mijn dak|mijn gegevens|welkom/i.test(after);
console.log(`Na inloggen: ${page.url()} | lijkt ingelogd: ${loggedIn ? "ja" : "nee"}`);
if (!loggedIn) console.log("Tekst op de pagina na inloggen (begin):", after.replace(/\s+/g, " ").slice(0, 600));
await page.close();

// 3. Aanbod als ingelogde gebruiker
const mine = await collect(ctx, "ingelogd");
const onlyMine = [...mine.values()].filter((p) => !pub.has(String(p.Id)));
const onlyPub = [...pub.values()].filter((p) => !mine.has(String(p.Id)));
console.log(`VERGELIJKING: openbaar ${pub.size}, ingelogd ${mine.size}, alleen ingelogd ${onlyMine.length}, alleen openbaar ${onlyPub.length}.`);
for (const p of onlyMine) console.log(`ALLEEN INGELOGD: ${p.Id} ${title(p)} | gepubliceerd ${p.PublicatieDatum} | ${(p.Eenheid || {}).Eigenaar || ""}`);
for (const p of onlyPub) console.log(`ALLEEN OPENBAAR: ${p.Id} ${title(p)}`);
const newest = [...mine.values()].sort((a, b) => String(b.PublicatieDatum).localeCompare(String(a.PublicatieDatum))).slice(0, 5);
console.log("Nieuwste 5 (ingelogd):", newest.map((p) => `${p.Id} ${title(p)} ${p.PublicatieDatum}`).join(" ;; "));
await browser.close();

// Alle woningen als losse regels, voor een overzicht van publicatietijden.
for (const [id, p] of new Map([...pub, ...mine])) {
  const e = p.Eenheid || {}, c = p.Cluster || {};
  console.log("LISTING " + JSON.stringify({
    id, title: title(p), owner: e.Eigenaar || c.Eigenaar || "", wijk: (p.Adres || {}).Wijk || "",
    rent: e.NettoHuur ?? c.PrijsMax ?? null, rooms: e.AantalKamers || c.AantalKamersMin || null,
    module: p.PublicatieModule || "", label: p.PublicatieLabel || "", contract: p.ContractVorm || "",
    published: p.PublicatieDatum || null, ends: p.EinddatumTijd || null, model: p.Model || p.ToewijzingsModel || "",
    inPublic: pub.has(id), inLoggedIn: mine.has(id),
  }));
}
