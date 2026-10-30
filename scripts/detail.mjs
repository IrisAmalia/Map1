// Leest de spelregels op de woningpagina. Dezelfde code gebruikt de melder en het controlescript.
import { parseRules, parseMinPersons, DETAIL_URL } from "./filter.mjs";

// Geeft { rules, minPersons } (spelregels, minimaal aantal personen of null) of null als de pagina niet te lezen was.
export async function readRules(browser, id) {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1400 } });
  try {
    await page.goto(`${DETAIL_URL}${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => /Nettohuur/.test(document.body.innerText) && /In het kort/.test(document.body.innerText), null, { timeout: 25000 });
    await page.waitForTimeout(1000);
    const text = await page.innerText("body");
    return { rules: parseRules(text), minPersons: parseMinPersons(text) };
  } catch (e) {
    console.log(`Spelregels van ${id} niet te lezen: ${e.message.split("\n")[0]}`);
    return null;
  } finally {
    await page.close();
  }
}
