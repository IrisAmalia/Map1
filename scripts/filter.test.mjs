import test from "node:test";
import assert from "node:assert/strict";
import { matches, message } from "./filter.mjs";

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
    "Voorrang kleine(re) huishoudens", "Middenhuur Voorrang kleine(re) huishoudens",
  ];
  const keep = [
    "Met situatiepunten", "Vrije sector", "Parkeren", "Rolstoelgeschikte woning", "Wibo-woning",
    "55+ Verhuisvoordeel voorrang GEB-indicatie", "Middenhuur", "Voorrang GEB-indicatie", "Voorrang 1-/2-persoonshuishoudens",
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

test("voorrang voor kleine huishoudens (= met kind) valt af, voorrang op aantal personen en andere voorrang niet", () => {
  for (const label of ["Voorrang kleine(re) huishoudens", "Middenhuur Voorrang kleine(re) huishoudens", "Voorrang kleine huishoudens", "Voorrang kleinere huishoudens"]) {
    assert.equal(matches(base(702, "1250.00", { PublicatieLabel: label })), false, label);
  }
  for (const label of ["Voorrang 1-/2-persoonshuishoudens", "Voorrang 1-persoonshuishoudens", "Voorrang GEB-indicatie", "55+ Verhuisvoordeel voorrang GEB-indicatie", "Met situatiepunten", "Middenhuur", "Vrije sector"]) {
    assert.equal(matches(base(703, "1250.00", { PublicatieLabel: label })), true, label);
  }
});
