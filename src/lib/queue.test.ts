import { describe, it, expect } from "vitest";
import { estimateQueue, levelFor, quietHours, type QueueEvent } from "./queue";

const now = new Date("2026-11-03T12:00:00Z").getTime();
const ev = (kind: "entrada" | "saida", minsAgo: number): QueueEvent => ({
  place_id: "n1",
  kind,
  created_at: new Date(now - minsAgo * 60000).toISOString(),
});

describe("queue", () => {
  it("people = entradas - saídas in the last 3h", () => {
    const r = estimateQueue([ev("entrada", 10), ev("entrada", 20), ev("saida", 5), ev("entrada", 300)], "ubs", now);
    expect(r.people).toBe(1);
    expect(r.waitMinutes).toBe(12);
  });
  it("never negative", () => {
    expect(estimateQueue([ev("saida", 1)], "upa", now).people).toBe(0);
  });
  it("levels", () => {
    expect(levelFor(3)).toBe("baixo");
    expect(levelFor(4)).toBe("moderado");
    expect(levelFor(11)).toBe("alto");
  });
  it("quiet hours need at least 10 check-ins", () => {
    expect(quietHours([ev("entrada", 1)])).toBeNull();
  });
});
