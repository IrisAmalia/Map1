// Hulpscript: leest de spelregels van een paar woningen met dezelfde code als de melder en toont de uitkomst.
import { chromium } from "playwright-core";
import { readRules } from "./detail.mjs";
import { rulesProblem, DETAIL_URL } from "./filter.mjs";

const ids = (process.env.IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const browser = await chromium.launch({ channel: "chrome" });
for (const id of ids) {
  const detail = await readRules(browser, id);
  console.log(`\n=== ${id} ===`);
  if (detail === null) { console.log("NIET TE LEZEN"); continue; }
  const { rules, minPersons } = detail;
  console.log(`Minimaal aantal personen: ${minPersons ?? "niet vermeld"}`);
  console.log(`Spelregels (${rules.length}):`);
  rules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  const problem = rulesProblem(rules, minPersons);
  console.log(problem ? `=> OVERSLAAN wegens: ${problem}` : "=> OK: melden");
}
// Met FULL=true ook de volledige tekst van de pagina tonen.
if (process.env.FULL === "true") {
  for (const id of ids) {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1400 } });
    await page.goto(`${DETAIL_URL}${id}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);
    console.log(`\n### VOLLEDIGE TEKST ${id}\n` + (await page.innerText("body")));
    await page.close();
  }
}
await browser.close();
