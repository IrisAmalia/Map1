// Controleert het openbare woningaanbod van Dak (Regio Amsterdam) en meldt nieuwe
// advertenties van Lieven de Key via ntfy (push) en e-mail.
import { chromium } from "playwright-core";
import nodemailer from "nodemailer";
import fs from "node:fs";
import { matches, skipReason, message, describe, rulesProblem } from "./filter.mjs";
import { readRules as readRulesOf } from "./detail.mjs";

const PAGE_URL = "https://amsterdam.mijndak.nl/Woningaanbod";
const API_MATCH = "DataActionHaalUitgelogdAanbod";
const STATE_FILE = "state/seen.json";
const MAX_DETAIL_CHECKS = 12; // per run; de rest komt de volgende minuut

const MAIL_TO = process.env.MAIL_ADDRESS;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const TEST = process.env.TEST_NOTIFICATION === "true";

async function notify(title, body, url = PAGE_URL) {
  const results = [];
  if (NTFY_TOPIC) {
    try {
      const r = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
        method: "POST",
        headers: { Title: title, Priority: "5", Tags: "house", Click: url },
        body,
      });
      results.push(`ntfy ${r.status}`);
    } catch (e) { results.push(`ntfy fout: ${e.message}`); }
  } else results.push("ntfy overgeslagen (NTFY_TOPIC ontbreekt)");
  if (GMAIL_APP_PASSWORD && MAIL_TO) {
    try {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user: MAIL_TO, pass: GMAIL_APP_PASSWORD } });
      await t.sendMail({ from: MAIL_TO, to: MAIL_TO, subject: title, text: `${body}\n\n${url}` });
      results.push("e-mail verstuurd");
    } catch (e) { results.push(`e-mail fout: ${e.message}`); }
  } else results.push("e-mail overgeslagen (GMAIL_APP_PASSWORD of MAIL_ADDRESS ontbreekt)");
  console.log("Melding:", results.join(" | "));
  return results.some((r) => r === "e-mail verstuurd" || r === "ntfy 200");
}

if (TEST) {
  const ok = await notify("Test: Dak-melder werkt", "Dit is een testbericht. Zie je dit in ntfy en je mail, dan staat alles goed.");
  process.exit(ok ? 0 : 1);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1000 } });
const items = new Map();
let apiCalls = 0;
let phase = "laden";
const t0 = Date.now();
page.on("response", async (r) => {
  if (!r.url().includes(API_MATCH)) return;
  try {
    const json = await r.json();
    apiCalls++;
    const list = json?.data?.PublicatieLijst?.List || [];
    for (const p of list) items.set(String(p.Id), p);
    console.log(`API-antwoord na ${((Date.now() - t0) / 1000).toFixed(1)}s (${phase}): status ${r.status()}, ${list.length} advertentie(s), ${JSON.stringify(r.request().postData() || "").length} bytes aanvraag`);
  } catch (e) { console.log(`API-antwoord niet leesbaar (${phase}): ${e.message}`); }
});
// De site geeft de lijst soms pas bij een tweede keer laden. Probeer daarom maximaal drie keer.
for (let attempt = 1; attempt <= 3 && items.size === 0; attempt++) {
  phase = `poging ${attempt}`;
  if (attempt === 1) await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
  else await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  if (attempt === 1) {
    try {
      await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 });
      const box = page.locator("input[type=search], input[type=text]").first();
      await box.fill("amsterdam");
      await page.getByText("Zoek", { exact: true }).first().click();
      await page.waitForTimeout(4000);
    } catch {}
  }
  console.log(`Na ${phase}: ${items.size} advertentie(s) in totaal.`);
}
if (!apiCalls) {
  console.error("FOUT: de site gaf geen aanbod-antwoord. Mogelijk is de site veranderd of geblokkeerd.");
  process.exit(1);
}

// De site toont normaal ruim honderd advertenties. Blijft de lijst na drie pogingen leeg, dan is de melder blind:
// meld dat (hooguit om de 20 minuten) in plaats van stil te blijven.
if (items.size === 0) {
  console.error("WAARSCHUWING: de lijst is na drie pogingen leeg. De melder kan nu geen woningen zien.");
  if (new Date().getUTCMinutes() % 20 === 0) {
    await notify("Waarschuwing: Dak-melder ziet geen aanbod", "De lijst op de Dak-site bleef leeg, ook na opnieuw proberen. Controleer de melder op GitHub (tabblad Actions) en kijk zelf op de Dak-site.");
  }
}

const seen = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { ids: [] };
const known = new Set(seen.ids);
const rejected = new Set(seen.rejected || []); // woningen waarvan de spelregels een kindeis e.d. bevatten
const all = [...items.values()];
console.log(`Aanbod opgehaald: ${all.length} advertentie(s), ${all.filter(matches).length} passend. Eerder gezien: ${known.size}, afgekeurd op spelregels: ${rejected.size}.`);

const readRules = (id) => readRulesOf(browser, id);

// Hulpgegevens in het logboek: welke labels en doelgroepen komen voor, en wat slaan we wegens gezinsvoorrang over?
const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
console.log("Labels in aanbod:", JSON.stringify(count(all.flatMap((p) => String(p.PublicatieLabel || "(geen)").split("~")))));
console.log("Aanbieders in aanbod:", JSON.stringify(count(all.map((p) => (p.Eenheid || {}).Eigenaar || (p.Cluster || {}).Eigenaar || "(geen)"))));
console.log("Doelgroepen in aanbod:", JSON.stringify(count(all.map((p) => (p.Eenheid || {}).Doelgroep || "(geen)"))));
for (const p of all.filter((x) => skipReason(x))) {
  console.log(`Overgeslagen (${skipReason(p)}): ${describe(p).title} (${p.PublicatieLabel || "geen label"}, wijk ${(p.Adres || {}).Wijk})`);
}

const fresh = all.filter((p) => matches(p) && !known.has(String(p.Id)) && !rejected.has(String(p.Id)));
let checks = 0;
for (const p of fresh) {
  const id = String(p.Id);
  if (checks >= MAX_DETAIL_CHECKS) break; // de rest volgt de volgende minuut
  checks++;
  const rules = await readRules(id);
  const problem = rules ? rulesProblem(rules) : "";
  if (problem) {
    console.log(`Overgeslagen (spelregels: ${problem}): ${describe(p).title} [${id}] | ${rules.join(" / ")}`);
    rejected.add(id);
    continue;
  }
  console.log("NIEUW (volledige gegevens voor controle):", JSON.stringify(p));
  console.log(`Spelregels van ${id}:`, JSON.stringify(rules));
  const { title, body, url } = message(p, rules);
  const sent = await notify(title, body, url);
  if (sent) known.add(id); // alleen onthouden als de melding echt is verstuurd
}
await browser.close();

// Afgekeurde woningen die niet meer in het aanbod staan hoeven we niet te onthouden (alleen opruimen als de lijst gevuld is).
const rejectedKeep = items.size > 0 ? [...rejected].filter((id) => items.has(id)) : [...rejected];
fs.mkdirSync("state", { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify({ ids: [...known].sort(), rejected: rejectedKeep.sort() }, null, 2) + "\n");
