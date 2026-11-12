import { useState, type FormEvent } from "react";
import { formatKg } from "./batchUi";
import { EntryList, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DateInput } from "../ui/DateInput";
import { Field, Input, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import { SILO_SIZES, siloLabel, sizesTotal, type SiloSize, type SizeValues } from "@anagroci/contract/domain/calibration";
import {
  COOK_CHECK_LABELS, COOLING_HOURS, LOT_STATUS_LABELS, coolingError, cookRunError, lotBags, nextCookingStep, nextLotCode, sizesToRecook, type CookCheckState, type LotStatus,
} from "@anagroci/contract/domain/cooking";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchLots, LotView } from "@anagroci/contract/types/lots";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, numCol, statusCol, textCol } from "./columns";

const STATUS_TONE: Record<LotStatus, string> = {
  cooking: "decision", cooling: "decision", ready: "entry", shelled: "term", colour_sorted: "term",
  in_borma: "term", humidified: "term", peeled: "term", graded: "term", packed: "term", qc11_passed: "entry", dispatched: "entry",
};
const CHECK_TONE: Record<CookCheckState, string> = { not_checked: "system", waiting: "decision", ok: "entry", recook: "gap" };
export const LotStatusPill = ({ status }: { status: LotStatus }) => <Pill tone={STATUS_TONE[status]} label={LOT_STATUS_LABELS[status]} />;

/** The Lot this person should be looking at: the oldest with something left to do in this phase, or else the newest. */
const firstOpen = (lots: LotView[]) => lots.find((l) => l.earlyStatus === "cooking" || l.earlyStatus === "cooling") ?? lots.at(-1) ?? null;

const stepOf = (lot: LotView, can: LotPermissions) => nextCookingStep({
  ...can, sizes: lot.cookedSizes, checks: lot.cookChecks, toRecook: sizesToRecook(lot.cookedSizes, lot.entries), inCooling: lot.coolingAt !== null, cooling: lot.coolingCheck,
  loggedSizes: lot.entries.filter((e) => e.kind === "cooker_log").map((e) => e.values.size as SiloSize),
});

/**
 * Phase 3 in the shape of Calibration: one sentence saying what to do next, then numbered steps. Cooking makes the
 * Lot; the steps after it are about one Lot, the one picked in step 1.
 */
export function CookingSection({ batchCode, data, calibration, can, onChanged, onGoToShelling }: {
  batchCode: string;
  data: BatchLots;
  calibration: BatchCalibration;
  can: LotPermissions;
  onChanged: () => void;
  onGoToShelling: () => void;
}) {
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  const lot = data.lots.find((l) => l.code === pickedCode) ?? firstOpen(data.lots);
  const step = lot ? stepOf(lot, can) : "none";
  const inSilosKg = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  const ready = lot !== null && (lot.earlyStatus === "ready" || lot.earlyStatus === "shelled");
  const held = lot ? sizesToRecook(lot.cookedSizes, lot.entries) : [];

  const nextText =
    data.lots.length === 0
      ? (inSilosKg > 0 ? (can.canFloor ? `Next: in step 1, click "Cook a Lot". The silos hold ${formatKg(inSilosKg)} ready to cook.` : "Nothing for you to do yet. The first Lot still has to be cooked.") : "Nothing to do yet. Nuts arrive here once they are sorted into the silos in Calibration.")
    : step === "cooker_log" ? (held.length > 0 ? `Size ${held.map(siloLabel).join(", ")} failed its cooking check. Next: cook it again, add the new run in step 2, then check it again in step 3.` : `Next: in step 2, fill in the cooker log for Lot ${lot!.code}.`)
    : step === "qc3" ? (can.canReview && lot!.cookedSizes.some((s) => lot!.cookChecks[s] === "waiting") ? `Next: in step 3, approve or reject the cooking check waiting for you on Lot ${lot!.code}.` : `Next: in step 3, do the cooking check (QC-3) for each size of Lot ${lot!.code}.`)
    : step === "cooling" ? `Next: in step 4, move Lot ${lot!.code} into a cooling silo, where it rests ${COOLING_HOURS} hours.`
    : step === "qc4" ? (can.canReview && lot!.coolingCheck === "waiting" ? `Next: in step 5, approve or reject the moisture and temperature check on Lot ${lot!.code}.` : `Next: in step 5, check the moisture and temperature (QC-4) of Lot ${lot!.code}.`)
    : ready ? `Lot ${lot!.code} (${formatKg(lot!.totalKg)}) is cooked, cooled and ready for Shelling.`
    : `Nothing for you to do on Lot ${lot!.code} right now. The Warehouse Incharge or the QFS Officer does the next job.`;

  const lotColumns: Column<LotView>[] = [
    textCol("Lot", (l) => l.code, { strong: true }),
    dateCol("Cooked on", (l) => l.date),
    ...SILO_SIZES.map((s) => kgCol<LotView>(s.code, (l) => l.sizes[s.key], { zeroAsDash: true })),
    kgCol("Total", (l) => l.totalKg, { strong: true }),
    numCol("Bags", (l) => l.bags, { digits: 1 }),
    statusCol("Status", (l) => LOT_STATUS_LABELS[l.status], (l) => <LotStatusPill status={l.status} />),
    { label: "", align: "right", nowrap: true, render: (l) => (l.code === lot?.code ? <Pill tone="term" label="Shown below" /> : <Button variant="secondary" onClick={() => setPickedCode(l.code)}>Show below</Button>) },
  ];

  return (
    <div className="space-y-4">
      <NextStep done={ready && step === "none"} action={ready && step === "none" && <Button variant="secondary" icon="arrow_downward" onClick={onGoToShelling}>Go to Shelling</Button>}>{nextText}</NextStep>

      <StepCard n={1} title="Cook by size" status={data.lots.length === 0 ? "No Lot yet" : `${data.lots.length} Lot${data.lots.length === 1 ? "" : "s"} · ${formatKg(data.lots.reduce((n, l) => n + l.totalKg, 0))} cooked`} active={data.lots.length === 0 && can.canFloor} done={data.lots.length > 0}>
        <p className="text-[13px] text-warmstone-800 mb-3">Each size is steam-cooked from its own silo. This is where the Lot is born: everything after this is tracked by its number.</p>
        {can.canFloor && <Button icon="add" disabled={inSilosKg <= 0} onClick={() => setCooking(true)}>Cook a Lot</Button>}
        {data.lots.length > 0 && <div className="mt-3"><DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={lotColumns} rows={data.lots} keyFn={(l) => l.code} /></div>}
        {lot && can.canFloor && lot.coolingAt === null && <CookRows lot={lot} onChanged={onChanged} />}
        {cooking && (
          <Modal wide title="Cook a Lot" onClose={() => setCooking(false)}>
            <CookForm batchCode={batchCode} data={data} calibration={calibration} onSaved={(code) => { setPickedCode(code); setCooking(false); onChanged(); }} />
          </Modal>
        )}
      </StepCard>

      {lot && (
        <>
          <h3 className="pt-2 text-[15px] font-bold text-warmstone-900">Steps 2 to 6 for Lot {lot.code} · {formatKg(lot.totalKg)}</h3>
          <StepCard n={2} title="Cooker log" status={`${lot.entries.filter((e) => e.kind === "cooker_log").length} run${lot.entries.filter((e) => e.kind === "cooker_log").length === 1 ? "" : "s"} written`} active={step === "cooker_log"} done={lot.coolingAt !== null}>
            <EntryList kind="cooker_log" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={3} title="Cooking check (QC-3)" status={lot.cookedSizes.every((s) => lot.cookChecks[s] === "ok") ? "Every size passed" : `${lot.cookedSizes.filter((s) => lot.cookChecks[s] !== "ok").length} of ${lot.cookedSizes.length} sizes still to pass`} active={step === "qc3"} done={lot.cookedSizes.every((s) => lot.cookChecks[s] === "ok")}>
            <ul className="flex flex-wrap gap-2 mb-3">
              {lot.cookedSizes.map((s) => (
                <li key={s} className="flex items-center gap-2 rounded-xl border border-warmstone-200 px-3 py-2 text-[13px] text-warmstone-800">
                  <b className="font-semibold">{siloLabel(s)}</b>
                  <Pill tone={CHECK_TONE[lot.cookChecks[s]!]} label={COOK_CHECK_LABELS[lot.cookChecks[s]!]} />
                </li>
              ))}
            </ul>
            <EntryList kind="qc3" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={4} title="Move to a cooling silo" status={lot.coolingAt ? `In ${lot.coolingSilo} since ${formatCoolingAt(lot.coolingAt)}` : "Not moved yet"} active={step === "cooling"} done={lot.coolingAt !== null}>
            <CoolingStep lot={lot} canEdit={can.canFloor} onChanged={onChanged} />
          </StepCard>
          <StepCard n={5} title="Moisture and temperature check (QC-4)" status={lot.coolingCheck === "ok" ? "OK: ready for shelling" : lot.coolingCheck === "wait" ? "Wait: check again" : lot.coolingCheck === "waiting" ? "Waiting for approval" : "Not checked yet"} active={step === "qc4"} done={lot.coolingCheck === "ok"}>
            {lot.coolingAt
              ? <EntryList kind="qc4" lot={lot} can={can} onChanged={onChanged} />
              : <p className="text-[13px] text-warmstone-800">This check comes after the Lot has rested {COOLING_HOURS} hours in a cooling silo.</p>}
          </StepCard>
          <StepCard n={6} title="Cooking waste water" status={`${formatKg(lot.entries.filter((e) => e.kind === "waste_water").reduce((n, e) => n + (Number(e.values.kg) || 0), 0))} from this Lot`} active={false} done={false}>
            <EntryList kind="waste_water" lot={lot} can={can} onChanged={onChanged} />
            <p className="mt-2 text-[12px] text-warmstone-500">The tank's balance and its trucks are in Shelling, under By-products and trucks.</p>
          </StepCard>
        </>
      )}
    </div>
  );
}

export const formatCoolingAt = (at: string) => `${formatDate(at.slice(0, 10))} ${at.slice(11)}`;

/** A Lot's cooking rows, each removable until the Lot goes to its cooling silo; only worth showing once there is a choice to make. */
function CookRows({ lot, onChanged }: { lot: LotView; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function remove(id: number) {
    const last = lot.runs.length === 1;
    if (!window.confirm(last ? `This is Lot ${lot.code}'s only row. Removing it removes the Lot, and its kg go back to the silos.` : "Remove this row? Its kg go back to the silos.")) return;
    setError(null);
    try {
      await api.deleteCookRun(id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <div className="mt-3 border-t border-warmstone-100 pt-3">
      <h4 className="text-[13px] font-bold text-warmstone-900 mb-2">What was entered for Lot {lot.code}</h4>
      <ul className="space-y-1">
        {lot.runs.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 text-[13px] text-warmstone-800 tabular-nums">
            <span>{formatDate(r.date)} · <b>{formatKg(r.totalKg)}</b> <span className="text-[12px] text-warmstone-500">· {SILO_SIZES.filter((s) => r.sizes[s.key]).map((s) => `${s.code}: ${r.sizes[s.key]} kg`).join(" · ")}</span></span>
            <button type="button" onClick={() => remove(r.id)} aria-label={`Remove the cooking row of ${formatDate(r.date)}`} className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors">
              <span className="material-symbols-outlined text-[20px]">delete</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[12px] text-danger-700 mt-2">{error}</p>}
    </div>
  );
}

function CookForm({ batchCode, data, calibration, onSaved }: { batchCode: string; data: BatchLots; calibration: BatchCalibration; onSaved: (code: string) => void }) {
  const [date, setDate] = useState(todayIso());
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [sizes, setSizes] = useState<SizeValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = typedCode ?? (date ? nextLotCode(date, data.allLotCodes) : "");
  const stock = Object.fromEntries(calibration.silos.map((s) => [s.size, s.stockKg])) as Record<SiloSize, number>;
  const total = sizesTotal(sizes);
  const live = cookRunError({ date, code, sizes }, stock);
  const over = SILO_SIZES.find((s) => Number(sizes[s.key]) > stock[s.key]);
  const existing = data.allLotCodes.includes(code.trim().toUpperCase());
  const failed = SILO_SIZES.filter((s) => Number(sizes[s.key]) > 0 && calibration.siloChecks[s.key].state === "failed");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (live) return setError(live);
    setSaving(true);
    setError(null);
    try {
      const lot = await api.cookFactoryLot({ batchCode, code, date, sizes });
      onSaved(lot.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><DateInput value={date} onChange={setDate} className={inputClass} /></Field>
        <Field label="Lot number" hint={existing ? "This Lot already exists: this adds a row to it." : "Suggested from the date. Change it if the floor used another."}>
          <Input value={code} onChange={(e) => setTypedCode(e.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="block text-[13px] font-bold text-warmstone-900 mb-3">How many kg were cooked from each silo?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {calibration.silos.filter((s) => s.stockKg > 0).map((s) => (
            <Field key={s.size} label={`Silo ${siloLabel(s.size)}`} hint={`Holds ${formatKg(s.stockKg)}`}>
              <Input numeric value={sizes[s.size] ?? ""} onChange={(e) => setSizes((p) => ({ ...p, [s.size]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <p className="text-[12px] text-warmstone-500 mt-2">Only silos holding nuts are shown. Leave a silo blank if nothing came from it.</p>
      </fieldset>
      <p className={`text-[13px] tabular-nums ${over ? "text-danger-700" : "text-warmstone-800"}`}>
        Total <b>{formatKg(total)}</b> · {lotBags(total).toLocaleString("en-US", { maximumFractionDigits: 1 })} bags of 80 kg
        {over && <> · Silo {siloLabel(over.key)} holds only {formatKg(stock[over.key])}.</>}
      </p>
      {failed.length > 0 && <p className="text-[12px] text-ambernut-800">Silo {failed.map((s) => s.code).join(", ")} failed its sizing check and its nuts have not been moved yet.</p>}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving || Boolean(over)}>Save the Lot</Button>
      </div>
    </form>
  );
}

function CoolingStep({ lot, canEdit, onChanged }: { lot: LotView; canEdit: boolean; onChanged: () => void }) {
  const [silo, setSilo] = useState(lot.coolingSilo ?? "");
  const [date, setDate] = useState(lot.coolingAt?.slice(0, 10) ?? todayIso());
  const [time, setTime] = useState(lot.coolingAt?.slice(11) ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passed = lot.cookedSizes.every((s) => lot.cookChecks[s] === "ok");
  const checked = lot.entries.some((e) => e.kind === "qc4" && e.status !== "rejected");

  if (lot.coolingAt && (checked || !canEdit)) {
    return <p className="text-[13px] text-warmstone-800">In cooling silo <b>{lot.coolingSilo}</b> since <b>{formatCoolingAt(lot.coolingAt)}</b>. It rests {COOLING_HOURS} hours before its check.</p>;
  }
  if (!passed) return <p className="text-[13px] text-warmstone-800">Every size has to pass its cooking check (QC-3) before the Lot can move here.</p>;
  if (!canEdit) return <p className="text-[13px] text-warmstone-800">The Warehouse Incharge moves the Lot to its cooling silo.</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = coolingError({ silo, date, time });
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.moveLotToCooling(lot.code, { silo, date, time });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Cooling silo"><Input value={silo} onChange={(e) => setSilo(e.target.value)} /></Field>
        <Field label="Date in"><DateInput value={date} onChange={setDate} className={inputClass} /></Field>
        <Field label="Time in" hint={`The ${COOLING_HOURS} h clock starts here.`}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving}>{lot.coolingAt ? "Correct the cooling silo" : "Move to the cooling silo"}</Button>
      </div>
    </form>
  );
}
