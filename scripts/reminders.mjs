// Herinneringen: een gemelde woning wordt elk half uur opnieuw gemeld tot je op "Gezien" drukt.
// "Gezien" stuurt het advertentienummer naar een apart ntfy-onderwerp; de melder leest dat elke run.
import { expired } from "./filter.mjs";

export const REMINDER_INTERVAL_MS = 30 * 60 * 1000;

export const ackTopic = (topic) => `${topic}-gezien`;
// Link voor in de e-mail: openen = "Gezien" (ntfy accepteert publiceren via een gewone link).
export const ackLink = (topic, id) => `https://ntfy.sh/${encodeURIComponent(ackTopic(topic))}/publish?message=${encodeURIComponent(id)}`;

// Advertentienummers uit de berichten van het "Gezien"-onderwerp (ntfy geeft één JSON-object per regel).
export function parseAcks(text) {
  const ids = new Set();
  for (const line of String(text || "").split("\n")) {
    try {
      const m = JSON.parse(line);
      if (m.event === "message" && m.message) ids.add(String(m.message).trim());
    } catch {}
  }
  return ids;
}

// Bepaalt per lopende herinnering wat er moet gebeuren.
// reminders: { id: { last: ISO-tijd, count, rules, minPersons } }, items: Map id -> advertentie (leeg = lijst niet geladen).
export function planReminders(reminders, items, acks, now = new Date()) {
  const stop = [];
  const due = [];
  for (const [id, r] of Object.entries(reminders || {})) {
    const p = items.get(id);
    if (acks.has(id)) stop.push([id, "gezien"]);
    else if (items.size > 0 && !p) stop.push([id, "niet meer in het aanbod"]);
    else if (p && expired(p, now)) stop.push([id, "reageertermijn voorbij"]);
    else if (p && now - new Date(r.last) >= REMINDER_INTERVAL_MS) due.push(id);
  }
  return { stop, due };
}
