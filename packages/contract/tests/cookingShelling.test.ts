/**
 * Phases 3–4 against the client's own numbers: "6. Cooking Process Report", "7. Shelling process Report", "13. Shelling
 * Machine Quality Reports", "11. Shell Waste Sample Report" and the document's worked examples.
 */
import { describe, expect, it } from "vitest";
import { boilerError, storeBalance, truckError, truckNetKg, truckStatus } from "../src/domain/byProducts.js";
import { siloDailyStock, siloStock } from "../src/domain/calibration.js";
import { coolingCheck, cookChecks, cookRunError, hoursBetween, lotBags, lotSizes, lotStatus, nextCookingStep, nextLotCode, sizesToRecook } from "../src/domain/cooking.js";
import { ENTRY_DEFS, ENTRY_KINDS, durationHours, entryError, entryFigures, entryNotes, machineSampleFigures, normalizeEntryValues, shellSampleFigures } from "../src/domain/lotEntries.js";
import { nextShellingStep, shellingDayError, shellingDayNotes, shellingFigures } from "../src/domain/shelling.js";

const noStock = Object.fromEntries(["App", "Ap", "A", "AB", "B", "BC", "C", "D", "E"].map((k) => [k, 0])) as Record<"App" | "Ap" | "A" | "AB" | "B" | "BC" | "C" | "D" | "E", number>;

describe("Cooking", () => {
  it("suggests the client's own Lot number: ANG · year · month letter · next of the month", () => {
    expect(nextLotCode("2026-07-20", [])).toBe("ANG26G01");
    expect(nextLotCode("2026-07-20", ["ANG26G15", "ANG26F30", "ANG26G09"])).toBe("ANG26G16");
    // The sheet's real suffixed Lots don't confuse it.
    expect(nextLotCode("2026-06-02", ["ANG26F20A", "ANG26F20B"])).toBe("ANG26F21");
  });

  it("total and bags as the doc's 20/07 Lot: 151,367 kg in 1,892 bags, and the sheet's ANG26E01", () => {
    const sizes = lotSizes([{ sizes: { Ap: "10456", A: "24209", AB: "24089", B: "24105", BC: "36135", C: "19632", D: "7209", E: "5532" } }]);
    expect(Object.values(sizes).reduce((a, b) => a + b, 0)).toBe(151_367);
    expect(Math.round(lotBags(151_367))).toBe(1892);
    expect(lotBags(20_017)).toBeCloseTo(250.2125, 4);
  });

  it("can't cook more than a silo holds, or nothing at all", () => {
    expect(cookRunError({ date: "2026-07-20", code: "ANG26G16", sizes: { A: "101" } }, { ...noStock, A: 100 })).toMatch(/holds 100 kg; 101 kg can't be cooked/);
    expect(cookRunError({ date: "2026-07-20", code: "ANG26G16", sizes: { A: "100" } }, { ...noStock, A: 100 })).toBeNull();
    expect(cookRunError({ date: "2026-07-20", code: "ANG26G16", sizes: {} }, noStock)).toMatch(/at least one silo/);
    expect(cookRunError({ date: "2026-07-20", code: "", sizes: { A: "1" } }, { ...noStock, A: 1 })).toMatch(/Lot its number/);
  });

  it("takes cooked kg out of the silos and out of the day's closing", () => {
    const runs = [{ date: "2026-07-19", sizes: { A: "1000", B: "500" } }];
    const moves = [{ date: "2026-07-19", fromSize: "A", toSize: "B", kg: "100" }];
    const cooks = [{ date: "2026-07-20", sizes: { A: "900" } }];
    const stock = siloStock(runs, moves, cooks);
    expect(stock.find((s) => s.size === "A")).toMatchObject({ cookedKg: 900, stockKg: 0 });
    expect(stock.find((s) => s.size === "B")).toMatchObject({ cookedKg: 0, stockKg: 600 });
    const days = siloDailyStock(runs, moves, cooks);
    expect(days.map((d) => [d.date, d.openingKg, d.sizedKg, d.cookedKg, d.closingKg])).toEqual([["2026-07-19", 0, 1500, 0, 1500], ["2026-07-20", 1500, 0, 900, 600]]);
    expect(days[1]!.sizes.A).toBe(-900);
    expect(days.at(-1)!.closingKg).toBe(stock.reduce((n, s) => n + s.stockKg, 0));
  });

  it("QC-3 holds a size on No until a newer check passes it; a waiting one changes nothing yet; a rejected one is ignored", () => {
    const check = (id: number, status: string, decision: string, size = "A") => ({ id, status, decision, values: { size } });
    expect(cookChecks(["A"], []).A).toBe("not_checked");
    expect(cookChecks(["A"], [check(1, "submitted", "ok")]).A).toBe("waiting");
    expect(cookChecks(["A"], [check(1, "approved", "no")]).A).toBe("recook");
    expect(cookChecks(["A"], [check(1, "approved", "no"), check(2, "approved", "ok")]).A).toBe("ok");
    expect(cookChecks(["A"], [check(1, "approved", "ok"), check(2, "rejected", "no")]).A).toBe("ok");
    expect(cookChecks(["A", "B"], [check(1, "approved", "ok", "B")])).toEqual({ A: "not_checked", B: "ok" });
  });

  it("QC-4 decides by the newest approved check, and the Lot's status follows", () => {
    const check = (id: number, status: string, decision: string) => ({ id, status, decision, values: {} });
    expect(coolingCheck([check(1, "approved", "wait"), check(2, "approved", "ok")])).toBe("ok");
    expect(coolingCheck([check(1, "approved", "ok"), check(2, "submitted", "wait")])).toBe("waiting");
    expect(lotStatus({ inCooling: false, cooling: "not_checked", shellingDays: 0 })).toBe("cooking");
    expect(lotStatus({ inCooling: true, cooling: "wait", shellingDays: 0 })).toBe("cooling");
    expect(lotStatus({ inCooling: true, cooling: "ok", shellingDays: 0 })).toBe("ready");
    expect(lotStatus({ inCooling: true, cooling: "ok", shellingDays: 1 })).toBe("shelled");
  });

  it("a held size needs a new cooker run after the check that held it, and then only its check", () => {
    const e = (id: number, kind: string, decision: string | null = null, status = "approved") => ({ id, kind, status, decision, values: { size: "A" } });
    expect(sizesToRecook(["A"], [e(1, "cooker_log")])).toEqual([]);
    expect(sizesToRecook(["A"], [e(1, "cooker_log"), e(2, "qc3", "no")])).toEqual(["A"]);
    expect(sizesToRecook(["A"], [e(1, "cooker_log"), e(2, "qc3", "no"), e(3, "cooker_log")])).toEqual([]);
    expect(sizesToRecook(["A"], [e(1, "cooker_log"), e(2, "qc3", "no"), e(3, "cooker_log"), e(4, "qc3", "no")])).toEqual(["A"]);
    expect(sizesToRecook(["A"], [e(1, "cooker_log"), e(2, "qc3", "no"), e(3, "qc3", "ok")])).toEqual([]);
    expect(sizesToRecook(["A"], [e(1, "cooker_log"), e(2, "qc3", "no", "submitted")])).toEqual([]);
  });

  it("warns, never refuses, when QC-4 comes under 24 hours", () => {
    expect(hoursBetween("2026-07-20T06:00", "2026-07-21T06:00")).toBe(24);
    const notes = (time: string) => entryNotes("qc4", { time, moisture: "9", tempC: "30" }, { date: "2026-07-21", coolingAt: "2026-07-20T10:00" });
    expect(notes("09:00")[0]).toMatch(/Only 23.0 hours/);
    expect(notes("10:00")).toEqual([]);
  });

  it("points each person at their own next job", () => {
    const base = { sizes: ["A"] as "A"[], loggedSizes: ["A"] as "A"[], toRecook: [] as "A"[], checks: { A: "not_checked" as const }, inCooling: false, cooling: "not_checked" as const };
    const wi = { canFloor: true, canCheck: true, canReview: true };
    const qfs = { canFloor: false, canCheck: true, canReview: false };
    expect(nextCookingStep({ ...wi, ...base, loggedSizes: [] })).toBe("cooker_log");
    expect(nextCookingStep({ ...qfs, ...base, loggedSizes: [] })).toBe("qc3");
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "ok" } })).toBe("cooling");
    expect(nextCookingStep({ ...qfs, ...base, checks: { A: "ok" } })).toBe("none");
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "recook" }, toRecook: ["A"] })).toBe("cooker_log");
    expect(nextCookingStep({ ...qfs, ...base, checks: { A: "recook" }, toRecook: ["A"] })).toBe("none");
    // The new run is logged: the job passes to whoever checks, and nobody is left with nothing to do.
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "recook" } })).toBe("qc3");
    expect(nextCookingStep({ ...qfs, ...base, checks: { A: "recook" } })).toBe("qc3");
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "waiting" } })).toBe("qc3");
    expect(nextCookingStep({ ...qfs, ...base, checks: { A: "ok" }, inCooling: true })).toBe("qc4");
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "ok" }, inCooling: true, cooling: "waiting" })).toBe("qc4");
    expect(nextCookingStep({ ...wi, ...base, checks: { A: "ok" }, inCooling: true, cooling: "ok" })).toBe("none");
  });
});

describe("Shelling's day record", () => {
  it("reproduces the doc's 21/07 to the kg", () => {
    const f = shellingFigures({ inputKg: "151367", wholesKg: "36987.7", piecesKg: "1139.2", rejectionKg: "428.9", oilKg: "192.8", blackRejectionKg: "780.6", firstPassUncutKg: "9820.6", finalUncutKg: "500" });
    expect(f.goodKg).toBeCloseTo(38_126.9, 2);
    expect(f.yieldPct.toFixed(2)).toBe("25.19");
    expect(f.finalKg).toBeCloseTo(39_529.2, 2);
    expect(f.shellDustKg).toBeCloseTo(2_270.505, 3);
    expect(f.shellKg).toBeCloseTo(109_567.295, 3);
    expect(f.wholesPct.toFixed(1)).toBe("97.0");
  });

  it("reproduces the client's own row for ANG26E01 on every calculated column", () => {
    const f = shellingFigures({ inputKg: "20017", wholesKg: "4956.3", piecesKg: "244.1", rejectionKg: "440", oilKg: "65.3", blackRejectionKg: "121.1", firstPassUncutKg: "1782.7", finalUncutKg: "150" });
    expect(f.goodKg).toBeCloseTo(5200.4, 3);
    expect(f.finalKg).toBeCloseTo(5826.8, 3);
    expect(f.shellDustKg).toBeCloseTo(300.255, 3);
    expect(f.shotLbs).toBeCloseTo(45.81818174551632, 8);
    expect(f.yieldPct).toBeCloseTo(25.9799, 3);
    expect(f.realisationPct).toBeCloseTo(29.1093, 3);
    expect(f.wholesPct).toBeCloseTo(95.3061, 3);
    expect(f.brokensPct).toBeCloseTo(4.6939, 3);
    expect(f.uncutPct).toBeCloseTo(8.9059, 3);
    expect(f.finalUncutPct).toBeCloseTo(0.7494, 3);
  });

  it("refuses a day that can't be real, and only notes what the client's own file does", () => {
    expect(shellingDayError({ date: "2026-07-21", inputKg: "", wholesKg: "1" })).toMatch(/input kg/);
    expect(shellingDayError({ date: "2026-07-21", inputKg: "100" })).toMatch(/at least one output/);
    expect(shellingDayError({ date: "2026-07-21", inputKg: "100", wholesKg: "99" })).toMatch(/more than the input/);
    expect(shellingDayError({ date: "2026-07-21", inputKg: "100", wholesKg: "-1" })).toMatch(/Wholes must be/);
    // ANG26F10: 110,708 kg cooked, 132,565 kg shelled over two rows. Real, so a note and no refusal.
    const over = { date: "2026-06-15", inputKg: "132565", wholesKg: "30000" };
    expect(shellingDayError(over)).toBeNull();
    expect(shellingDayNotes(over, 110_708)[0]).toMatch(/Only 110,708 kg of this Lot is left/);
    expect(shellingDayNotes({ inputKg: "10", firstPassUncutKg: "1", finalUncutKg: "2" }, 10)[0]).toMatch(/Final uncut is more/);
  });

  it("walks the floor through its steps, then the checks", () => {
    const none = { days: 0, lineRuns: 0, qc5: 0, qty1: 0, qc6: 0 };
    expect(nextShellingStep({ canFloor: true, canCheck: true, ...none })).toBe("day");
    expect(nextShellingStep({ canFloor: true, canCheck: true, ...none, days: 1 })).toBe("line_run");
    expect(nextShellingStep({ canFloor: false, canCheck: true, ...none })).toBe("qc5");
    expect(nextShellingStep({ canFloor: false, canCheck: true, ...none, qc5: 1 })).toBe("qty1");
    expect(nextShellingStep({ canFloor: false, canCheck: true, ...none, qc5: 1, qty1: 1 })).toBe("qc6");
    expect(nextShellingStep({ canFloor: true, canCheck: true, days: 1, lineRuns: 1, qc5: 1, qty1: 1, qc6: 1 })).toBe("none");
  });
});

describe("the checks on the line", () => {
  it("machine frequency: kg per hour = g/min × 0.06, the sheet's 5,430 → 325.8", () => {
    expect(entryFigures("qc5_frequency", { gramsPerMin: "5430" })[0]).toEqual({ label: "Kg per hour", value: "325.8" });
  });

  it("machine sample: the sheet's first row, knife marks among the wholes and out of the sum", () => {
    const row = { sampleG: "1000", wholesG: "189", piecesG: "1", buttsG: "0", knifeMarkG: "20", uncutG: "130", unscoopWholesG: "129", unscoopPiecesG: "13", shellG: "538" };
    const f = machineSampleFigures(row);
    expect(f).toMatchObject({ totalKernels: 210, errorG: 0 });
    expect(f.wholesPct).toBeCloseTo(90, 6);
    expect(f.uncutPct).toBeCloseTo(13, 6);
    expect(f.unscoopPct).toBeCloseTo(14.2, 6);
    expect(f.knifeMarkPct).toBeCloseTo(9.5238, 3);
    expect(f.piecesPct).toBeCloseTo(0.4762, 3);
    // 90 % is under the doc's 95 % target: an alert, and it adds up, so only one note.
    expect(entryNotes("qc5_capacity", row, {})).toEqual([expect.stringMatching(/below the 95 % target/)]);
  });

  it("shell sample: unscoop counts 0.4, uncut 0.28, rejection nothing, on the sheet's real rows", () => {
    const pct = (v: Record<string, string>) => shellSampleFigures({ sampleG: "1000", ...v }).kernelPct;
    expect(pct({ brokensG: "5", uncutG: "7", shellG: "988" })).toBeCloseTo(0.696, 6);
    expect(pct({ wholeG: "5", brokensG: "8", unscoopG: "5", uncutG: "12", shellG: "970" })).toBeCloseTo(1.836, 6);
    expect(pct({ rejectionG: "25", unscoopG: "10", uncutG: "30" })).toBeCloseTo(1.24, 6);
    expect(shellSampleFigures({ sampleG: "1000", brokensG: "5", uncutG: "7", shellG: "988" }).kernelLbs).toBeCloseTo(1.2274656, 8);
  });

  it("alerts above 0.5 % kernel in the shell, the doc's 0.78 % of 21/07, and the shell still moves on", () => {
    const notes = entryNotes("qc6", { sampleG: "1000", brokensG: "7.8", shellG: "992.2" }, {});
    expect(notes).toEqual([expect.stringMatching(/0.78 % kernel left in the shell, above 0.5 %/)]);
    expect(ENTRY_DEFS.qc6.decision).toBeUndefined();
  });

  it("line run: duration and uncut %, the sheet's line A++: 06:25–12:00, 700 of 8,010 kg", () => {
    expect(durationHours("06:25", "12:00")).toBeCloseTo(5.583, 3);
    expect(durationHours("22:00", "02:00")).toBe(4);
    expect(entryFigures("line_run", { start: "06:25", end: "12:00", inputKg: "8010", uncutKg: "700" }).map((f) => f.value)).toEqual(["5.58 h", "8.7 %"]);
  });

  it("every kind's form refuses what it must, in words a person can follow", () => {
    expect(entryError("cooker_log", { date: "2026-07-20", values: { size: "A", start: "06:00", stop: "aa", tempC: "90", pressureBar: "2" } })).toMatch(/Stop must be a time/);
    expect(entryError("qc3", { date: "2026-07-20", values: { size: "A" } })).toMatch(/Choose OK or No/);
    expect(entryError("qc3", { date: "2026-07-20", values: { size: "B" }, decision: "ok" }, ["A"])).toMatch(/cooked no size B/);
    expect(entryError("qc4", { date: "2026-07-21", values: { time: "10:00", moisture: "25", tempC: "30" }, decision: "ok" })).toMatch(/between 0 and 20/);
    expect(entryError("qc4", { date: "2026-07-21", values: { time: "10:00", moisture: "9", tempC: "30" }, decision: "no" })).toMatch(/Choose OK or Wait/);
    expect(entryError("line_run", { date: "2026-07-21", values: { line: "Z9", size: "A", inputKg: "1", start: "06:00", end: "07:00" } })).toMatch(/not one of the 14 lines/);
    expect(entryError("qty1", { date: "2026-07-21", values: { line: "A1", kg: "1", repassed: "Maybe" } })).toMatch(/Repassed\? must be one of Yes, No/);
    expect(entryError("qc6", { date: "", values: {} })).toMatch(/date is required/);
  });

  it("reads a size as a sheet writes it, and keeps only the kind's own fields", () => {
    expect(normalizeEntryValues("qc3", { size: "DE", remarks: " fine ", junk: "x" })).toEqual({ size: "E", remarks: "fine" });
    expect(normalizeEntryValues("qc3", { size: "App" })).toEqual({ size: "App" });
  });

  it("every kind names its workbook sheet, and only a check with a decision asks for one", () => {
    expect(new Set(ENTRY_KINDS.map((k) => ENTRY_DEFS[k].sheet)).size).toBe(ENTRY_KINDS.length);
    // QC-5, QC-6, QTY-1 and QC-7 before the sorter only raise alerts; every check of Phases 6–8 sends material back on No.
    expect(ENTRY_KINDS.filter((k) => ENTRY_DEFS[k].decision)).toEqual(["qc3", "qc4", "qc7_after", "qc8", "qc10", "qc12", "qc9", "qc11"]);
  });
});

describe("by-products", () => {
  it("store = produced − dispatched − burned", () => {
    expect(storeBalance("shell", 109_567.3, 26_720, 7000)).toMatchObject({ stockKg: 75_847.3 });
    expect(storeBalance("shell_dust", 2270.5, 0)).toMatchObject({ stockKg: 2270.5, burnedKg: 0 });
  });

  it("the doc's truck: tare 20,850 → gross 47,570 = net 26,720 kg", () => {
    expect(truckNetKg({ tareKg: "20850", grossKg: "47570" })).toBe(26_720);
    expect(truckNetKg({ tareKg: "20850" })).toBeNull();
  });

  it("moves through the gate procedure as it is filled in", () => {
    expect(truckStatus({})).toBe("at_gate");
    expect(truckStatus({ documentsChecked: true })).toBe("documents_checked");
    expect(truckStatus({ documentsChecked: true, tareKg: "1" })).toBe("tare_weighed");
    expect(truckStatus({ documentsChecked: true, tareKg: "1", grossKg: "2" })).toBe("weighed");
    expect(truckStatus({ documentsChecked: true, tareKg: "1", grossKg: "2", gatePassNo: "GP1" })).toBe("closed");
  });

  it("weighing opens only after the documents, and a gate pass only closes a truck the store can fill", () => {
    const truck = { stream: "shell", date: "2026-07-20", truckNo: "2040KB01" };
    const err = (v: object, stock = 30_000) => truckError({ ...truck, ...v }, stock);
    expect(err({})).toBeNull();
    expect(err({ tareKg: "20850" })).toMatch(/documents before weighing/);
    expect(err({ documentsChecked: true, grossKg: "47570" })).toMatch(/empty \(tare\) first/);
    expect(err({ documentsChecked: true, tareKg: "47570", grossKg: "20850" })).toMatch(/Gross must be more than tare/);
    expect(err({ documentsChecked: true, tareKg: "20850", gatePassNo: "GP1" })).toMatch(/empty and loaded before closing/);
    expect(err({ documentsChecked: true, tareKg: "20850", grossKg: "47570", gatePassNo: "GP1" })).toMatch(/buyer or vendor/);
    expect(err({ documentsChecked: true, tareKg: "20850", grossKg: "47570", gatePassNo: "GP1", buyer: "Revata" }, 26_000)).toMatch(/shell store holds 26,000 kg; a truck of 26,720 kg/);
    expect(err({ documentsChecked: true, tareKg: "20850", grossKg: "47570", gatePassNo: "GP1", buyer: "Revata" })).toBeNull();
    // Open trucks may weigh more than the store holds today: only leaving takes it out.
    expect(err({ documentsChecked: true, tareKg: "20850", grossKg: "47570" }, 0)).toBeNull();
  });

  it("the boiler burns only what the shell silo holds", () => {
    expect(boilerError({ date: "2026-05-20", shellKg: "7000" }, 7000)).toBeNull();
    expect(boilerError({ date: "2026-05-20", shellKg: "7001" }, 7000)).toMatch(/holds 7,000 kg/);
    expect(boilerError({ date: "2026-05-20", shellKg: "1", runningHours: "25" }, 7000)).toMatch(/between 0 and 24/);
  });
});
