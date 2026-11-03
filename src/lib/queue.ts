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
