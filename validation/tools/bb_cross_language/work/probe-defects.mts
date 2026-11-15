// validation/tools/bb_cross_language/work/probe-defects.mts
//
// Phase A audit probe for bb_cross_language. Seeds store states the shipped
// corpus cannot reach, then reads the REAL handler (createToolHandlers) against
// a throwaway BB_DATA_DIR so every claim below is a measured answer, not a
// reading of the SQL.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/probe-defects.mts
//
// The states:
//   P1 UNPAIRABLE-ONLY   a stored is_cross_language=1 row whose endpoint file has
//                        no detected language. The row IS about the asked name;
//                        it cannot name a language pair.
//   P2 DEEPER-OUTGOING   owner -> member -> grandchild, and the grandchild is the
//                        SOURCE of a cross-language row into another language.
//   P3 DEEPER-INCOMING   same shape, grandchild is the TARGET (control).
//   P4 BUDGET            own + member facts on one name, proven at limit 1..5.
//   P5 MEMBER-ONLY       rows on the members only (silentItselfButNotItsMembers).
//   P6 COPIES            three copies of one name: copyCount, ambiguous, cap fields.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")

const dataDir = mkdtempSync(join(tmpdir(), "bbcl-audit-"))
process.env.BB_DATA_DIR = dataDir
process.env.BB_NO_AUTO_REFRESH = "1"

const projects = {
  unpairable: "clauditunpairable00000000000000000000000",
  deeperOut: "clauditdeeperout000000000000000000000000",
  deeperIn: "clauditdeeperin0000000000000000000000000",
  budget: "clauditbudget000000000000000000000000000",
  memberOnly: "clauditmemberonly00000000000000000000000",
  copies: "clauditcopies00000000000000000000000000000",
}

type Seed = {
  file: (project: string, id: string, relative: string, language: string | null) => void
  sym: (project: string, id: string, fileId: string, name: string, owner: string | null, line?: number) => void
  rel: (project: string, id: string, projectId: string, src: string, tgt: string, type?: string, bridge?: string | null, metadata?: string | null) => void
}

const out: Record<string, unknown> = {}

async function main(): Promise<void> {
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))

  const rawByProject = new Map<string, any>()
  const rawFor = async (projectId: string) => {
    const existing = rawByProject.get(projectId)
    if (existing) return existing
    mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
    const raw = await (BrainDatabase as any).getRawInstance(projectId)
    rawByProject.set(projectId, raw)
    return raw
  }

  const seed: Seed = {
    file: (project, id, relative, language) => {
      const raw = rawByProject.get(project)
      raw.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
        .run(id, project, `/seed/${relative}`, relative, language, `h-${id}`)
    },
    sym: (project, id, fileId, name, owner, line = 1) => {
      const raw = rawByProject.get(project)
      raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, project, fileId, name, "function", line, line, 0, 10, 1, owner)
    },
    rel: (project, id, projectId, src, tgt, type = "calls", bridge = "name-resolution", metadata = null) => {
      const raw = rawByProject.get(projectId)
      raw.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism, metadata) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, project, src, tgt, type, 0.9, 1, bridge, metadata)
    },
  }

  // ── P1: unpairable-only ─────────────────────────────────────────────────────
  {
    const P = projects.unpairable
    await rawFor(P)
    seed.file(P, "u-ts", "caller.ts", "typescript")
    seed.file(P, "u-nolang", "mystery.unknownlang", null)
    seed.sym(P, "u-caller", "u-ts", "uCaller", null)
    seed.sym(P, "u-target", "u-nolang", "uMystery", null)
    seed.rel(P, "u-rel", P, "u-caller", "u-target", "uses", "name-resolution")
    const raw = rawByProject.get(P)
    out.p1Store = {
      crossRows: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1").get(P) as any).n,
      rowTarget: (raw.prepare("SELECT target_symbol_id t FROM brain_relationship WHERE id = 'u-rel'").get() as any).t,
    }
  }

  // ── P2/P3: deeper descendant, outgoing vs incoming ──────────────────────────
  const deeper = async (projectId: string, prefix: string, direction: "outgoing" | "incoming") => {
    const P = projectId
    await rawFor(P)
    seed.file(P, `${prefix}-owner`, "owner.ts", "typescript")
    seed.file(P, `${prefix}-child`, "child.clj", "clojure")
    seed.file(P, `${prefix}-grand`, "grand.kt", "kotlin")
    seed.file(P, `${prefix}-other`, "other.java", "java")
    seed.sym(P, `${prefix}-owner-s`, `${prefix}-owner`, `${prefix}Owner`, null)
    seed.sym(P, `${prefix}-child-s`, `${prefix}-child`, `${prefix}Child`, `${prefix}-owner-s`)
    seed.sym(P, `${prefix}-grand-s`, `${prefix}-grand`, `${prefix}Grand`, `${prefix}-child-s`)
    seed.sym(P, `${prefix}-other-s`, `${prefix}-other`, `${prefix}Other`, null)
    if (direction === "outgoing") {
      // the DESCENDANT is the source: an edge out to another language
      seed.rel(P, `${prefix}-rel`, P, `${prefix}-grand-s`, `${prefix}-other-s`, "calls")
    } else {
      // the DESCENDANT is the target: an edge in from another language
      seed.rel(P, `${prefix}-rel`, P, `${prefix}-other-s`, `${prefix}-grand-s`, "calls")
    }
    return `${prefix}Owner`
  }
  const outName = await deeper(projects.deeperOut, "o", "outgoing")
  const inName = await deeper(projects.deeperIn, "i", "incoming")

  // ── P4: budget ──────────────────────────────────────────────────────────────
  {
    const P = projects.budget
    await rawFor(P)
    seed.file(P, "b-ts", "budget.ts", "typescript")
    seed.file(P, "b-clj", "budget.clj", "clojure")
    seed.file(P, "b-owner", "budgetOwner.kt", "kotlin")
    seed.file(P, "b-x", "x.py", "python")
    seed.sym(P, "b-owner-s", "b-owner", "bOwner", null)
    seed.sym(P, "b-copy-a", "b-ts", "budgetName", null, 1)
    seed.sym(P, "b-copy-b", "b-clj", "budgetName", null, 2)
    // two own rows on copy A (caller + callee)
    seed.sym(P, "b-ts-other", "b-ts", "bTsOther", null, 9)
    seed.sym(P, "b-clj-other", "b-clj", "bCljOther", null, 9)
    seed.rel(P, "b-own-1", P, "b-ts-other", "b-copy-a", "calls")
    seed.rel(P, "b-own-2", P, "b-copy-a", "b-clj-other", "calls")
    // three member facts under the owner (members are distinct names)
    seed.sym(P, "b-m1", "b-ts", "bMemberOne", "b-owner-s", 5)
    seed.sym(P, "b-m2", "b-ts", "bMemberTwo", "b-owner-s", 6)
    seed.sym(P, "b-m3", "b-ts", "bMemberThree", "b-owner-s", 7)
    seed.sym(P, "b-py", "b-x", "bPyOther", null, 8)
    seed.rel(P, "b-mem-1", P, "b-py", "b-m1", "calls")
    seed.rel(P, "b-mem-2", P, "b-py", "b-m2", "calls")
    seed.rel(P, "b-mem-3", P, "b-py", "b-m3", "calls")
  }

  // ── P5: member-only (the name itself is silent) ─────────────────────────────
  {
    const P = projects.memberOnly
    await rawFor(P)
    seed.file(P, "m-owner", "memberOwner.kt", "kotlin")
    seed.file(P, "m-ts", "memberOwner.ts", "typescript")
    seed.file(P, "m-y", "y.py", "python")
    seed.sym(P, "m-owner-s", "m-owner", "mOwner", null)
    seed.sym(P, "m-member", "m-owner", "mOwnerMember", "m-owner-s", 4)
    seed.sym(P, "m-py", "m-y", "mPy", null, 4)
    seed.rel(P, "m-rel", P, "m-py", "m-member", "calls")
    // a second copy of the owner NAME with no rows of its own, so copies > 1
    seed.sym(P, "m-copy2", "m-ts", "mOwner", null, 1)
  }

  // ── P6: copies ──────────────────────────────────────────────────────────────
  {
    const P = projects.copies
    await rawFor(P)
    seed.file(P, "c-1", "one.ts", "typescript")
    seed.file(P, "c-2", "two.js", "javascript")
    seed.file(P, "c-3", "three.py", "python")
    seed.file(P, "c-4", "four.java", "java")
    seed.sym(P, "c-a", "c-1", "copyName", null, 1)
    seed.sym(P, "c-b", "c-2", "copyName", null, 2)
    seed.sym(P, "c-c", "c-3", "copyName", null, 3)
    seed.sym(P, "c-other", "c-4", "otherJava", null, 1)
    seed.rel(P, "c-rel", P, "c-other", "c-b", "calls")
  }

  // ── Ask the REAL handler ────────────────────────────────────────────────────
  const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
  const ask = async (projectId: string, args: Record<string, unknown>) => {
    const result = await handlers["bb_cross_language"](args, { projectId, projectPath: "/seed" })
    const text = result?.content?.[0]?.text ?? ""
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch { /* refusal is plain text */ }
    return { isError: result?.isError === true, text: text.slice(0, 400), parsed }
  }

  out.p1Unpairable = await ask(projects.unpairable, { symbol: "uMystery" })
  out.p2DeeperOutgoing = await ask(projects.deeperOut, { symbol: outName })
  out.p3DeeperIncoming = await ask(projects.deeperIn, { symbol: inName })
  out.p4Budget = {
    limit1: await ask(projects.budget, { symbol: "bOwner", limit: 1 }),
    limit2: await ask(projects.budget, { symbol: "bOwner", limit: 2 }),
    limit5: await ask(projects.budget, { symbol: "bOwner", limit: 5 }),
    default: await ask(projects.budget, { symbol: "bOwner" }),
  }
  out.p5MemberOnly = await ask(projects.memberOnly, { symbol: "mOwner" })
  out.p6Copies = {
    limit1: await ask(projects.copies, { symbol: "copyName", limit: 1 }),
    limit200: await ask(projects.copies, { symbol: "copyName", limit: 200 }),
  }
  // ── refusals / empty input ──────────────────────────────────────────────────
  out.refusals = {
    missing: await ask(projects.budget, {}),
    blank: await ask(projects.budget, { symbol: "   " }),
    emptyString: await ask(projects.budget, { symbol: "" }),
    unknown: await ask(projects.budget, { symbol: "no-such-name-xyz" }),
    limitZero: await ask(projects.budget, { symbol: "bOwner", limit: 0 }),
    limitTooBig: await ask(projects.budget, { symbol: "bOwner", limit: 1001 }),
    limitFractional: await ask(projects.budget, { symbol: "bOwner", limit: 2.5 }),
    limitString: await ask(projects.budget, { symbol: "bOwner", limit: "5" }),
    symbolNumber: await ask(projects.budget, { symbol: 5 }),
    extraOption: await ask(projects.budget, { symbol: "bOwner", bogus: 1 }),
    aliasTarget: await ask(projects.budget, { target: "bOwner" }),
  }
  // The direct-handler door does NOT run tool-validation; the MCP door does.
  out.doorNote = "handler calls above bypass validateToolArguments; alias/type refusals are re-checked through the real MCP stdio door separately"

  // Preserve the seeded data dir for reproducibility of the evidence.
  const keep = join(HERE, "..", "fixtures", "seeddata")
  rmSync(keep, { recursive: true, force: true })
  try {
    // keep the SQLite files only, not the WAL/SHM
    const { cpSync } = await import("node:fs")
    cpSync(dataDir, keep, { recursive: true })
    for (const project of Object.values(projects)) {
      const dbPath = join(keep, "projects", project, "brain.db")
      cpSync(dbPath, dbPath)
    }
  } catch (error) {
    out.keepError = String(error)
  }
  const evidence = { schemaVersion: 1, tool: "bb_cross_language", generatedAt: new Date().toISOString(), currentCommit: "c43282e92", projectIds: projects, answers: out, dataDirKeptAt: "fixtures/seeddata" }
  writeFileSync(join(HERE, "..", "results", "AUDIT-seeded-states.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
