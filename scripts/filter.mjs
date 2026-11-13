// Filterregels en berichttekst voor de Dak-melder. Geen netwerk, zodat dit los te testen is.

// Corporaties waarvan we woningen melden. Lieven de Key is jouw eigen corporatie (daar heb je voorrang), de rest is extra.
// De Dak-naam is bijvoorbeeld "de Alliantie Amsterdam".
export const OWNER = /lieven de key|rochdale|eigen\s?haard|stadgenoot|alliantie/i;
export const ROOMS = [2, 5];
// Je eigen corporatie: daarvan wil je alles in de gemeente Amsterdam, in elk stadsdeel en ook bij voorrang voor gezinnen
// (zolang een huishouden van 1 mag reageren).
export const OWN = /lieven de key/i;
// Alleen de stad Amsterdam zelf (Dak zet de plaats in Adres.Woonplaats); Weesp, Diemen, Zaandam, Badhoevedorp enz. vallen af.
export const HOME_CITY = /^amsterdam$/i;
// Je bruto jaarinkomen, om inkomensgrenzen op de woningpagina te controleren.
export const INCOME = 71000;
export const CONTRACT = /onbepaald/i;
// Stadsdelen waar je niet wilt wonen. Dak zet het stadsdeel tussen haakjes achter de wijk, bijvoorbeeld
// "Holendrecht (Zuidoost)" of "Slotervaart-Zuid (Nieuw-West)". Alleen het stadsdeel aan het einde telt,
// dus "Stadionbuurt (Zuid)" of "Slotervaart-Zuid" op zich vallen er niet onder.
export const EXCLUDED_DISTRICTS = /\(\s*(zuidoost|nieuw-west)\s*\)\s*$/i;
// Pas vanaf deze netto (kale) huur is het middenhuur of vrije sector: alles tot en met 932,93 is sociaal.
export const MIN_RENT_EXCLUSIVE_CENTS = 93293;
// Woningen waarvoor je (minimaal) een kind moet hebben of die voorrang geven aan gezinnen/kinderen slaan we over:
// elk label met "gezin" of "kind" ("Alleen voor gezinnen", "Voorrang kleine gezinnen", "Voorrang grote gezinnen", ...).
// De labels van een advertentie staan in PublicatieLabel, gescheiden door "~".
export const FAMILY_PRIORITY = /gezin|kind/i;
// Zelfde idee voor de vrije tekst van een advertentie (meestal leeg): bijvoorbeeld "minimaal 1 kind" of "gezinnen met kinderen".
export const CHILD_REQUIRED_TEXT = /(minimaal|minstens|ten minste|tenminste)\s+(1|één|een|2|twee)\s+(thuiswonende\s+)?kind|alleen voor (huishoudens|gezinnen) met (een |1 |twee )?(thuiswonende )?kind|gezinnen met (thuiswonende )?kinderen|huishoudens met (thuiswonende )?kinderen/i;

const eur = (n) => `€ ${Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

// Netto huur in centen: bij een losse woning de netto huur, bij een cluster de hoogste prijs. null = onbekend.
export function netRentCents(p) {
  const e = p.Eenheid || {};
  const c = p.Cluster || {};
  if (e.NettoHuurBekend && num(e.NettoHuur) > 0) return Math.round(num(e.NettoHuur) * 100);
  if (c.PrijsMaxBekend && num(c.PrijsMax) > 0) return Math.round(num(c.PrijsMax) * 100);
  return null;
}

// Jongeren- en seniorenwoningen (leeftijdsgrenzen) slaan we ook over: op het label of in de doelgroep.
export const AGE_RESTRICTED_LABEL = /jongerenwoning|seniorenwoning/i;
export const AGE_RESTRICTED_TARGET = /^(jongeren|senioren)$/i;
export function ageRestricted(p) {
  const labels = String(p.PublicatieLabel || "").split("~");
  return labels.some((l) => AGE_RESTRICTED_LABEL.test(l)) || AGE_RESTRICTED_TARGET.test(String((p.Eenheid || {}).Doelgroep || "").trim());
}

export function excludedDistrict(p) {
  const m = String((p.Adres || {}).Wijk || "").match(EXCLUDED_DISTRICTS);
  return m ? m[1] : "";
}

// Voorrang of eis voor huishoudens van minimaal 3 personen ("3-persoonshuishoudens", "minimaal 3 personen", "3+ personen",
// "grote huishoudens"). "Voorrang 1-/2-persoonshuishoudens" en "Voorrang kleine(re) huishoudens" blijven wél doorkomen.
export const LARGE_HOUSEHOLD = /(minimaal|minstens|ten minste|tenminste|vanaf)\s+(3|drie|4|vier)\s+(personen|bewoners)|\b[3-9]\s*\+\s*-?\s*(persoons|personen)|\b[3-9]\s*-?\s*(of meer\s*)?-?persoons|meerpersoons|grote(re)?\s+huishoudens/i;

export function familyPriority(p) {
  const text = String((p.PublicatieOmschrijving || {}).Tekst || "");
  const labels = String(p.PublicatieLabel || "").split("~");
  return labels.some((label) => FAMILY_PRIORITY.test(label) || LARGE_HOUSEHOLD.test(label)) || CHILD_REQUIRED_TEXT.test(text) || LARGE_HOUSEHOLD.test(text);
}

export function describe(p) {
  const a = p.Adres || {};
  const e = p.Eenheid || {};
  const c = p.Cluster || {};
  const street = [a.Straatnaam, a.Huisnummer || "", a.Huisletter, a.HuisnummerToevoeging].filter(Boolean).join(" ");
  const place = [a.Wijk || a.Woonplaats].filter(Boolean).join(", ");
  const rooms = e.AantalKamers || (c.AantalKamersMin ? `${c.AantalKamersMin}-${c.AantalKamersMax}` : "?");
  const cents = netRentCents(p);
  const rent = cents !== null
    ? `netto huur ${eur(cents / 100)}${e.BrutoHuurBekend ? ` (bruto ${eur(e.Brutohuur)})` : ""}`
    : "huur onbekend";
  const ends = p.EinddatumTijd && !p.EinddatumTijd.startsWith("1900")
    ? new Date(p.EinddatumTijd).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return {
    title: street || c.Naam || `Advertentie ${p.Id}`,
    place,
    rooms,
    rent,
    cents,
    module: p.PublicatieModule || "",
    contract: p.ContractVorm || "",
    owner: e.Eigenaar || c.Eigenaar || "",
    floor: e.DetailSoort ? `${e.DetailSoort}${p.Verdieping !== "" && p.Verdieping !== undefined ? `, verdieping ${p.Verdieping}` : ""}${p.HeeftLift ? ", lift" : ""}` : "",
    label: e.EnergieLabel ? `energielabel ${e.EnergieLabel}` : "",
    target: e.Doelgroep ? `doelgroep ${e.Doelgroep}` : "",
    ends,
  };
}

// Alle eisen behalve de gezinsvoorrang (apart, zodat we kunnen loggen wat we daardoor overslaan).
// De reageertermijn is al voorbij (sommige woningen staan maar een paar minuten open). Dan heeft een melding geen zin.
export function expired(p, now = new Date()) {
  const end = p.EinddatumTijd;
  if (!end || end.startsWith("1900")) return false;
  const t = new Date(end);
  return !Number.isNaN(t.getTime()) && t < now;
}

export const ownCorporation = (p) => OWN.test(describe(p).owner);
export function outsideCity(p) {
  const place = String((p.Adres || {}).Woonplaats || "").trim();
  return place && !HOME_CITY.test(place) ? place : "";
}

export function coreMatches(p) {
  const d = describe(p);
  if (!d.owner || !OWNER.test(d.owner)) return false; // zonder eigenaar kunnen we niet bevestigen dat het jouw corporatie is
  const e = p.Eenheid || {};
  const c = p.Cluster || {};
  const min = e.AantalKamers || c.AantalKamersMin || 0;
  const max = e.AantalKamers || c.AantalKamersMax || 0;
  if (min && (max < ROOMS[0] || min > ROOMS[1])) return false;
  if (d.contract && !CONTRACT.test(d.contract)) return false;
  // Prijs: alleen vanaf € 932,94. Is de prijs onbekend, dan melden we alleen als het niet als sociale huur is gelabeld.
  if (d.cents !== null) return d.cents > MIN_RENT_EXCLUSIVE_CENTS;
  return !/soci/i.test(d.module);
}

export const DETAIL_URL = "https://amsterdam.mijndak.nl/HuisDetails?PublicatieId=";
export const detailUrl = (p) => `${DETAIL_URL}${p.Id}`;

// Op de woningpagina staat onder "Spelregels" hoe de woning wordt toegewezen, de belangrijkste regel bovenaan.
// "Voorrang kleine(re) huishoudens" op de lijst betekent bij de ene woning "minimaal een minderjarig kind" en bij de andere
// "1 of 2 personen". Alleen de spelregels op de woningpagina zeggen dat zeker.
export function parseRules(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // De echte spelregels staan direct onder een vaste inleidende zin. "Spelregels" alleen kan ook een tabblad zijn.
  const intro = lines.findIndex((l) => /^Om te kunnen bepalen wie de woning krijgt/i.test(l));
  if (intro < 0) return [];
  let end = lines.findIndex((l, i) => i > intro && /^Locatie op kaart/i.test(l));
  if (end < 0) end = Math.min(lines.length, intro + 12);
  return lines.slice(intro + 1, end);
}

// Onder "Voorwaarden" staat wie mag reageren, bijvoorbeeld "Aantal personen huishouden / is groter of gelijk aan 1".
// Geeft het minimale aantal personen, of null als die voorwaarde er niet staat.
export function parseMinPersons(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  let min = null;
  lines.forEach((l, i) => {
    if (!/^Aantal personen( huishouden)?$/i.test(l) || !lines[i + 1]) return;
    const c = lines[i + 1].toLowerCase();
    const n = Number((c.match(/\d+/) || [])[0]);
    let m = null;
    if (/kleiner|niet groter|maximaal|hoogstens/.test(c)) m = 1;
    else if (/groter of gelijk|minimaal|minstens|tussen|gelijk aan|^\d/.test(c) && n) m = n;
    else if (/groter dan/.test(c) && n >= 0) m = n + 1;
    if (m !== null) min = Math.max(min ?? 0, m);
  });
  return min;
}

// Het blok "Voorwaarden" (tot "Kenmerken"): wie mag reageren. Lieven de Key zet hier bijvoorbeeld
// "Huishoudsamenstelling / Alleen voor gezinnen met minimaal 1 kind(eren)".
export function parseConditions(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((l, i) => {
    if (!/^Voorwaarden$/i.test(l)) return;
    for (let j = i + 1; j < lines.length && !/^(Kenmerken|Spelregels|Locatie op kaart)$/i.test(lines[j]); j++) out.push(lines[j]);
  });
  return out;
}

// Een voorwaarde die een kind of gezin eist, of minimaal 3 personen.
export const CONDITION_CHILD_OR_FAMILY = /alleen voor gezinnen|\bkind(eren|\(eren\))?\b|minderjarig/i;
// "maximaal 1 kind" is een bovengrens (ook zonder kinderen mag je reageren), geen eis.
export const CHILD_LIMIT = /^(maximaal|hoogstens|niet meer dan)\s+\d+\s+kind/i;
export function conditionProblem(conditions) {
  return (conditions || []).find((c) => !CHILD_LIMIT.test(c.trim()) && (CONDITION_CHILD_OR_FAMILY.test(c) || LARGE_HOUSEHOLD.test(c))) || "";
}

// Een spelregel over een kind, een gezin of een huishouden van minimaal 3 personen.
export const RULE_CHILD_OR_FAMILY = /minderjarig|\bkind(eren)?\b|gezin/i;
export function familyRule(rules) {
  return (rules || []).find((r) => RULE_CHILD_OR_FAMILY.test(r) || LARGE_HOUSEHOLD.test(r)) || "";
}

// Waarom de woning na het lezen van de woningpagina toch wordt overgeslagen ("" = melden).
// - Een voorwaarde eist een kind of gezin: overslaan.
// - Een huishouden van 1 mag niet reageren: overslaan.
// - Een huishouden van 1 mag wel reageren: melden, ook als gezinnen voorrang hebben (dat is alleen een volgorde).
// - Die voorwaarde staat er niet: dan bij een gezins- of kindregel overslaan, zoals eerst.
// Bedrag uit een tekst als "€ 70149", "€ 68.483,-" of "€51578.94".
export function parseEuro(text) {
  const m = String(text || "").match(/€\s*([\d.,]+)/);
  if (!m) return null;
  let v = m[1].replace(/[.,]$/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Inkomensgrenzen voor een huishouden van 1 onder "Voorwaarden". Een maximum geldt niet als er een uitzondering
// voor doorstromers uit een sociale huurwoning bij staat (dat ben jij, met je jongerencontract bij Lieven de Key).
export function incomeProblem(conditions, income = INCOME) {
  const lines = (conditions || []).map((l) => String(l).trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i], value = lines[i + 1];
    if (/2 of meer/i.test(label)) continue;
    const isIncome = /^(maximum|minimum)?inkomen( 1 persoon| 1 persoons huishouden)?$/i.test(label);
    if (!isIncome) continue;
    const amount = parseEuro(value);
    if (amount === null) continue;
    // Het label zegt het meestal ("Maximuminkomen"); anders de tekst ("maximaal", "niet hoger dan", "minimaal", "hoger dan").
    const kind = /^maximum/i.test(label) ? "max" : /^minimum/i.test(label) ? "min"
      : /niet hoger|maximaal/i.test(value) ? "max" : /hoger dan|minimaal/i.test(value) ? "min" : "";
    if (kind === "min" && income < amount) return `inkomen onder het minimum van € ${amount}`;
    if (kind === "max" && income > amount && !/uitzondering|geen maximum/i.test(value)) return `inkomen boven het maximum van € ${amount}`;
  }
  return "";
}

// own = woning van je eigen corporatie: dan alleen overslaan als een huishouden van 1 echt niet mag reageren,
// niet bij alleen voorrang voor gezinnen.
export function rulesProblem(rules, minPersons = null, conditions = [], own = false) {
  const condition = conditionProblem(conditions);
  if (condition) return `voorwaarde: ${condition}`;
  if (minPersons > 1) return `minimaal ${minPersons} personen`;
  const income = incomeProblem(conditions);
  if (income) return income;
  if (minPersons === 1 || own) return "";
  return familyRule(rules);
}

// Waarom een verder passende woning toch wordt overgeslagen ("" = niet overslaan).
export function skipReason(p) {
  if (!coreMatches(p)) return "";
  const city = outsideCity(p);
  if (city) return `buiten Amsterdam (${city})`;
  if (ageRestricted(p)) return "jongeren/senioren";
  // Lieven de Key: elk stadsdeel, en of gezinsvoorrang een probleem is, beslist de woningpagina.
  if (ownCorporation(p)) return "";
  if (familyPriority(p)) return "gezinsvoorrang";
  const district = excludedDistrict(p);
  if (district) return `stadsdeel ${district}`;
  return "";
}

export function matches(p) {
  return coreMatches(p) && skipReason(p) === "";
}

export function message(p, rules, minPersons = null) {
  const d = describe(p);
  const family = familyRule(rules);
  const warning = family && (minPersons === 1 || ownCorporation(p))
    ? `Let op: voorrang eerst voor "${family}". Een huishouden van 1 mag wel reageren.`
    : "";
  const rulesLine = rules === null
    ? "Spelregels konden niet gecontroleerd worden: kijk zelf op de woningpagina."
    : rules && rules.length ? `Spelregels: ${rules.slice(0, 3).join(" / ")}` : "";
  return {
    title: `Nieuwe woning: ${d.title}`,
    url: detailUrl(p),
    body: [
      `${d.title}${d.place ? ", " + d.place : ""}`,
      `${d.rooms} kamers | ${d.rent}`,
      [d.owner, d.module, d.contract].filter(Boolean).join(" | "),
      [d.floor, d.label, d.target].filter(Boolean).join(" | "),
      d.ends && `Reageren tot: ${d.ends}`,
      rulesLine,
      warning,
      `Woning: ${detailUrl(p)}`,
    ].filter(Boolean).join("\n"),
  };
}
