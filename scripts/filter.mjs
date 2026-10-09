// Filterregels en berichttekst voor de Dak-melder. Geen netwerk, zodat dit los te testen is.

export const OWNER = /lieven de key/i;
export const ROOMS = [2, 5];
export const CONTRACT = /onbepaald/i;
// Pas vanaf deze netto (kale) huur is het middenhuur of vrije sector: alles tot en met 932,93 is sociaal.
export const MIN_RENT_EXCLUSIVE_CENTS = 93293;

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
    ends,
  };
}

export function matches(p) {
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

export function message(p) {
  const d = describe(p);
  return {
    title: `Nieuwe woning: ${d.title}`,
    body: [
      `${d.title}${d.place ? ", " + d.place : ""}`,
      `${d.rooms} kamers | ${d.rent}`,
      [d.module, d.contract].filter(Boolean).join(" | "),
      [d.floor, d.label].filter(Boolean).join(" | "),
      d.ends && `Reageren tot: ${d.ends}`,
    ].filter(Boolean).join("\n"),
  };
}
