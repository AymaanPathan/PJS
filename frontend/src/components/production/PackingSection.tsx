import { useState } from "react";
import { BatchStatusPill, formatKg } from "./batchUi";
import { CheckPill, LotPicker, countOf, pickLot, plural } from "./LaterLot";
import { EntryList, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { StatBlock } from "../ui/StatBlock";
import { DataTable, type Column } from "../ui/DataTable";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, numCol, textCol } from "./columns";
import { api, ApiError } from "../../repository/api";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { CheckState } from "@anagroci/contract/domain/laterPhases";
import type { FgStockRow } from "@anagroci/contract/domain/packing";
import type { RunBalanceLine } from "@anagroci/contract/domain/runBalance";
import type { BatchLots } from "@anagroci/contract/types/lots";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";

const checkWord = (s: CheckState) => (s === "ok" ? "OK" : s === "no" ? "held · back to packing" : s === "waiting" ? "waiting for approval" : "not checked yet");

/**
 * Phase 8: packing per grade (code and SKU come from the client's material master), QC-9 before filling, QC-11 on the
 * finished goods, dispatch against a contract, the finished-goods stock with its aging — and, for the whole run, the
 * batch balance and closing it.
 */
export function PackingSection({ run, data, can, canReopen, onChanged }: { run: BatchDetail; data: BatchLots; can: LotPermissions; canReopen: boolean; onChanged: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const lot = pickLot(data.lots, picked, (l) => l.later.borma.toPackingKg > 0 && countOf(l, "packing") === 0);

  const fgColumns: Column<FgStockRow>[] = [
    textCol("Grade", (r) => r.grade, { strong: true, wrap: true }),
    textCol("Material code", (r) => r.code, { mono: true }),
    numCol("Packed", (r) => r.packedQty, { digits: 0 }),
    numCol("Dispatched", (r) => r.dispatchedQty, { digits: 0 }),
    numCol("In stock", (r) => r.closingQty, { digits: 0 }),
    kgCol("In stock (kg)", (r) => r.closingKg),
    dateCol("Packed on", (r) => r.packedOn),
    textCol("Aging", (r) => (r.closingQty > 0 ? `${r.agingDays} days (${r.bucket})` : "-")),
  ];

  const L = lot?.later;
  const fg = L?.fg ?? [];
  const sum = (f: (r: FgStockRow) => number) => fg.reduce((n, r) => n + f(r), 0);
  const waiting = Boolean(L && can.canReview && (L.checks.qc9 === "waiting" || L.checks.qc11 === "waiting"));
  const next = !lot || !L ? "No Lot yet. A Lot is made when its nuts are cooked, in Cooking."
    : run.status === "closed" ? `This production run is closed. Its records are locked${canReopen ? "; you can reopen it in step 6" : ""}.`
    : waiting ? `Next: approve or reject the check waiting for you on Lot ${lot.code}.`
    : L.checks.qc9 === "not_checked" && countOf(lot, "packing") === 0 ? `Next: in step 1 the QFS Officer checks the kernels before filling (QC-9), then pack them in step 2.`
    : L.checks.qc9 === "no" ? "QC-9 sent the kernels back to packing: re-sort or re-blend, then check again."
    : countOf(lot, "packing") === 0 ? `Next: in step 2, record what was packed for Lot ${lot.code}, per grade.`
    : L.checks.qc11 === "no" ? "QC-11 held the finished goods: they go back to packing and can't be dispatched until a new check says OK."
    : L.checks.qc11 === "not_checked" ? "Next: in step 3, the QFS Officer checks the finished goods (QC-11)."
    : sum((r) => r.closingQty) > 0 ? `Lot ${lot.code} has ${sum((r) => r.closingQty).toLocaleString("en-US")} packs in stock. Dispatch them against a contract in step 4.`
    : `Everything packed from Lot ${lot.code} has been dispatched.`;

  return (
    <div className="space-y-4">
      <NextStep done={Boolean(L && (run.status === "closed" || (L.checks.qc11 === "ok" && fg.length > 0 && sum((r) => r.closingQty) === 0)))}>{next}</NextStep>
      {lot && L && (
        <>
          <LotPicker lots={data.lots} lot={lot} onPick={setPicked} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatBlock icon="inventory_2" label="Packed" value={formatKg(sum((r) => r.packedKg))} sub={`${sum((r) => r.packedQty).toLocaleString("en-US")} packs · ${plural(fg.length, "grade")}`} />
            <StatBlock icon="local_shipping" label="Dispatched" value={formatKg(sum((r) => r.dispatchedKg))} sub={`${sum((r) => r.dispatchedQty).toLocaleString("en-US")} packs`} />
            <StatBlock icon="warehouse" label="In stock" value={formatKg(sum((r) => r.closingKg))} sub={`${sum((r) => r.closingQty).toLocaleString("en-US")} packs`} />
            <StatBlock icon="verified" label="Final check (QC-11)" value={checkWord(L.checks.qc11)} tone={L.checks.qc11 === "ok" ? "success" : L.checks.qc11 === "no" ? "danger" : "default"} sub="Stock is released once it is OK" />
          </div>

          <StepCard n={1} title="Check before filling (QC-9)" status={`QC-9: ${checkWord(L.checks.qc9)}`} active={L.checks.qc9 === "no" || (L.checks.qc9 === "waiting" && can.canReview)} done={L.checks.qc9 === "ok"}>
            <div className="mb-3"><CheckPill state={L.checks.qc9} /></div>
            <EntryList kind="qc9" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={2} title="Packing" status={countOf(lot, "packing") === 0 ? "Nothing packed yet" : plural(countOf(lot, "packing"), "packing line")} active={countOf(lot, "packing") === 0} done={countOf(lot, "packing") > 0}>
            <EntryList kind="packing" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={3} title="Final output analysis (QC-11)" status={`QC-11: ${checkWord(L.checks.qc11)}`} active={L.checks.qc11 === "no" || (L.checks.qc11 === "waiting" && can.canReview)} done={L.checks.qc11 === "ok"}>
            <div className="mb-3"><CheckPill state={L.checks.qc11} /></div>
            <EntryList kind="qc11" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={4} title="Dispatch" status={plural(countOf(lot, "fg_dispatch"), "dispatch")} active={false} done={fg.length > 0 && sum((r) => r.closingQty) === 0}>
            {L.checks.qc11 !== "ok" && countOf(lot, "packing") > 0 && (
              <p className="flex items-center gap-1.5 text-[12px] text-ambernut-800 mb-3">
                <span className="material-symbols-outlined text-[16px]">warning</span>The finished goods of this Lot have not passed QC-11 yet.
              </p>
            )}
            <EntryList kind="fg_dispatch" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={5} title="Finished goods stock and aging" status="Worked out by the app: packed − dispatched" active={false} done={false}>
            <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={fgColumns} rows={fg} keyFn={(r) => r.grade} emptyTitle="Nothing packed yet" emptyHint="Each grade appears here once it is packed." />
          </StepCard>
        </>
      )}
      <CloseRunStep run={run} data={data} canClose={can.canReview} canReopen={canReopen} onChanged={onChanged} />
    </div>
  );
}

/** The doc's "Closing the batch": every stream that left the line, the kg packed, and the Incharge's close. */
function CloseRunStep({ run, data, canClose, canReopen, onChanged }: { run: BatchDetail; data: BatchLots; canClose: boolean; canReopen: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = data.balance;
  const closed = run.status === "closed";

  async function act(close: boolean) {
    const ask = close
      ? `Close ${run.code}? Its Lots' records are locked and its bins become free for a new run. Only an Admin can reopen it.`
      : `Reopen ${run.code}? Its Lots can take records again.`;
    if (!window.confirm(ask)) return;
    setBusy(true);
    setError(null);
    try {
      await (close ? api.closeProductionRun(run.code) : api.reopenProductionRun(run.code));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<RunBalanceLine>[] = [
    textCol("Stream", (l) => l.label, { strong: true }),
    { label: "", align: "right", nowrap: true, render: (l) => (l.sign > 0 ? "+" : "−") },
    kgCol("Kg", (l) => l.kg),
  ];

  return (
    <StepCard n={6} title="Close the production run" status={closed ? `Closed ${run.closedAt ? formatDateTime(run.closedAt) : ""}${run.closedBy ? ` by ${run.closedBy}` : ""}` : "When all its Lots are packed"} active={false} done={closed}>
      <div className="space-y-4">
        <p className="text-[13px] text-warmstone-800">
          The batch balance for the whole run: the RCN received, less every stream that left the line, against the kg packed. Cooking water is not counted. The difference is shown for you to check; it never stops the run from closing.
        </p>
        <DataTable pageSize={20} columns={columns} rows={b.lines} keyFn={(l) => l.label} />
        <div className="grid sm:grid-cols-3 gap-4">
          <StatBlock icon="functions" label="Should reach packing" value={formatKg(b.expectedKg)} />
          <StatBlock icon="inventory_2" label="Packed" value={formatKg(b.packedKg)} />
          <StatBlock icon="help" label="Unaccounted" value={formatKg(b.unaccountedKg)} sub={b.unaccountedPct === null ? undefined : `${b.unaccountedPct.toFixed(2)} % of the RCN received`} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BatchStatusPill status={run.status} />
          {!closed && canClose && <Button icon="lock" disabled={busy} onClick={() => void act(true)}>Close {run.code}</Button>}
          {closed && canReopen && <Button variant="secondary" icon="lock_open" disabled={busy} onClick={() => void act(false)}>Reopen {run.code}</Button>}
        </div>
        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      </div>
    </StepCard>
  );
}
