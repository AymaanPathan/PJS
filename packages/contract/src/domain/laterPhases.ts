/**
 * A Lot's Phases 6–8, worked out from its records: where it stands, its Borma summary, its finished goods, and where
 * each quality check of those phases stands. Nothing here is stored; the backend sends it with the Lot and the screens
 * read it, so both always say the same.
 *
 * No phase waits for the one before it: a record of any of these phases can be made on any Lot of the run. A Lot's
 * status is simply the furthest phase it has a record in — the doc's "Cooking → … → In Borma → Humidified → Peeled
 * → Graded → Packed → QC-11 passed → Dispatched" (wholes packed straight from the Borma skip the three in the middle).
 */
import { bormaSummary, type BormaSummary } from "./borma.js";
import { fgStock, type FgStockRow } from "./packing.js";
import type { LaterLotStatus } from "./cooking.js";
import type { EntryKind } from "./lotEntries.js";

export type { LaterLotStatus };

/** A quality check of these phases, from its newest record: "No" holds the material until a newer check says OK. */
export type CheckState = "not_checked" | "waiting" | "ok" | "no";

export const CHECK_STATE_LABELS: Record<CheckState, string> = {
  not_checked: "Not checked yet",
  waiting: "Waiting for approval",
  ok: "OK",
  no: "Sent back",
};

interface EntryLike {
  id: number;
  kind: string;
  date: string;
  status: string;
  decision: string | null;
  values: Record<string, string | undefined>;
}

export function checkState(entries: EntryLike[], kind: EntryKind): CheckState {
  const mine = entries.filter((e) => e.kind === kind && e.status !== "rejected").sort((a, b) => b.id - a.id);
  if (mine[0]?.status === "submitted") return "waiting";
  const decided = mine.find((e) => e.status === "approved");
  return !decided ? "not_checked" : decided.decision === "ok" ? "ok" : "no";
}

export const LATER_CHECKS = ["qc8", "qc10", "qc12", "qc9", "qc11"] as const;
export type LaterCheck = (typeof LATER_CHECKS)[number];

export interface LaterPhases {
  /** Null while the Lot has no record of Phases 6–8. */
  status: LaterLotStatus | null;
  borma: BormaSummary;
  checks: Record<LaterCheck, CheckState>;
  fg: FgStockRow[];
  /** Kg graded (Σ grades) and rejected at grading, for the run's balance. */
  gradedKg: number;
  rejectKernelsKg: number;
  /** Humidification kg out − kg in, over the lines with both. */
  humidGainKg: number;
  /** Husk winnowed to storage. */
  huskKg: number;
}

const n0 = (v: string | undefined) => Number(v) || 0;
const kg2 = (n: number) => Math.round(n * 100) / 100;

const STATUS_FROM: [LaterLotStatus, EntryKind[]][] = [
  ["dispatched", ["fg_dispatch"]],
  ["packed", ["packing", "qc9", "qc11"]],
  ["graded", ["grading", "worker_output", "qc12"]],
  ["peeled", ["peeling", "winnowing"]],
  ["humidified", ["humidification", "qc10"]],
  ["in_borma", ["borma_trolley", "borma_oven", "qc8"]],
];

export function laterPhases(entries: EntryLike[], today: string): LaterPhases {
  const live = entries.filter((e) => e.status !== "rejected");
  const has = (kinds: EntryKind[]) => live.some((e) => kinds.includes(e.kind as EntryKind));
  const of = (kind: EntryKind) => live.filter((e) => e.kind === kind);
  const checks = Object.fromEntries(LATER_CHECKS.map((k) => [k, checkState(entries, k)])) as Record<LaterCheck, CheckState>;
  let status = STATUS_FROM.find(([, kinds]) => has(kinds))?.[0] ?? null;
  if (status === "packed" && checks.qc11 === "ok") status = "qc11_passed";
  const fg = fgStock(entries, today);
  const gradingKg = (keyFilter: (k: string) => boolean) => kg2(of("grading").reduce((n, e) => n + Object.entries(e.values).filter(([k]) => keyFilter(k)).reduce((m, [, v]) => m + n0(v), 0), 0));
  return {
    status,
    borma: bormaSummary(of("borma_trolley")),
    checks,
    fg,
    gradedKg: gradingKg((k) => k.startsWith("kg_")),
    rejectKernelsKg: gradingKg((k) => k === "rejectionKg"),
    humidGainKg: kg2(of("humidification").filter((e) => (e.values.kgOut ?? "").trim() !== "").reduce((n, e) => n + n0(e.values.kgOut) - n0(e.values.kgIn), 0)),
    huskKg: kg2(of("winnowing").reduce((n, e) => n + n0(e.values.huskToStorageKg), 0)),
  };
}
