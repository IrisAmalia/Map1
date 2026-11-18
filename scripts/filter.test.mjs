import test from "node:test";
import assert from "node:assert/strict";
import { matches, message, parseRules, parseMinPersons, parseConditions, rulesProblem, expired } from "./filter.mjs";

// Gegevens zoals de site ze levert (vier echte advertenties van 8 oktober, ingekort), plus grensgevallen.
const base = (id, netto, extra = {}) => ({
  Id: String(id),
  PublicatieModule: "Sociale huur",
  ContractVorm: "Onbepaalde tijd contract",
  EinddatumTijd: "2026-10-13T21:59:00Z",
  Verdieping: "0",
  HeeftLift: false,
  Adres: { Straatnaam: "Bontekoestraat", Huisnummer: 42, Wijk: "Spaarndammerbuurt/Zeeheldenbuurt (West)", Woonplaats: "Amsterdam" },
  Cluster: { PrijsMaxBekend: false, PrijsMax: "0.0", AantalKamersMin: 0, AantalKamersMax: 0, Eigenaar: "" },
  Eenheid: { DetailSoort: "Bovenwoning", AantalKamers: 2, NettoHuurBekend: true, NettoHuur: String(netto), BrutoHuurBekend: true, Brutohuur: "939.95", EnergieLabel: "C", Eigenaar: "Eigen Haard" },
  ...extra,
});

test("de vier sociale huurwoningen van gisteravond worden niet meer gemeld", () => {
  for (const [id, netto] of [[384737, "764.14"], [384874, "932.93"], [384908, "713.02"], [385140, "864.24"]]) {
    assert.equal(matches(base(id, netto)), false, `${id} (${netto})`);
  }
});

test("precies op de grens: 932,93 nee, 932,94 ja", () => {
  assert.equal(matches(base(1, "932.93")), false);
  assert.equal(matches(base(2, "932.94", { PublicatieModule: "Middenhuur" })), true);
  assert.equal(matches(base(3, "1250.00", { PublicatieModule: "Vrije sector" })), true);
});

test("andere corporatie, te veel kamers of tijdelijk contract worden niet gemeld", () => {
  const dur = base(4, "1250.00");
  dur.Eenheid.Eigenaar = "Een Andere Corporatie";
  assert.equal(matches(dur), false);
  const zes = base(5, "1250.00");
  zes.Eenheid.AantalKamers = 6;
  assert.equal(matches(zes), false);
  assert.equal(matches(base(6, "1250.00", { ContractVorm: "Tijdelijk contract" })), false);
});

test("onbekende prijs: alleen melden als het niet als sociale huur gelabeld is", () => {
  const onbekend = base(7, "0");
  onbekend.Eenheid.NettoHuurBekend = false;
  assert.equal(matches(onbekend), false); // Sociale huur
  onbekend.PublicatieModule = "Vrije sector";
  assert.equal(matches(onbekend), true);
});

test("het bericht bevat adres, prijs, soort en reageren-tot in Nederlandse tijd", () => {
  const { title, body } = message(base(8, "1250.5", { PublicatieModule: "Vrije sector" }));
  assert.match(title, /Bontekoestraat 42/);
  assert.match(body, /netto huur € 1\.250,50/);
  assert.match(body, /Vrije sector \| Onbepaalde tijd contract/);
  assert.match(body, /Reageren tot: .*23:59/); // 21:59 UTC = 23:59 in Amsterdam
});

test("alleen voorrang voor gezinnen is geen reden om over te slaan: de woningpagina beslist", () => {
  // Echt label uit de advertenties van 8 oktober.
  assert.equal(matches(base(10, "1250.00", { PublicatieLabel: "Met situatiepunten~Voorrang kleine gezinnen" })), true);
  assert.equal(matches(base(11, "1250.00", { PublicatieLabel: "Voorrang gezinnen met kinderen" })), true);
  assert.equal(matches(base(12, "1250.00", { PublicatieLabel: "Voorrang 1 kind" })), true);
  assert.equal(matches(base(13, "1250.00", { PublicatieLabel: "Voorrang grote gezinnen~Met situatiepunten" })), true);
});

test("andere labels blijven gewoon doorkomen", () => {
  assert.equal(matches(base(14, "1250.00", { PublicatieLabel: "Vrije sector" })), true);
  assert.equal(matches(base(15, "1250.00", { PublicatieLabel: "" })), true);
  assert.equal(matches(base(16, "1250.00", { PublicatieLabel: "Met situatiepunten" })), true);
  assert.equal(matches(base(17, "1250.00", { PublicatieLabel: "Voorrang senioren" })), true);
  assert.equal(matches(base(18, "1250.00")), true); // geen label
});

test("echte labels uit het aanbod (9 en 16 oktober, ook met spatie ervoor)", () => {
  const skip = [
    " Alleen voor gezinnen", "Alleen voor gezinnen", "Alleen voor gezinnen voorrang GEB-indicatie",
    "Jongerenwoning", " Jongerenwoning", "Seniorenwoning", "Seniorenwoning met voorrang GEB-indicatie",
  ];
  const keep = [
    "Met situatiepunten", "Vrije sector", "Parkeren", "Rolstoelgeschikte woning", "Wibo-woning",
    "55+ Verhuisvoordeel voorrang GEB-indicatie", "Middenhuur", "Voorrang GEB-indicatie", "Voorrang 1-/2-persoonshuishoudens",
    "Voorrang kleine(re) huishoudens", "Middenhuur Voorrang kleine(re) huishoudens", // de woningpagina beslist (voorwaarden)
    " Voorrang kleine gezinnen", "Voorrang kleine gezinnen", "Voorrang grote gezinnen", " Voorrang grote gezinnen", "Met situatiepunten~ Voorrang kleine gezinnen",
  ];
  skip.forEach((label, i) => assert.equal(matches(base(100 + i, "1250.00", { PublicatieLabel: label })), false, label));
  keep.forEach((label, i) => assert.equal(matches(base(200 + i, "1250.00", { PublicatieLabel: label })), true, label));
});

test("een kindeis staat soms alleen in de tekst of in een nieuw label", () => {
  for (const label of ["Minimaal 1 kind", "Gezinnen met kinderen", "Woning voor huishoudens met kind"]) {
    assert.equal(matches(base(400, "1250.00", { PublicatieLabel: label })), false, label);
  }
  for (const Tekst of ["Voor gezinnen met kinderen.", "Je moet minimaal 1 kind hebben.", "Alleen voor huishoudens met een kind"]) {
    assert.equal(matches(base(401, "1250.00", { PublicatieOmschrijving: { Id: "1", Tekst } })), false, Tekst);
  }
  assert.equal(matches(base(402, "1250.00", { PublicatieOmschrijving: { Id: "1", Tekst: "Mooie woning bij het park." } })), true);
});

test("jongeren- en seniorenwoningen worden overgeslagen, ook zonder label via de doelgroep", () => {
  for (const label of ["Jongerenwoning", " Jongerenwoning", "Seniorenwoning", "Seniorenwoning met voorrang GEB-indicatie", "Met situatiepunten~Seniorenwoning"]) {
    assert.equal(matches(base(300, "1250.00", { PublicatieLabel: label })), false, label);
  }
  for (const doelgroep of ["Jongeren", "Senioren"]) {
    const p = base(301, "1250.00");
    p.Eenheid.Doelgroep = doelgroep;
    assert.equal(matches(p), false, doelgroep);
  }
  const persoon = base(302, "1250.00");
  persoon.Eenheid.Doelgroep = "Persoon";
  assert.equal(matches(persoon), true);
  const gezin = base(303, "1250.00");
  gezin.Eenheid.Doelgroep = "Gezin"; // alleen "Doelgroep Gezin" is geen voorrang en geen reden om over te slaan
  assert.equal(matches(gezin), true);
});

test("woningen van Rochdale, Eigen Haard, Stadgenoot en de Alliantie komen ook door, andere corporaties niet", () => {
  for (const eigenaar of ["Rochdale", "Rochdale Amsterdam", "Eigen Haard", "Eigen Haard Amsterdam", "Eigenhaard", "Stadgenoot", "Stadgenoot Amsterdam", "Lieven de Key Amsterdam", "de Alliantie Amsterdam", "De Alliantie"]) {
    const p = base(500, "1250.00");
    p.Eenheid.Eigenaar = eigenaar;
    assert.equal(matches(p), true, eigenaar);
  }
  for (const eigenaar of ["Ymere Parkeren", "Woonzorg Amsterdam", "Onze Woning", ""]) {
    const p = base(501, "1250.00");
    p.Eenheid.Eigenaar = eigenaar;
    assert.equal(matches(p), false, eigenaar);
  }
  // De andere eisen gelden ook voor de nieuwe corporaties.
  const sociaal = base(502, "800.00");
  sociaal.Eenheid.Eigenaar = "Rochdale";
  assert.equal(matches(sociaal), false);
  const gezin = base(503, "1250.00", { PublicatieLabel: "Alleen voor gezinnen" });
  gezin.Eenheid.Eigenaar = "Stadgenoot Amsterdam";
  assert.equal(matches(gezin), false);
});

test("de naam van de corporatie staat in het bericht", () => {
  const p = base(504, "1250.00");
  p.Eenheid.Eigenaar = "Eigen Haard";
  assert.match(message(p).body, /Eigen Haard \| Sociale huur/);
});

test("Rochdale: niets in Zuidoost, wel in de rest van de stad (ook Nieuw-West)", () => {
  const wijk = (naam) => {
    const p = base(600, "1250.00");
    p.Eenheid.Eigenaar = "Rochdale Amsterdam";
    p.Adres.Wijk = naam;
    return p;
  };
  // Echte wijken uit de meldingen van 27 oktober.
  for (const naam of ["Holendrecht (Zuidoost)", "Venserpolder (Zuidoost)", "Bijlmer-Centrum (zuidoost)"]) {
    assert.equal(matches(wijk(naam)), false, naam);
  }
  for (const naam of ["Stadionbuurt (Zuid)", "Volewijck (Noord)", "Waterlandpleinbuurt (Noord)", "Bellamybuurt (West)", "Indische Buurt-Oost (Oost)", "Weesperbuurt/Plantage (Centrum)", "Slotervaart-Zuid", "", "Zuidoost-park", "Overtoomse Veld (Nieuw-West)", "Slotervaart-Zuid (Nieuw-West)"]) {
    assert.equal(matches(wijk(naam)), true, naam);
  }
});

test("een eis van minimaal 3 personen wordt overgeslagen, alleen voorrang voor grotere huishoudens niet", () => {
  for (const label of ["Minimaal 3 personen", "Minimaal 2 personen", "Alleen voor 3+ personen"]) {
    assert.equal(matches(base(700, "1250.00", { PublicatieLabel: label })), false, label);
  }
  for (const label of ["Voorrang 3-persoonshuishoudens", "Voorrang 3-/4-persoonshuishoudens", "Voorrang 3+ personen", "Voorrang grotere huishoudens", "Voorrang grote huishoudens", "Voorrang meerpersoonshuishoudens", "Voorrang 4-persoonshuishoudens"]) {
    assert.equal(matches(base(703, "1250.00", { PublicatieLabel: label })), true, label);
  }
  for (const Tekst of ["Voor huishoudens van minimaal 3 personen.", "Alleen voor 3+ personen"]) {
    assert.equal(matches(base(701, "1250.00", { PublicatieOmschrijving: { Id: "1", Tekst } })), false, Tekst);
  }
});

// Echte tekst van de woningpagina van Andoornstraat 3 H (27 oktober), ingekort tot waar het om gaat.
const PAGE_ANDOORN = [
  "Prijs", "Nettohuur", "€ 1.100,00", "Brutohuur", "€1.109,67", "Je betaalt per maand €1.109,67.",
  "Spelregels",
  "Om te kunnen bepalen wie de woning krijgt, kijken we naar spelregels. De belangrijkste spelregel staat bovenaan, deze telt het zwaarst.",
  "Gezinnen (minimaal een minderjarig kind)",
  "Stadsvernieuwingsurgenten van Eigen Haard",
  "Voorrang voor sociale huurders Eigen Haard die een woning leeg achterlaten",
  "Voorrang voor huurders die een zelfstandige sociale huurwoning  van een corporatie met een onbepaalde tijd contract of jongerencontract in de Stadsregio Amsterdam leeg achterlaten",
  "Voorrang voor huishoudens met een inkomen t/m € 66952",
  "Voorrang voor woningzoekenden die geen sociale huurwoning of jongerenwoning van een corporatie binnen Stadsregio Amsterdam leeg achterlaten",
  "Locatie op kaart", "+", "In het kort",
].join("\n");

test("de spelregels worden uit de woningpagina gelezen", () => {
  const rules = parseRules(PAGE_ANDOORN);
  assert.equal(rules.length, 6);
  assert.equal(rules[0], "Gezinnen (minimaal een minderjarig kind)");
  assert.deepEqual(parseRules("Prijs\nNettohuur\n€ 900,00\nLocatie op kaart"), []); // geen spelregels, bijvoorbeeld vrije sector
});

test("voorrang voor gezinnen in de spelregels is alleen een volgorde: wel melden, met waarschuwing", () => {
  assert.equal(rulesProblem(parseRules(PAGE_ANDOORN)), "");
  assert.equal(rulesProblem(["Voorrang voor huishoudens met kinderen onder de 18"]), "");
  assert.equal(rulesProblem(["Grote gezinnen"]), "");
  assert.match(message(base(904, "1225.00"), parseRules(PAGE_ANDOORN), null).body, /Let op: voorrang eerst voor "Gezinnen/);
});

test("spelregels zonder kind- of gezinseis blijven doorkomen, ook 1 of 2 personen", () => {
  const ok = [
    ["Huishoudens van 1 of 2 personen", "Voorrang voor sociale huurders Eigen Haard die een woning leeg achterlaten"],
    ["1- of 2-persoonshuishoudens"],
    ["Voorrang voor huishoudens met een inkomen t/m € 66952", "Voorrang voor woningzoekenden die geen sociale huurwoning leeg achterlaten"],
    [],
  ];
  for (const rules of ok) assert.equal(rulesProblem(rules), "", rules.join(" / "));
  assert.equal(rulesProblem(null), ""); // niet te lezen: niet afkeuren
});

test("labels over kleine huishoudens beslissen niet meer zelf: de woningpagina doet dat", () => {
  for (const label of ["Voorrang kleine(re) huishoudens", "Middenhuur Voorrang kleine(re) huishoudens", "Voorrang 1-/2-persoonshuishoudens"]) {
    assert.equal(matches(base(702, "1250.00", { PublicatieLabel: label })), true, label);
  }
});

test("het bericht heeft een directe link en de spelregels", () => {
  const m = message(base(900, "1250.00"), ["Voorrang voor sociale huurders Eigen Haard die een woning leeg achterlaten"]);
  assert.equal(m.url, "https://amsterdam.mijndak.nl/HuisDetails?PublicatieId=900");
  assert.match(m.body, /Spelregels: Voorrang voor sociale huurders/);
  assert.match(m.body, /Woning: https:\/\/amsterdam\.mijndak\.nl\/HuisDetails\?PublicatieId=900/);
  assert.match(message(base(901, "1250.00"), null).body, /niet gecontroleerd/);
});

test("'Spelregels' als tabblad bovenaan de pagina verstoort het lezen niet", () => {
  const page = ["Kenmerken", "Spelregels", "Locatie", "Titel", "Etage", "3", "Prijs", "Nettohuur", "€ 1.225,00",
    "Spelregels", "Om te kunnen bepalen wie de woning krijgt, kijken we naar spelregels.", "Gezinnen (minimaal een minderjarig kind)",
    "Voorrang voor sociale huurders die een woning leeg achterlaten", "Locatie op kaart", "In het kort"].join("\n");
  assert.deepEqual(parseRules(page), ["Gezinnen (minimaal een minderjarig kind)", "Voorrang voor sociale huurders die een woning leeg achterlaten"]);
  assert.deepEqual(parseRules("Kenmerken\nSpelregels\nLocatie\nPrijs\nLocatie op kaart"), []); // alleen het tabblad, geen echte regels
});

// Echte "Voorwaarden" van Karimatastraat 29 (30 oktober), ingekort.
const CONDITIONS_KARIMATA = [
  "Voorwaarden", "Aantal personen huishouden", "is groter of gelijk aan 1", "Inkomen 1 persoon",
  "maximaal € 70149. Uitzondering geldt voor woningzoekenden die een zelfstandige sociale huurwoning leeg achterlaten",
  "Maximuminkomen 2 of meer personen", "Je inkomen is niet hoger dan € 93531.",
].join("\n");

test("het minimale aantal personen wordt uit de voorwaarden gelezen", () => {
  assert.equal(parseMinPersons(CONDITIONS_KARIMATA), 1);
  assert.equal(parseMinPersons("Aantal personen huishouden\nis groter of gelijk aan 3"), 3);
  assert.equal(parseMinPersons("Aantal personen huishouden\nis groter dan 1"), 2);
  assert.equal(parseMinPersons("Aantal personen huishouden\nis kleiner of gelijk aan 2"), 1);
  assert.equal(parseMinPersons(PAGE_ANDOORN), null); // voorwaarde staat er niet
});

test("gezinnen eerst, maar een huishouden van 1 mag reageren: wel melden, met waarschuwing", () => {
  const rules = parseRules(PAGE_ANDOORN);
  assert.equal(rulesProblem(rules, 1), "");
  assert.match(message(base(902, "1225.00"), rules, 1).body, /Let op: voorrang eerst voor "Gezinnen \(minimaal een minderjarig kind\)"/);
  assert.doesNotMatch(message(base(903, "1225.00"), ["Voorrang voor huishoudens met een inkomen t/m € 66952"], 1).body, /Let op/);
});

test("minimaal 2 of meer personen als voorwaarde: overslaan, ook zonder gezinsregel", () => {
  assert.equal(rulesProblem([], 2), "minimaal 2 personen");
  assert.equal(rulesProblem(["Voorrang voor huishoudens met een inkomen t/m € 66952"], 3), "minimaal 3 personen");
});

// Echte tekst van Van Noordtkade 44 E (Lieven de Key, 1 november), ingekort.
const PAGE_NOORDTKADE = [
  "Voorwaarden", "Let op: bij deze woning krijg je een huurcontract voor onbepaalde tijd.",
  "Huishoudsamenstelling", "Alleen voor gezinnen met minimaal 1 kind(eren)",
  "Maximuminkomen 1 persoons huishouden", "Je inkomen is niet hoger dan € 70149.",
  "Kenmerken", "Advertentienummer", "388292", "Prijs", "Nettohuur", "€ 1.228,07", "Spelregels",
  "Om te kunnen bepalen wie de woning krijgt, kijken we naar spelregels.",
  "Voorrang voor huurders van Lieven de Key die een sociale huurwoning leeg achterlaten",
  "Locatie op kaart", "In het kort",
].join("\n");

test("een kind- of gezinseis bij de voorwaarden betekent overslaan, ook zonder gezinsregel", () => {
  const conditions = parseConditions(PAGE_NOORDTKADE);
  assert.ok(conditions.includes("Alleen voor gezinnen met minimaal 1 kind(eren)"));
  assert.equal(rulesProblem(parseRules(PAGE_NOORDTKADE), parseMinPersons(PAGE_NOORDTKADE), conditions), "voorwaarde: Alleen voor gezinnen met minimaal 1 kind(eren)");
  // De voorwaarden van Karimatastraat (huishouden van 1 mag) blijven gewoon doorkomen.
  assert.equal(rulesProblem(parseRules(PAGE_ANDOORN), parseMinPersons(CONDITIONS_KARIMATA), parseConditions(CONDITIONS_KARIMATA)), "");
});

test("een woning waarvan de reageertermijn al voorbij is, wordt niet gemeld (Peelstraat: 2 minuten open)", () => {
  const now = new Date("2026-11-03T14:49:54Z");
  assert.equal(expired({ EinddatumTijd: "2026-11-03T14:48:24Z" }, now), true);
  assert.equal(expired({ EinddatumTijd: "2026-11-06T22:59:00Z" }, now), false);
  assert.equal(expired({ EinddatumTijd: "1900-01-01T00:00:00" }, now), false);
  assert.equal(expired({}, now), false);
});

test("'maximaal 1 kind' als voorwaarde is een bovengrens en geen reden om over te slaan", async () => {
  const { rulesProblem } = await import("./filter.mjs");
  const stadgenoot = ["Huishoudsamenstelling:", "maximaal 1 kind", "Inkomen", "minimaal €51578.94"];
  assert.equal(rulesProblem(["Voorrang voor huurders van Stadgenoot die een sociale huurwoning leeg achterlaten"], null, stadgenoot), "");
  assert.equal(rulesProblem([], null, ["Huishoudsamenstelling:", "maximaal 2 kind"]), "");
  // Een echte eis blijft overslaan.
  assert.notEqual(rulesProblem([], null, ["Huishoudsamenstelling:", "Alléén voor gezinnen met minderjarige kinderen", "maximaal 2 kind"]), "");
});

test("Lieven de Key: elk stadsdeel van Amsterdam en ook bij gezinsvoorrang op de lijst; andere corporaties niet", async () => {
  const { skipReason } = await import("./filter.mjs");
  const ldk = (p) => ((p.Eenheid.Eigenaar = "Lieven de Key Amsterdam"), p);
  const zuidoost = ldk(base(700, "1150.00", { PublicatieModule: "Middenhuur", Adres: { Straatnaam: "Bijlmerdreef", Huisnummer: 1, Wijk: "Holendrecht (Zuidoost)", Woonplaats: "Amsterdam" } }));
  assert.equal(matches(zuidoost), true);
  const gezin = ldk(base(701, "1150.00", { PublicatieModule: "Middenhuur", PublicatieLabel: "Voorrang kleine gezinnen" }));
  assert.equal(matches(gezin), true);
  const ander = base(702, "1150.00", { PublicatieModule: "Middenhuur", Adres: { Straatnaam: "X", Huisnummer: 1, Wijk: "Osdorp-Oost (Nieuw-West)", Woonplaats: "Amsterdam" } });
  ander.Eenheid.Eigenaar = "Rochdale Amsterdam";
  ander.Adres.Wijk = "Holendrecht (Zuidoost)";
  assert.equal(skipReason(ander), "stadsdeel Zuidoost");
});

test("buiten de stad Amsterdam wordt overgeslagen, ook bij Lieven de Key", async () => {
  const { skipReason } = await import("./filter.mjs");
  for (const plaats of ["Weesp", "Diemen", "Zaandam", "Badhoevedorp", "Amstelveen"]) {
    const p = base(710, "1150.00", { PublicatieModule: "Middenhuur", Adres: { Straatnaam: "X", Huisnummer: 1, Wijk: "Centrum", Woonplaats: plaats } });
    p.Eenheid.Eigenaar = "Lieven de Key Amsterdam";
    assert.equal(matches(p), false, plaats);
    assert.match(skipReason(p), /buiten Amsterdam/);
  }
});

test("alleen voorrang voor gezinnen wordt gemeld; een echte gezinseis niet", () => {
  const regels = ["Voorrang voor gezinnen met minimaal 1 kind(eren)", "Voorrang voor huurders van Lieven de Key die een sociale huurwoning leeg achterlaten"];
  assert.equal(rulesProblem(regels, null, []), "");
  assert.notEqual(rulesProblem(regels, null, ["Huishoudsamenstelling", "Alleen voor gezinnen met minimaal 1 kind(eren)"]), "");
  assert.notEqual(rulesProblem([], 2, []), "");
});

test("inkomensgrenzen: 71k past, behalve bij een maximum zonder uitzondering voor doorstromers", async () => {
  const { incomeProblem, parseEuro } = await import("./filter.mjs");
  assert.equal(parseEuro("€ 68.483,-"), 68483);
  assert.equal(parseEuro("minimaal €51578.94"), 51578.94);
  const ldk = ["Maximuminkomen 1 persoons huishouden", "Je inkomen is niet hoger dan € 70149. Uitzondering geldt voor woningzoekenden die een zelfstandige sociale huurwoning  van een corporatie in de regio Amsterdam leeg achterlaten.", "Minimuminkomen 1 persoon", "Je inkomen is hoger dan € 51537"];
  assert.equal(incomeProblem(ldk), "");
  const rochdale = ["Inkomen 1 persoon", "maximaal € 70149 Uitzonderingen: er geldt geen maximum voor woningzoekenden die een zelfstandige sociale huurwoning van een corporatie achterlaten."];
  assert.equal(incomeProblem(rochdale), "");
  assert.equal(incomeProblem(["Inkomen", "minimaal €51578.94"]), "");
  assert.match(incomeProblem(["Maximuminkomen 1 persoon", "Je inkomen is niet hoger dan € 65000"]), /boven het maximum/);
  assert.match(incomeProblem(["Minimuminkomen 1 persoon", "Je inkomen is hoger dan € 80000"]), /onder het minimum/);
  // Grens voor 2 of meer personen telt niet voor jou.
  assert.equal(incomeProblem(["Maximuminkomen 2 of meer personen", "Je inkomen is niet hoger dan € 60000"]), "");
});

test("1-kamerwoningen en studio's bij alle corporaties; meer dan 5 kamers niet", () => {
  const studio = base(720, "1050.00", { PublicatieModule: "Middenhuur" });
  studio.Eenheid.AantalKamers = 1;
  assert.equal(matches(studio), true);
  studio.Eenheid.Eigenaar = "Lieven de Key Amsterdam";
  assert.equal(matches(studio), true);
  const groot = base(721, "1500.00", { PublicatieModule: "Vrije sector" });
  groot.Eenheid.Eigenaar = "Lieven de Key Amsterdam";
  groot.Eenheid.AantalKamers = 6;
  assert.equal(matches(groot), false);
});

test("Nieuw-West mag bij alle corporaties; Zuidoost bij geen van allen (behalve Lieven de Key)", async () => {
  const { skipReason } = await import("./filter.mjs");
  const woning = (eigenaar, wijk) => {
    const p = base(730, "1225.00", { PublicatieModule: "Middenhuur", Adres: { Straatnaam: "X", Huisnummer: 1, Wijk: wijk, Woonplaats: "Amsterdam" } });
    p.Eenheid.Eigenaar = eigenaar;
    return p;
  };
  for (const eigenaar of ["Eigen Haard", "Stadgenoot", "de Alliantie Amsterdam", "Rochdale Amsterdam", "Ymere"]) {
    assert.equal(skipReason(woning(eigenaar, "Osdorp-Oost (Nieuw-West)")), "", eigenaar);
    assert.equal(matches(woning(eigenaar, "Osdorp-Oost (Nieuw-West)")), true, eigenaar);
    assert.equal(skipReason(woning(eigenaar, "Holendrecht (Zuidoost)")), "stadsdeel Zuidoost", eigenaar);
  }
});

test("volglijst: Jollemanhof 216 wordt herkend, andere nummers niet", async () => {
  const { WATCHLIST, watchHit } = await import("./filter.mjs");
  const w = WATCHLIST.find((x) => x.name === "Jollemanhof 216");
  const adres = (nr) => base(740, "1200.61", { Adres: { Straatnaam: "Jollemanhof", Huisnummer: nr, Wijk: "Oostelijk Havengebied (Oost)", Woonplaats: "Amsterdam" } });
  assert.equal(watchHit(w, adres(216)), true);
  assert.equal(watchHit(w, adres(2160)), false);
  assert.equal(watchHit(w, adres(21)), false);
});

test("Ymere komt door (Zuidoost niet), Ymere Parkeren niet", async () => {
  const { skipReason } = await import("./filter.mjs");
  const ymere = (wijk) => {
    const p = base(750, "1228.07", { PublicatieModule: "Middenhuur", Adres: { Straatnaam: "Jollemanhof", Huisnummer: 216, Wijk: wijk, Woonplaats: "Amsterdam" } });
    p.Eenheid.Eigenaar = "Ymere";
    return p;
  };
  assert.equal(matches(ymere("Oostelijk Havengebied (Oost)")), true);
  assert.equal(skipReason(ymere("Osdorp-Oost (Nieuw-West)")), "");
  assert.equal(skipReason(ymere("Holendrecht (Zuidoost)")), "stadsdeel Zuidoost");
  const p = ymere("Oostelijk Havengebied (Oost)");
  p.Eenheid.Eigenaar = "Ymere Parkeren";
  assert.equal(matches(p), false);
});
