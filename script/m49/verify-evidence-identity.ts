// script/m49/verify-evidence-identity.ts — M49.G8: evidence-identity integrity.
//
// Why this exists (found 2026-09-12, M49 W8).
//
// `validation/m14/results/<issueId>.json` is keyed by the `issueId` its producer
// passes to `emitEvidence`. Nothing enforced that two producers do not claim the
// same id, and two did — three times over:
//
//   M14.0.F7  verify-analyzer-hygiene.ts   +  verify-pipeline-e2e.ts
//   M14.0.F8  verify-corpus-census.ts      +  verify-web-cluster-e2e.ts
//   M14.0.F9  verify-probe-battery.ts      +  verify-systems-cluster-e2e.ts
//
// The consequence was not a merge conflict, it was EVIDENCE LOSS with a green
// light. The three cluster/pipeline gates were in the battery; the three
// strengthened gates were not. So every full run overwrote the hygiene, census
// and probe-battery evidence with unrelated content — and `verify-honesty.ts`
// then deep-checked whatever file happened to be there and reported all three
// green. The honesty gate believed it was verifying three strengthened gates and
// was verifying none of them; the M14 systems sign-off cites "M14.0.F9
// systems-cluster e2e", an artifact that no longer existed on disk.
//
// This gate closes the identity hole using only facts checkable without trusting
// any artifact:
//
//   1. UNIQUE PRODUCER — no two scripts may claim one `issueId`.
//   2. NO ORPHANS — every `M14*.json` in the results dir must be claimed by some
//      producer, so an artifact can never appear that no gate explains.
//   3. EVERY PRODUCER'S ARTIFACT EXISTS — a gate that names an identity and never
//      writes it is a gate with no evidence. (The harness's own self-test id is
//      exempt: it is written only under `selftest`.)
//   4. REQUIRED IDS ARE OWNED BY WIRED GATES — every id in `verify-honesty.ts`'s
//      REQUIRED_EVIDENCE must be produced by a script that runs in the battery.
//      That is the invariant the ledger asserts ("three new PERMANENT gates wired
//      into the honesty REQUIRED set") and the one whose violation made the loss
//      systematic rather than accidental.
//
// Non-battery producers are DISCLOSED with their ids, so a hand-run gate's
// staleness is visible instead of silent.
//
// SCANNER DISCIPLINE (two false results were caught while authoring this):
//   * A producer is a file that CALLS the harness — the literal must be inside
//     an `emitEvidence(` argument. Documentation that quotes the literal, and
//     test data that contains it, must not register as producers. The first
//     version read raw source and immediately reported verify-honesty.ts (whose
//     explanatory comment quotes `issueId: "M14.0.F7"`) as a producer of F7.
//   * A position-mask variant was worse, not better: the hand-rolled state
//     machine desynced on regex literals containing quotes and silently dropped
//     two REAL producers (F7 hygiene, CC1). Comment stripping is done line-wise
//     with block tracking instead, and the anchor does the rest. This is the same
//     lesson M12 recorded: a scanner you cannot trust is worse than none.
//
// Run: bun script/m49/verify-evidence-identity.ts [--scripts <dir>] [--results <dir>]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? resolve(process.argv[i + 1]) : undefined
}
const SCRIPTS_DIR = argValue("--scripts") ?? join(ROOT, "script")
const RESULTS_DIR = argValue("--results") ?? join(ROOT, "validation", "m14", "results")
const REGISTER = argValue("--register") ?? join(ROOT, "validation", "m49", "evidence-producer-register.json")

/** The harness call anchor. Built by concatenation so this file's own self-test
 *  data cannot register as a producer of the ids it quotes. */
const ANCHOR = "emit" + "Evidence("

let checks = 0, passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

// ── pure helpers (self-tested below) ─────────────────────────────────────────
export interface Producer { file: string; id: string }

export function collisions(producers: Producer[]): { id: string; files: string[] }[] {
  const byId = new Map<string, string[]>()
  for (const p of producers) {
    const list = byId.get(p.id) ?? []
    if (!list.includes(p.file)) list.push(p.file)
    byId.set(p.id, list)
  }
  return [...byId.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([id, files]) => ({ id, files: files.slice().sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function orphanArtifacts(artifactIds: string[], producers: Producer[]): string[] {
  const owned = new Set(producers.map((p) => p.id))
  return artifactIds.filter((id) => !owned.has(id)).sort()
}

export function missingArtifacts(producers: Producer[], artifactIds: string[], exempt: (id: string) => boolean): string[] {
  const present = new Set(artifactIds)
  return [...new Set(producers.map((p) => p.id))].filter((id) => !present.has(id) && !exempt(id)).sort()
}

export interface RegisterRow { id: string; producer?: string; reason?: string; ledgerId?: string }

/** Cross-check the unwired-required set against its register (all three fail). */
export function registerIssues(unwiredRequired: string[], registered: RegisterRow[]) {
  const byId = new Map(registered.map((r) => [r.id, r]))
  return {
    unregistered: unwiredRequired.filter((id) => !byId.has(id)).sort(),
    ghosts: registered.filter((r) => !unwiredRequired.includes(r.id)).map((r) => r.id).sort(),
    incomplete: registered.filter((r) => !r.reason || !r.ledgerId || !r.producer).map((r) => r.id).sort(),
  }
}

/**
 * Remove comments line-wise (with block tracking) so prose about an identity is
 * not read as code. Deliberately simple: a full string/regex-aware tokenizer was
 * tried and silently dropped real producers, which is the failure mode this gate
 * exists to prevent.
 */
export function stripCommentLines(source: string): string {
  let inBlock = false
  const out: string[] = []
  for (const raw of source.split("\n")) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf("*/")
      if (end === -1) { out.push(""); continue }
      inBlock = false
      line = line.slice(end + 2)
    }
    for (;;) {
      const start = line.indexOf("/*")
      if (start === -1) break
      const end = line.indexOf("*/", start + 2)
      if (end === -1) { line = line.slice(0, start); inBlock = true; break }
      line = line.slice(0, start) + line.slice(end + 2)
    }
    const trimmed = line.trimStart()
    if (trimmed.startsWith("//")) { out.push(""); continue }
    const inline = line.indexOf("//")
    out.push(inline === -1 ? line : line.slice(0, inline))
  }
  return out.join("\n")
}

/**
 * A producer is a file that hands an identity to the harness. Both conditions
 * matter: the file must call the harness, and the literal must sit within that
 * call's argument window.
 */
export function producersInSource(file: string, source: string): Producer[] {
  if (!source.includes(ANCHOR)) return []
  const text = stripCommentLines(source)
  const out: Producer[] = []
  for (const anchor of text.matchAll(new RegExp(ANCHOR.replace("(", "\\("), "g"))) {
    if (anchor.index === undefined) continue
    const window = text.slice(anchor.index, anchor.index + 2000)
    const id = window.match(/issueId:\s*"(M14[^"]*)"/)
    if (id) out.push({ file, id: id[1] })
  }
  return out
}

// ── discovery ────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "tmp" || name === "node_modules" || name === ".git") continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (extname(name) === ".ts") out.push(p)
  }
  return out
}

function producersIn(dir: string): Producer[] {
  return walk(dir).flatMap((file) => producersInSource(relative(ROOT, file), readFileSync(file, "utf8")))
}

/** The battery = `verify` plus every `bun|npm run <alias>` it names, expanded. */
function batteryText(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
  const verify = pkg.scripts.verify ?? ""
  const parts = [verify]
  for (const m of verify.matchAll(/(?:bun|npm) run ([A-Za-z0-9:_.-]+)/g)) {
    if (pkg.scripts[m[1]]) parts.push(pkg.scripts[m[1]])
  }
  return parts.join(" && ")
}

function requiredIdsFromHonestyGate(): string[] {
  const p = join(ROOT, "script", "m14", "verify-honesty.ts")
  if (!existsSync(p)) return []
  const m = readFileSync(p, "utf8").match(/const REQUIRED_EVIDENCE\s*=\s*\[([^\]]*)\]/)
  if (!m) return []
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

function main(): void {
  const producers = producersIn(SCRIPTS_DIR)
  check("producer scripts were found", producers.length > 0, `${producers.length} harness call(s) in ${SCRIPTS_DIR}`)

  const artifactIds = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR).filter((f) => /^M14.*\.json$/.test(f)).map((f) => basename(f, ".json")).sort()
    : []
  check("evidence artifacts were found", artifactIds.length > 0, `${artifactIds.length} in ${RESULTS_DIR}`)

  // 1. Unique producer per identity.
  const clash = collisions(producers)
  check("every evidence identity has exactly one producer", clash.length === 0,
    clash.length ? clash.map((c) => `${c.id} <- ${c.files.join(" + ")}`).join(" | ") : "")

  // 2. No orphan artifacts.
  const orphans = orphanArtifacts(artifactIds, producers)
  check("every evidence artifact is claimed by a producer (no orphans)", orphans.length === 0,
    orphans.length ? `${orphans.length}: ${orphans.slice(0, 6).join(", ")}` : "")

  // 3. Every producer's artifact exists (the harness's own self-test id is
  //    written only under `selftest`, never by the battery).
  const missing = missingArtifacts(producers, artifactIds, (id) => id.startsWith("M14.9."))
  check("every producer's evidence artifact exists", missing.length === 0,
    missing.length ? `${missing.length} never written: ${missing.slice(0, 6).join(", ")}` : "")

  // 4. Required ids must be owned by a producer that runs in the battery — or be
  //    explicitly registered as knowingly outside it, with a reason and a ledger
  //    id. The register exists so the invariant stays fatal without one
  //    unfinished investigation blocking every release, and so the admission is
  //    visible and countable instead of silent.
  const battery = batteryText()
  const required = requiredIdsFromHonestyGate()
  check("the honesty gate's required-evidence list was read", required.length > 0, `${required.length} ids`)
  const unwiredRequired = required.filter((id) => {
    const owners = producers.filter((p) => p.id === id)
    if (owners.length === 0) return true
    return !owners.some((o) => battery.includes(o.file))
  })

  const register: { unwiredRequired?: RegisterRow[] } = existsSync(REGISTER)
    ? JSON.parse(readFileSync(REGISTER, "utf8"))
    : {}
  const reg = registerIssues(unwiredRequired, register.unwiredRequired ?? [])
  check("every required id is produced in the battery, or registered as knowingly unwired",
    reg.unregistered.length === 0,
    reg.unregistered.length ? `${reg.unregistered.join(", ")} — an unwired producer's artifact is overwritten or stale` : "")
  check("the unwired-producer register has no ghost rows", reg.ghosts.length === 0,
    reg.ghosts.length ? `${reg.ghosts.join(", ")} — registered as unwired but is wired (or not required)` : "")
  check("every registered unwired producer names its script, reason and ledger id", reg.incomplete.length === 0,
    reg.incomplete.length ? reg.incomplete.join(", ") : "")

  // Self-tests.
  const callSource = ANCHOR + '{ issueId: "M14.0.PIPE", title: "t" })'
  const commented = "// this used to emit " + ANCHOR + 'issueId: "M14.0.F7" })\nconst x = 1'
  const testData = 'const s = "' + ANCHOR.replace("(", "") + '({ issueId: \\"M14.0.F7\\" })"'
  negative("a duplicated issueId is reported as a collision",
    collisions([{ file: "a.ts", id: "M14.0.F7" }, { file: "b.ts", id: "M14.0.F7" }]).length === 1,
    "a duplicate id was not reported")
  negative("distinct issueIds are not reported as a collision",
    collisions([{ file: "a.ts", id: "M14.0.F7" }, { file: "b.ts", id: "M14.0.PIPE" }]).length === 0,
    "distinct ids collided")
  negative("an artifact no producer claims is reported as an orphan",
    orphanArtifacts(["M14.0.F7", "M14.0.GHOST"], [{ file: "a.ts", id: "M14.0.F7" }]).join(",") === "M14.0.GHOST",
    "an orphan artifact was not reported")
  negative("a producer whose artifact is absent is reported as missing",
    missingArtifacts([{ file: "a.ts", id: "M14.0.F7" }], [], () => false).join(",") === "M14.0.F7",
    "a missing artifact was not reported")
  negative("the harness self-test id is exempt from the artifact requirement",
    missingArtifacts([{ file: "h.ts", id: "M14.9.SELFTEST" }], [], (id) => id.startsWith("M14.9.")).length === 0,
    "the self-test id demanded an artifact")
  negative("a real harness call IS counted as a producer",
    producersInSource("x.ts", callSource).map((p) => p.id).join() === "M14.0.PIPE",
    "a real producer was missed")
  negative("an issueId quoted in a comment is not counted as a producer",
    producersInSource("x.ts", commented).length === 0,
    "a prose literal registered as a producer")
  negative("an issueId inside a plain string is not counted as a producer",
    producersInSource("x.ts", testData).length === 0,
    "a test-data literal registered as a producer")
  negative("a file that never calls the harness is not a producer",
    producersInSource("x.ts", 'const ISSUE = { issueId: "M14.0.F7" }').length === 0,
    "a non-harness file registered as a producer")
  const completeRow: RegisterRow = { id: "M14.0.F6", producer: "p.ts", reason: "r", ledgerId: "W8" }
  negative("an unwired required producer absent from the register is reported",
    registerIssues(["M14.0.F6", "M14.0.F7"], [completeRow]).unregistered.join() === "M14.0.F7",
    JSON.stringify(registerIssues(["M14.0.F6", "M14.0.F7"], [completeRow]).unregistered))
  negative("a register row for an id that is not unwired-required is reported as a ghost",
    registerIssues([], [completeRow]).ghosts.join() === "M14.0.F6",
    JSON.stringify(registerIssues([], [completeRow]).ghosts))
  negative("a register row without a reason or ledger id is reported as incomplete",
    registerIssues(["M14.0.F6"], [{ id: "M14.0.F6", producer: "p.ts" }]).incomplete.join() === "M14.0.F6",
    "an unjustified register row was accepted")

  // Disclosure: producers outside the battery.
  const unwired = [...new Set(producers.filter((p) => !battery.includes(p.file)).map((p) => p.id))].sort()
  if (unwired.length) console.log(`disclosure: ${unwired.length} identity(ies) produced only outside the battery: ${unwired.join(", ")}`)

  console.log(`evidence identities: ${new Set(producers.map((p) => p.id)).size} producer(s) / ${artifactIds.length} artifact(s)`)
  console.log(`M49.G8: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised`)
  if (failed > 0) process.exitCode = 1
}

main()
