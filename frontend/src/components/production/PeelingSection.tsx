import { useState } from "react";
import { formatKg } from "./batchUi";
import { CheckPill, LotPicker, countOf, pickLot, plural } from "./LaterLot";
import { EntryList, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { StatBlock } from "../ui/StatBlock";
import { WORKER_ALERT_KG, workerBand } from "@anagroci/contract/domain/peeling";
import type { CheckState } from "@anagroci/contract/domain/laterPhases";
import type { BatchLots } from "@anagroci/contract/types/lots";

const checkWord = (s: CheckState) => (s === "ok" ? "OK" : s === "no" ? "sent back" : s === "waiting" ? "waiting for approval" : "not checked yet");

/**
 * Phase 7, in the order it happens on the floor: humidification and its moisture check (QC-10), the peeling machine,
 * husk winnowing, the grading day record with the workers' output, and the in-process check (QC-12). Husk and
 * reject kernels go to their stores and leave by truck.
 */
export function PeelingSection({ data, can, onChanged }: { data: BatchLots; can: LotPermissions; onChanged: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const lot = pickLot(data.lots, picked, (l) => l.later.borma.toPeelingKg > 0 && countOf(l, "grading") === 0);
  if (!lot) return <NextStep done={false}>No Lot yet. A Lot is made when its nuts are cooked, in Cooking.</NextStep>;

  const L = lot.later;
  const n = (kind: string) => countOf(lot, kind);
  const workers = lot.entries.filter((e) => e.kind === "worker_output" && e.status !== "rejected");
  const below = workers.filter((w) => Number(w.values.kg) < WORKER_ALERT_KG).length;
  const bands = workers.reduce<Record<string, number>>((m, w) => { const k = workerBand(Number(w.values.kg) || 0); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const store = (s: string) => data.stores.find((x) => x.stream === s);
  const waiting = can.canReview && (L.checks.qc10 === "waiting" || L.checks.qc12 === "waiting");

  const next =
    waiting ? `Next: approve or reject the check waiting for you on Lot ${lot.code}.`
    : n("humidification") === 0 ? `Next: in step 1, put the trolleys the Borma sent to peeling into a humidification chamber, and weigh them in.`
    : L.checks.qc10 === "no" ? "QC-10 sent the kernels back to humidification. Humidify again, then check again in step 2."
    : L.checks.qc10 === "not_checked" ? "Next: in step 2, the QFS Officer checks the moisture before peeling (QC-10)."
    : n("peeling") === 0 ? "Next: in step 3, record what the peeling machine took in and gave out."
    : n("grading") === 0 ? "Next: in step 5, record the grading day: kg per grade."
    : L.checks.qc12 === "no" ? "QC-12 sent the kernels back to grading. Grade again, then check again in step 7."
    : L.checks.qc12 === "not_checked" ? "Next: in step 7, the QFS Officer checks the graded kernels (QC-12)."
    : `Lot ${lot.code} is graded and checked. The graded kernels go on to Packing.`;

  return (
    <div className="space-y-4">
      <NextStep done={L.checks.qc12 === "ok" && !waiting}>{next}</NextStep>
      <LotPicker lots={data.lots} lot={lot} onPick={setPicked} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBlock icon="call_split" label="From the Borma" value={formatKg(L.borma.toPeelingKg)} sub="Trolleys sent to peeling" />
        <StatBlock icon="humidity_percentage" label="Moisture gained" value={formatKg(L.humidGainKg)} sub="Humidification: kg out − kg in" />
        <StatBlock icon="category" label="Graded" value={formatKg(L.gradedKg)} sub={`${formatKg(L.rejectKernelsKg)} reject kernels`} />
        <StatBlock icon="grass" label="Husk to storage" value={formatKg(L.huskKg)} sub="From husk winnowing" />
      </div>

      <StepCard n={1} title="Humidification" status={plural(n("humidification"), "line")} active={n("humidification") === 0} done={n("humidification") > 0}>
        <EntryList kind="humidification" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={2} title="Moisture before peeling (QC-10)" status={`QC-10: ${checkWord(L.checks.qc10)}`} active={L.checks.qc10 === "no" || (L.checks.qc10 === "waiting" && can.canReview)} done={L.checks.qc10 === "ok"}>
        <div className="mb-3"><CheckPill state={L.checks.qc10} /></div>
        <EntryList kind="qc10" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={3} title="Peeling machine" status={plural(n("peeling"), "line")} active={false} done={n("peeling") > 0}>
        <EntryList kind="peeling" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={4} title="Husk winnowing" status={plural(n("winnowing"), "line")} active={false} done={n("winnowing") > 0}>
        <EntryList kind="winnowing" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={5} title="Grading day record" status={n("grading") === 0 ? "Not entered yet" : `${formatKg(L.gradedKg + L.rejectKernelsKg)} graded`} active={false} done={n("grading") > 0}>
        <EntryList kind="grading" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={6} title="Worker output (manual peeling)" status={workers.length === 0 ? "No worker yet" : `${plural(workers.length, "worker")}${below ? ` · ${below} under ${WORKER_ALERT_KG} kg` : ""}`} active={false} done={workers.length > 0}>
        {workers.length > 0 && (
          <p className="text-[13px] text-warmstone-800 mb-3">
            {Object.entries(bands).map(([band, count]) => `${band}: ${count}`).join(" · ")}
          </p>
        )}
        <EntryList kind="worker_output" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={7} title="In-process quality (QC-12)" status={`QC-12: ${checkWord(L.checks.qc12)}`} active={L.checks.qc12 === "no" || (L.checks.qc12 === "waiting" && can.canReview)} done={L.checks.qc12 === "ok"}>
        <div className="mb-3"><CheckPill state={L.checks.qc12} /></div>
        <EntryList kind="qc12" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={8} title="Husk and reject kernels to storage" status={`${formatKg(store("husk")?.stockKg ?? 0)} husk · ${formatKg(store("reject_kernels")?.stockKg ?? 0)} reject kernels in storage`} active={false} done={false}>
        <p className="text-[13px] text-warmstone-800">
          The husk winnowed to storage and the reject kernels from grading are stored and sold. Their kg come from steps 4 and 5. A sale is a truck: in Shelling, step 6, choose "Husk" or "Reject kernels".
        </p>
      </StepCard>
    </div>
  );
}
