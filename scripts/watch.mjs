// Controleert het openbare woningaanbod van Dak (Regio Amsterdam) en meldt nieuwe
// advertenties van Lieven de Key via ntfy (push) en e-mail.
import { chromium } from "playwright-core";
import nodemailer from "nodemailer";
import fs from "node:fs";
import { matches, message } from "./filter.mjs";

const PAGE_URL = "https://amsterdam.mijndak.nl/Woningaanbod";
const API_MATCH = "DataActionHaalUitgelogdAanbod";
const STATE_FILE = "state/seen.json";

const MAIL_TO = process.env.MAIL_ADDRESS;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const TEST = process.env.TEST_NOTIFICATION === "true";

async function notify(title, body) {
  const results = [];
  if (NTFY_TOPIC) {
    try {
      const r = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
        method: "POST",
        headers: { Title: title, Priority: "5", Tags: "house", Click: PAGE_URL },
        body,
      });
      results.push(`ntfy ${r.status}`);
    } catch (e) { results.push(`ntfy fout: ${e.message}`); }
  } else results.push("ntfy overgeslagen (NTFY_TOPIC ontbreekt)");
  if (GMAIL_APP_PASSWORD && MAIL_TO) {
    try {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user: MAIL_TO, pass: GMAIL_APP_PASSWORD } });
      await t.sendMail({ from: MAIL_TO, to: MAIL_TO, subject: title, text: `${body}\n\n${PAGE_URL}` });
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
page.on("response", async (r) => {
  if (!r.url().includes(API_MATCH)) return;
  try {
    const json = await r.json();
    apiCalls++;
    for (const p of json?.data?.PublicatieLijst?.List || []) items.set(String(p.Id), p);
  } catch {}
});
await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
try {
  await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 });
  const box = page.locator("input[type=search], input[type=text]").first();
  await box.fill("amsterdam");
  await page.getByText("Zoek", { exact: true }).first().click();
  await page.waitForTimeout(4000);
} catch {}
await browser.close();

if (!apiCalls) {
  console.error("FOUT: de site gaf geen aanbod-antwoord. Mogelijk is de site veranderd of geblokkeerd.");
  process.exit(1);
}

const seen = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { ids: [] };
const known = new Set(seen.ids);
const all = [...items.values()];
console.log(`Aanbod opgehaald: ${all.length} advertentie(s), ${all.filter(matches).length} passend. Eerder gezien: ${known.size}.`);

const fresh = all.filter((p) => matches(p) && !known.has(String(p.Id)));
for (const p of fresh) {
  console.log("NIEUW (volledige gegevens voor controle):", JSON.stringify(p));
  const { title, body } = message(p);
  const sent = await notify(title, body);
  if (sent) known.add(String(p.Id)); // alleen onthouden als de melding echt is verstuurd
}
fs.mkdirSync("state", { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify({ ids: [...known].sort() }, null, 2) + "\n");
