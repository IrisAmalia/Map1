// Ingelogd aanbod van Dak. Een ingelogde woningzoekende ziet nieuwe woningen soms uren eerder dan de openbare lijst
// (op 12 november: gepubliceerd om 00:01, openbaar pas na 03:14). Ingelogd toont Dak het "passend aanbod":
// de woningen waarop jij volgens je profiel mag reageren.
// Geeft { items: Map id -> advertentie, context } of null als inloggen of ophalen mislukte.
const LOGIN_URL = "https://amsterdam.mijndak.nl/Inloggen";
const API_MATCH = "DataActionHaalPassendAanbod";

export async function loggedInListings(browser, user, pass) {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0", viewport: { width: 1400, height: 1000 } });
  const items = new Map();
  let calls = 0;
  try {
    const page = await context.newPage();
    page.on("response", async (r) => {
      if (!r.url().includes(API_MATCH)) return;
      try {
        const list = (await r.json())?.data?.PublicatieLijst?.List || [];
        calls++;
        for (const p of list) items.set(String(p.Id), p);
      } catch {}
    });
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45000 });
    try { await page.getByRole("button", { name: /alles afwijzen/i }).click({ timeout: 2000 }); } catch {}
    await page.locator("#Input_UsernameVal").fill(user);
    await page.locator("#Input_PasswordVal").fill(pass);
    await page.locator("#Input_PasswordVal").press("Enter");
    // Na het inloggen opent Dak het woningoverzicht en haalt het passend aanbod op.
    const t0 = Date.now();
    while (!calls && Date.now() - t0 < 30000) await page.waitForTimeout(500);
    if (!calls) {
      console.log(`Ingelogd aanbod: niet opgehaald (pagina ${page.url()}).`);
      await context.close();
      return null;
    }
    await page.waitForTimeout(1500); // eventueel een tweede pagina met resultaten
    await page.close();
    return { items, context };
  } catch (e) {
    console.log(`Ingelogd aanbod: fout bij inloggen: ${e.message.split("\n")[0]}`);
    await context.close().catch(() => {});
    return null;
  }
}
