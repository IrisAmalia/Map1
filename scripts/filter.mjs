// Filterregels en berichttekst voor de Dak-melder. Geen netwerk, zodat dit los te testen is.

// Corporaties waarvan we woningen melden. Lieven de Key is jouw eigen corporatie (daar heb je voorrang), de rest is extra.
export const OWNER = /lieven de key|rochdale|eigen\s?haard|stadgenoot/i;
export const ROOMS = [2, 5];
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

// Een spelregel over een kind, een gezin of een huishouden van minimaal 3 personen: niets voor jou, overslaan.
export const RULE_CHILD_OR_FAMILY = /minderjarig|\bkind(eren)?\b|gezin/i;
export function rulesProblem(rules) {
  for (const r of rules || []) {
    if (RULE_CHILD_OR_FAMILY.test(r) || LARGE_HOUSEHOLD.test(r)) return r;
  }
  return "";
}

// Waarom een verder passende woning toch wordt overgeslagen ("" = niet overslaan).
export function skipReason(p) {
  if (!coreMatches(p)) return "";
  if (familyPriority(p)) return "gezinsvoorrang";
  if (ageRestricted(p)) return "jongeren/senioren";
  const district = excludedDistrict(p);
  if (district) return `stadsdeel ${district}`;
  return "";
}

export function matches(p) {
  return coreMatches(p) && skipReason(p) === "";
}

export function message(p, rules) {
  const d = describe(p);
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
      `Woning: ${detailUrl(p)}`,
    ].filter(Boolean).join("\n"),
  };
}
