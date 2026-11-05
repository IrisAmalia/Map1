import test from "node:test";
import assert from "node:assert/strict";
import { parseAcks, planReminders, ackLink } from "./reminders.mjs";

const now = new Date("2026-11-05T12:00:00Z");
const listing = (id, end = "2026-11-06T22:59:00Z") => ({ Id: id, EinddatumTijd: end });

test("'Gezien' wordt uit de ntfy-berichten gelezen", () => {
  const text = [
    JSON.stringify({ event: "open" }),
    JSON.stringify({ event: "message", message: "388706" }),
    JSON.stringify({ event: "message", message: " 389273\n" }),
    "geen json",
  ].join("\n");
  assert.deepEqual([...parseAcks(text)].sort(), ["388706", "389273"]);
});

test("na een half uur zonder 'Gezien' volgt een herinnering, eerder niet", () => {
  const items = new Map([["1", listing("1")], ["2", listing("2")]]);
  const reminders = {
    1: { last: "2026-11-05T11:29:00Z" }, // 31 minuten geleden
    2: { last: "2026-11-05T11:45:00Z" }, // 15 minuten geleden
  };
  assert.deepEqual(planReminders(reminders, items, new Set(), now), { stop: [], due: ["1"] });
});

test("herinneringen stoppen bij 'Gezien', als de woning weg is of als de termijn voorbij is", () => {
  const items = new Map([["1", listing("1")], ["3", listing("3", "2026-11-05T11:00:00Z")], ["4", listing("4")]]);
  const reminders = { 1: { last: "2026-11-05T10:00:00Z" }, 2: { last: "2026-11-05T10:00:00Z" }, 3: { last: "2026-11-05T10:00:00Z" }, 4: { last: "2026-11-05T10:00:00Z" } };
  const plan = planReminders(reminders, items, new Set(["1"]), now);
  assert.deepEqual(plan.stop, [["1", "gezien"], ["2", "niet meer in het aanbod"], ["3", "reageertermijn voorbij"]]);
  assert.deepEqual(plan.due, ["4"]);
});

test("lukt het laden van het aanbod niet, dan niets stoppen en niets herinneren", () => {
  assert.deepEqual(planReminders({ 1: { last: "2026-11-05T10:00:00Z" } }, new Map(), new Set(), now), { stop: [], due: [] });
});

test("de link in de e-mail meldt 'Gezien' voor de juiste woning", () => {
  assert.equal(ackLink("abc", "388706"), "https://ntfy.sh/abc-gezien/publish?message=388706");
});
