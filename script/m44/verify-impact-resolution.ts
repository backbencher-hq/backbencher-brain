// script/m44/verify-impact-resolution.ts — M44.U5 (issue #692) gate.
//
// Proves member/keyword impact targets resolve through their OWNING
// declaration (declared, first-class), that genuinely absent symbols keep
// the declared error, and that the suite CAN FAIL:
//
//   R0 fixture truth:  the REAL indexer, run over the U5 fixture source,
//                      writes the constructor symbol with an owner + a
//                      contains row and NO inbound call edges — the seed
//                      can never drift from what analyzers actually write
//   R1 component:      computeImpact("constructor") over the seeded index
//                      roots at Greeter with resolution "owning-declaration";
//                      impact set = the class's reverse dependencies
//   R2 declared error: a genuinely unknown symbol still throws the
//                      declared error (never an empty set / silent re-root)
//   R3 narrowness:     a member WITH its own reverse edges does NOT
//                      re-root (its own impact set is real; re-rooting
//                      would drop dependencies) — declared error stands
//   R4 renderer:       the ONE core renders the resolution note (visible,
//                      machine-readable attrs); a direct resolution
//                      renders NO note (declared absence)
//   R5 real server:    bb/impact over the REAL dist server resolves
//                      "constructor" (the owner-session defect, end to end)
//   R6 mutants:        dropping the fallback, breaking rule 3, and
//                      silent-relabel mutants are each caught
//
// Run: npx tsx script/m44/verify-impact-resolution.ts
// Evidence: validation/m44/results/U5.json (machine-emitted)

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m44/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "U5.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const BB = path.join(ROOT, "bin/bb")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const IMPACT = path.join(ROOT, "src/lsp/impact.ts")
// M55.T1: the member-resolution rules now live in the ONE identity resolver;
// affected mutant anchors may sit in either file (see withComponent).
const IDENTITY = path.join(ROOT, "src/lsp/identity.ts")

let checks = 0
let passed = 0
const failures: string[] = []
const mutants = { caught: 0, total: 0 }

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutants.total++
  if (caught) mutants.caught++
  check(`M${mutants.total}: ${label} (planted defect caught)`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- DOM stub (same shape the W1/V1 suites use) ---------------------------------
class El {
  tagName: string
  className = ""
  children: El[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  constructor(tag: string) {
    this.tagName = tag
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
  }
  appendChild(child: El): El {
    this.children.push(child)
    return child
  }
  addClass(name: string): void {
    this.className = this.className ? `${this.className} ${name}` : name
  }
  /** Depth-first search by class name (the V1/U3 stub convention). */
  find(className: string): El | null {
    if (this.className.split(" ").includes(className)) return this
    for (const child of this.children) {
      const hit = child.find(className)
      if (hit !== null) return hit
    }
    return null
  }
}
function makeDom(): { create: (t: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (t: string) => new El(t), root: () => el, el }
}

// --- R0: the REAL indexer writes the seed the gate asserts against ---------------
const U5_WS = path.join(ROOT, ".tools/m44-u5-fixture")
async function indexFixture(): Promise<{ dataDir: string; projectId: string }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "m44u5-data-"))
  process.env.BB_DATA_DIR = dataDir
  const canonical = path.resolve(U5_WS)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  execFileSync(BB, ["index", U5_WS, "--no-setup"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, BB_DATA_DIR: dataDir },
  })
  return { dataDir, projectId }
}

// --- Seeded fallback fixture (component-level legs; shape = R0's real rows) ------
async function makeSeedFixture(): Promise<{ raw: any; projectId: string; dataDir: string; cleanup: () => void }> {
  const ws = mkdtempSync(path.join(tmpdir(), "m44u5-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m44u5-data2-"))
  const canonical = path.resolve(ws)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run(
    "file-1", projectId, path.join(ws, "main.ts"), "main.ts", "typescript", "u5-hash",
  )
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run(
    "file-2", projectId, path.join(ws, "registry.ts"), "registry.ts", "typescript", "u5-hash2",
  )
  const sym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  sym.run("sym-greeter", projectId, "file-1", "Greeter", "class", 1, 6, 1, 30, null, 10)
  sym.run("sym-greet", projectId, "file-1", "greet", "method", 2, 4, 8, 20, "sym-greeter", 7)
  sym.run("sym-ctor", projectId, "file-1", "constructor", "constructor", 5, 5, 26, 40, "sym-greeter", 6)
  sym.run("sym-main", projectId, "file-1", "main", "function", 8, 11, 50, 90, null, 5)
  sym.run("sym-helper", projectId, "file-1", "helper", "method", 12, 14, 95, 120, "sym-greeter", 4)
  // The SECOND class + constructor (X1 closure): real repos have several
  // same-name member rows — the seed mirrors the owner's demo repo shape.
  sym.run("sym-registry", projectId, "file-2", "Registry", "class", 1, 6, 1, 30, null, 9)
  // Gravity 20 > greeter's 6: the M48.C1 engine resolves an exact member name
  // DIRECTLY (gravity-ordered, any type) — without the file hint it roots the
  // WRONG constructor here. This fixture makes that masking deterministic:
  // the hinted request must beat gravity, or the gate fails.
  sym.run("sym-registry-ctor", projectId, "file-2", "constructor", "constructor", 5, 5, 26, 40, "sym-registry", 20)
  sym.run("sym-register", projectId, "file-2", "register", "function", 8, 11, 50, 90, null, 5)
  // Rule-3 negative at full strength: a NON-traversable member (outside the
  // engine whitelist, like the constructor) that HAS its own reverse edge —
  // the direct path cannot resolve it, so only rule 3 stands between it and
  // a dependency-dropping re-root through the owner.
  sym.run("sym-factory", projectId, "file-1", "factory", "factory", 15, 17, 125, 160, "sym-greeter", 3)
  const rel = raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`,
  )
  // The indexer's universal containment row: Greeter contains its members.
  rel.run("u5-contains-ctor", projectId, "sym-greeter", "sym-ctor", "contains", 1.0)
  rel.run("u5-contains-greet", projectId, "sym-greeter", "sym-greet", "contains", 1.0)
  rel.run("u5-contains-helper", projectId, "sym-greeter", "sym-helper", "contains", 1.0)
  rel.run("u5-contains-reg-ctor", projectId, "sym-registry", "sym-registry-ctor", "contains", 1.0)
  // The class's reverse dependency (the impact set the owner roots at).
  rel.run("u5-inst", projectId, "sym-main", "sym-greeter", "instantiates", 0.9)
  rel.run("u5-inst-reg", projectId, "sym-register", "sym-registry", "instantiates", 0.9)
  // helper HAS its own reverse edge (rule 3 negative case): a caller calls
  // helper directly — helper must NOT re-root through Greeter.
  rel.run("u5-calls-helper", projectId, "sym-main", "sym-helper", "calls", 0.8)
  // factory (non-traversable) ALSO has its own reverse edge — the strong
  // rule-3 negative: re-rooting it would DROP its real dependency.
  rel.run("u5-calls-factory", projectId, "sym-main", "sym-factory", "calls", 0.8)
  return {
    raw,
    projectId,
    dataDir,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

// --- Main ------------------------------------------------------------------------
async function main(): Promise<void> {
  const core = await import(CORE)
  const impact = await import(IMPACT)

  // --- R0: fixture truth from the REAL indexer -----------------------------------
  console.log("\nR0: the real indexer writes the constructor seed")
  const fx = await indexFixture()
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const raw = await BrainDatabase.getRawInstance(fx.projectId)
  const ctorRows = raw
    .prepare(`SELECT s.id, s.name, s.symbol_type, s.owner_symbol_id, COALESCE(f.relative_path, f.path, '') AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = 'constructor'`)
    .all(fx.projectId) as Array<{ id: string; name: string; symbol_type: string; owner_symbol_id: string | null; file: string }>
  check("R0: the real index stores a 'constructor' PER CLASS (2 classes -> 2 rows)", ctorRows.length === 2, JSON.stringify(ctorRows))
  const ctor = ctorRows.find((r) => r.file.endsWith("main.ts"))
  check("R0: both constructors are type 'constructor' (outside the engine whitelist)", ctorRows.every((r) => r.symbol_type === "constructor"), ctorRows.map((r) => r.symbol_type).join(","))
  check("R0: every constructor has an owner (its containing class)", ctorRows.every((r) => !!r.owner_symbol_id), String(ctorRows.filter((r) => !r.owner_symbol_id).length))
  const ownerRows = ctor?.owner_symbol_id
    ? (raw.prepare(`SELECT name, symbol_type FROM brain_symbol WHERE id = ?`).all(ctor.owner_symbol_id) as Array<{ name: string; symbol_type: string }>)
    : []
  check("R0: the owner is the Greeter class", ownerRows[0]?.name === "Greeter" && ownerRows[0]?.symbol_type === "class", JSON.stringify(ownerRows))
  const ctorInbound = raw
    .prepare(`SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND target_symbol_id = ? AND relationship_type IN ('calls','instantiates','extends','implements')`)
    .get(fx.projectId, ctor?.id) as { c: number }
  check("R0: the constructor has NO stored reverse call edges (rule 3 holds)", ctorInbound.c === 0, String(ctorInbound.c))
  // M63.T1: this check counted `contains` rows aimed at ONE constructor id and
  // expected 2, which no correct index can satisfy — the fixture has two
  // classes, so the indexer writes two DISTINCT constructor symbols, each with
  // its own containment row. Measured on a live run: one row per constructor,
  // two rows overall. The property that matters is the one the X1 closure
  // turned on: each class's constructor has ITS OWN containment row, and the
  // two are different targets.
  const containsRows = raw
    .prepare(
      `SELECT r.target_symbol_id, r.source_symbol_id, s.name AS sourceName
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       WHERE r.project_id = ? AND r.relationship_type = 'contains'
         AND r.target_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'constructor')`,
    )
    .all(fx.projectId, fx.projectId) as Array<{ target_symbol_id: string; source_symbol_id: string; sourceName: string }>
  check(
    "R0: each class's constructor has its OWN containment row (2 rows, 2 targets, both classes)",
    containsRows.length === 2 && new Set(containsRows.map((r) => r.target_symbol_id)).size === 2 && new Set(containsRows.map((r) => r.sourceName)).size === 2,
    JSON.stringify(containsRows),
  )
  const instRow = raw
    .prepare(`SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'instantiates' AND target_symbol_id IN (SELECT id FROM brain_symbol WHERE name IN ('Greeter','Registry'))`)
    .get(fx.projectId) as { c: number }
  check("R0: the real analyzer wrote the instantiates edges (main→Greeter, register→Registry)", instRow.c === 2, String(instRow.c))

  // --- R1: component-level resolution over the seeded fixture --------------------
  console.log("\nR1: computeImpact resolves the member through its owner")
  const sfx = await makeSeedFixture()
  try {
    // X1 closure: TWO constructors share the name now. Without the file
    // hint the ambiguity is a declared error; with the hint each file's
    // member roots at ITS class.
    let ambiguousErr = ""
    try {
      await impact.computeImpact(sfx.raw, sfx.projectId, "constructor")
    } catch (e) {
      ambiguousErr = e instanceof Error ? e.message : String(e)
    }
    check("R1: an ambiguous member name without a file hint keeps the declared error", ambiguousErr.startsWith("bb/impact:") && ambiguousErr.includes("not found"), ambiguousErr.slice(0, 140))

    const result = await impact.computeImpact(sfx.raw, sfx.projectId, "constructor", {}, "main.ts")
    check("R1: file-hinted member roots at the owning class (Greeter)", result.root?.name === "Greeter", JSON.stringify(result.root ?? null))
    check("R1: resolution is declared as owning-declaration", result.resolution?.through === "owning-declaration" && result.resolution?.memberName === "constructor" && result.resolution?.ownerName === "Greeter", JSON.stringify(result.resolution ?? null))
    check("R1: the impact set is the class's reverse dependencies (main)", result.impact.length === 1 && result.impact[0]?.name === "main", JSON.stringify(result.impact))
    check("R1: shownCount/totalCount honest (untruncated)", result.shownCount === 1 && result.totalCountIfKnown === 1 && result.truncated === false, JSON.stringify({ shown: result.shownCount, total: result.totalCountIfKnown }))

    const regResult = await impact.computeImpact(sfx.raw, sfx.projectId, "constructor", {}, "registry.ts")
    check("R1: the SAME name in the other file roots at ITS class (Registry)", regResult.root?.name === "Registry" && regResult.resolution?.ownerName === "Registry", JSON.stringify(regResult.resolution ?? null))
    check("R1: Registry's impact set is its own reverse dependency (register)", regResult.impact.length === 1 && regResult.impact[0]?.name === "register", JSON.stringify(regResult.impact))
    // A hint that matches no stored row is stale-index noise: a single-row
    // name would still resolve (index truth); here the name is ambiguous, so
    // a wrong hint must keep the declared error (never a guess).
    let staleHintErr = ""
    try {
      await impact.computeImpact(sfx.raw, sfx.projectId, "constructor", {}, "no-such-file.ts")
    } catch (e) {
      staleHintErr = e instanceof Error ? e.message : String(e)
    }
    check("R1: a hint matching no row keeps the declared error (never a guess)", staleHintErr.startsWith("bb/impact:") && staleHintErr.includes("not found"), staleHintErr.slice(0, 140))

    // Direct path unchanged: a traversable name still resolves directly.
    const direct = await impact.computeImpact(sfx.raw, sfx.projectId, "Greeter")
    check("R1: direct traversal path unchanged (Greeter roots at itself)", direct.root?.name === "Greeter" && (direct.resolution?.through ?? "direct") === "direct", JSON.stringify(direct.resolution ?? null))

    // --- R2: genuinely absent symbol keeps the declared error --------------------
    console.log("\nR2: unknown symbol still errors (declared, never re-rooted)")
    let unknownErr = ""
    try {
      await impact.computeImpact(sfx.raw, sfx.projectId, "definitely_not_a_symbol_u5")
    } catch (e) {
      unknownErr = e instanceof Error ? e.message : String(e)
    }
    check("R2: unknown symbol throws the declared error", unknownErr.startsWith("bb/impact:") && unknownErr.includes("not found"), unknownErr.slice(0, 140))

    // --- R3: narrowness — a member with its OWN edges does not re-root -----------
    console.log("\nR3: a member with its own reverse edges keeps its own impact")
    let helperErr = ""
    try {
      await impact.computeImpact(sfx.raw, sfx.projectId, "helper")
    } catch (e) {
      helperErr = e instanceof Error ? e.message : String(e)
    }
    // helper is a method (traversable) so the DIRECT path should resolve it;
    // its own impact set = main (the calls edge). Either way, it must NOT
    // root at Greeter with an owning-declaration note.
    let helperRootedAtOwner = false
    try {
      const r = await impact.computeImpact(sfx.raw, sfx.projectId, "helper")
      helperRootedAtOwner = r.root?.name === "Greeter" && r.resolution?.through === "owning-declaration"
    } catch {
      helperRootedAtOwner = false
    }
    check("R3: helper does not silently re-root through the owner", helperRootedAtOwner === false, helperErr.slice(0, 100) || "no error")

    // --- R4: the ONE core renders the resolution note -----------------------------
    console.log("\nR4: the renderer states the resolution (never a silent relabel)")
    const dom = makeDom()
    core.renderImpact(result, dom as never)
    const note = dom.el.find("bb-impact-resolution-note") as El | null
    check("R4: the resolution note renders", note !== null)
    check("R4: the note names the member and the owner", note !== null && note!.textContent.includes("constructor") && note!.textContent.includes("Greeter"), note?.textContent ?? "")
    check("R4: machine-readable attrs ride the layer", dom.el.attrs["data-resolution-through"] === "owning-declaration" && dom.el.attrs["data-resolution-member"] === "constructor" && dom.el.attrs["data-resolution-owner"] === "Greeter", JSON.stringify(dom.el.attrs))
    const domDirect = makeDom()
    core.renderImpact(direct, domDirect as never)
    check("R4: a direct resolution renders NO note (declared absence)", domDirect.el.find("bb-impact-resolution-note") === null && domDirect.el.attrs["data-resolution-through"] === undefined, JSON.stringify(domDirect.el.attrs))

    // --- R6: mutants (component + core) -------------------------------------------
    console.log("\nR6: the resolution laws CAN FAIL (mutants planted)")
    const componentSource = readFileSync(IMPACT, "utf8")
    const identitySource = readFileSync(IDENTITY, "utf8")
    const coreSource = readFileSync(CORE, "utf8")
    const importComponent = (src: string): string =>
      src
        .replace(/from "\.\.\/intelligence\/graph\/graph-engine"/g, `from "file://${path.join(ROOT, "src", "intelligence", "graph", "graph-engine.ts").replace(/\\/g, "/")}"`)
        .replace(/from "\.\.\/intelligence\/contracts"/g, `from "file://${path.join(ROOT, "src", "intelligence", "contracts.ts").replace(/\\/g, "/")}"`)
    // M55.T1: an anchor may live in the impact door OR in the identity
    // resolver it now reads. Both copies are written into one temp dir (the
    // mutated one where the anchor is, the other verbatim) so `import
    // "./identity"` inside the impact copy resolves to that sibling — the
    // mutant is still exercised through the door's own computeImpact.
    const withComponent = async (name: string, from: string, to: string, probe: (m: any) => Promise<boolean> | boolean): Promise<void> => {
      const anchorInImpact = componentSource.includes(from)
      const anchorInIdentity = identitySource.includes(from)
      if (!anchorInImpact && !anchorInIdentity) {
        check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 80))
        return
      }
      const dir = mkdtempSync(path.join(tmpdir(), "m44-u5-mut-"))
      const mutantIdentity = path.join(dir, "identity.ts")
      const mutantImpact = path.join(dir, "impact.ts")
      writeFileSync(mutantIdentity, anchorInIdentity ? identitySource.replace(from, to) : identitySource)
      writeFileSync(mutantImpact, importComponent(anchorInImpact ? componentSource.replace(from, to) : componentSource))
      try {
        const m = await import(mutantImpact)
        mutant(name, await probe(m))
      } catch (e) {
        mutant(name, true, `mutant failed to load: ${String(e).slice(0, 80)}`)
      } finally {
        try { rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    }
    const withCore = async (name: string, from: string, to: string, probe: (m: any) => Promise<boolean> | boolean): Promise<void> => {
      if (!coreSource.includes(from)) {
        check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 80))
        return
      }
      const mutantPath = path.join(ROOT, "validation/m44", `core.u5mutant.${Date.now()}.${Math.floor(Math.random() * 1e6)}.ts`)
      writeFileSync(mutantPath, coreSource.replace(from, to))
      try {
        const m = await import(mutantPath)
        mutant(name, await probe(m))
      } catch (e) {
        mutant(name, true, `mutant failed to load: ${String(e).slice(0, 80)}`)
      } finally {
        try { rmSync(mutantPath, { force: true }) } catch {}
      }
    }

    // M1 (M53 update): the post-traverse re-root gate is dropped — the
    // M48.C1 gravity pick rides silently. The engine resolves the member
    // name directly (registry's higher-gravity ctor), the U5 fallback never
    // runs, and the hint-less ambiguous name RESOLVES instead of keeping
    // the declared error. Caught because the probe demands the declared
    // error for the hint-less ambiguous name.
    await withComponent(
      "post-traverse re-root gate dropped (gravity pick rides silently)",
      "if (rootType && !IMPACT_TRAVERSABLE_ROOT_TYPES.includes(rootType)) {",
      "if (false) { // gate dropped: gravity pick allowed over the whitelist",
      async (m) => {
        // Defect signature: with the gate gone, the engine's M48.C1 direct
        // resolve hands back a member row (the gravity pick) and the
        // hint-less AMBIGUOUS name resolves — the declared error the law
        // demands is gone. Detection = observing that resolve.
        try {
          await m.computeImpact(sfx.raw, sfx.projectId, "constructor")
          return true // ambiguous name resolved => defect observed => caught
        } catch {
          return false // still throws => this mutant shape didn't manifest
        }
      },
    )
    // M1b (X1 closure): file disambiguation dropped — the filter is gone and
    // the resolver takes the ARBITRARY first same-name row, so a registry.ts
    // hint silently roots at Greeter. Caught because the probe demands
    // Registry when hinting registry.ts.
    await withComponent(
      "disambiguation dropped (wrong same-name member resolved)",
      "const narrowed = memberRows.filter((r) => memberFileMatches(fileHint, r.file))",
      "const narrowed = memberRows.slice(0, 1) // disambiguation dropped: arbitrary first row",
      async (m) => {
        try {
          const r = await m.computeImpact(sfx.raw, sfx.projectId, "constructor", {}, "registry.ts")
          return r.root?.name === "Greeter" // resolved to the WRONG class (arbitrary first row) => defect visible
        } catch {
          return false // declared error = correct behavior => mutant caught
        }
      },
    )
    // M2: rule 3 broken — a member with its own edges silently re-roots
    // (its real dependency would be dropped from the impact set).
    await withComponent(
      "rule 3 dropped (dependency-dropping re-root)",
      "if (typeof inbound?.c === \"number\" && inbound.c > 0) return null",
      "if (false) return null // rule 3 dropped",
      async (m) => {
        try {
          const r = await m.computeImpact(sfx.raw, sfx.projectId, "factory")
          return r.root?.name === "Greeter" // re-rooted => defect visible
        } catch {
          return false
        }
      },
    )
    // M3: silent relabel — the resolution field is dropped from the result.
    // M63.T1 moved `rootMatch` into the same return object, so the anchor is
    // the whole tail of the literal: a short anchor stops matching silently
    // and the mutant is reported SKIPped, which reads like a pass.
    await withComponent(
      "silent relabel (resolution field dropped)",
      "    resolution,\n    rootMatch: {",
      "    resolution: { through: \"direct\" },\n    rootMatch: {",
      async (m) => {
        const r = await m.computeImpact(sfx.raw, sfx.projectId, "constructor", {}, "main.ts")
        return r.resolution?.through !== "owning-declaration" // relabeled => defect visible
      },
    )
    // M4: the renderer hides the note (silent relabel at the UI layer).
    await withCore(
      "note suppressed (UI hides the resolution)",
      // Anchor updated 2026-09-12 (M55.T1 refactor renamed the local `note` to
      // `impactNote` when the append-resolution-note helper was extracted).
      "  if (impactNote !== null) impactNote.addClass(\"bb-impact-resolution-note\")",
      "  // note suppressed",
      async (m) => {
        const d = makeDom()
        m.renderImpact({ ...result }, d as never)
        return d.el.find("bb-impact-resolution-note") === null // note gone => defect visible
      },
    )
  } finally {
    sfx.cleanup()
    try { rmSync(fx.dataDir, { recursive: true, force: true }) } catch {}
  }

  // --- R5: the REAL dist server resolves the member end to end -------------------
  console.log("\nR5: real bb_lsp server over the real-indexed fixture")
  if (!existsSync(SERVER)) {
    check("R5: dist server present (blocked-with-reason: run npm run build)", false, "dist/lsp/server.js missing")
  } else {
    const dataDir = mkdtempSync(path.join(tmpdir(), "m44u5-r5-"))
    process.env.BB_DATA_DIR = dataDir
    const canonical = path.resolve(U5_WS)
    const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
    mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
    execFileSync(BB, ["index", U5_WS, "--no-setup"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, BB_DATA_DIR: dataDir },
    })
    const child = spawn(process.execPath, [SERVER, "--dir", U5_WS], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (b) => (stderr += String(b)))
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    let nextId = 1
    let buffer = Buffer.alloc(0)
    const reader = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const sep = buffer.indexOf("\r\n\r\n")
        if (sep === -1) break
        const headers = buffer.slice(0, sep).toString()
        const mm = headers.match(/Content-Length: (\d+)/)
        if (!mm) break
        const len = Number(mm[1])
        if (buffer.length < sep + 4 + len) break
        const body = JSON.parse(buffer.slice(sep + 4, sep + 4 + len).toString())
        buffer = buffer.slice(sep + 4 + len)
        if (body.id !== undefined && pending.has(body.id)) {
          const p = pending.get(body.id)!
          pending.delete(body.id)
          if (body.error) p.reject(new Error(body.error.message))
          else p.resolve(body.result)
        }
      }
    }
    child.stdout.on("data", reader)
    const send = (msg: any): void => {
      const body = JSON.stringify(msg)
      child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    const request = (method: string, params: any): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        send({ jsonrpc: "2.0", id, method, params })
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            reject(new Error(`timeout waiting for ${method}`))
          }
        }, 30_000)
      })
    try {
      const init = await request("initialize", { processId: null, rootUri: `file://${U5_WS}`, capabilities: {} })
      if (!init?.capabilities) throw new Error("no capabilities")
      send({ jsonrpc: "2.0", method: "initialized", params: {} })
      // THE owner-session defect, end to end: bb/impact("constructor", file)
      // must resolve through Greeter — and the hint-less ambiguous name must
      // keep the declared error (X1 closure: the fixture now has TWO
      // constructors, mirroring every real repo).
      const r = await request("bb/impact", { schemaVersion: 1, symbol: "constructor", file: U5_WS + "/main.ts" })
      check("R5: bb/impact resolves the hinted constructor (no declared error)", r?.root?.name === "Greeter", JSON.stringify(r?.root ?? null))
      check("R5: the wire result carries the declared resolution", r?.resolution?.through === "owning-declaration" && r?.resolution?.memberName === "constructor", JSON.stringify(r?.resolution ?? null))
      check("R5: the impact set is the class's reverse dependencies", Array.isArray(r?.impact) && r.impact.some((d: any) => d.name === "main"), JSON.stringify(r?.impact?.map((d: any) => d.name)))
      let ambigWireErr = ""
      try {
        await request("bb/impact", { schemaVersion: 1, symbol: "constructor" })
      } catch (e) {
        ambigWireErr = e instanceof Error ? e.message : String(e)
      }
      check("R5: the hint-less ambiguous name keeps the declared error over the wire", ambigWireErr.startsWith("bb/impact:") && /not in the index|not found/.test(ambigWireErr), ambigWireErr.slice(0, 140))
      // The renderer's markup over the wire result states the resolution.
      const dom = makeDom()
      core.renderImpact(r, dom as never)
      const note = dom.el.find("bb-impact-resolution-note") as El | null
      check("R5: the rendered panel states the resolution", note !== null && note!.textContent.includes("Greeter"), note?.textContent ?? "")
      // Unknown symbol over the wire: declared error unchanged.
      let wireErr = ""
      try {
        await request("bb/impact", { schemaVersion: 1, symbol: "definitely_not_a_symbol_u5" })
      } catch (e) {
        wireErr = e instanceof Error ? e.message : String(e)
      }
      check("R5: unknown symbol over the wire still errors (declared)", wireErr.startsWith("bb/impact:") && /not in the index|not found/.test(wireErr), wireErr.slice(0, 140))
    } catch (error: any) {
      check("R5: real-server session completes", false, String(error?.message ?? error).slice(0, 200) + (stderr ? ` | stderr: ${stderr.slice(-200)}` : ""))
    } finally {
      try { child.kill() } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    }
  }

  // --- Persist evidence ----------------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M44.U5",
    code: "U5",
    milestone: "M44",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    currentCommit,
    verifierCommand: "npx tsx script/m44/verify-impact-resolution.ts",
    evidenceFile: "U5.json",
    generatedAt: new Date().toISOString(),
    fixture: "script/m44/u5-fixture.ts (real indexer + real dist server)",
    laws: [
      "R0 fixture truth from the REAL indexer (seed can never drift)",
      "R1 component: member roots at the owner, resolution declared",
      "R2 unknown symbol keeps the declared error",
      "R3 a member with its own edges does not re-root",
      "R4 renderer states the resolution; direct renders no note",
      "R5 real server end to end (the owner-session defect fixed)",
      "R6 four mutants (fallback dropped, rule-3 broken, silent relabel, note hidden)",
    ],
    limitations: [
      "The fallback requires an exact single-name member match and a traversable owner; ambiguous names keep the declared error (documented narrowness, never a guess).",
      "Cross-file owners resolve the same way (owner_symbol_id is workspace-global); the fixture covers the same-file shape the owner session exercised.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nU5: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
