// Hulpscript (tijdelijk): open een woning op de Dak-site en laat zien waar de voorwaarden staan.
import { chromium } from "playwright-core";

const PAGE_URL = "https://amsterdam.mijndak.nl/Woningaanbod";
const TARGET = process.env.TARGET || "Andoornstraat";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1000 } });
let phase = "laden";
page.on("response", async (r) => {
  const u = r.url();
  if (!/screenservices/i.test(u)) return;
  if (!/Publicatie|Woning|Detail|Voorwaard|Toewijz|Aanbod/i.test(u)) return;
  if (/HaalUitgelogdAanbod|VoorlopigePositie|Sortering|Menu|Onderhoud|Layout/i.test(u)) return;
  let body = "";
  try { body = await r.text(); } catch {}
  const req = r.request().postData() || "";
  console.log(`\\n### [${phase}] ${r.request().method()} ${r.status()} ${u}\\nREQ(${req.length}): ${req.slice(0, 1200)}\\nRES(${body.length}): ${body.slice(0, 3500)}`);
});
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`[nav] ${f.url()}`); });

await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
try {
  await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 });
  await page.locator("input[type=search], input[type=text]").first().fill("amsterdam");
  await page.getByText("Zoek", { exact: true }).first().click();
  await page.waitForTimeout(4000);
} catch {}
await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000);

phase = "zoeken";
console.log("Links met 'Woning'/'Detail' op de lijstpagina:");
const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter((h) => /Woning|Detail|Publicatie/i.test(h || "")).slice(0, 8));
console.log(JSON.stringify(hrefs));

let target = page.getByText(new RegExp(TARGET, "i")).first();
for (let i = 0; i < 12 && (await target.count()) === 0; i++) {
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(700);
  target = page.getByText(new RegExp(TARGET, "i")).first();
}
console.log(`Gevonden "${TARGET}": ${await target.count()}`);
phase = "openen";
await target.click({ timeout: 10000 });
await page.waitForTimeout(8000);
console.log(`\\n[url na klik] ${page.url()}`);
console.log("\\n### ZICHTBARE TEKST VAN DE WONINGPAGINA\\n" + (await page.innerText("body")).slice(0, 6000));
await browser.close();
