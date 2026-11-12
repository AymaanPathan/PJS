/**
 * Phases 6–8, against the client's own rows: every expected figure below is what their sheet shows for that row, so a
 * formula that drifts from the sheet fails here, not on the factory floor.
 */
import { describe, it, expect } from "vitest";
import { bormaSummary, finalOutputFigures, trolleyFigures } from "../src/domain/borma.js";
import { GRADE_CODES, gradeKey, gradingFigures, workerBand } from "../src/domain/peeling.js";
import { agingBucket, fgStock, materialOf, packKg } from "../src/domain/packing.js";
import { laterPhases } from "../src/domain/laterPhases.js";
import { runBalance } from "../src/domain/runBalance.js";
import { ENTRY_DEFS, ENTRY_KINDS, ENTRY_PHASE, entryError, isEditableKind } from "../src/domain/lotEntries.js";
import { PACKING_MATERIALS } from "../src/data/packingMaterials.js";

describe("Phase 6 · Borma", () => {
  it("a trolley line, as row 1 of the Borma Loss Tally Sheet: 345.4 → 324 kg, loss 21.4 (6.2 %)", () => {
    const f = trolleyFigures({ emptyBeforeKg: "222.5", grossBeforeKg: "567.9", grossAfterKg: "546.5" });
    expect(f.netBeforeKg).toBe(345.4);
    expect(f.netAfterKg).toBe(324);
    expect(f.lossKg).toBe(21.4);
    expect(f.lossPct! / 100).toBeCloseTo(0.06195715112912559, 6);
  });

  it("keeps a different empty weight after the oven (199 sheet rows have one), and waits while the trolley is still inside", () => {
    expect(trolleyFigures({ emptyBeforeKg: "220", grossBeforeKg: "500", emptyAfterKg: "219", grossAfterKg: "479" }).netAfterKg).toBe(260);
    expect(trolleyFigures({ emptyBeforeKg: "220", grossBeforeKg: "500" })).toMatchObject({ netBeforeKg: 280, netAfterKg: null, lossKg: null });
  });

  it("alerts on after > before and on pieces sent to packing, without refusing them (8 real rows weigh more after)", () => {
    const v = { bormaNo: "1", material: "Pieces", trolleyNo: "7", emptyBeforeKg: "200", grossBeforeKg: "300", grossAfterKg: "310", to: "Packing" };
    expect(entryError("borma_trolley", { date: "2026-07-20", values: v })).toBeNull();
    const notes = ENTRY_DEFS.borma_trolley.notes!(v, {});
    expect(notes.join(" ")).toMatch(/weigh more after the oven/);
    expect(notes.join(" ")).toMatch(/Only wholes go straight to packing/);
  });

  it("the Lot's summary is built from its trolleys: loss only over the trolleys weighed after", () => {
    const s = bormaSummary([
      { values: { material: "Wholes", emptyBeforeKg: "222.5", grossBeforeKg: "567.9", grossAfterKg: "546.5", to: "Packing" } },
      { values: { material: "Pieces", emptyBeforeKg: "200", grossBeforeKg: "210", grossAfterKg: "209.4", to: "Peeling" } },
      { values: { material: "Wholes", emptyBeforeKg: "200", grossBeforeKg: "500" } },
    ]);
    expect(s).toMatchObject({ trolleys: 3, weighedAfter: 2, beforeKg: 655.4, beforeOfWeighedKg: 355.4, afterKg: 333.4, lossKg: 22, toPackingKg: 324, toPeelingKg: 9.4 });
  });

  it("QC-8, as the first row of the Final Output Analysis Report (Pieces % counts butts, Spotted % counts PUK3)", () => {
    const f = finalOutputFigures({
      sampleG: "1000", goodKernelsG: "680", piecesG: "11", scorchedG: "9", spottedG: "76", puk3G: "22", shrivelledG: "53",
      dessertG: "17", oilG: "11", dirtyG: "9", rejectionG: "9", huskG: "103",
    });
    expect(f.goodPct).toBeCloseTo(68);
    expect(f.piecesPct).toBeCloseTo(1.1);
    expect(f.spottedPct).toBeCloseTo(9.8);
    expect(f.shrivelledBlemishedPct).toBeCloseTo(5.3);
    expect(f.dirtOilPct).toBeCloseTo(2);
    expect(f.huskPct).toBeCloseTo(10.3);
    expect(f.errorG).toBe(0);
    expect(finalOutputFigures({ sampleG: "1000", piecesG: "20", buttsG: "5" }).piecesPct).toBeCloseTo(2.5);
  });
});

describe("Phase 7 · Peeling & grading", () => {
  it("the grading day of 17/08/2026: 74.8 kg by 11 workers = 6.8 kg a head", () => {
    const v = { WW: "44", CW: "4", SW: "0.8", DW: "1.6", PUK2: "2.1", PUK3: "0.9", SS: "1", LP: "1.4", OW: "7.5", SB: "5.9" };
    const f = gradingFigures({ ...Object.fromEntries(Object.entries(v).map(([k, kg]) => [gradeKey(k), kg])), rejectionKg: "5.6", manpower: "11" });
    expect(f.totalKg).toBe(74.8);
    expect(f.avgPerHead).toBeCloseTo(6.8, 1);
  });

  it("keeps the sheet's grade codes and its worker bands", () => {
    expect(GRADE_CODES).toContain("PUK1");
    expect(GRADE_CODES).toContain("Powder");
    expect([11.5, 11, 9, 8.9, 7, 6, 5, 4.9].map(workerBand)).toEqual(["GOOD", "AVERAGE", "AVERAGE", "NEED IMPROVEMENT", "NEED IMPROVEMENT", "POOR", "POOR", "V.POOR"]);
  });
});

describe("Phase 8 · Packing & dispatch", () => {
  it("reads code and SKU from the master, and kg as packs × SKU (the sheet's first row: 178 × 20 = 3,560)", () => {
    expect(materialOf("Borma CK # 20Kg Pouch")).toEqual({ grade: "Borma CK # 20Kg Pouch", code: "100000000150", sku: 20 });
    expect(packKg({ grade: "Borma CK # 20Kg Pouch", qty: "178" })).toBe(3560);
    expect(packKg({ grade: "KTP # 50 lbs Pouch", qty: "10" })).toBe(226.8);
    // A kg the sheet typed is kept as typed (2 of its 470 rows).
    expect(packKg({ grade: "Borma CK # 20Kg Pouch", qty: "178", kg: "3555" })).toBe(3555);
    expect(new Set(PACKING_MATERIALS.map((m) => m.grade)).size).toBe(PACKING_MATERIALS.length);
  });

  it("finished-goods stock: closing = packed − dispatched, and aging buckets as the sheet's Grouping", () => {
    const e = (id: number, kind: string, date: string, values: Record<string, string>, status = "approved") => ({ id, kind, date, status, decision: null, values });
    const rows = fgStock([
      e(1, "packing", "2026-05-15", { grade: "Borma CK # 20Kg Pouch", qtyPacked: "178" }),
      e(2, "fg_dispatch", "2026-05-20", { grade: "Borma CK # 20Kg Pouch", qtyOut: "100" }),
      e(3, "fg_dispatch", "2026-05-21", { grade: "Borma CK # 20Kg Pouch", qtyOut: "50" }, "rejected"),
    ], "2026-06-20");
    expect(rows).toEqual([expect.objectContaining({ packedQty: 178, packedKg: 3560, dispatchedQty: 100, closingQty: 78, closingKg: 1560, agingDays: 36, bucket: "30-90" })]);
    expect([0, 29, 30, 120, 200, 400].map((d) => agingBucket(d, 1))).toEqual(["<30", "<30", "30-90", "90-180", "180-365", ">365"]);
    expect(agingBucket(400, 0)).toBe("0");
  });
});

describe("a Lot's status after colour sorting", () => {
  const e = (id: number, kind: string, extra: Partial<{ status: string; decision: string | null }> = {}) => ({ id, kind, date: "2026-07-20", status: "approved", decision: null, values: {}, ...extra });

  it("is the furthest phase with a record — no phase waits for the one before", () => {
    expect(laterPhases([], "2026-07-20").status).toBeNull();
    // Packing recorded before any Borma line: still Packed, nothing refused.
    expect(laterPhases([e(1, "packing")], "2026-07-20").status).toBe("packed");
    expect(laterPhases([e(1, "borma_trolley"), e(2, "humidification")], "2026-07-20").status).toBe("humidified");
    expect(laterPhases([e(1, "packing"), e(2, "qc11", { decision: "ok" })], "2026-07-20").status).toBe("qc11_passed");
    expect(laterPhases([e(1, "packing"), e(2, "fg_dispatch")], "2026-07-20").status).toBe("dispatched");
    expect(laterPhases([e(1, "fg_dispatch", { status: "rejected" })], "2026-07-20").status).toBeNull();
  });

  it("a check's newest record decides it: No, then OK, is OK; one waiting is waiting", () => {
    const qc = (id: number, decision: string, status = "approved") => e(id, "qc8", { decision, status });
    expect(laterPhases([qc(1, "no"), qc(2, "ok")], "2026-07-20").checks.qc8).toBe("ok");
    expect(laterPhases([qc(1, "ok"), qc(2, "no")], "2026-07-20").checks.qc8).toBe("no");
    expect(laterPhases([qc(1, "ok"), qc(2, "no", "submitted")], "2026-07-20").checks.qc8).toBe("waiting");
  });
});

describe("the run's balance", () => {
  it("is the doc's formula: received less every stream out, plus humidification gain, against kg packed", () => {
    const b = runBalance({
      receivedKg: 1000, dustKg: 5, voidsKg: 1, shellKg: 600, shellDustKg: 15, finalUncutKg: 4, blackRejectionKg: 5,
      bormaLossKg: 15, humidGainKg: 2, huskKg: 3, rejectKernelsKg: 4, packedKg: 340,
    });
    expect(b.expectedKg).toBe(350);
    expect(b.unaccountedKg).toBe(10);
    expect(b.unaccountedPct).toBe(1);
  });
});

describe("the new records' definitions", () => {
  it("every kind has its phase, and a workbook tab name Excel accepts (unique, 31 characters at most)", () => {
    for (const k of ENTRY_KINDS) expect(ENTRY_PHASE[k], k).toBeGreaterThan(0);
    const sheets = ENTRY_KINDS.map((k) => ENTRY_DEFS[k].sheet);
    expect(new Set(sheets).size).toBe(sheets.length);
    for (const s of sheets) expect(s.length, s).toBeLessThanOrEqual(31);
  });

  it("only the floor's own records can be corrected; a quality check stays as recorded", () => {
    expect(isEditableKind("borma_trolley")).toBe(true);
    expect(isEditableKind("packing")).toBe(true);
    expect(isEditableKind("qc8")).toBe(false);
    expect(isEditableKind("qc11")).toBe(false);
  });

  it("a packing grade must be one of the master's", () => {
    expect(entryError("packing", { date: "2026-07-20", values: { lane: "8a · Borma wholes", grade: "Not a grade", qtyPacked: "1" } })).toMatch(/Grade must be one of/);
    expect(entryError("packing", { date: "2026-07-20", values: { lane: "8a · Borma wholes", grade: "Borma CK # 20Kg Pouch", qtyPacked: "1" } })).toBeNull();
  });
});
