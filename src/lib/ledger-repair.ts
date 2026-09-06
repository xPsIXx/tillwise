import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { cp, mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

function ledgerPath() {
  if (process.env.NODE_ENV === "production") return resolve("/data/pglite");
  return resolve(process.cwd(), "data", "pglite");
}

export type LedgerInspect = {
  path: string;
  exists: boolean;
  pgVersion: string | null;
  pgVersionBytes: number | null;
  looksComplete: boolean;
  hasPostmasterPid: boolean;
  hasLock: boolean;
  hasControl: boolean;
  fileCount: number;
  bytes: number;
  backups: string[];
  notes: string[];
};

export type LedgerRepairResult = {
  inspect: LedgerInspect;
  backupPath: string | null;
  steps: string[];
  ok: boolean;
  trips: number | null;
  repaired: boolean;
  restartNeeded: boolean;
  restarting: boolean;
};

const PG_CONTROL_FILE_SIZE = 8192;
const DB_SHUTDOWNED = 1;
const XLOG_BLCKSZ = 8192;
const MIN_WAL_SEG_SIZE = 1024 * 1024;
const MAX_WAL_SEG_SIZE = 1024 * 1024 * 1024;
const SIZE_OF_XLOG_LONG_PHD = 40;
const SIZE_OF_XLOG_RECORD = 24;
const SIZE_OF_CHECKPOINT = 88;
const XLOG_PAGE_MAGIC_17 = 0xd116;
const XLOG_PAGE_MAGIC_18 = 0xd118;
const XLP_LONG_HEADER = 0x0002;
const XLOG_CHECKPOINT_SHUTDOWN = 0x00;
const XLR_BLOCK_ID_DATA_SHORT = 255;
const RM_XLOG_ID = 0;

const OFF = {
  systemIdentifier: 0,
  pgControlVersion: 8,
  state: 16,
  time: 24,
  checkPoint: 32,
  checkPointCopy: 40,
  checkPointCopyRedo: 40,
  checkPointCopyThisTimeLineID: 48,
  checkPointCopyTime: 104,
  minRecoveryPoint: 136,
  minRecoveryPointTLI: 144,
  backupStartPoint: 152,
  backupEndPoint: 160,
  backupEndRequired: 168,
  walLevel: 172,
  walLogHints: 176,
  maxConnections: 180,
  maxWorkerProcesses: 184,
  maxWalSenders: 188,
  maxPreparedXacts: 192,
  maxLocksPerXact: 196,
  trackCommitTimestamp: 200,
  xlogBlcksz: 224,
  xlogSegSize: 228,
} as const;

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let crc = i;
  for (let j = 0; j < 8; j += 1) {
    crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
  }
  crcTable[i] = crc >>> 0;
}

function crc32c(chunks: Uint8Array[]) {
  let crc = 0xffffffff;
  for (const chunk of chunks) {
    for (const byte of chunk) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUInt64LE(buf: Buffer, offset: number) {
  return buf.readBigUInt64LE(offset);
}

function writeUInt64LE(buf: Buffer, value: bigint, offset: number) {
  buf.writeBigUInt64LE(value, offset);
}

function parseWalSegNo(fileName: string, walSegSize: number) {
  if (!/^[0-9A-F]{24}$/.test(fileName)) return null;
  const log = BigInt(`0x${fileName.slice(8, 16)}`);
  const seg = BigInt(`0x${fileName.slice(16, 24)}`);
  return log * (0x100000000n / BigInt(walSegSize)) + seg;
}

function xlogFileName(tli: number, segNo: bigint, walSegSize: number) {
  const segmentsPerXlogId = 0x100000000n / BigInt(walSegSize);
  const log = segNo / segmentsPerXlogId;
  const seg = segNo % segmentsPerXlogId;
  return [
    tli.toString(16).toUpperCase().padStart(8, "0"),
    log.toString(16).toUpperCase().padStart(8, "0"),
    seg.toString(16).toUpperCase().padStart(8, "0"),
  ].join("");
}

async function unlinkIfExists(path: string) {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

async function writeFileSynced(path: string, data: Buffer) {
  const file = await open(path, "w");
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function fileBytes(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function walkBytes(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files: 0, bytes: 0 };
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = await walkBytes(path);
      files += inner.files;
      bytes += inner.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(path)).size;
    }
  }
  return { files, bytes };
}

async function listBackups(dir: string): Promise<string[]> {
  const parent = dirname(dir);
  const base = basename(dir);
  let names: string[] = [];
  try {
    names = await readdir(parent);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(`${base}.bak-`) || n.startsWith(`${base}.corrupt-`))
    .sort()
    .reverse();
}

export async function inspectLedger(): Promise<LedgerInspect> {
  const path = ledgerPath();
  const notes: string[] = [];
  let exists = false;
  try {
    exists = (await stat(path)).isDirectory();
  } catch {
    exists = false;
  }
  const pgPath = join(path, "PG_VERSION");
  const pidPath = join(path, "postmaster.pid");
  const lockPath = `${path}.lock`;
  const controlPath = join(path, "global", "pg_control");
  const pgVersionBytes = exists ? await fileBytes(pgPath) : null;
  let pgVersion: string | null = null;
  if (pgVersionBytes != null) {
    try {
      pgVersion = (await readFile(pgPath, "utf8")).trim();
    } catch {
      pgVersion = null;
    }
  }
  const hasPostmasterPid = exists && existsSync(pidPath);
  const hasLock = existsSync(lockPath);
  const hasControl = exists && existsSync(controlPath);
  const walked = exists ? await walkBytes(path) : { files: 0, bytes: 0 };
  const looksComplete = Boolean(pgVersion && hasControl);

  if (!exists) notes.push("No ledger folder at this path.");
  else if (!pgVersion) notes.push("Folder exists but PG_VERSION is missing — not a finished ledger.");
  else {
    notes.push(
      "PG_VERSION is meant to be tiny (a few bytes of “17”). 1 KB is normal and means a ledger is here.",
    );
  }
  if (hasPostmasterPid) {
    notes.push(
      "postmaster.pid is present. While Tillwise is running that file is supposed to be there — Postgres recreates it on every start. Deleting it by hand will not keep it gone.",
    );
  }
  if (hasLock) notes.push("A lock file is present. Repair will remove it if the process is gone.");
  if (pgVersion && !hasControl) {
    notes.push("PG_VERSION is present but pg_control is not — this copy may be incomplete.");
  }

  return {
    path,
    exists,
    pgVersion,
    pgVersionBytes,
    looksComplete,
    hasPostmasterPid,
    hasLock,
    hasControl,
    fileCount: walked.files,
    bytes: walked.bytes,
    backups: exists ? await listBackups(path) : [],
    notes,
  };
}

function findCrcOffset(control: Buffer): number {
  for (let off = 248; off <= 360; off += 4) {
    if (crc32c([control.subarray(0, off)]) === control.readUInt32LE(off)) return off;
  }
  throw new Error("Could not locate pg_control checksum");
}

async function resetWal(rootDir: string) {
  const pgVersion = (await readFile(join(rootDir, "PG_VERSION"), "utf8")).trim();
  if (pgVersion !== "17" && pgVersion !== "18") {
    throw new Error(`Cannot reset WAL for PG_VERSION ${pgVersion} (need 17 or 18)`);
  }
  const controlPath = join(rootDir, "global", "pg_control");
  const control = Buffer.from(await readFile(controlPath));
  if (control.length !== PG_CONTROL_FILE_SIZE) {
    throw new Error(`Unexpected pg_control size ${control.length}`);
  }
  const controlVersion = control.readUInt32LE(OFF.pgControlVersion);
  if (controlVersion !== 1700 && controlVersion !== 1800) {
    throw new Error(`Unsupported pg_control version ${controlVersion}`);
  }
  const crcOff = findCrcOffset(control);
  const pageMagic = pgVersion === "18" || controlVersion === 1800 ? XLOG_PAGE_MAGIC_18 : XLOG_PAGE_MAGIC_17;

  const walSegSize = control.readUInt32LE(OFF.xlogSegSize);
  const xlogBlcksz = control.readUInt32LE(OFF.xlogBlcksz);
  if (
    walSegSize < MIN_WAL_SEG_SIZE ||
    walSegSize > MAX_WAL_SEG_SIZE ||
    (walSegSize & (walSegSize - 1)) !== 0 ||
    0x100000000 % walSegSize !== 0
  ) {
    throw new Error(`Unsupported WAL segment size ${walSegSize}`);
  }
  if (xlogBlcksz !== XLOG_BLCKSZ) {
    throw new Error(`Unsupported WAL block size ${xlogBlcksz}`);
  }

  const tli = control.readUInt32LE(OFF.checkPointCopyThisTimeLineID);
  let newSegNo = readUInt64LE(control, OFF.checkPointCopyRedo) / BigInt(walSegSize);
  const walDir = join(rootDir, "pg_wal");
  await mkdir(join(walDir, "archive_status"), { recursive: true });
  for (const file of await readdir(walDir)) {
    const segNo = parseWalSegNo(file, walSegSize);
    if (segNo !== null && segNo > newSegNo) newSegNo = segNo;
  }
  newSegNo += 1n;

  const redo = newSegNo * BigInt(walSegSize) + BigInt(SIZE_OF_XLOG_LONG_PHD);
  const now = BigInt(Math.floor(Date.now() / 1000));

  writeUInt64LE(control, redo, OFF.checkPointCopyRedo);
  writeUInt64LE(control, now, OFF.checkPointCopyTime);
  control.writeInt32LE(DB_SHUTDOWNED, OFF.state);
  writeUInt64LE(control, now, OFF.time);
  writeUInt64LE(control, redo, OFF.checkPoint);
  writeUInt64LE(control, 0n, OFF.minRecoveryPoint);
  control.writeUInt32LE(0, OFF.minRecoveryPointTLI);
  writeUInt64LE(control, 0n, OFF.backupStartPoint);
  writeUInt64LE(control, 0n, OFF.backupEndPoint);
  control.writeUInt8(0, OFF.backupEndRequired);
  control.writeInt32LE(0, OFF.walLevel);
  control.writeUInt8(0, OFF.walLogHints);
  control.writeInt32LE(100, OFF.maxConnections);
  control.writeInt32LE(8, OFF.maxWorkerProcesses);
  control.writeInt32LE(10, OFF.maxWalSenders);
  control.writeInt32LE(0, OFF.maxPreparedXacts);
  control.writeInt32LE(64, OFF.maxLocksPerXact);
  control.writeUInt8(0, OFF.trackCommitTimestamp);
  control.writeUInt32LE(crc32c([control.subarray(0, crcOff)]), crcOff);

  for (const file of await readdir(walDir)) {
    if (/^[0-9A-F]{24}(?:\.partial)?$/.test(file)) {
      await unlink(join(walDir, file));
    }
  }
  const archiveStatusDir = join(walDir, "archive_status");
  if (existsSync(archiveStatusDir)) {
    for (const file of await readdir(archiveStatusDir)) {
      if (/^[0-9A-F]{24}(?:\.partial)?\.(?:ready|done)$/.test(file)) {
        await unlink(join(archiveStatusDir, file));
      }
    }
  }
  const walSummaryDir = join(walDir, "summaries");
  if (existsSync(walSummaryDir)) {
    for (const file of await readdir(walSummaryDir)) {
      if (/^[0-9A-F]{40}\.summary$/.test(file)) {
        await unlink(join(walSummaryDir, file));
      }
    }
  }

  const wal = Buffer.alloc(walSegSize);
  wal.writeUInt16LE(pageMagic, 0);
  wal.writeUInt16LE(XLP_LONG_HEADER, 2);
  wal.writeUInt32LE(tli, 4);
  writeUInt64LE(wal, redo - BigInt(SIZE_OF_XLOG_LONG_PHD), 8);
  wal.writeUInt32LE(0, 16);
  writeUInt64LE(wal, readUInt64LE(control, OFF.systemIdentifier), 24);
  wal.writeUInt32LE(walSegSize, 32);
  wal.writeUInt32LE(XLOG_BLCKSZ, 36);

  const recordOffset = SIZE_OF_XLOG_LONG_PHD;
  const recordTotalLength = SIZE_OF_XLOG_RECORD + 2 + SIZE_OF_CHECKPOINT;
  wal.writeUInt32LE(recordTotalLength, recordOffset);
  wal.writeUInt32LE(0, recordOffset + 4);
  writeUInt64LE(wal, 0n, recordOffset + 8);
  wal.writeUInt8(XLOG_CHECKPOINT_SHUTDOWN, recordOffset + 16);
  wal.writeUInt8(RM_XLOG_ID, recordOffset + 17);
  wal.writeUInt16LE(0, recordOffset + 18);
  wal.writeUInt8(XLR_BLOCK_ID_DATA_SHORT, recordOffset + SIZE_OF_XLOG_RECORD);
  wal.writeUInt8(SIZE_OF_CHECKPOINT, recordOffset + SIZE_OF_XLOG_RECORD + 1);
  control.copy(
    wal,
    recordOffset + SIZE_OF_XLOG_RECORD + 2,
    OFF.checkPointCopy,
    OFF.checkPointCopy + SIZE_OF_CHECKPOINT,
  );
  const record = wal.subarray(recordOffset, recordOffset + recordTotalLength);
  const recordCrc = crc32c([record.subarray(SIZE_OF_XLOG_RECORD), record.subarray(0, 20)]);
  wal.writeUInt32LE(recordCrc, recordOffset + 20);

  await writeFileSynced(join(walDir, xlogFileName(tli, newSegNo, walSegSize)), wal);
  await writeFileSynced(controlPath, control);
}

function pgliteEntryUrl(): string {
  const req = createRequire(join(process.cwd(), "package.json"));
  return pathToFileURL(req.resolve("@electric-sql/pglite")).href;
}

function probeScript(entryUrl: string): string {
  return `import { PGlite } from ${JSON.stringify(entryUrl)};
try {
  const dir = process.env.TILLWISE_LEDGER;
  const pg = new PGlite(dir);
  await pg.waitReady;
  let trips = 0;
  try {
    const r = await pg.query("select count(*)::int as n from trips");
    trips = Number(r.rows?.[0]?.n ?? 0);
  } catch {}
  await pg.close();
  process.stdout.write(JSON.stringify({ ok: true, trips }));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  process.stdout.write(JSON.stringify({ ok: false, error: msg.slice(0, 180) }));
  process.exit(1);
}
`;
}

function tidyProbeError(text: string): string {
  if (/Aborted/i.test(text)) return "Postgres aborted on open (torn write-ahead log).";
  const panic = text.match(/PANIC:\s*[^\n]+/);
  if (panic) return panic[0].slice(0, 180);
  if (/ERR_MODULE_NOT_FOUND/i.test(text)) return "Probe could not load PGLite from this image.";
  if (/import\{/.test(text) || /chunk-/.test(text)) {
    return "Could not start Postgres on this folder.";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function probeLedger(dir: string): { ok: boolean; trips: number | null; error: string | null } {
  const file = join(process.cwd(), ".tillwise-probe.mjs");
  writeFileSync(file, probeScript(pgliteEntryUrl()), "utf8");
  try {
    const result = spawnSync(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, TILLWISE_LEDGER: dir },
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 2_000_000,
    });
    const out = (result.stdout || "").trim();
    const err = (result.stderr || "").trim();
    if (out) {
      try {
        const parsed = JSON.parse(out) as { ok?: boolean; trips?: number; error?: string };
        if (parsed.ok) return { ok: true, trips: Number(parsed.trips ?? 0), error: null };
        return { ok: false, trips: null, error: tidyProbeError(parsed.error || err || "open failed") };
      } catch {
        return { ok: false, trips: null, error: tidyProbeError(out) };
      }
    }
    return { ok: false, trips: null, error: tidyProbeError(err || `probe exited ${result.status}`) };
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

export async function repairLedger(): Promise<LedgerRepairResult> {
  const before = await inspectLedger();
  const fail = (
    steps: string[],
    extra?: Partial<LedgerRepairResult>,
  ): LedgerRepairResult => ({
    inspect: before,
    backupPath: extra?.backupPath ?? null,
    steps,
    ok: false,
    trips: extra?.trips ?? null,
    repaired: false,
    restartNeeded: false,
    restarting: false,
    ...extra,
  });

  if (!before.exists || !before.pgVersion) {
    return fail(["Stopped: no PG_VERSION. Will not create or overwrite a ledger."]);
  }

  const steps: string[] = [];
  const first = probeLedger(before.path);
  if (first.ok) {
    steps.push(
      `Ledger already opens. ${first.trips ?? 0} trip(s) readable. postmaster.pid is normal while the app is running.`,
    );
    const inspect = await inspectLedger();
    inspect.notes = steps;
    return {
      inspect,
      backupPath: null,
      steps,
      ok: true,
      trips: first.trips,
      repaired: false,
      restartNeeded: false,
      restarting: false,
    };
  }
  steps.push(`Open failed (${first.error ?? "Aborted"}). Repairing files, not deleting them.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${before.path}.bak-${stamp}`;
  await cp(before.path, backupPath, { recursive: true });
  steps.push(`Copied ledger to ${basename(backupPath)}.`);

  await unlinkIfExists(join(before.path, "postmaster.pid"));
  await unlinkIfExists(`${before.path}.lock`);
  steps.push("Cleared pid and lock.");

  if (before.hasControl && (before.pgVersion === "17" || before.pgVersion === "18")) {
    await resetWal(before.path);
    steps.push(`Reset torn write-ahead log (Postgres ${before.pgVersion}). Data files stayed in place.`);
  } else {
    steps.push(
      before.pgVersion && before.pgVersion !== "17" && before.pgVersion !== "18"
        ? `Skipped WAL reset (PG_VERSION is ${before.pgVersion}, need 17 or 18).`
        : "Skipped WAL reset (no pg_control).",
    );
  }

  const second = probeLedger(before.path);
  const inspect = await inspectLedger();
  if (!second.ok) {
    inspect.notes = [
      ...steps,
      `Still will not open (${second.error ?? "Aborted"}). The copy is ${basename(backupPath)}.`,
    ];
    return fail(inspect.notes, { inspect, backupPath: basename(backupPath) });
  }

  steps.push(`Opened after repair. ${second.trips ?? 0} trip(s) readable.`);
  inspect.notes = [
    ...steps,
    "The app will restart onto these files. The live folder was not deleted.",
  ];
  return {
    inspect,
    backupPath: basename(backupPath),
    steps,
    ok: true,
    trips: second.trips,
    repaired: true,
    restartNeeded: true,
    restarting: false,
  };
}
