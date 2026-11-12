/**
 * The numbers behind a run's batch balance (contract domain/runBalance.ts), read off the same views the run's pages
 * show: its loads' final weights, and its Lots' shelling days, Borma trolleys, Phase 7 lines and packing.
 */
import { runBalance, type RunBalance } from "@anagroci/contract/domain/runBalance";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { LotView } from "@anagroci/contract/types/lots";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export function runBalanceOf(loads: RcnReceipt[], lots: LotView[]): RunBalance {
  const weighed = loads.filter((r) => r.finalWeight).map((r) => weighingTotals(r.pallets, r.finalWeight!));
  const days = lots.flatMap((l) => l.shellingDays);
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
  return runBalance({
    receivedKg: sum(weighed, (t) => t.netKg),
    dustKg: sum(weighed, (t) => t.dustKg),
    voidsKg: sum(weighed, (t) => t.voidsKg),
    shellKg: sum(days, (d) => d.figures.shellKg),
    shellDustKg: sum(days, (d) => d.figures.shellDustKg),
    finalUncutKg: sum(days, (d) => Number(d.kg.finalUncutKg) || 0),
    blackRejectionKg: sum(days, (d) => Number(d.kg.blackRejectionKg) || 0),
    bormaLossKg: sum(lots, (l) => l.later.borma.lossKg),
    humidGainKg: sum(lots, (l) => l.later.humidGainKg),
    huskKg: sum(lots, (l) => l.later.huskKg),
    rejectKernelsKg: sum(lots, (l) => l.later.rejectKernelsKg),
    packedKg: sum(lots, (l) => sum(l.later.fg, (g) => g.packedKg)),
  });
}
