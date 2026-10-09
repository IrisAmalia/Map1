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

test("echte labels uit het aanbod van 9 oktober (ook met spatie ervoor)", () => {
  const skip = [" Voorrang kleine gezinnen", "Voorrang kleine gezinnen", "Voorrang grote gezinnen", " Alleen voor gezinnen", "Alleen voor gezinnen", "Met situatiepunten~ Voorrang kleine gezinnen"];
  const keep = ["Met situatiepunten", "Vrije sector", "Parkeren", "Seniorenwoning", "Jongerenwoning", "Seniorenwoning met voorrang GEB-indicatie", "Rolstoelgeschikte woning", "Wibo-woning", "Voorrang 1-/2-persoonshuishoudens"];
  skip.forEach((label, i) => assert.equal(matches(base(100 + i, "1250.00", { PublicatieLabel: label })), false, label));
  keep.forEach((label, i) => assert.equal(matches(base(200 + i, "1250.00", { PublicatieLabel: label })), true, label));
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
