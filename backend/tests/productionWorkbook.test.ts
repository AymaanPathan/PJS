/**
 * The production workbook: one file creates a batch, its load, the load's moisture checks, its pallets and its
 * final weight — through the same rules as the screens — and a preview writes nothing. What the file can't
 * do is as important: change a saved batch, check a load that isn't due one, weigh before moisture is OK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import {
  commitProductionWorkbook, downloadProductionWorkbook, previewProductionWorkbook,
} from "../src/services/productionWorkbook.js";
import { batchCalibration } from "../src/services/production/calibration.js";
import { listRcnReceipts } from "../src/services/production/rcnReceipts.js";
import { TABS, tabHeader } from "../src/domain/productionWorkbook/tabs.js";

const prisma = new PrismaClient();
const app = buildApp();
const SITE = "PWB-FACTORY";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
let wi: { id: string; role: "warehouse_incharge" };
let qfsCookie = "";

async function cleanup() {
  await prisma.manualCalibration.deleteMany({ where: { sizingCheck: { batch: { warehouse: SITE } } } });
  await prisma.sizingCheck.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.rcnCalibrationRun.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnPallet.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnMoistureCheck.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PWB-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pwb-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function lotInBin(bin: string, kg: string) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
}

/** An .xlsx with the given tabs: first row the headers, then the rows. */
async function xlsx(tabs: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [title, rows] of Object.entries(tabs)) {
    const ws = wb.addWorksheet(title);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const BATCHES = ["Batch Name", "Start Date", "Bins", "Proposed By"];
const LOADS = ["RCN Receipt ID", "Batch Name", "Date", "BTM No", "Source Bin"];
const CHECKS = ["Check ID", "RCN Receipt ID", "BTM No", "Moisture (%)", "Nut Count", "Sample Weight (g)", "GK (g)", "Spot (g)", "Immature (g)", "Result"];
const PALLETS = ["Pallet ID", "RCN Receipt ID", "BTM No", "Gross Weight (kg)", "No of Bags", "Factory Bin"];
const FINAL = ["RCN Receipt ID", "BTM No", "Empty Pallets Weight (kg)", "No of Pallets", "Dust (kg)", "Voids (kg)"];

const preview = (buf: Buffer) => previewProductionWorkbook(wi, SITE, buf, "test.xlsx");
const byName = (p: Awaited<ReturnType<typeof preview>>, name: string) => p.sheets.find((s) => s.name === name)!;

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "PWB" } });
  for (const code of ["PWB-03B", "PWB-10", "PWB-11"]) await prisma.bin.create({ data: { code } });
  await lotInBin("PWB-03B", "2950400");
  await lotInBin("PWB-10", "878200");
  await lotInBin("PWB-11", "640000");
  const u = await prisma.user.create({ data: { username: "pwb-wi", displayName: "wi", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  wi = { id: u.id, role: "warehouse_incharge" };
  await prisma.user.create({ data: { username: "pwb-qfs", displayName: "qfs", role: "qfs_officer", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "pwb-qfs", password: "test-password-1" } });
  qfsCookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the sample", () => {
  it("is one file with a tab per step of Phases 1 to 8, headers only", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(built.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Batches", "RCN Receipts", "Moisture Checks", "Pallets", "Final Weight", "Calibration Runs", "Silo Checks", "Silo Moves", "Cooking", "Cooker Log", "Cooking Checks", "Waste Water", "Cooling", "Cooling Checks", "Shelling Days", "Line Runs", "Machine Frequency", "Machine Samples", "Uncut Checks", "Shell Samples", "Sorter Before", "Sorter After", "Borma Trolleys", "Borma Ovens", "Borma Quality", "Humidification", "Humidity Checks", "Peeling", "Husk Winnowing", "Grading", "Peeling Workers", "In-process Checks", "Packing", "Pre-fill Checks", "Final Checks", "FG Dispatch", "Boiler", "Trucks"]);
    expect(wb.worksheets.every((w) => w.actualRowCount === 1)).toBe(true);
    expect(built.filename).toBe("ANAGROCI - Production - Sample.xlsx");
  });
});

describe("the columns", () => {
  it("no two columns of a tab read as one: silo A++'s kg must never land in silo A", () => {
    for (const tab of TABS) {
      const headers = tab.fields.map((f) => tabHeader(f.label));
      expect(new Set(headers).size, tab.title).toBe(headers.length);
    }
  });
});

describe("one file, the whole of Intake", () => {
  const file = () => xlsx({
    Batches: [BATCHES, ["PWB-ANA-03B", "2026-07-19", "PWB-03B / PWB-10", "Warehouse team"]],
    "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-20", "109", "PWB-03B"]],
    // Too wet first, then OK after drying: two rows for one load, in the order they happened.
    "Moisture Checks": [CHECKS, [null, null, "109", 11.2, 180, 1000, 230, 12, 13, "Hold"], [null, null, "109", 9.8, 180, 1000, 230, 12, 13, "OK"]],
    Pallets: [PALLETS, [null, null, "109", 2335, 30, "ANA-03B"], [null, null, "109", 2445.4, 30, "ANA-03B"]],
    "Final Weight": [FINAL, [null, "109", "120 / 80", "1 / 1", 2.5, ""]],
  });

  it("previews every row as new, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.errorCount).toBe(0);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["Batches", 1], ["RCN Receipts", 1], ["Moisture Checks", 2], ["Pallets", 2], ["Final Weight", 1]]);
    expect(await prisma.productionBatch.count({ where: { warehouse: SITE } })).toBe(0);
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(0);
  });

  it("applies it: the load is Intake done, and an Incharge's checks are approved as they are saved", async () => {
    const p = await preview(await file());
    const done = await commitProductionWorkbook(wi, p.token);
    expect(done.totalCreated).toBe(7);
    const [load] = await listRcnReceipts(SITE);
    expect(load).toMatchObject({ batchCode: expect.stringMatching(/^PR-PWB-2026-\d{3}$/), btmNo: "109", binCode: "PWB-03B", status: "intake_done" });
    expect(load!.moistureChecks.map((c) => [c.decision, c.status])).toEqual([["hold", "approved"], ["ok", "approved"]]);
    expect(load!.pallets.map((p) => p.grossKg)).toEqual(["2335", "2445.4"]);
    expect(load!.finalWeight).toMatchObject({ emptyPallets: [{ weightKg: "120", count: "1" }, { weightKg: "80", count: "1" }], dustKg: "2.5", voidsKg: "" });
  });

  it("a token is used once", async () => {
    const p = await preview(await xlsx({ Batches: [BATCHES] }));
    await commitProductionWorkbook(wi, p.token);
    await expect(commitProductionWorkbook(wi, p.token)).rejects.toThrow(/expired/);
  });

  it("an export uploaded back unchanged changes nothing", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "Pallets").unchanged).toBe(2);
  });
});

describe("what the file can't do — the screens' own refusals, row by row", () => {
  it("won't put a bin in a second batch, or change a saved one", async () => {
    const p = await preview(await xlsx({
      Batches: [BATCHES, ["PWB-NEW", "2026-08-01", "PWB-03B", ""], ["PWB-ANA-03B", "2026-07-25", "PWB-03B / PWB-10", "Warehouse team"]],
    }));
    expect(byName(p, "Batches").errors.map((e) => [e.row, e.message])).toEqual([
      [2, expect.stringMatching(/PWB-03B is already in production run PR-PWB-2026-\d{3} \(PWB-ANA-03B\)/)],
      [3, expect.stringMatching(/Production run PR-PWB-2026-\d{3} \(PWB-ANA-03B\) is already saved.*Start Date/)],
    ]);
  });

  it("takes a load's steps in any order, as the screens do: pallets before the moisture check, a re-check of a weighed load", async () => {
    const p = await preview(await xlsx({
      "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-21", "110", "PWB-10"]],
      Pallets: [PALLETS, [null, null, "110", 2000, 30, "ANA-03B"]],
      "Moisture Checks": [CHECKS, [null, null, "109", 9.5, 180, null, null, null, null, "OK"]],
    }));
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["RCN Receipts", 1], ["Moisture Checks", 1], ["Pallets", 1]]);
    // Previewed only: the tests below go on from the one load.
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(1);
  });

  it("asks for the RCN Receipt ID when a BTM No is on two loads, and warns about the repeat", async () => {
    const p = await preview(await xlsx({
      "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-22", "109", "PWB-03B"]],
      "Moisture Checks": [CHECKS, [null, null, "109", 9.5, 180, null, null, null, null, "OK"]],
    }));
    expect(byName(p, "RCN Receipts").warnings[0]!.message).toMatch(/BTM 109 from PWB-03B is already on RR-PWB-2026-0001/);
    expect(byName(p, "Moisture Checks").errors[0]!.message).toMatch(/BTM 109 is on 2 loads .* Give the RCN Receipt ID/);
  });

  it("corrects a weighed load's pallet (any order), and reports an unknown ID rather than creating a row", async () => {
    const [load] = await listRcnReceipts(SITE);
    const p = await preview(await xlsx({
      Pallets: [PALLETS, [load!.pallets[0]!.id, null, null, 9999, 30, "ANA-03B"], [999999, null, null, 1, 1, "X"]],
    }));
    expect(byName(p, "Pallets").changed).toBe(1);
    expect(byName(p, "Pallets").errors.map((e) => e.message)).toEqual([expect.stringMatching(/Pallet 999999 doesn't exist/)]);
  });

  it("a column the tab needs must be there", async () => {
    const p = await preview(await xlsx({ Pallets: [["Gross Weight (kg)", "No of Bags"], [1, 1]] }));
    expect(byName(p, "Pallets").errors[0]!.message).toMatch(/"Pallet ID" column is missing/);
  });
});

describe("Calibration in the same file", () => {
  const RUNS = ["Run ID", "RCN Receipt ID", "BTM No", "Date", "Size A++ (>25mm)", "Size A (24mm)", "Size E (18mm)"];
  const CHECKS2 = ["Check ID", "Batch Name", "Date", "Sampling Point", "BIN NO", "Nut Count per KG", "Sample Qty (gm)", "A++ (g)", "A (g)", "AB (g)", "DE (g)", "< DE (g)", "Result"];
  const MOVES = ["Move ID", "Date", "From Silo", "To Silo", "Kg Moved"];
  // PWB-ANA-03B's BTM 109 hands over 2335 + 2445.4 − 39 (60 bags) − 200 (pallets) − 2.5 (dust) = 4,538.9 kg.
  const file = () => xlsx({
    "Calibration Runs": [RUNS, [null, null, "109", "2026-07-21", 500, 3000, null], [null, null, "109", "2026-07-22", null, 1000, 38.9]],
    "Silo Checks": [
      CHECKS2,
      [null, "PWB-ANA-03B", "2026-07-22", "A", "PWB-03B", 143, 1000, null, 203, 625, null, 172, "Fail"],
      [null, "PWB-ANA-03B", "2026-07-22", "DE", null, null, 1000, null, null, null, 950, 50, "OK"],
    ],
    "Silo Moves": [MOVES, [null, "2026-07-23", "A", "AB", 400]],
  });

  it("previews runs, checks and moves leaning on each other, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.errorCount).toBe(0);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["Calibration Runs", 2], ["Silo Checks", 2], ["Silo Moves", 1]]);
    expect(await prisma.rcnCalibrationRun.count({ where: { rcnReceipt: { batch: { warehouse: SITE } } } })).toBe(0);
  });

  it("applies them: the silos fill, DE reads as silo E, a check is approved as it is saved, and the nuts move", async () => {
    await commitProductionWorkbook(wi, (await preview(await file())).token);
    const load = (await listRcnReceipts(SITE)).find((r) => r.btmNo === "109")!;
    expect(load.calibration).toMatchObject({ sizedKg: 4_538.9, leftKg: 0 });
    expect(load.status).toBe("calibrated");
    const cal = (await batchCalibration(SITE, "PWB-ANA-03B"))!;
    const stock = Object.fromEntries(cal.silos.map((s) => [s.size, s.stockKg]));
    expect(stock).toMatchObject({ App: 500, A: 3_600, AB: 400, E: 38.9 });
    expect(cal.siloChecks.A).toMatchObject({ state: "re_sized" });
    expect(cal.siloChecks.E).toMatchObject({ state: "ok" });
    expect(cal.sizingChecks.every((c) => c.status === "approved")).toBe(true);
  });

  it("the same file again creates nothing: an upload is never duplicated", async () => {
    const p = await preview(await xlsx({
      "Calibration Runs": [RUNS, [null, null, "109", "2026-07-22", null, 1000, 38.9]],
      "Silo Checks": [CHECKS2, [null, "PWB-ANA-03B", "2026-07-22", "A", "PWB-03B", 143, 1000, null, 203, 625, null, 172, "Fail"]],
      "Silo Moves": [MOVES, [null, "2026-07-23", "A", "AB", 400]],
    }));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated).toBe(0);
  });

  it("an export uploaded back unchanged changes nothing, Calibration tabs included", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "Calibration Runs").unchanged).toBe(2);
    expect(byName(p, "Silo Checks").unchanged).toBe(2);
    expect(byName(p, "Silo Moves").unchanged).toBe(1);
  });

  it("gives the screens' own refusals, row by row", async () => {
    const p = await preview(await xlsx({
      "Calibration Runs": [RUNS, [null, null, "109", "2026-07-24", 1, null, null], [999999, null, null, "2026-07-24", 1, null, null]],
      "Silo Checks": [CHECKS2, [null, "PWB-ANA-03B", "2026-07-24", "Z", null, null, 1000, 1000, null, null, null, null, "OK"], [null, "PWB-ANA-03B", "2026-07-24", "A", "BIN-NOPE", null, 1000, null, 1000, null, null, null, "OK"]],
      "Silo Moves": [MOVES, [null, "2026-07-24", "E", "A", 1], [null, "2026-07-24", "A", "AB", 999999]],
    }));
    expect(byName(p, "Calibration Runs").errors.map((e) => e.message)).toEqual([expect.stringMatching(/already fully calibrated/), expect.stringMatching(/run 999999 doesn't exist/)]);
    expect(byName(p, "Silo Checks").errors.map((e) => e.message)).toEqual([expect.stringMatching(/Choose the silo the sample was taken from/), expect.stringMatching(/BIN-NOPE is not in production run/)]);
    expect(byName(p, "Silo Moves").errors.map((e) => e.message)).toEqual([expect.stringMatching(/E \(18 mm\) has no failed check/), expect.stringMatching(/can't be moved out of it/)]);
  });
});

describe("who may upload", () => {
  it("a QFS Officer keeps entering checks on screen, for the Incharge to approve", async () => {
    const res = await app.inject({ method: "GET", url: "/api/production/workbook/info", headers: { cookie: qfsCookie } });
    expect(res.statusCode).toBe(403);
  });
});
