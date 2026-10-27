// Hulpscript (tijdelijk): open de detailpagina van een woning en laat zien waar de voorwaarden staan.
import { chromium } from "playwright-core";

const ID = process.env.PUBLICATIE_ID || "383139";
const URL = `https://amsterdam.mijndak.nl/HuisDetails?PublicatieId=${ID}`;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1400 } });
page.on("response", async (r) => {
  const u = r.url();
  if (!/screenservices/i.test(u)) return;
  if (/Menu|Onderhoud|Layout|ApplicationReady|Sitemelding|Inloggen|ApplicationTitle|Voorwaarden(Check|Geaccepteerd)|HeaderMK|SamenwerkingsverbandBy/i.test(u)) return;
  let body = "";
  try { body = await r.text(); } catch {}
  const req = r.request().postData() || "";
  console.log(`\n### ${r.request().method()} ${r.status()} ${u}\nREQ(${req.length}): ${req.slice(0, 600)}\nRES(${body.length}): ${body.slice(0, 7000)}`);
});
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(6000);
try { await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 }); } catch {}
await page.waitForTimeout(2000);
console.log(`\n[url] ${page.url()}`);
console.log("\n### ZICHTBARE TEKST VAN DE WONINGPAGINA\n" + (await page.innerText("body")).slice(0, 7000));
await browser.close();
