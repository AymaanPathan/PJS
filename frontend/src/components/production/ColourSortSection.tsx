import { useState } from "react";
import { formatKg } from "./batchUi";
import { LotStatusPill } from "./CookingSection";
import { EntryList, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { DataTable, type Column } from "../ui/DataTable";
import { Field, Select } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { SORT_CHECK_LABELS, nextColourSortStep, sorterComparison, type SortCheckState, type SortComparison } from "@anagroci/contract/domain/colourSort";
import { canColourSort } from "@anagroci/contract/domain/cooking";
import type { BatchLots } from "@anagroci/contract/types/lots";
import { PRODUCTION_PAGE_SIZE, textCol } from "./columns";

const CHECK_TONE: Record<SortCheckState, string> = { not_checked: "system", waiting: "decision", ok: "entry", resort: "gap" };
const pct = (n: number | undefined) => (n === undefined ? "-" : `${n.toFixed(1)} %`);

/**
 * Phase 5. The sorter's kg are already in the shelling day record, so this phase is about how well it sorted: a QC-7
 * sample before it and one per stream after it, compared side by side, and black rejection sent to storage for sale.
 */
export function ColourSortSection({ data, can, onChanged }: { data: BatchLots; can: LotPermissions; onChanged: () => void }) {
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const lots = data.lots.filter((l) => canColourSort(l.earlyStatus));
  // The oldest Lot not sorted yet, else the newest.
  const lot = lots.find((l) => l.code === pickedCode) ?? lots.find((l) => l.earlyStatus === "shelled") ?? lots.at(-1) ?? null;
  const notShelled = data.lots.length - lots.length;
  const of = (kind: string) => lot?.entries.filter((e) => e.kind === kind && e.status !== "rejected") ?? [];
  const waiting = lot?.entries.filter((e) => (e.kind === "qc7_before" || e.kind === "qc7_after") && e.status === "submitted") ?? [];
  const step = lot ? nextColourSortStep({ canCheck: can.canCheck, beforeSamples: of("qc7_before").length, streams: lot.sorterStreams, checks: lot.sortChecks }) : "none";
  const resort = lot?.sorterStreams.filter((s) => lot.sortChecks[s] === "resort") ?? [];
  const blackStore = data.stores.find((s) => s.stream === "black_rejection")!;
  const done = lot?.earlyStatus === "colour_sorted" && waiting.length === 0;

  const nextText = !lot
    ? (notShelled > 0 ? `No Lot is ready to sort yet. A Lot arrives here once its day record is entered in Shelling.` : "Nothing to do yet. A Lot arrives here once it is shelled.")
    : can.canReview && waiting.length > 0 ? `Next: approve or reject the ${waiting.length} sample${waiting.length === 1 ? "" : "s"} waiting for you on Lot ${lot.code}.`
    : resort.length > 0 && step === "after" ? `${resort.join(", ")} failed its check. Next: pass it through the sorter again, then in step 2 take a new sample after the sorter.`
    : step === "before" ? `Next: in step 1, take a sample before the sorter for Lot ${lot.code}.`
    : step === "after" ? `Next: in step 2, take a sample after the sorter for each stream of Lot ${lot.code}.`
    : done ? `Lot ${lot.code} is colour sorted. Its wholes, pieces and rejection + oil go on to the Borma ovens.`
    : `Nothing for you to do on Lot ${lot.code} right now. The QFS Officer takes the next sample.`;

  const comparison = lot ? sorterComparison(lot.entries) : [];
  const columns: Column<SortComparison>[] = [
    textCol("Stream", (r) => r.stream, { strong: true }),
    textCol("Size group", (r) => r.sizes),
    ...(["wholesPct", "brokensPct", "rejectionPct", "knifeMarkPct"] as const).map((key): Column<SortComparison> => ({
      label: { wholesPct: "Wholes", brokensPct: "Brokens", rejectionPct: "Rejection", knifeMarkPct: "Knife mark" }[key],
      align: "right", nowrap: true,
      render: (r) => <span className="tabular-nums">{pct(r.before?.[key])} → <b className="font-semibold">{pct(r.after?.[key])}</b></span>,
    })),
  ];

  return (
    <div className="space-y-4">
      <NextStep done={Boolean(done)}>{nextText}</NextStep>
      {lot && (
        <>
          {lots.length > 1 && (
            <div className="max-w-sm">
              <Field label="Which Lot are you working on?">
                <Select value={lot.code} onChange={(e) => setPickedCode(e.target.value)}>
                  {lots.map((l) => <option key={l.code} value={l.code}>{l.code} · {formatKg(l.totalKg)}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-warmstone-900">Lot {lot.code} · {formatKg(lot.shelledKg)} shelled <LotStatusPill status={lot.status} /></h3>
          <p className="text-[13px] text-warmstone-800 tabular-nums">
            The sorter split: wholes <b>{formatKg(lot.sorterKg.Wholes)}</b> · pieces <b>{formatKg(lot.sorterKg.Pieces)}</b> · rejection + oil <b>{formatKg(lot.sorterKg["Rejection + oil"])}</b> · black rejection <b>{formatKg(lot.shellingDays.reduce((n, d) => n + (Number(d.kg.blackRejectionKg) || 0), 0))}</b>. These come from the shelling day record.
          </p>
          <StepCard n={1} title="Sample before the sorter" status={`${of("qc7_before").length} sample${of("qc7_before").length === 1 ? "" : "s"}`} active={step === "before"} done={of("qc7_before").length > 0}>
            <EntryList kind="qc7_before" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={2} title="Quality after the sorter (QC-7)" status={lot.sorterStreams.every((s) => lot.sortChecks[s] === "ok") ? "Every stream passed" : `${lot.sorterStreams.filter((s) => lot.sortChecks[s] !== "ok").length} of ${lot.sorterStreams.length} streams still to pass`} active={step === "after"} done={lot.earlyStatus === "colour_sorted"}>
            <ul className="flex flex-wrap gap-2 mb-3">
              {lot.sorterStreams.map((s) => (
                <li key={s} className="flex items-center gap-2 rounded-xl border border-warmstone-200 px-3 py-2 text-[13px] text-warmstone-800">
                  <b className="font-semibold">{s}</b>
                  <Pill tone={CHECK_TONE[lot.sortChecks[s]!]} label={SORT_CHECK_LABELS[lot.sortChecks[s]!]} />
                </li>
              ))}
            </ul>
            <EntryList kind="qc7_after" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={3} title="Before and after, compared" status="Worked out by the app from the approved samples" active={false} done={comparison.some((r) => r.before && r.after)}>
            <p className="text-[13px] text-warmstone-800 mb-3">Each stream's newest sample before the sorter next to its newest sample after it. Wholes should go up and rejection down.</p>
            <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={comparison} keyFn={(r) => `${r.stream}|${r.sizes}`} emptyTitle="No approved sample yet" emptyHint="The comparison fills in as samples are approved." />
          </StepCard>
          <StepCard n={4} title="Black rejection to storage" status={`${formatKg(blackStore.stockKg)} in storage`} active={false} done={false}>
            <p className="text-[13px] text-warmstone-800">
              Black rejection goes to storage and is sold. Its kg come from the shelling day record: <b className="tabular-nums">{formatKg(blackStore.producedKg)}</b> in all, <b className="tabular-nums">{formatKg(blackStore.dispatchedKg)}</b> sold, <b className="tabular-nums">{formatKg(blackStore.stockKg)}</b> in storage now.
              A sale is a truck: in Shelling, step 6, choose "Black rejection".
            </p>
          </StepCard>
        </>
      )}
    </div>
  );
}
