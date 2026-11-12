/**
 * The doc's "Closing the batch" (Phase 8): before the Warehouse Incharge closes a run, the app shows every stream that
 * left the line so the balance can be checked.
 *
 *   Batch balance = RCN received − dust − voids − shell − shell dust − final uncut − black rejection
 *                   − Borma moisture loss + humidification moisture gain − husk − reject kernels
 *                   → compared with kg packed; the difference is shown as unaccounted loss.
 *
 * "Cooking adds water and is not used in the kernel balance" — so cooking waste water is not a line here. The alert
 * tolerance is "rule to be agreed": the difference is shown, never judged or blocking.
 */

export interface RunBalanceInput {
  /** Net kg of the run's loads with a final weight (Σ gross − bags − empty pallets). */
  receivedKg: number;
  dustKg: number;
  voidsKg: number;
  shellKg: number;
  shellDustKg: number;
  finalUncutKg: number;
  blackRejectionKg: number;
  bormaLossKg: number;
  humidGainKg: number;
  huskKg: number;
  rejectKernelsKg: number;
  packedKg: number;
}

export interface RunBalanceLine {
  label: string;
  kg: number;
  /** +1 adds to the balance, −1 takes from it. */
  sign: 1 | -1;
}

export interface RunBalance {
  lines: RunBalanceLine[];
  /** What should have reached packing. */
  expectedKg: number;
  packedKg: number;
  /** expected − packed: kg nobody has accounted for. */
  unaccountedKg: number;
  unaccountedPct: number | null;
}

const kg2 = (n: number) => Math.round(n * 100) / 100;

export function runBalance(i: RunBalanceInput): RunBalance {
  const lines: RunBalanceLine[] = [
    { label: "RCN received (net)", kg: i.receivedKg, sign: 1 },
    { label: "Dust", kg: i.dustKg, sign: -1 },
    { label: "Voids", kg: i.voidsKg, sign: -1 },
    { label: "Shell", kg: i.shellKg, sign: -1 },
    { label: "Shell dust", kg: i.shellDustKg, sign: -1 },
    { label: "Final uncut", kg: i.finalUncutKg, sign: -1 },
    { label: "Black rejection", kg: i.blackRejectionKg, sign: -1 },
    { label: "Borma moisture loss", kg: i.bormaLossKg, sign: -1 },
    { label: "Humidification moisture gain", kg: i.humidGainKg, sign: 1 },
    { label: "Husk", kg: i.huskKg, sign: -1 },
    { label: "Reject kernels", kg: i.rejectKernelsKg, sign: -1 },
  ].map((l) => ({ ...l, kg: kg2(l.kg) })) as RunBalanceLine[];
  const expectedKg = kg2(lines.reduce((n, l) => n + l.sign * l.kg, 0));
  const unaccountedKg = kg2(expectedKg - i.packedKg);
  return { lines, expectedKg, packedKg: kg2(i.packedKg), unaccountedKg, unaccountedPct: i.receivedKg > 0 ? (unaccountedKg / i.receivedKg) * 100 : null };
}
