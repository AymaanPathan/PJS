import type { BatchStatus, LotInBin } from "../domain/productionBatch.js";

/** A factory warehouse bin offered on the New batch screen. */
export interface AvailableBin {
  binCode: string;
  /** The store the Bin is in, from the Bin master; null when the master doesn't say. */
  store: string | null;
  /** Current stock (kg), worked out from the procurement Lots in it. */
  kg: number;
  lotCount: number;
  /** Lots in the bin that add no kg: no GRN weight recorded, or split across bins without a share. */
  lotsWithoutKg: number;
  /** Lots physically in the bin but marked "Keep in warehouse", so not in its stock. A batch still takes the whole bin. */
  lotsKept: number;
  /** Set when the bin is already in a running batch — it can't be picked again. */
  inBatch: string | null;
  /** False when the code appears on receipts but not in Masters › Bins, so it can't be put in a batch. */
  inMaster: boolean;
}

export interface BatchBinView {
  binCode: string;
  /** The bin's stock when the batch was created: the plan, kept as it was. */
  plannedKg: number;
  /** What procurement says is in the bin now. */
  currentKg: number;
  lots: LotInBin[];
}

export interface BatchSummary {
  /** The run's system ID, PR-<warehouse code>-<year>-NNN — always issued by the system, like a truck's REC- ID. */
  code: string;
  /** An optional name the team gave it (ANA-03B), shown beside the ID. */
  name: string | null;
  warehouse: string;
  startDate: string;
  proposedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  status: BatchStatus;
  plannedKg: number;
  days: number;
  endDate: string | null;
  binCodes: string[];
  /** Set once the Warehouse Incharge has closed the run (Phase 8). */
  closedAt: string | null;
  closedBy: string | null;
}

export interface BatchHistoryEntry {
  at: string;
  text: string;
  actor: string | null;
}

export interface BatchDetail extends BatchSummary {
  bins: BatchBinView[];
  history: BatchHistoryEntry[];
}
