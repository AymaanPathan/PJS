/**
 * What the production workbook shows: each tab's rows, read through the same services the production
 * screens use (listBatches, listRcnReceipts), so a status, a KOR or a net weight in the file is exactly what
 * the batch page shows.
 */
import { SILO_SIZES, SIZING_GRADES, type SiloSize } from "@anagroci/contract/domain/calibration";
import { TRUCK_STATUS_LABELS, streamLabel } from "@anagroci/contract/domain/byProducts";
import { ENTRY_DEFS, ENTRY_KINDS, entryFigures, sizeWord } from "@anagroci/contract/domain/lotEntries";
import { BATCH_STATUS_LABELS } from "@anagroci/contract/domain/productionBatch";
import { RCN_RECEIPT_STATUS_LABELS } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { listBatches } from "../../services/production/batches.js";
import { listBoilerReadings, listTrucks } from "../../services/production/byProducts.js";
import { listSizingChecks } from "../../services/production/calibration.js";
import { listLots } from "../../services/production/factoryLots.js";
import { listRcnReceipts } from "../../services/production/rcnReceipts.js";
import { figureKey, gramKey, joinList, runKgKey, type Tab } from "./tabs.js";

export type TabRow = Record<string, unknown>;

const CHECK_STATUS = { submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected" } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function exportRows(site: string): Promise<Record<Tab["id"], TabRow[]>> {
  const [batches, receipts, sizingChecks, lots, trucks, boiler] = await Promise.all([listBatches(site), listRcnReceipts(site), listSizingChecks(site), listLots(site), listTrucks(site), listBoilerReadings(site)]);
  const word = (size: SiloSize) => SILO_SIZES.find((s) => s.key === size)!.sheet;
  // Oldest first, the order the loads happened in, as on the client's sheets.
  const loads = [...receipts].reverse();
  // Every "Batch Name" cell names the run the way people know it: its name when it has one, else its ID.
  const runNames = new Map(batches.map((b) => [b.code, b.name ?? b.code]));
  const run = (code: string) => runNames.get(code) ?? code;

  return {
    batches: [...batches].reverse().map((b) => ({
      // The run's name when it has one, else its ID — either finds it again on upload (services' runWhere).
      code: b.name ?? b.code, startDate: b.startDate, bins: joinList(b.binCodes), proposedBy: b.proposedBy, plannedKg: b.plannedKg, status: BATCH_STATUS_LABELS[b.status],
    })),
    receipts: loads.map((r) => ({ id: r.id, batchCode: run(r.batchCode), date: r.date, btmNo: r.btmNo, binCode: r.binCode, status: RCN_RECEIPT_STATUS_LABELS[r.status] })),
    checks: loads.flatMap((r) => r.moistureChecks.map((c) => ({
      id: c.id, receiptId: r.id, btmNo: r.btmNo, loadDate: r.date, moisture: c.moisture, nutCount: c.nutCount, sampleG: c.sampleG, ...c.grams,
      decision: c.decision === "ok" ? "OK" : "Hold", kor: c.kor === null ? null : round2(c.kor), status: CHECK_STATUS[c.status],
    }))),
    pallets: loads.flatMap((r) => r.pallets.map((p) => ({
      id: p.id, receiptId: r.id, btmNo: r.btmNo, loadDate: r.date, no: p.no, grossKg: p.grossKg, bags: p.bags, factoryBin: p.factoryBin,
    }))),
    final: loads.filter((r) => r.finalWeight).map((r) => {
      const f = r.finalWeight!;
      const t = weighingTotals(r.pallets, f);
      return {
        receiptId: r.id, btmNo: r.btmNo, loadDate: r.date,
        emptyPalletsKg: joinList(f.emptyPallets.map((s) => s.weightKg)),
        // Counts only when every stack has one: a list with gaps couldn't be matched back to its stacks.
        emptyPalletsCount: f.emptyPallets.every((s) => s.count) ? joinList(f.emptyPallets.map((s) => s.count)) : "",
        dustKg: f.dustKg, voidsKg: f.voidsKg, netKg: t.netKg, toSilosKg: t.toSilosKg,
      };
    }),
    runs: loads.flatMap((r) => (r.calibration?.runs ?? []).map((c) => ({
      id: c.id, receiptId: r.id, btmNo: r.btmNo, date: c.date, totalKg: c.totalKg,
      ...Object.fromEntries(SILO_SIZES.map((s) => [runKgKey(s.key), c.sizes[s.key]])),
    }))),
    siloChecks: sizingChecks.map((c) => ({
      id: c.id, batchCode: run(c.batchCode), date: c.date, point: c.point === "received" ? "Received RCN" : word(c.point), binCode: c.binCode, nutCount: c.nutCount, sampleG: c.sampleG,
      ...Object.fromEntries(SIZING_GRADES.map((g) => [gramKey(g), c.grams[g]])),
      decision: c.decision === "ok" ? "OK" : "Fail", correctPct: c.correctPct === null ? null : round2(c.correctPct), status: CHECK_STATUS[c.status],
    })),
    siloMoves: sizingChecks.flatMap((c) => c.manualCalibrations.map((m) => ({ id: m.id, date: m.date, fromSize: word(m.fromSize), toSize: word(m.toSize), kg: m.kg }))),
    cooking: lots.flatMap((l) => l.runs.map((r) => ({
      id: r.id, batchCode: run(l.batchCode), lotCode: l.code, date: r.date, totalKg: r.totalKg, bags: round2(r.totalKg / 80),
      ...Object.fromEntries(SILO_SIZES.map((s) => [runKgKey(s.key), r.sizes[s.key]])),
    }))),
    cooling: lots.filter((l) => l.coolingAt).map((l) => ({ lotCode: l.code, silo: l.coolingSilo, date: l.coolingAt!.slice(0, 10), time: l.coolingAt!.slice(11) })),
    shellingDays: lots.flatMap((l) => l.shellingDays.map((d) => ({
      id: d.id, lotCode: l.code, date: d.date, inputKg: d.inputKg, ...d.kg,
      shellDustKg: d.figures.shellDustKg, shellKg: d.figures.shellKg, goodKg: d.figures.goodKg, finalKg: d.figures.finalKg, shotLbs: round2(d.figures.shotLbs),
      yieldPct: round2(d.figures.yieldPct), realisationPct: round2(d.figures.realisationPct), wholesPct: round2(d.figures.wholesPct), uncutPct: round2(d.figures.uncutPct),
    }))),
    boiler: [...boiler].reverse().map((b) => ({ id: b.id, date: b.date, shellKg: b.shellKg, runningHours: b.runningHours })),
    trucks: [...trucks].reverse().map((t) => ({
      id: t.id, stream: streamLabel(t.stream), date: t.date, truckNo: t.truckNo, driver: t.driver, documentsChecked: t.documentsChecked ? "Yes" : "No", slipNo: t.slipNo, tareKg: t.tareKg, grossKg: t.grossKg,
      buyer: t.buyer, category: t.category, price: t.price, gatePassNo: t.gatePassNo, netKg: t.netKg, status: TRUCK_STATUS_LABELS[t.status],
    })),
    ...(Object.fromEntries(ENTRY_KINDS.map((kind) => [`entry:${kind}`, lots.flatMap((l) => l.entries.filter((e) => e.kind === kind).map((e) => ({
      id: e.id, lotCode: l.code, date: e.date, status: CHECK_STATUS[e.status],
      decision: e.decision === null ? null : e.decision === "ok" ? "OK" : e.decision === "wait" ? "Wait" : "No",
      ...Object.fromEntries(ENTRY_DEFS[kind].fields.map((f) => [`v_${f.key}`, f.type === "size" ? sizeWord(e.values[f.key]) : e.values[f.key]])),
      ...Object.fromEntries(entryFigures(kind, e.values).map((fig, i) => [figureKey(i), fig.value])),
    })))])) as unknown as Record<`entry:${(typeof ENTRY_KINDS)[number]}`, TabRow[]>),
  };
}
