import { useState } from "react";
import { formatKg } from "./batchUi";
import { CheckPill, LotPicker, countOf, pickLot, plural } from "./LaterLot";
import { EntryList, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { StatBlock } from "../ui/StatBlock";
import { DataTable, type Column } from "../ui/DataTable";
import { PRODUCTION_PAGE_SIZE, kgCol, pctCol, textCol } from "./columns";
import { BORMA_MATERIALS, type BormaMaterial } from "@anagroci/contract/domain/borma";
import type { BatchLots } from "@anagroci/contract/types/lots";

interface MaterialRow { material: BormaMaterial; beforeKg: number; afterKg: number }

/**
 * Phase 6. Trolley lines (weighed before and after the oven), the oven runs, QC-8, and where each trolley goes. The
 * Lot's Borma summary — the client's "8. Borma Process Report" — is worked out from the trolley lines, never typed.
 * Any Lot of the run can be worked on here, whatever it has been through.
 */
export function BormaSection({ data, can, onChanged }: { data: BatchLots; can: LotPermissions; onChanged: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const lot = pickLot(data.lots, picked, (l) => l.later.borma.trolleys === 0 || l.later.borma.weighedAfter < l.later.borma.trolleys);
  if (!lot) return <NextStep done={false}>No Lot yet. A Lot is made when its nuts are cooked, in Cooking.</NextStep>;

  const b = lot.later.borma;
  const qc8 = lot.later.checks.qc8;
  const inOven = b.trolleys - b.weighedAfter;
  const ovens = countOf(lot, "borma_oven");
  const next =
    can.canReview && qc8 === "waiting" ? `Next: approve or reject the quality check (QC-8) waiting for you on Lot ${lot.code}.`
    : b.trolleys === 0 ? `Next: in step 1, add a line for each trolley of Lot ${lot.code}: its empty weight and its weight loaded.`
    : inOven > 0 ? `${plural(inOven, "trolley")} still in the oven. When they come out, open the line (pencil) in step 1 and add the weight after.`
    : qc8 === "no" ? "QC-8 sent the kernels back into the Borma. Run the trolleys again, update their weights after, then check again in step 3."
    : qc8 === "not_checked" ? `Next: in step 3, the QFS Officer checks the dried kernels of Lot ${lot.code} (QC-8).`
    : qc8 === "ok" ? `Lot ${lot.code} is dried and checked. Wholes go to Packing; pieces, reject and oil go to Peeling & grading.`
    : `Nothing for you to do on Lot ${lot.code} right now.`;

  const materials: MaterialRow[] = BORMA_MATERIALS.map((m) => ({ material: m, ...b.byMaterial[m] })).filter((r) => r.beforeKg > 0);
  const columns: Column<MaterialRow>[] = [
    textCol("Material", (r) => r.material, { strong: true }),
    kgCol("Net before (kg)", (r) => r.beforeKg),
    kgCol("Net after (kg)", (r) => r.afterKg, { zeroAsDash: true }),
    pctCol("Loss %", (r) => (r.afterKg > 0 && r.beforeKg > 0 ? ((r.beforeKg - r.afterKg) / r.beforeKg) * 100 : null), 1),
  ];

  return (
    <div className="space-y-4">
      <NextStep done={qc8 === "ok" && inOven === 0 && b.trolleys > 0}>{next}</NextStep>
      <LotPicker lots={data.lots} lot={lot} onPick={setPicked} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBlock icon="scale" label="Before the oven" value={formatKg(b.beforeKg)} sub={`${plural(b.trolleys, "trolley")}`} />
        <StatBlock icon="local_fire_department" label="After the oven" value={formatKg(b.afterKg)} sub={inOven > 0 ? `${inOven} still in the oven` : "Every trolley weighed"} />
        <StatBlock icon="water_drop" label="Moisture loss" value={formatKg(b.lossKg)} sub={b.lossPct === null ? "Once trolleys are weighed after" : `${b.lossPct.toFixed(1)} % of what went in`} />
        <StatBlock icon="call_split" label="Sent on" value={formatKg(b.toPackingKg + b.toPeelingKg)} sub={`${formatKg(b.toPackingKg)} to packing · ${formatKg(b.toPeelingKg)} to peeling`} />
      </div>

      <StepCard n={1} title="Trolley lines" status={b.trolleys === 0 ? "No trolley yet" : `${plural(b.trolleys, "trolley")} · ${b.weighedAfter} weighed after`} active={b.trolleys === 0 || inOven > 0} done={b.trolleys > 0 && inOven === 0}>
        <EntryList kind="borma_trolley" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={2} title="Oven runs" status={ovens === 0 ? "No oven run logged" : plural(ovens, "oven run")} active={false} done={ovens > 0}>
        <EntryList kind="borma_oven" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={3} title="Quality after the Borma (QC-8)" status={`QC-8: ${qc8 === "ok" ? "OK" : qc8 === "no" ? "back into the Borma" : qc8 === "waiting" ? "waiting for approval" : "not checked yet"}`} active={qc8 === "not_checked" || qc8 === "no" || (qc8 === "waiting" && can.canReview)} done={qc8 === "ok"}>
        <div className="mb-3"><CheckPill state={qc8} /></div>
        <EntryList kind="qc8" lot={lot} can={can} onChanged={onChanged} />
      </StepCard>
      <StepCard n={4} title="Borma summary" status="Worked out by the app from the trolley lines" active={false} done={false}>
        <p className="text-[13px] text-warmstone-800 mb-3">Net = gross − empty trolley · Loss = net before − net after. Only trolleys weighed after the oven count towards the loss.</p>
        <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={materials} keyFn={(r) => r.material} emptyTitle="No trolley yet" emptyHint="The summary fills in as trolley lines are added." />
      </StepCard>
    </div>
  );
}
