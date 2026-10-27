// Hulpscript: leest de spelregels van een paar woningen met dezelfde code als de melder en toont de uitkomst.
import { chromium } from "playwright-core";
import { readRules } from "./detail.mjs";
import { rulesProblem } from "./filter.mjs";

const ids = (process.env.IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const browser = await chromium.launch({ channel: "chrome" });
for (const id of ids) {
  const rules = await readRules(browser, id);
  console.log(`\n=== ${id} ===`);
  if (rules === null) { console.log("NIET TE LEZEN"); continue; }
  console.log(`Spelregels (${rules.length}):`);
  rules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  const problem = rulesProblem(rules);
  console.log(problem ? `=> OVERSLAAN wegens: ${problem}` : "=> OK: geen kind- of gezinseis");
}
await browser.close();
