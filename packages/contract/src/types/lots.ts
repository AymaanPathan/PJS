import type { SiloSize, SizeValues } from "../domain/calibration.js";
import type { CookCheckState, CoolingCheckState, EarlyLotStatus, LotStatus } from "../domain/cooking.js";
import type { LaterPhases } from "../domain/laterPhases.js";
import type { RunBalance } from "../domain/runBalance.js";
import type { EntryKind } from "../domain/lotEntries.js";
import type { ShellingFigures, ShellingKgField } from "../domain/shelling.js";
import type { StoreBalance, Stream, TruckStatus } from "../domain/byProducts.js";
import type { MoistureCheckStatus } from "../domain/rcnReceipt.js";
import type { SortCheckState, SorterStream } from "../domain/colourSort.js";

/** One cooking row of a Lot: kg per size, as typed. */
export interface LotCookRunView {
  id: number;
  date: string;
  sizes: SizeValues;
  totalKg: number;
  createdBy: string | null;
  createdAt: string;
}

/** One small record of a Lot (domain/lotEntries.ts says which fields each kind has). */
export interface LotEntryView {
  id: number;
  lotCode: string;
  kind: EntryKind;
  date: string;
  values: Record<string, string>;
  decision: string | null;
  status: MoistureCheckStatus;
  /** The alerts the doc lists for this kind. */
  notes: string[];
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export interface ShellingDayView {
  id: number;
  lotCode: string;
  date: string;
  inputKg: string;
  kg: Partial<Record<ShellingKgField, string>>;
  figures: ShellingFigures;
  notes: string[];
  createdBy: string | null;
  createdAt: string;
}

/** A production Lot: born at cooking, and everything after it is tracked by it. */
export interface LotView {
  code: string;
  batchCode: string;
  /** The furthest phase the Lot has a record in. */
  status: LotStatus;
  /** Its status as far as colour sorting: what Phases 4–5 go by (shelling only after QC-4). */
  earlyStatus: EarlyLotStatus;
  /** The first cooking row's date. */
  date: string;
  runs: LotCookRunView[];
  sizes: Record<SiloSize, number>;
  /** The sizes it actually cooked, largest first. */
  cookedSizes: SiloSize[];
  totalKg: number;
  bags: number;
  coolingSilo: string | null;
  /** "YYYY-MM-DDTHH:MM", factory time as typed. */
  coolingAt: string | null;
  /** QC-3, per cooked size. */
  cookChecks: Record<string, CookCheckState>;
  /** QC-4. */
  coolingCheck: CoolingCheckState;
  entries: LotEntryView[];
  shellingDays: ShellingDayView[];
  shelledKg: number;
  leftToShellKg: number;
  /** Phase 5: each stream's kg out of shelling, the streams with kg, and where each stands on QC-7. */
  sorterKg: Record<SorterStream, number>;
  sorterStreams: SorterStream[];
  sortChecks: Record<string, SortCheckState>;
  /** Phases 6–8: Borma summary, finished goods, and where their checks stand. */
  later: LaterPhases;
}

export interface TruckView {
  id: number;
  stream: Stream;
  date: string;
  truckNo: string;
  driver: string;
  documentsChecked: boolean;
  tareKg: string;
  grossKg: string;
  netKg: number | null;
  slipNo: string;
  buyer: string;
  category: string;
  price: string;
  gatePassNo: string;
  status: TruckStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface BoilerReadingView {
  id: number;
  date: string;
  shellKg: string;
  runningHours: string;
  createdBy: string | null;
}

/** Phases 3–4 for one batch: its Lots, plus the factory's by-product stores, trucks and boiler (they are shared). */
export interface BatchLots {
  lots: LotView[];
  stores: StoreBalance[];
  /** Newest first. */
  trucks: TruckView[];
  /** Newest first. */
  boiler: BoilerReadingView[];
  /** Every Lot number at the factory, for suggesting the next one. */
  allLotCodes: string[];
  /** The doc's batch balance, shown before the run is closed. */
  balance: RunBalance;
}

export interface CookRunInput {
  batchCode?: string;
  code?: string;
  date?: string;
  sizes?: SizeValues;
}

export interface CoolingInput {
  silo?: string;
  date?: string;
  time?: string;
}

export interface LotEntryInput {
  kind?: string;
  date?: string;
  values?: Record<string, string | undefined>;
  decision?: string;
}

export type ShellingDayInput = Partial<Record<ShellingKgField | "inputKg" | "date", string>>;

export interface TruckInput {
  stream?: string;
  date?: string;
  truckNo?: string;
  driver?: string;
  documentsChecked?: boolean;
  tareKg?: string;
  grossKg?: string;
  slipNo?: string;
  buyer?: string;
  category?: string;
  price?: string;
  gatePassNo?: string;
}

export interface BoilerInput {
  date?: string;
  shellKg?: string;
  runningHours?: string;
}
