// Eenmalige verkenning van het huuraanbod van Rebo: welke aanvragen doet de pagina en hoe zien de woningen eruit.
import { chromium } from "playwright-core";
const URL = process.env.URL || "https://www.rebogroep.nl/particulier/ons-aanbod/huren?page=1";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", viewport: { width: 1400, height: 1000 } });
page.on("response", async (r) => {
  const ct = r.headers()["content-type"] || "";
  if (!/json/.test(ct) && !/api|graphql|search|aanbod|woning|object/i.test(r.url())) return;
  let body = "";
  try { body = (await r.text()).slice(0, 1500); } catch {}
  console.log(`AANVRAAG ${r.request().method()} ${r.status()} ${r.url().slice(0, 300)} | ${ct}\n  ${body.replace(/\s+/g, " ")}`);
});
const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
console.log("status", resp?.status(), page.url());
await page.waitForTimeout(4000);
for (const name of [/accepteer|alles toestaan|akkoord|accept/i]) { try { await page.getByRole("button", { name }).first().click({ timeout: 2000 }); await page.waitForTimeout(2000); } catch {} }
const text = await page.innerText("body");
console.log("PAGINATEKST:\n" + text.slice(0, 6000));
const links = await page.$$eval("a[href]", (as) => as.map((a) => `${(a.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120)} -> ${a.href}`));
console.log("LINKS:\n" + links.filter((l) => /huur|aanbod|woning|object|page=/i.test(l)).slice(0, 120).join("\n"));
await browser.close();
