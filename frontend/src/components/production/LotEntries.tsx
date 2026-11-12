import { useState, type FormEvent } from "react";
import { ReviewBar } from "./MoistureCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DateInput } from "../ui/DateInput";
import { Field, Input, Select, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import { SILO_SIZES, siloLabel, type SiloSize } from "@anagroci/contract/domain/calibration";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { ENTRY_DEFS, SHELLING_LINES, entryError, entryFieldText, entryFigures, entryNotes, isEditableKind, type EntryField, type EntryKind } from "@anagroci/contract/domain/lotEntries";
import type { LotEntryView, LotView } from "@anagroci/contract/types/lots";
import { PRODUCTION_PAGE_SIZE, dateCol, statusCol } from "./columns";
import { IconButton } from "../ui/IconButton";

export interface LotPermissions {
  /** The floor's own records (the Incharge / Admin; Data Entry later). */
  canFloor: boolean;
  /** Enter a quality check (the QFS Officer, or the Incharge / Admin directly). */
  canCheck: boolean;
  /** Approve or reject a submitted check. */
  canReview: boolean;
}

export const decisionText = (kind: EntryKind, decision: string | null): string => {
  const d = ENTRY_DEFS[kind].decision;
  return !d || !decision ? "-" : decision === "ok" ? d.ok : d.no;
};

/** "Quality after the Borma" → "quality after the Borma": only the first letter, so names keep their capitals. */
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Up to this many waiting checks are shown one by one; a shift's machine samples can run to hundreds. */
const WAITING_SHOWN = 5;

/**
 * A Lot's records of one kind: what it is, the button to add one, what waits for approval, and the list. Every kind
 * goes through this one component, driven by its definition in the contract.
 */
export function EntryList({ kind, lot, can, startValues, onChanged }: { kind: EntryKind; lot: LotView; can: LotPermissions; startValues?: Record<string, string>; onChanged: () => void }) {
  const def = ENTRY_DEFS[kind];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LotEntryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = lot.entries.filter((e) => e.kind === kind);
  const waiting = entries.filter((e) => e.status === "submitted");
  const mayAdd = def.who === "floor" ? can.canFloor : can.canCheck;
  const shownFields = def.fields.filter((f) => f.type !== "number" || f.required || !def.figures);

  async function removeEntry(e: LotEntryView) {
    if (!window.confirm(`Remove this ${lowerFirst(def.title)} line?`)) return;
    setError(null);
    try {
      await api.deleteLotEntry(e.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function approveAll() {
    setError(null);
    try {
      await api.approveAllLotEntries(lot.code, kind);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const columns: Column<LotEntryView>[] = [
    dateCol("Date", (e) => e.date),
    // Each recorded field filters the way it reads: a number by range, a size, line or shift by checklist.
    ...shownFields.map((f): Column<LotEntryView> => ({
      label: f.label, nowrap: f.type !== "text",
      filter: { value: (e) => (f.type === "number" ? Number(e.values[f.key]) : entryFieldText(f, e.values[f.key])), kind: f.type === "number" ? "number" : undefined },
      render: (e) => entryFieldText(f, e.values[f.key]),
    })),
    ...(def.figures ? entryFigures(kind, {}).map((fig, i): Column<LotEntryView> => ({
      label: fig.label, align: "right", nowrap: true,
      render: (e) => {
        const shown = entryFigures(kind, e.values)[i]!;
        return <span className={shown.alert ? "font-semibold text-danger-700" : ""}>{shown.value}</span>;
      },
    })) : []),
    ...(def.decision ? [statusCol<LotEntryView>("Result", (e) => decisionText(kind, e.decision), (e) => <Pill tone={e.decision === "ok" ? "entry" : "gap"} label={decisionText(kind, e.decision)} />)] : []),
    ...(def.who === "qfs" ? [statusCol<LotEntryView>("Approval", (e) => e.status, (e) => <StatusPill status={e.status} />)] : []),
    ...(def.who === "floor" && can.canFloor ? [{
      label: "", align: "right" as const, nowrap: true,
      render: (e: LotEntryView) => (
        <span className="inline-flex items-center gap-1">
          {isEditableKind(kind) && <IconButton icon="edit" label={`Change the line of ${formatDate(e.date)}`} onClick={() => setEditing(e)} />}
          <IconButton icon="delete" label={`Remove the line of ${formatDate(e.date)}`} onClick={() => removeEntry(e)} />
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-warmstone-800">{def.help}</p>
      {mayAdd && <Button icon="add" onClick={() => setAdding(true)}>Add {lowerFirst(def.title)}</Button>}
      {waiting.length > WAITING_SHOWN && can.canReview && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ambernut-300 bg-ambernut-50 p-4">
          <p className="text-[13px] text-ambernut-900"><b>{waiting.length} waiting for your approval.</b> The first {WAITING_SHOWN} are below; all of them are in the list.</p>
          <Button icon="check" onClick={approveAll}>Approve all {waiting.length}</Button>
        </div>
      )}
      {waiting.slice(0, WAITING_SHOWN).map((e) => (
        can.canReview ? (
          <div key={e.id} className="space-y-2">
            <p className="text-[13px] text-warmstone-800 tabular-nums">
              <b className="font-semibold">{formatDate(e.date)}</b> · {shownFields.map((f) => `${f.label}: ${entryFieldText(f, e.values[f.key])}`).join(" · ")}
              {def.decision && <> · <b className="font-semibold">{decisionText(kind, e.decision)}</b></>} · by {e.submittedBy}
            </p>
            <Notes notes={e.notes} />
            <ReviewBar
              applies={def.decision ? `the result "${decisionText(kind, e.decision)}" counts.` : "the sample goes on record."}
              onApprove={() => api.approveLotEntry(e.id)}
              onReject={(reason) => api.rejectLotEntry(e.id, reason)}
              onDone={onChanged}
            />
          </div>
        ) : null
      ))}
      {entries.length > 0 && <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={[...entries].reverse()} keyFn={(e) => String(e.id)} />}
      {entries.flatMap((e) => (e.status === "rejected" && e.rejectReason ? [e] : [])).map((e) => (
        <p key={e.id} className="text-[12px] text-danger-700">Rejected ({formatDate(e.date)}): {e.rejectReason}</p>
      ))}
      {/* A note on each row would crowd the table: the newest row's alerts are what the person acts on. */}
      {entries.length > 0 && waiting.length === 0 && <Notes notes={entries.at(-1)!.notes} />}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      {adding && (
        <Modal wide title={`${def.check ? `${def.check} · ` : ""}${def.title}, Lot ${lot.code}`} onClose={() => setAdding(false)}>
          <EntryForm kind={kind} lot={lot} direct={can.canReview} startValues={startValues} onSaved={onChanged} onClose={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal wide title={`Change ${lowerFirst(def.title)}, Lot ${lot.code}`} onClose={() => setEditing(null)}>
          <EntryForm kind={kind} lot={lot} direct={can.canReview} entry={editing} onSaved={onChanged} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: LotEntryView["status"] }) {
  return <Pill tone={status === "approved" ? "entry" : status === "submitted" ? "decision" : "gap"} label={status === "approved" ? "Approved" : status === "submitted" ? "Waiting for approval" : "Rejected"} />;
}

export function Notes({ notes }: { notes: string[] }) {
  return (
    <>
      {notes.map((n) => (
        <p key={n} className="flex items-center gap-1.5 text-[12px] text-ambernut-800">
          <span className="material-symbols-outlined text-[16px]">warning</span>{n}
        </p>
      ))}
    </>
  );
}

function FieldControl({ field, sizes, value, onChange }: { field: EntryField; sizes: SiloSize[]; value: string; onChange: (v: string) => void }) {
  const change = (e: { target: { value: string } }) => onChange(e.target.value);
  if (field.type === "size") {
    return (
      <Select value={value} onChange={change}>
        <option value="">Choose a size…</option>
        {sizes.map((s) => <option key={s} value={s}>{siloLabel(s)}</option>)}
      </Select>
    );
  }
  if (field.type === "line" || field.type === "select") {
    const options = field.type === "line" ? SHELLING_LINES : field.options!;
    return (
      <Select value={value} onChange={change}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  if (field.type === "time") return <Input type="time" value={value} onChange={change} />;
  return <Input numeric={field.type === "number"} value={value} onChange={change} />;
}

/** Adds a record, or — given `entry` — changes a floor record already saved (a trolley's weight after the oven). */
function EntryForm({ kind, lot, direct, startValues, entry, onSaved, onClose }: { kind: EntryKind; lot: LotView; direct: boolean; startValues?: Record<string, string>; entry?: LotEntryView; onSaved: () => void; onClose: () => void }) {
  const def = ENTRY_DEFS[kind];
  const defaults = entry ? entry.values : { ...(def.fields.some((f) => f.key === "sampleG") ? { sampleG: "1000" } : {}), ...startValues };
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [decision, setDecision] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  // A cooker or a QC-3 is about what this Lot cooked; a line can run any of the sizes.
  const sizes = kind === "line_run" ? SILO_SIZES.map((s) => s.key) : lot.cookedSizes;
  const canRepeat = !entry && def.fields.some((f) => f.keep);
  const figures = entryFigures(kind, values);
  const notes = entryNotes(kind, values, { date, coolingAt: lot.coolingAt });

  async function save(again: boolean) {
    const input = { date, values, decision };
    const problem = entryError(kind, input, lot.cookedSizes);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      if (entry) await api.updateLotEntry(entry.id, { date, values });
      else await api.addLotEntry(lot.code, { kind, ...input });
      onSaved();
      if (!again) return onClose();
      // The same line and shift, the next machine: only what stays the same from one sample to the next is kept.
      setValues(Object.fromEntries(def.fields.filter((f) => f.keep && values[f.key]).map((f) => [f.key, values[f.key]!])));
      setDecision(undefined);
      setSaved((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void save(false); }} className="space-y-4">
      <p className="text-[13px] text-warmstone-800">{def.help}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Date"><DateInput value={date} onChange={setDate} className={inputClass} /></Field>
        {def.fields.map((f) => (
          <Field key={f.key} label={f.required ? f.label : `${f.label}${f.type === "number" ? "" : " (optional)"}`} hint={f.hint}>
            <FieldControl field={f} sizes={sizes} value={values[f.key] ?? ""} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
          </Field>
        ))}
      </div>
      {figures.length > 0 && (
        <p className="text-[13px] tabular-nums text-warmstone-800">
          {figures.map((f, i) => <span key={f.label}>{i > 0 && " · "}{f.label}: <b className={f.alert ? "text-danger-700" : ""}>{f.value}</b></span>)}
        </p>
      )}
      <Notes notes={notes} />
      {def.decision && (
        <div>
          <span className="block text-[13px] font-bold text-warmstone-900 mb-3">What is your decision?</span>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["ok", def.decision.noValue] as const).map((d) => {
              const on = decision === d;
              const ok = d === "ok";
              return (
                <label key={d} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${on ? (ok ? "border-success-600 bg-success-50" : "border-danger-600 bg-danger-50") : "border-warmstone-200 bg-white hover:bg-warmstone-50"}`}>
                  <input type="radio" name={`decision-${kind}`} className="mt-0.5" checked={on} onChange={() => setDecision(d)} />
                  <span>
                    <span className="block font-semibold text-[13px] text-warmstone-900">{ok ? def.decision!.ok : def.decision!.no}</span>
                    <span className="block text-[12px] text-warmstone-500">{ok ? def.decision!.okHint : def.decision!.noHint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        {saved > 0 && <span className="text-[12px] text-success-700 mr-auto">{saved} saved. Enter the next one.</span>}
        {def.who === "qfs" && !direct && <span className="text-[12px] text-warmstone-500">The Warehouse Incharge will approve it.</span>}
        {canRepeat && <Button variant="secondary" disabled={saving} onClick={() => void save(true)}>Save and add another</Button>}
        <Button type="submit" icon={def.who === "qfs" && !direct ? "send" : "check"} disabled={saving}>{def.who === "qfs" && !direct ? "Send for approval" : "Save"}</Button>
      </div>
    </form>
  );
}
