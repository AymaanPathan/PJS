import { useState, type FormEvent } from "react";
import { formatKg } from "./batchUi";
import { ByProductsPanel } from "./ByProductsPanel";
import { LotStatusPill } from "./CookingSection";
import { EntryList, Notes, type LotPermissions } from "./LotEntries";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DateInput } from "../ui/DateInput";
import { Field, Input, Select, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { api, ApiError } from "../../repository/api";
import { canShell } from "@anagroci/contract/domain/cooking";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { SHELLING_KG_FIELDS, nextShellingStep, shellingDayError, shellingDayNotes, shellingFigures, type ShellingDayValues } from "@anagroci/contract/domain/shelling";
import type { BatchLots, LotView, ShellingDayView } from "@anagroci/contract/types/lots";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, numCol, pctCol } from "./columns";
import { IconButton } from "../ui/IconButton";

const pct = (n: number) => `${n.toFixed(2)} %`;

/** Phase 4: first what is one Lot's (its day record, line runs and checks), then what is the factory's (shell silo, trucks). */
export function ShellingSection({ data, can, onChanged }: { data: BatchLots; can: LotPermissions; onChanged: () => void }) {
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const lots = data.lots.filter((l) => canShell(l.earlyStatus));
  // The oldest Lot with no day record yet, else the newest.
  const lot = lots.find((l) => l.code === pickedCode) ?? lots.find((l) => l.earlyStatus === "ready") ?? lots.at(-1) ?? null;
  const waitingOnCooling = data.lots.length - lots.length;
  const count = (kind: string) => lot?.entries.filter((e) => e.kind === kind && e.status !== "rejected").length ?? 0;
  // QC-5 has two halves, and the step is done only with a record of each.
  const qc5Samples = count("qc5_frequency") + count("qc5_capacity");
  const counts = { days: lot?.shellingDays.length ?? 0, lineRuns: count("line_run"), qc5: Math.min(count("qc5_frequency"), count("qc5_capacity")), qty1: count("qty1"), qc6: count("qc6") };
  const waitingApproval = lot?.entries.filter((e) => e.status === "submitted") ?? [];
  const step = lot ? nextShellingStep({ ...can, ...counts }) : "none";

  const nextText = !lot
    ? (waitingOnCooling > 0 ? `No Lot is ready to shell yet. ${waitingOnCooling} Lot${waitingOnCooling === 1 ? " is" : "s are"} still in Cooking. A Lot arrives here once its moisture and temperature check says OK.` : "Nothing to do yet. A Lot arrives here once it is cooked and cooled in Cooking.")
    : can.canReview && waitingApproval.length > 0 ? `Next: approve or reject the ${waitingApproval.length} check${waitingApproval.length === 1 ? "" : "s"} waiting for you on Lot ${lot.code}.`
    : step === "day" ? `Next: in step 1, enter the day record for Lot ${lot.code}. ${formatKg(lot.leftToShellKg)} is left to shell.`
    : step === "line_run" ? `Next: in step 2, enter what each shelling line ran for Lot ${lot.code}.`
    : step === "qc5" ? `Next: in step 3, do the machine checks (QC-5) for Lot ${lot.code}.`
    : step === "qty1" ? `Next: in step 4, count the uncut nuts (QTY-1) for Lot ${lot.code}.`
    : step === "qc6" ? `Next: in step 5, take a shell sample (QC-6) for Lot ${lot.code}.`
    : counts.days > 0 ? `Lot ${lot.code} is shelled and every check is done. Its kernels go on to Colour sorting, the next stage.`
    : `Nothing for you to do on Lot ${lot.code} right now. The Warehouse Incharge does the next job.`;
  const allDone = lot !== null && step === "none" && counts.days > 0 && waitingApproval.length === 0;

  return (
    <div className="space-y-4">
      <NextStep done={allDone}>{nextText}</NextStep>

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
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-warmstone-900">Lot {lot.code} · {formatKg(lot.totalKg)} cooked <LotStatusPill status={lot.status} /></h3>
        </>
      )}
      {lot && (
        <>
          <StepCard n={1} title="Day record" status={counts.days === 0 ? "Not entered yet" : `${formatKg(lot.shelledKg)} shelled`} active={step === "day"} done={counts.days > 0}>
            <DayRecords lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={2} title="Line runs" status={`${counts.lineRuns} line${counts.lineRuns === 1 ? "" : "s"} entered`} active={step === "line_run"} done={counts.lineRuns > 0}>
            <EntryList kind="line_run" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={3} title="Machine checks (QC-5)" status={`${qc5Samples} sample${qc5Samples === 1 ? "" : "s"}`} active={step === "qc5"} done={counts.qc5 > 0}>
            <div className="space-y-6">
              <div><h4 className="text-[13px] font-bold text-warmstone-900 mb-2">Machine frequency</h4><EntryList kind="qc5_frequency" lot={lot} can={can} onChanged={onChanged} /></div>
              <div><h4 className="text-[13px] font-bold text-warmstone-900 mb-2">Machine capacity sample</h4><EntryList kind="qc5_capacity" lot={lot} can={can} onChanged={onChanged} /></div>
            </div>
          </StepCard>
          <StepCard n={4} title="Uncut quantity check (QTY-1)" status={`${counts.qty1} check${counts.qty1 === 1 ? "" : "s"}`} active={step === "qty1"} done={counts.qty1 > 0}>
            <EntryList kind="qty1" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
          <StepCard n={5} title="Kernel left in the shell (QC-6)" status={`${counts.qc6} sample${counts.qc6 === 1 ? "" : "s"}`} active={step === "qc6"} done={counts.qc6 > 0}>
            <EntryList kind="qc6" lot={lot} can={can} onChanged={onChanged} />
          </StepCard>
        </>
      )}
      <ByProductsPanel n={lot ? 6 : 1} data={data} can={can} onChanged={onChanged} />
    </div>
  );
}

function DayRecords({ lot, can, onChanged }: { lot: LotView; can: LotPermissions; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(d: ShellingDayView) {
    if (!window.confirm(`Remove the day record of ${formatDate(d.date)}?`)) return;
    setError(null);
    try {
      await api.deleteShellingDay(d.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const columns: Column<ShellingDayView>[] = [
    dateCol("Date", (d) => d.date),
    kgCol("Input", (d) => Number(d.inputKg)),
    kgCol("Good kernels", (d) => d.figures.goodKg),
    kgCol("Final kernels", (d) => d.figures.finalKg, { strong: true }),
    kgCol("Shell", (d) => d.figures.shellKg),
    kgCol("Shell dust", (d) => d.figures.shellDustKg),
    { ...pctCol("Yield", (d) => d.figures.yieldPct), render: (d) => pct(d.figures.yieldPct) },
    { ...pctCol("Realisation", (d) => d.figures.realisationPct), render: (d) => pct(d.figures.realisationPct) },
    { ...pctCol("Wholes", (d) => d.figures.wholesPct), render: (d) => pct(d.figures.wholesPct) },
    { ...pctCol("Uncut", (d) => d.figures.uncutPct), render: (d) => pct(d.figures.uncutPct) },
    numCol("SHOT (lbs)", (d) => d.figures.shotLbs),
    ...(can.canFloor ? [{
      label: "", align: "right" as const, nowrap: true,
      render: (d: ShellingDayView) => (
        <IconButton icon="delete" label={`Remove the day record of ${formatDate(d.date)}`} onClick={() => remove(d)} />
      ),
    }] : []),
  ];

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-warmstone-800">Type the kg in and the kg of each output. The app works out everything else; shell is calculated, not weighed.</p>
      {can.canFloor && lot.leftToShellKg > 0 && <Button icon="add" onClick={() => setAdding(true)}>Enter the day record</Button>}
      {can.canFloor && lot.leftToShellKg <= 0 && <Button variant="secondary" icon="add" onClick={() => setAdding(true)}>Add another day</Button>}
      {lot.shellingDays.length > 0 && <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={lot.shellingDays} keyFn={(d) => String(d.id)} />}
      {lot.shellingDays.length > 0 && <Notes notes={lot.shellingDays.at(-1)!.notes} />}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      {adding && (
        <Modal wide title={`Day record, Lot ${lot.code}`} onClose={() => setAdding(false)}>
          <DayForm lot={lot} onSaved={() => { setAdding(false); onChanged(); }} />
        </Modal>
      )}
    </div>
  );
}

function DayForm({ lot, onSaved }: { lot: LotView; onSaved: () => void }) {
  const [v, setV] = useState<ShellingDayValues>({ date: todayIso(), inputKg: lot.leftToShellKg > 0 ? String(lot.leftToShellKg) : "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = shellingFigures(v);
  const notes = shellingDayNotes(v, lot.leftToShellKg);
  const entered = f.finalKg > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = shellingDayError(v);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.addShellingDay(lot.code, v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputClass} /></Field>
        <Field label="Input (kg)" hint={`Filled in with what is left of the Lot: ${formatKg(lot.leftToShellKg)}.`}>
          <Input numeric value={v.inputKg ?? ""} onChange={(e) => setV((p) => ({ ...p, inputKg: e.target.value }))} />
        </Field>
      </div>
      <fieldset>
        <legend className="block text-[13px] font-bold text-warmstone-900 mb-3">How many kg came out?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SHELLING_KG_FIELDS.map(([key, label]) => (
            <Field key={key} label={`${label} (kg)`}><Input numeric value={v[key] ?? ""} onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value }))} /></Field>
          ))}
        </div>
      </fieldset>
      {entered && (
        <div className="rounded-xl border border-warmstone-200 bg-warmstone-50 p-4 space-y-1 text-[13px] text-warmstone-800 tabular-nums">
          <p>Good kernels = wholes + pieces = <b>{formatKg(f.goodKg)}</b> · Yield <b>{pct(f.yieldPct)}</b> · Wholes <b>{pct(f.wholesPct)}</b></p>
          <p>Final kernels = good + rejection + oil + black rejection = <b>{formatKg(f.finalKg)}</b> · Realisation <b>{pct(f.realisationPct)}</b></p>
          <p>Shell dust = 1.5 % of input = <b>{formatKg(f.shellDustKg)}</b> · Shell = input − final − dust = <b className={f.shellKg < 0 ? "text-danger-700" : ""}>{formatKg(f.shellKg)}</b></p>
        </div>
      )}
      <Notes notes={notes} />
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving}>Save the day record</Button>
      </div>
    </form>
  );
}
