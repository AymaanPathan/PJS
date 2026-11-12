/**
 * What leaves the floor by truck: the document's "By-products & dispatch", one form with the stream picked from a list.
 * Finished goods leave against a sales contract instead (Phase 8's dispatch), so they are not a stream here. Stores are calculated from what produced
 * them and what left, never stored. Source: the doc's page 15, and the client's "15. Waste Management Dispatch
 * Tracker" and "16. Shell Dispatch Tracker", whose net = gross − tare holds on all 1,653 rows.
 */

export const STREAMS = [
  { key: "dust_voids", label: "Dust & voids", register: "Waste Management Dispatch Tracker", producedIn: "Intake" },
  { key: "waste_water", label: "Cooking waste water", register: "Waste Management Dispatch Tracker", producedIn: "Cooking" },
  { key: "shell", label: "Shell", register: "16. Shell Dispatch Tracker", producedIn: "Shelling" },
  { key: "shell_dust", label: "Shell dust", register: "Waste Management Dispatch Tracker", producedIn: "Shelling" },
  // The doc: "black rejection → storage → sale". Its kg come from the shelling day record.
  { key: "black_rejection", label: "Black rejection", register: "Gate Pass / Sortie", producedIn: "Colour sort" },
  // Phase 7: "husk → winnowing → storage → sale" (the husk winnowing line's husk to storage) and "reject kernels → sale"
  // (the grading sheet's Rejection column).
  { key: "husk", label: "Husk", register: "Gate Pass / Sortie", producedIn: "Husk winnowing" },
  { key: "reject_kernels", label: "Reject kernels", register: "Gate Pass / Sortie", producedIn: "Grading" },
] as const;

export type Stream = (typeof STREAMS)[number]["key"];
export const isStream = (v: unknown): v is Stream => STREAMS.some((s) => s.key === v);
export const streamLabel = (s: Stream): string => STREAMS.find((x) => x.key === s)!.label;
/** A stream as a workbook names it. */
export const streamFromWord = (w: string | null | undefined): Stream | null => STREAMS.find((s) => s.label.toLowerCase() === (w ?? "").trim().toLowerCase())?.key ?? null;

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const kg3 = (n: number) => Math.round(n * 1000) / 1000;

export interface StoreBalance {
  stream: Stream;
  producedKg: number;
  dispatchedKg: number;
  /** Shell only: burned in the plant's own boiler. */
  burnedKg: number;
  stockKg: number;
}

/** "Store balance (each stream) = produced − dispatched (shell: − burned in boiler)". */
export function storeBalance(stream: Stream, producedKg: number, dispatchedKg: number, burnedKg = 0): StoreBalance {
  return { stream, producedKg: kg3(producedKg), dispatchedKg: kg3(dispatchedKg), burnedKg: kg3(burnedKg), stockKg: kg3(producedKg - dispatchedKg - burnedKg) };
}

export interface TruckValues {
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

export const truckNetKg = (v: { tareKg?: string | null; grossKg?: string | null }): number | null => {
  const [t, g] = [num(v.tareKg), num(v.grossKg)];
  return t === null || g === null || Number.isNaN(t) || Number.isNaN(g) ? null : kg3(g - t);
};

/** The gate procedure, worked out from what has been filled in. */
export type TruckStatus = "at_gate" | "documents_checked" | "tare_weighed" | "weighed" | "closed";

export const TRUCK_STATUS_LABELS: Record<TruckStatus, string> = {
  at_gate: "At the gate · check documents",
  documents_checked: "Documents checked · weigh empty",
  tare_weighed: "Weighed empty · load, then weigh",
  weighed: "Weighed · add the gate pass",
  closed: "Closed",
};

export function truckStatus(v: { documentsChecked?: boolean; tareKg?: string | null; grossKg?: string | null; gatePassNo?: string | null }): TruckStatus {
  if ((v.gatePassNo ?? "").trim()) return "closed";
  if (!v.documentsChecked) return "at_gate";
  if (!(v.tareKg ?? "").trim()) return "documents_checked";
  return (v.grossKg ?? "").trim() ? "weighed" : "tare_weighed";
}

/**
 * The doc: "Weighing opens only after documents are checked"; "Net = gross − tare; net cannot exceed the stream's store
 * stock"; "Gate pass no required to close the truck; unique". `stockKg` is the stream's store now, without this truck.
 */
export function truckError(v: TruckValues, stockKg: number): string | null {
  if (!isStream(v.stream)) return "Choose what the truck is taking.";
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!(v.truckNo ?? "").trim()) return "Enter the truck number.";
  const weighed = (v.tareKg ?? "").trim() || (v.grossKg ?? "").trim();
  if (weighed && !v.documentsChecked) return "Check the truck's documents before weighing it.";
  for (const [key, label] of [["tareKg", "Tare"], ["grossKg", "Gross"]] as const) {
    const n = num(v[key]);
    if (n !== null && (Number.isNaN(n) || n <= 0)) return `${label} must be a number of kg above 0.`;
  }
  if ((v.grossKg ?? "").trim() && !(v.tareKg ?? "").trim()) return "Weigh the truck empty (tare) first.";
  const net = truckNetKg(v);
  if (net !== null && net <= 0) return "Gross must be more than tare.";
  const price = num(v.price);
  if (price !== null && (Number.isNaN(price) || price < 0)) return "Price must be a number, 0 or more.";
  if ((v.gatePassNo ?? "").trim()) {
    if (net === null) return "Weigh the truck empty and loaded before closing it.";
    if (!(v.buyer ?? "").trim()) return "Enter the buyer or vendor before closing the truck.";
    if (net > kg3(stockKg)) return `The ${streamLabel(v.stream).toLowerCase()} store holds ${fmt(stockKg)} kg; a truck of ${fmt(net)} kg can't leave it.`;
  }
  return null;
}

export interface BoilerValues {
  date?: string;
  shellKg?: string;
  runningHours?: string;
}

/** "Shell kg taken from the shell balance of Phase 4." `shellStockKg` is the shell silo now. */
export function boilerError(v: BoilerValues, shellStockKg: number): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  const kg = num(v.shellKg);
  if (kg === null) return "Enter the shell burned, in kg.";
  if (Number.isNaN(kg) || kg <= 0) return "Shell burned must be a number of kg above 0.";
  const h = num(v.runningHours);
  if (h !== null && (Number.isNaN(h) || h < 0 || h > 24)) return "Running hours must be a number between 0 and 24.";
  if (kg > kg3(shellStockKg)) return `The shell silo holds ${fmt(shellStockKg)} kg; ${fmt(kg)} kg can't be burned from it.`;
  return null;
}
