export type Category = "farmacia" | "ama" | "ubs" | "clinica" | "hospital" | "upa";
export type QueueEvent = { place_id: string; kind: "entrada" | "saida"; created_at: string };

/** Estimated minutes of service per person waiting (community estimate, not official). */
export const MINUTES_PER_PERSON: Record<Category, number> = {
  farmacia: 3,
  ubs: 12,
  ama: 15,
  clinica: 15,
  upa: 20,
  hospital: 25,
};

export const WINDOW_HOURS = 3;
export const MIN_EVENTS_FOR_HOURS = 10;

export type Level = "baixo" | "moderado" | "alto";

export function levelFor(people: number): Level {
  if (people <= 3) return "baixo";
  if (people <= 10) return "moderado";
  return "alto";
}

export function estimateQueue(events: QueueEvent[], category: Category, now = Date.now()) {
  const since = now - WINDOW_HOURS * 3600_000;
  let entradas = 0;
  let saidas = 0;
  for (const e of events) {
    if (new Date(e.created_at).getTime() < since) continue;
    if (e.kind === "entrada") entradas++;
    else saidas++;
  }
  const reports = entradas + saidas;
  const people = Math.max(0, entradas - saidas);
  return {
    reports,
    people,
    waitMinutes: people * MINUTES_PER_PERSON[category],
    level: levelFor(people),
  };
}

/** Hours (0-23) with fewest check-ins, or null when there's not enough data. */
export function quietHours(events: QueueEvent[], count = 3): number[] | null {
  const entries = events.filter((e) => e.kind === "entrada");
  if (entries.length < MIN_EVENTS_FOR_HOURS) return null;
  const hist = new Array(24).fill(0);
  for (const e of entries) hist[new Date(e.created_at).getHours()]++;
  return hist
    .map((n, h) => ({ n, h }))
    .filter(({ h }) => h >= 7 && h <= 21)
    .sort((a, b) => a.n - b.n || a.h - b.h)
    .slice(0, count)
    .map(({ h }) => h);
}

/** Typical number of people waiting at the busiest hour, per category (simulation, not real data). */
export const TYPICAL_PEAK_PEOPLE: Record<Category, number> = {
  farmacia: 3,
  ubs: 12,
  ama: 10,
  clinica: 5,
  upa: 15,
  hospital: 18,
};

/** Relative movement by hour (0–1): morning peak, smaller afternoon peak, quiet night. */
const HOUR_CURVE = [0.15, 0.1, 0.1, 0.1, 0.1, 0.15, 0.35, 0.7, 1, 1, 0.9, 0.75, 0.6, 0.7, 0.8, 0.75, 0.65, 0.6, 0.55, 0.5, 0.4, 0.3, 0.25, 0.2];
/** UPA/hospital run all night, so their curve never drops as low. */
const isAllDay = (c: Category) => c === "upa" || c === "hospital";

export function hourFactor(category: Category, hour: number) {
  const f = HOUR_CURVE[((hour % 24) + 24) % 24]!;
  return isAllDay(category) ? 0.35 + 0.65 * f : f;
}

/** Typical-hour simulation used only when there are no recent citizen reports. */
export function typicalQueue(category: Category, hour: number) {
  const people = Math.round(TYPICAL_PEAK_PEOPLE[category] * hourFactor(category, hour));
  return { people, waitMinutes: people * MINUTES_PER_PERSON[category], level: levelFor(people) };
}

/** Quietest daytime hours according to the typical curve. */
export function typicalQuietHours(category: Category, count = 3): number[] {
  return HOUR_CURVE.map((_, h) => ({ h, n: hourFactor(category, h) }))
    .filter(({ h }) => h >= 7 && h <= 21)
    .sort((a, b) => a.n - b.n || a.h - b.h)
    .slice(0, count)
    .map(({ h }) => h)
    .sort((a, b) => a - b);
}
