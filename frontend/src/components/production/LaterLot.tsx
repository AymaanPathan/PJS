import { Field, Select } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { formatKg } from "./batchUi";
import { LotStatusPill } from "./CookingSection";
import { CHECK_STATE_LABELS, type CheckState } from "@anagroci/contract/domain/laterPhases";
import { LOT_STATUS_LABELS } from "@anagroci/contract/domain/cooking";
import type { LotView } from "@anagroci/contract/types/lots";

const CHECK_TONE: Record<CheckState, string> = { not_checked: "system", waiting: "decision", ok: "entry", no: "gap" };

/** Where a quality check of Phases 6–8 stands, from its newest record. */
export function CheckPill({ state }: { state: CheckState }) {
  return <Pill tone={CHECK_TONE[state]} label={CHECK_STATE_LABELS[state]} />;
}

/**
 * The Lot being worked on, for Phases 6–8. Every Lot of the run is offered: no phase waits for the one before it, so
 * a Lot can take a Borma line, a grading day or a packing line whatever it has (or hasn't) been through yet.
 */
export function LotPicker({ lots, lot, onPick }: { lots: LotView[]; lot: LotView; onPick: (code: string) => void }) {
  return (
    <div className="space-y-3">
      {lots.length > 1 && (
        <div className="max-w-sm">
          <Field label="Which Lot are you working on?">
            <Select value={lot.code} onChange={(e) => onPick(e.target.value)}>
              {lots.map((l) => <option key={l.code} value={l.code}>{l.code} · {LOT_STATUS_LABELS[l.status]} · {formatKg(l.totalKg)} cooked</option>)}
            </Select>
          </Field>
        </div>
      )}
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-warmstone-900">
        Lot {lot.code} · {formatKg(lot.totalKg)} cooked <LotStatusPill status={lot.status} />
      </h3>
    </div>
  );
}

/** The Lot picked by the person, else the first one `prefer` likes, else the newest. */
export function pickLot(lots: LotView[], picked: string | null, prefer: (l: LotView) => boolean): LotView | null {
  return lots.find((l) => l.code === picked) ?? lots.find(prefer) ?? lots.at(-1) ?? null;
}

/** Records of a kind on a Lot, rejected ones left out. */
export const countOf = (lot: LotView, kind: string) => lot.entries.filter((e) => e.kind === kind && e.status !== "rejected").length;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
