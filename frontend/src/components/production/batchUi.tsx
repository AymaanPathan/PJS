import { Pill } from "../ui/Pill";
import { BATCH_STATUS_LABELS, type BatchStatus } from "@anagroci/contract/domain/productionBatch";
import { RCN_RECEIPT_STATUS_LABELS, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { siteSlugFor } from "../../config/sites";
import { useSites } from "../../state/SiteContext";
import { useTracking } from "../../state/TrackingContext";

/** Kg as the client reads batch sizes: tonnes, one decimal (4,172.9 t). */
export function formatTonnes(kg: number): string {
  return `${(kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  return <Pill tone={status === "in_process" ? "term" : status === "closed" ? "entry" : "system"} label={BATCH_STATUS_LABELS[status]} />;
}

/** Amber waits on someone, red went wrong (On hold), green is moving on or done. */
const RCN_TONE: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "decision",
  moisture_pending: "decision",
  on_hold: "gap",
  waiting_for_weighing: "entry",
  weighing: "entry",
  intake_done: "term",
  calibrating: "entry",
  calibrated: "term",
};

/** Kg as the tally sheet shows them: up to 2 decimals, thousands separated. */
export function formatKg(kg: number): string {
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
}

export function RcnReceiptStatusPill({ status }: { status: RcnReceiptStatus }) {
  return <Pill tone={RCN_TONE[status]} label={RCN_RECEIPT_STATUS_LABELS[status]} />;
}

/** Links from a batch back to procurement, resolved against the warehouses of the master. */
export function useSiteHrefs() {
  const sites = useSites();
  const { masters } = useTracking();
  const slug = (warehouse: string) => siteSlugFor(sites, masters, warehouse);
  return {
    /** Where a procurement receipt of `warehouse` opens, so a batch's Lots link back to their trucks. */
    receiptHref: (warehouse: string, receiptId: string) => `/${slug(warehouse)}/receipts/${encodeURIComponent(receiptId)}`,
    /** Where a BKT that brought a Lot to `warehouse` opens. */
    transferHref: (warehouse: string, transferId: string) => `/${slug(warehouse)}/transfers/${encodeURIComponent(transferId)}`,
  };
}

/**
 * The stages a production run walks through (the client's Production module: Intake, Calibration & sizing, Cooking,
 * Shelling, Colour sorting, Borma, Peeling & grading, Packing & dispatch), in order. `built` = has screens so far;
 * the rest are listed so nobody wonders where they went. `sheets` are the client's workbooks each stage replaces.
 */
export const PRODUCTION_STAGES = [
  { id: "intake", label: "Intake", built: true, sheets: "1. RCN Receipts · 2. Input RCN Quality report · 19. RCN Receipts Tally Sheet", text: "Each load from a warehouse bin gets an RCN receipt, a moisture check, then is weighed pallet by pallet." },
  { id: "calibration", label: "Calibration", built: true, sheets: "4. Calibration Process report · 5. Calibrated RCN Silos Stock report", text: "Sort each weighed load by nut size into the 9 silos, then check that each silo holds the right size." },
  { id: "cooking", label: "Cooking", built: true, sheets: "6. Cooking Process Report", text: "Steam-cook the nuts size by size to make a Lot, then rest the Lot 24 hours in a cooling silo." },
  { id: "shelling", label: "Shelling", built: true, sheets: "7. Shelling process Report · 13. Shelling Machine Quality Reports", text: "Cut the shells open and record what comes out: kernels, uncut nuts, shell and shell dust." },
  { id: "colour_sort", label: "Colour sorting", built: true, sheets: "12. Shelled Kernels Quality Report", text: "A camera machine splits the kernels into wholes, pieces, rejection + oil and black rejection. Check the sorter before and after." },
  { id: "borma", label: "Borma ovens", built: true, sheets: "18. Borma Loss Tally Sheet · 20. Borma Machine Monitoring report · 14. Final Output Analysis Report (8. Borma Process Report is worked out)", text: "Dry the kernels in the ovens, trolley by trolley: weigh each trolley before and after, log the oven run, check the quality (QC-8) and send each trolley on." },
  { id: "peeling", label: "Peeling & grading", built: true, sheets: "Manual Peeling Individual performance", text: "Humidify the kernels the Borma sent to peeling, peel them, winnow the husk and grade what comes out. Two checks: QC-10 and QC-12." },
  { id: "packing", label: "Packing & dispatch", built: true, sheets: "Packing Traceability FG Aging Report", text: "Pack each grade into pouches, check before filling (QC-9) and the finished goods (QC-11), dispatch against a contract, then close the run." },
] as const;

export type ProductionStageId = (typeof PRODUCTION_STAGES)[number]["id"];
