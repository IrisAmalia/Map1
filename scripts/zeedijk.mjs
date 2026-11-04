// Controleert https://nvzeedijk.nl/m-verhuur/ en meldt via ntfy (push) en e-mail zodra er
// iets bijkomt op de pagina: nieuwe tekstregels of nieuwe links (bijv. een nieuwe woning).
// De eerste keer wordt alleen de huidige stand bewaard, zonder melding.
import { chromium } from "playwright-core";
import nodemailer from "nodemailer";
import fs from "node:fs";

const PAGE_URL = "https://nvzeedijk.nl/m-verhuur/";
const STATE_FILE = "state/zeedijk.json";

const MAIL_TO = process.env.MAIL_ADDRESS;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const TEST = process.env.TEST_NOTIFICATION === "true";
const DRY = process.env.DRY_RUN === "true"; // niets versturen of bewaren, wel alles in het logboek
const SHOW = process.env.SHOW_PAGE === "true"; // volledige paginatekst in het logboek

async function notify(title, body, url = PAGE_URL) {
  if (DRY) {
    console.log(`[PROEFMODUS, niet verstuurd] ${title}\n${body}\n${url}`);
    return false;
  }
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
  const ok = await notify("Test: NV Zeedijk-melder werkt", "Dit is een testbericht van de NV Zeedijk-melder. Zie je dit in ntfy en je mail, dan staat alles goed.");
  process.exit(ok ? 0 : 1);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", viewport: { width: 1400, height: 1000 } });
let content;
try {
  const resp = await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 60000 });
  console.log(`Pagina geladen: status ${resp?.status()}`);
  await page.waitForTimeout(3000); // ruimte voor lijsten die later worden ingeladen
  content = await page.evaluate(() => {
    // Alleen de inhoud, niet het menu, de kop, de voettekst of een cookiemelding.
    const pick = document.querySelector("main, article, .entry-content, #content, .site-content") || document.body;
    const root = pick.cloneNode(true);
    root.querySelectorAll("header, footer, nav, script, style, noscript, form, [class*=cookie], [id*=cookie], [class*=consent], [id*=consent]").forEach((n) => n.remove());
    const holder = document.createElement("div");
    holder.style.position = "absolute"; holder.style.left = "-99999px";
    holder.appendChild(root); document.body.appendChild(holder);
    const text = root.innerText;
    const links = [...root.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.href.split("#")[0], text: (a.innerText || a.title || "").trim().replace(/\s+/g, " ") }))
      .filter((l) => /^https?:/.test(l.href) && !/^(mailto|tel):/.test(l.href));
    holder.remove();
    return { text, links, title: document.title };
  });
} catch (e) {
  console.error(`FOUT: pagina niet te laden: ${e.message}`);
  await browser.close();
  process.exit(1);
}
await browser.close();

const lines = [...new Set(content.text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1))];
const links = [...new Map(content.links.map((l) => [l.href, l])).values()];
console.log(`Paginatitel: ${content.title} | ${lines.length} tekstregel(s), ${links.length} link(s) in de inhoud.`);
if (SHOW) {
  console.log("PAGINATEKST:\n" + lines.join("\n"));
  console.log("LINKS:\n" + links.map((l) => `${l.text} -> ${l.href}`).join("\n"));
}
if (lines.length < 3) {
  console.error("WAARSCHUWING: de pagina lijkt (bijna) leeg. Stand niet bijgewerkt.");
  process.exit(1);
}

const prev = !DRY && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
let save = true;
if (!prev) {
  console.log("Eerste keer: huidige stand bewaard, geen melding.");
} else {
  const oldLines = new Set(prev.lines);
  const oldLinks = new Set(prev.links.map((l) => l.href));
  const addedLines = lines.filter((l) => !oldLines.has(l));
  const removedLines = prev.lines.filter((l) => !lines.includes(l));
  const addedLinks = links.filter((l) => !oldLinks.has(l.href));
  console.log(`Nieuw: ${addedLines.length} regel(s), ${addedLinks.length} link(s). Verdwenen: ${removedLines.length} regel(s).`);
  if (addedLines.length) console.log("Nieuwe regels:", JSON.stringify(addedLines));
  if (addedLinks.length) console.log("Nieuwe links:", JSON.stringify(addedLinks));
  if (removedLines.length) console.log("Verdwenen regels:", JSON.stringify(removedLines));
  if (addedLines.length || addedLinks.length) {
    let body = addedLines.slice(0, 15).join("\n");
    if (addedLines.length > 15) body += `\n… en nog ${addedLines.length - 15} regel(s)`;
    if (addedLinks.length) body += `\n\nNieuwe link(s):\n` + addedLinks.slice(0, 5).map((l) => `${l.text || "link"}: ${l.href}`).join("\n");
    body = body.trim().slice(0, 3500);
    const target = addedLinks.length === 1 ? addedLinks[0].href : PAGE_URL;
    // Alleen opslaan als de melding echt is aangekomen; anders probeert de volgende run het opnieuw.
    save = await notify("NV Zeedijk: nieuw op de verhuurpagina", body, target);
  }
}
if (!DRY && save) {
  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lines, links }, null, 2) + "\n");
}
