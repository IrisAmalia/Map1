import test from "node:test";
import assert from "node:assert/strict";
import { matches, message, parseRules, rulesProblem } from "./filter.mjs";

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
  Eenheid: { DetailSoort: "Bovenwoning", AantalKamers: 2, NettoHuurBekend: true, NettoHuur: String(netto), BrutoHuurBekend: true, Brutohuur: "939.95", EnergieLabel: "C", Eigenaar: "Lieven de Key Amsterdam" },
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

test("andere corporatie, te weinig kamers of tijdelijk contract worden niet gemeld", () => {
  const dur = base(4, "1250.00");
  dur.Eenheid.Eigenaar = "Een Andere Corporatie";
  assert.equal(matches(dur), false);
  const een = base(5, "1250.00");
  een.Eenheid.AantalKamers = 1;
  assert.equal(matches(een), false);
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

test("woningen met voorrang voor gezinnen of kinderen worden overgeslagen", () => {
  // Echt label uit de advertenties van 8 oktober.
  assert.equal(matches(base(10, "1250.00", { PublicatieLabel: "Met situatiepunten~Voorrang kleine gezinnen" })), false);
  assert.equal(matches(base(11, "1250.00", { PublicatieLabel: "Voorrang gezinnen met kinderen" })), false);
  assert.equal(matches(base(12, "1250.00", { PublicatieLabel: "Voorrang 1 kind" })), false);
  assert.equal(matches(base(13, "1250.00", { PublicatieLabel: "Voorrang grote gezinnen~Met situatiepunten" })), false);
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
    " Voorrang kleine gezinnen", "Voorrang kleine gezinnen", "Voorrang grote gezinnen", " Voorrang grote gezinnen",
    " Alleen voor gezinnen", "Alleen voor gezinnen", "Alleen voor gezinnen voorrang GEB-indicatie",
    "Met situatiepunten~ Voorrang kleine gezinnen",
    "Jongerenwoning", " Jongerenwoning", "Seniorenwoning", "Seniorenwoning met voorrang GEB-indicatie",
  ];
  const keep = [
    "Met situatiepunten", "Vrije sector", "Parkeren", "Rolstoelgeschikte woning", "Wibo-woning",
    "55+ Verhuisvoordeel voorrang GEB-indicatie", "Middenhuur", "Voorrang GEB-indicatie", "Voorrang 1-/2-persoonshuishoudens",
    "Voorrang kleine(re) huishoudens", "Middenhuur Voorrang kleine(re) huishoudens", // de woningpagina beslist (spelregels)
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

test("woningen van Rochdale, Eigen Haard en Stadgenoot komen ook door, andere corporaties niet", () => {
  for (const eigenaar of ["Rochdale", "Rochdale Amsterdam", "Eigen Haard", "Eigen Haard Amsterdam", "Eigenhaard", "Stadgenoot", "Stadgenoot Amsterdam", "Lieven de Key Amsterdam"]) {
    const p = base(500, "1250.00");
    p.Eenheid.Eigenaar = eigenaar;
    assert.equal(matches(p), true, eigenaar);
  }
  for (const eigenaar of ["Ymere", "De Alliantie", "Onze Woning", ""]) {
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

test("niets in Zuidoost of Nieuw-West, wel in de rest van de stad", () => {
  const wijk = (naam) => {
    const p = base(600, "1250.00");
    p.Adres.Wijk = naam;
    return p;
  };
  // Echte wijken uit de meldingen van 27 oktober.
  for (const naam of ["Holendrecht (Zuidoost)", "Venserpolder (Zuidoost)", "Overtoomse Veld (Nieuw-West)", "Slotervaart-Zuid (Nieuw-West)", "Bijlmer-Centrum (zuidoost)"]) {
    assert.equal(matches(wijk(naam)), false, naam);
  }
  for (const naam of ["Stadionbuurt (Zuid)", "Volewijck (Noord)", "Waterlandpleinbuurt (Noord)", "Bellamybuurt (West)", "Indische Buurt-Oost (Oost)", "Weesperbuurt/Plantage (Centrum)", "Slotervaart-Zuid", "", "Zuidoost-park"]) {
    assert.equal(matches(wijk(naam)), true, naam);
  }
});

test("voorrang of eis voor huishoudens van minimaal 3 personen wordt overgeslagen", () => {
  for (const label of ["Voorrang 3-persoonshuishoudens", "Voorrang 3-/4-persoonshuishoudens", "Voorrang 3+ personen", "Minimaal 3 personen", "Voorrang grotere huishoudens", "Voorrang grote huishoudens", "Voorrang meerpersoonshuishoudens", "Voorrang 4-persoonshuishoudens"]) {
    assert.equal(matches(base(700, "1250.00", { PublicatieLabel: label })), false, label);
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

test("een kindeis of gezinseis in de spelregels betekent overslaan", () => {
  assert.equal(rulesProblem(parseRules(PAGE_ANDOORN)), "Gezinnen (minimaal een minderjarig kind)");
  assert.notEqual(rulesProblem(["Voorrang voor huishoudens met kinderen onder de 18"]), "");
  assert.notEqual(rulesProblem(["Huishoudens van minimaal 3 personen"]), "");
  assert.notEqual(rulesProblem(["Grote gezinnen"]), "");
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
