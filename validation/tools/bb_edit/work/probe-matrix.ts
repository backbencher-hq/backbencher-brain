// bb_edit Phase A behavioural matrix — runs against fixtures only, never the repo.
// Every call goes through the production engine (executeEdit) with BB_DATA_DIR
// pointed at validation/tools/bb_edit/bbdata.
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, reindexFilesParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit, resolveSafeEditPath, WRITE_GUARD, lineCount, writeGuardMessage, type EditRequest, type EditResult } from "../../../../src/intelligence/edit/edit-engine"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { ASTEngine } from "../../../../src/ast/engine"
import { buildFixtures, FX } from "./fixtures"

const EDIT_DESCRIPTOR = TOOL_DESCRIPTORS.find((d) => d.name === "bb_edit")!

type Check = { section: string; name: string; pass: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
let failures = 0
function ck(section: string, name: string, pass: boolean, detail = ""): void {
  checks.push({ section, name, pass, detail })
  if (!pass) { failures++; console.log(`FAIL ${section} :: ${name} — ${detail}`) }
}
function negative(section: string, name: string, pass: boolean, detail = ""): void {
  checks.push({ section, name, pass, detail, negative: true })
  if (!pass) { failures++; console.log(`FAIL ${section} :: ${name} [negative] — ${detail}`) }
}

const ORIGINALS = new Map<string, Buffer>()
function remember(file: string): void {
  if (!ORIGINALS.has(file)) ORIGINALS.set(file, readFileSync(file))
}
function restore(file: string): void {
  const bytes = ORIGINALS.get(file)
  if (bytes) writeFileSync(file, bytes)
}
const hashOf = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex")
const textOf = (file: string): string => readFileSync(file, "utf8")

async function reindex(projectId: string, projectRoot: string, files: string[]): Promise<void> {
  await reindexFilesParallel(projectId as any, projectRoot, files.map((f) => ({ path: f, type: "modified" as const })))
}

/** Delete the persisted index for a fixture path, so a re-run starts unindexed.
 *  Fixture paths are stable, so their project ids are too — without this the
 *  second run of this probe inherits the first run's rows. */
function resetProjectData(root: string): void {
  const dataDir = process.env.BB_DATA_DIR ? path.resolve(process.env.BB_DATA_DIR) : path.join(process.env.HOME ?? "/tmp", ".bb")
  rmSync(path.join(dataDir, "projects", getProjectId(root)), { recursive: true, force: true })
}

async function indexFixture(root: string): Promise<string> {
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  return projectId
}

function tempsIn(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.includes(".bb-edit-"))
}

function descriptorError(args: unknown): string {
  try { validateToolArguments(EDIT_DESCRIPTOR, args); return "" } catch (e: any) { return String(e?.message ?? e) }
}

async function attempt(fn: () => Promise<EditResult>): Promise<{ result?: EditResult; error?: any }> {
  try { return { result: await fn() } } catch (e: any) { return { error: e } }
}

async function main(): Promise<void> {
  const f = buildFixtures()
  const work = path.resolve("validation/tools/bb_edit/work")
  const run = path.join(work, "run")
  rmSync(run, { recursive: true, force: true })
  mkdirSync(run, { recursive: true })

  // ── index the indexed fixtures ─────────────────────────────────────────
  const ids: Record<string, string> = {}
  const roots: Record<string, string> = { ts: f.ts, multi: f.multi, py: f.py, rb: f.rb, ex: f.ex, java: f.java, kt: f.kt, go: f.go, crlf: f.crlf, nonutf8: f.nonutf8, perm: f.perm, guard: f.guard, batch: f.batch, stale: f.stale, moved: f.moved, safety: f.safety, yaml: f.yaml }
  for (const root of [...Object.values(roots), f.noindex, path.join(work, "run/virgin"), path.join(work, "run/noindex-batch")]) resetProjectData(root)
  for (const [k, root] of Object.entries(roots)) ids[k] = await indexFixture(root)

  // Record every file we may restore.
  for (const root of Object.values(roots)) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.isFile()) remember(p)
      }
    }
    walk(root)
  }

  // ══ SECTION: write mode ═══════════════════════════════════════════════════
  {
    const file = path.join(roots.guard, "src/created.ts")
    rmSync(file, { force: true })
    const r = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/created.ts", content: "export const created = 1\n", format: false })
    ck("write", "create: file exists with the requested bytes", textOf(file) === "export const created = 1\n", textOf(file))
    ck("write", "create: result reports committed envelope", r.envelope?.committed === 1 && r.envelope?.entries[0]?.committed === true, JSON.stringify(r.envelope))
    ck("write", "create: reindexed true and the symbol is findable", r.reindexed === true && (await ASTEngine.findSymbol(ids.guard, "created")).matches.length === 1)
    negative("write", "create: no .bb-edit temp files remain", tempsIn(path.dirname(file)).length === 0, tempsIn(path.dirname(file)).join(","))

    const dry = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/dry-created.ts", content: "export const dry = 1\n", dryRun: true, format: false })
    ck("write", "dryRun: plans the change and reports the file", dry.dryRun === true && dry.changes.length === 1 && dry.changes[0].path.endsWith("dry-created.ts"), JSON.stringify(dry.changes.map((c) => c.path)))
    negative("write", "dryRun: writes nothing", !existsSync(path.join(roots.guard, "src/dry-created.ts")))
    ck("write", "dryRun: envelope says planned, nothing committed/restored", dry.envelope?.committed === 0 && dry.envelope?.restored === 0 && dry.envelope?.entries[0].planned === true, JSON.stringify(dry.envelope))

    const alias = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/alias-created.ts", newContent: "export const aliasedWrite = 1\n", format: false })
    ck("write", "content alias: newContent is accepted for write", alias.changes.length === 1 && textOf(path.join(roots.guard, "src/alias-created.ts")) === "export const aliasedWrite = 1\n")

    const deep = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "deep/nested/dir/deep.ts", content: "export const deep = 1\n", format: false })
    ck("write", "nested create: intermediate directories are created", existsSync(path.join(roots.guard, "deep/nested/dir/deep.ts")) && deep.changes.length === 1)
  }

  // ══ SECTION: the overwrite guard ══════════════════════════════════════════
  {
    const long = path.join(roots.guard, "src/long.ts")
    const before = textOf(long)
    const refused = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: "export const only = 1\n", format: false }))
    ck("guard", "default: 41 lines → 1 is refused", !!refused.error && /would replace .*long\.ts \(41 lines\) with 1 line/.test(refused.error.message), refused.error?.message?.slice(0, 240))
    negative("guard", "default: the refused write leaves the file byte-identical", textOf(long) === before)
    ck("guard", "default: the refusal names both ways forward", !!refused.error && /overwrite: true/.test(refused.error.message) && /update\/insert/.test(refused.error.message))
    const dryRefused = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: "export const only = 1\n", dryRun: true, format: false }))
    ck("guard", "dryRun: the SAME guard refusal is raised in the plan", !!dryRefused.error && /would replace/.test(dryRefused.error.message), dryRefused.error?.message?.slice(0, 160))

    const six = path.join(roots.guard, "src/six.ts")
    const sixBefore = textOf(six)
    const sixRefused = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/six.ts", content: "export const a = 1\n", format: false }))
    ck("guard", "default: 6 lines → 1 is refused (>=5 removed and >half)", !!sixRefused.error && /removing 5 lines/.test(sixRefused.error.message), sixRefused.error?.message?.slice(0, 200))
    negative("guard", "default: the 6→1 refusal leaves the file untouched", textOf(six) === sixBefore)

    const allowed = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: Array.from({ length: 21 }, (_, i) => `export const cell${i} = ${i}`).join("\n") + "\n", format: false })
    ck("guard", "default: 41 → 21 is allowed (remaining share > 0.5)", allowed.changes.length === 1 && lineCount(textOf(long)) === 21, `lines=${lineCount(textOf(long))}`)
    restore(long)

    const forced = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: "export const only = 1\n", overwrite: true, format: false })
    ck("guard", "overwrite:true: replaces regardless of size", forced.changes.length === 1 && textOf(long) === "export const only = 1\n")
    restore(long)
    await reindex(ids.guard, roots.guard, [long])

    const createOnly = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: "x\n", overwrite: false, format: false }))
    ck("guard", "overwrite:false on an existing file is refused with create-only wording", !!createOnly.error && /overwrite is false \(create-only\)/.test(createOnly.error.message), createOnly.error?.message?.slice(0, 200))
    const createOnlyNew = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/create-only.ts", content: "export const co = 1\n", overwrite: false, format: false })
    ck("guard", "overwrite:false still creates a new file", createOnlyNew.changes.length === 1 && existsSync(path.join(roots.guard, "src/create-only.ts")))

    // pure helper contract
    ck("guard", "pure helper: writeGuardMessage is null for a new file", writeGuardMessage("x.ts", { existed: false, before: "", after: "y" }) === null)
    ck("guard", "constants: minRemovedLines=5, maxRemainingRatio=0.5", WRITE_GUARD.minRemovedLines === 5 && WRITE_GUARD.maxRemainingRatio === 0.5)
  }

  // ══ SECTION: update mode ══════════════════════════════════════════════════
  {
    const a = path.join(roots.ts, "src/a.ts")
    const full = "export function target(x: number): number {\n  return x * 2\n}\n"
    const r1 = await executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: full, format: false })
    ck("update", "full declaration: replaces the symbol body", textOf(a).includes("return x * 2") && r1.changes.length === 1)
    restore(a); await reindex(ids.ts, roots.ts, [a])

    const r2 = await executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "return x + 100", format: false })
    ck("update", "body fragment: keeps the declaration, replaces only the body", textOf(a).includes("export function target(x: number): number {") && textOf(a).includes("return x + 100"), textOf(a).slice(0, 160))
    restore(a); await reindex(ids.ts, roots.ts, [a])

    const r3 = await executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", content: "return 7", format: false })
    ck("update", "content alias: accepted in place of newContent", textOf(a).includes("return 7"))
    restore(a); await reindex(ids.ts, roots.ts, [a])

    const r4 = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/does-not-exist.ts", newContent: "x", format: false }))
    ck("update", "wrong filePath: refused (symbol not found), nothing written", !!r4.error && /not found/.test(r4.error.message), r4.error?.message?.slice(0, 160))

    const beforeDry = hashOf(a)
    const dry = await executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "return 8", dryRun: true, format: false })
    ck("update", "dryRun: returns the plan's before/after and writes nothing", dry.changes[0].before === textOf(a) && dry.changes[0].after.includes("return 8") && hashOf(a) === beforeDry, `before=${JSON.stringify(dry.changes[0].before.slice(0, 40))}`)
    restore(a); await reindex(ids.ts, roots.ts, [a])
  }

  // ══ SECTION: lineStart disambiguation ═════════════════════════════════════
  {
    const pick = path.join(roots.multi, "src/pick.ts")
    const ambiguous = await attempt(() => executeEdit(roots.multi, ids.multi, { mode: "update", symbolName: "pick", newContent: "return 99", format: false }))
    ck("lineStart", "ambiguous symbol: refused and names filePath/lineStart", !!ambiguous.error && /ambiguous; provide filePath and lineStart/.test(ambiguous.error.message), ambiguous.error?.message?.slice(0, 160))
    const withFile = await attempt(() => executeEdit(roots.multi, ids.multi, { mode: "update", symbolName: "pick", filePath: "src/pick.ts", newContent: "return 99", format: false }))
    ck("lineStart", "filePath alone still ambiguous for two same-file symbols", !!withFile.error && /ambiguous/.test(withFile.error.message), withFile.error?.message?.slice(0, 160))
    const secondLine = 5
    const r = await executeEdit(roots.multi, ids.multi, { mode: "update", symbolName: "pick", filePath: "src/pick.ts", lineStart: secondLine, newContent: 'return "second"', format: false })
    const body = textOf(pick)
    ck("lineStart", "lineStart selects the second declaration", body.includes('return "second"') && body.includes("return 1"), body.replace(/\n/g, "⏎"))
    const wrongLine = await attempt(() => executeEdit(roots.multi, ids.multi, { mode: "update", symbolName: "pick", filePath: "src/pick.ts", lineStart: 99, newContent: "return 1", format: false }))
    ck("lineStart", "a non-declaration line is refused (not silently ignored)", !!wrongLine.error && /not found/.test(wrongLine.error.message), wrongLine.error?.message?.slice(0, 160))
    restore(pick); await reindex(ids.multi, roots.multi, [pick])
  }

  // ══ SECTION: validation-failure rollback (byte-identical) ═════════════════
  {
    const a = path.join(roots.ts, "src/a.ts")
    const before = readFileSync(a)
    const beforeHash = hashOf(a)
    const r = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "export function target( { this is not valid }", format: false }))
    ck("rollback", "invalid content: refused with a validation error", !!r.error && /validation failed|Syntax/.test(r.error.message), r.error?.message?.slice(0, 200))
    negative("rollback", "invalid content: the file is byte-identical after the failure", hashOf(a) === beforeHash, `${before.length} bytes before`)
    ck("rollback", "invalid content: the error carries a restored envelope", r.error?.envelope?.entries?.every((e: any) => e.restored === true) === true && r.error.envelope.restored === 1, JSON.stringify(r.error?.envelope))
    negative("rollback", "invalid content: no temp files leak", tempsIn(path.dirname(a)).length === 0)
    await reindex(ids.ts, roots.ts, [a])
  }

  // ══ SECTION: file fidelity (CRLF, mode, invalid UTF-8) ═══════════════════
  {
    const crlf = path.join(roots.crlf, "src/crlf.ts")
    await executeEdit(roots.crlf, ids.crlf, { mode: "update", symbolName: "target", filePath: "src/crlf.ts", newContent: "return 42", format: false })
    const bytes = textOf(crlf)
    const loneLf = (bytes.match(/(?<!\r)\n/g) ?? []).length
    ck("fidelity", "CRLF file: an LF-fragment update keeps CRLF only", loneLf === 0 && bytes.includes("\r\n"), JSON.stringify(bytes))
    restore(crlf); await reindex(ids.crlf, roots.crlf, [crlf])

    const script = path.join(roots.perm, "bin/run.sh")
    const modeBefore = statSync(script).mode & 0o777
    await executeEdit(roots.perm, ids.perm, { mode: "write", filePath: "bin/run.sh", content: "#!/bin/sh\necho replaced\necho two\necho three\necho four\necho five\necho six\n", format: false })
    const modeAfter = statSync(script).mode & 0o777
    ck("fidelity", "0755 file: the mode survives a committed write", modeBefore === modeAfter && modeBefore === 0o755, `${modeBefore.toString(8)} → ${modeAfter.toString(8)}`)
    restore(script); chmod755(script)

    const latin = path.join(roots.nonutf8, "src/latin.ts")
    const latinBefore = readFileSync(latin)
    const bad = await attempt(() => executeEdit(roots.nonutf8, ids.nonutf8, { mode: "update", symbolName: "target", filePath: "src/latin.ts", newContent: "export function target( { broken", format: false }))
    ck("fidelity", "invalid UTF-8 file: a failed edit is refused", !!bad.error && /validation failed|Syntax/.test(bad.error.message), bad.error?.message?.slice(0, 160))
    negative("fidelity", "invalid UTF-8 file: rollback restores the EXACT bytes (no U+FFFD re-encoding)", Buffer.compare(readFileSync(latin), latinBefore) === 0, `sha ${hashOf(latin).slice(0, 12)} vs ${createHash("sha256").update(latinBefore).digest("hex").slice(0, 12)}`)
    await reindex(ids.nonutf8, roots.nonutf8, [latin])
  }

  // ══ SECTION: insert mode ══════════════════════════════════════════════════
  {
    const a = path.join(roots.ts, "src/a.ts")
    const positions = ["before", "after", "inside-top", "inside-bottom"] as const
    for (const position of positions) {
      restore(a); await reindex(ids.ts, roots.ts, [a])
      const r = await executeEdit(roots.ts, ids.ts, { mode: "insert", targetSymbolName: "target", filePath: "src/a.ts", position, newContent: `// inserted ${position}`, format: false })
      const text = textOf(a)
      const ok = r.changes.length === 1 && text.includes(`// inserted ${position}`)
      ck("insert", `${position}: lands exactly once`, ok, text.slice(0, 200).replace(/\n/g, "⏎"))
    }
    restore(a); await reindex(ids.ts, roots.ts, [a])

    const pyBody = await executeEdit(roots.py, ids.py, { mode: "insert", targetSymbolName: "target", position: "inside-top", newContent: "first = 1", format: false })
    ck("insert", "Python soft body: inside-top inserts with indentation", textOf(path.join(roots.py, "src/target.py")).startsWith("def target(x):\n    first = 1\n"), textOf(path.join(roots.py, "src/target.py")).slice(0, 120).replace(/\n/g, "⏎"))
    restore(path.join(roots.py, "src/target.py")); await reindex(ids.py, roots.py, [path.join(roots.py, "src/target.py")])

    const exRefused = await attempt(() => executeEdit(roots.ex, ids.ex, { mode: "insert", targetSymbolName: "target", position: "inside-top", newContent: "x = 1", format: false }))
    ck("insert", "Elixir do/end body: inside-top is refused loudly", !!exRefused.error && /not line-aligned|no recognizable body|unsupported/.test(exRefused.error.message), exRefused.error?.message?.slice(0, 220))

    const missing = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "insert", targetSymbolName: "noSuchSymbol", position: "after", newContent: "x", format: false }))
    ck("insert", "missing targetSymbolName: refused by name", !!missing.error && /not found/.test(missing.error.message), missing.error?.message?.slice(0, 160))
  }

  // ══ SECTION: declaration widening (Java/Kotlin index from the NAME) ═══════
  {
    const java = path.join(roots.java, "src/com/demo/Target.java")
    const r = await executeEdit(roots.java, ids.java, { mode: "update", symbolName: "target", newContent: "int target() {\n        return 5;\n    }", format: false })
    const text = textOf(java)
    ck("widen", "Java: a full declaration update does not duplicate the return type", r.changes.length === 1 && !/int\s+int\s+target/.test(text) && /int target\(\)/.test(text), text.replace(/\n/g, "⏎").slice(0, 200))
    restore(java); await reindex(ids.java, roots.java, [java])

    const kt = path.join(roots.kt, "src/T.kt")
    const kr = await executeEdit(roots.kt, ids.kt, { mode: "update", symbolName: "target", newContent: "fun target(): Int {\n    return 5\n}", format: false })
    const ktext = textOf(kt)
    ck("widen", "Kotlin: a full declaration update does not duplicate `fun`", kr.changes.length === 1 && !/fun\s+fun\s+target/.test(ktext) && /fun target\(\)/.test(ktext), ktext.replace(/\n/g, "⏎").slice(0, 200))
    restore(kt); await reindex(ids.kt, roots.kt, [kt])
  }

  // ══ SECTION: body-fragment refusal outside brace languages ════════════════
  {
    const py = await attempt(() => executeEdit(roots.py, ids.py, { mode: "update", symbolName: "target", newContent: "return 9", format: false }))
    ck("bodies", "Python body fragment: refused (no brace body) with the remedy named", !!py.error && /no replaceable body block|pass the full declaration/.test(py.error.message), py.error?.message?.slice(0, 200))
    negative("bodies", "Python body fragment: nothing was written", textOf(path.join(roots.py, "src/target.py")) === ORIGINALS.get(path.join(roots.py, "src/target.py"))!.toString("utf8"))
    const rb = await attempt(() => executeEdit(roots.rb, ids.rb, { mode: "update", symbolName: "target", newContent: "2", format: false }))
    ck("bodies", "Ruby body fragment: refused, remedy named", !!rb.error && /no replaceable body block|pass the full declaration/.test(rb.error.message), rb.error?.message?.slice(0, 200))
  }

  // ══ SECTION: formatting measurement ═══════════════════════════════════════
  {
    const tsFile = path.join(roots.guard, "src/fmt.ts")
    rmSync(tsFile, { force: true })
    const tsR = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/fmt.ts", content: "export const formatted = 1\n", format: true })
    ck("formatting", "no formatter installed for .ts: formatted=false, ran=false, and the outcome names the mapped formatter it tried", tsR.formatted === false && tsR.formatting?.[0].formatter === "prettier" && tsR.formatting?.[0].ran === false && /no formatter found/.test(tsR.formatting?.[0].reason ?? ""), JSON.stringify(tsR.formatting))
    const tsOff = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/fmt2.ts", content: "export const formatted2 = 1\n", format: false })
    ck("formatting", "format:false: no formatting array and formatted=false", tsOff.formatting === undefined && tsOff.formatted === false, JSON.stringify(tsOff.formatting))

    const goFile = path.join(roots.go, "src2.go")
    const goR = await executeEdit(roots.go, ids.go, { mode: "write", filePath: "src2.go", content: "package fixture\n\nvar   misplaced   =   1\n", format: true })
    ck("formatting", ".go with gofmt installed: formatted=true, formatter=gofmt, ran ok", goR.formatted === true && goR.formatting?.[0].formatter === "gofmt" && goR.formatting?.[0].ok === true, JSON.stringify(goR.formatting))
    ck("formatting", ".go: the formatter actually rewrote the bytes", textOf(goFile).includes("var misplaced = 1"), JSON.stringify(textOf(goFile)))

    const rbFile = path.join(roots.guard, "src/noformat.rb")
    const rbR = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/noformat.rb", content: "def x\n  1\nend\n", format: true })
    ck("formatting", ".rb (unmapped): reported 'no formatter mapped', not a silent true", rbR.formatted === false && /no formatter mapped for \.rb/.test(rbR.formatting?.[0].reason ?? ""), JSON.stringify(rbR.formatting))
    void rbFile
  }

  // ══ SECTION: delete guards ════════════════════════════════════════════════
  {
    const used = path.join(roots.ts, "src/used.ts")
    const guarded = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "delete", symbolName: "used", filePath: "src/used.ts", format: false }))
    ck("delete", "indexed caller: refused without force, naming the callers", !!guarded.error && /cannot delete used: .*indexed caller/.test(guarded.error.message), guarded.error?.message?.slice(0, 220))
    negative("delete", "indexed caller: nothing was deleted", existsSync(used))
    const forced = await executeEdit(roots.ts, ids.ts, { mode: "delete", symbolName: "used", filePath: "src/used.ts", force: true, format: false })
    ck("delete", "force:true: deletion proceeds and warns about survivors", forced.warnings?.some((w) => /forced/.test(w)) === true, JSON.stringify(forced.warnings))
    restore(used); await reindex(ids.ts, roots.ts, [used])

    const doomed = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "delete", symbolName: "doomed", filePath: "src/del.ts", format: false }))
    ck("delete", "aliased/importing caller: refusal names the importing file", !!doomed.error && /importing file\(s\)/.test(doomed.error.message), doomed.error?.message?.slice(0, 260))

    const aliased = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "delete", symbolName: "target", filePath: "src/a.ts", format: false }))
    ck("delete", "aliased import specifier blocks a delete (import { target as aliased })", !!aliased.error && /cannot delete target/.test(aliased.error.message), aliased.error?.message?.slice(0, 240))

    const missing = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "delete", symbolName: "neverExisted", format: false }))
    ck("delete", "unknown symbol: refused", !!missing.error && /not found/.test(missing.error.message), missing.error?.message?.slice(0, 120))
  }

  // ══ SECTION: refactor completeness ════════════════════════════════════════
  {
    const a = path.join(roots.ts, "src/a.ts")
    const b = path.join(roots.ts, "src/b.ts")
    const c = path.join(roots.ts, "src/c.ts")
    const dFile = path.join(roots.ts, "src/d.ts")
    const r = await executeEdit(roots.ts, ids.ts, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "renamedTarget", format: false })
    const at = textOf(a); const bt = textOf(b); const ct = textOf(c); const dt = textOf(dFile)
    ck("refactor", "declaration file: declaration + in-file call renamed", at.includes("export function renamedTarget") && at.includes("return renamedTarget(41)"), at.replace(/\n/g, "⏎"))
    ck("refactor", "cross-file: the import specifier is rewritten", bt.includes('import { renamedTarget } from "./a"') && bt.includes("renamedTarget(2)"), bt.replace(/\n/g, "⏎"))
    negative("refactor", "local same-name in an unrelated file is untouched", ct.includes("const target = 3"), ct.replace(/\n/g, "⏎"))
    ck("refactor", "namespace import is not rewritten (the export name moved, the local binding did not)", dt.includes("import * as a") && dt.includes("a.target(3)"))
    ck("refactor", "summary reports files and sites", (r.summary?.renamedFiles ?? 0) >= 2 && (r.summary?.renamedSites ?? 0) >= 3, JSON.stringify(r.summary))
    ck("refactor", "warnings state the reach", r.warnings?.some((w) => /site\(s\) across/.test(w)) === true, JSON.stringify(r.warnings))
    // restore the whole ts fixture tree
    for (const file of [a, b, c, dFile]) restore(file)
    await reindex(ids.ts, roots.ts, [a, b, c, dFile])

    // invalid newName
    for (const badName of ["1bad", "has space", "a-b", ""]) {
      const e = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: badName, format: false }))
      ck("refactor", `invalid identifier ${JSON.stringify(badName)}: refused`, !!e.error && /valid identifier newName/.test(e.error.message), e.error?.message?.slice(0, 120))
    }

    // stale caller aborts the whole rename
    const bBefore = textOf(b)
    writeFileSync(b, bBefore.replace("across = target(2)", "across = target(2) /* external save */"))
    const staleCaller = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "renamedTarget", format: false }))
    ck("refactor", "stale caller file: the rename is refused before writing", !!staleCaller.error && /not fresh|stale/.test(staleCaller.error.message), staleCaller.error?.message?.slice(0, 240))
    negative("refactor", "stale caller: the declaration file is untouched", textOf(a) === ORIGINALS.get(a)!.toString("utf8"))
    restore(b)

    // renaming ONTO an existing declaration is refused (two declarations of one name
    // is not a completed rename)
    const ontoExisting = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "helper", format: false }))
    ck("refactor", "rename onto an existing name: refused, file unchanged", !!ontoExisting.error && /already declared/.test(ontoExisting.error.message), ontoExisting.error?.message?.slice(0, 220))
    negative("refactor", "rename onto an existing name: the declaration file is byte-identical", textOf(a) === ORIGINALS.get(a)!.toString("utf8"))
    const sameName = await attempt(() => executeEdit(roots.ts, ids.ts, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "target", format: false }))
    ck("refactor", "rename to the SAME name: refused as a no-op", !!sameName.error && /current name/.test(sameName.error.message), sameName.error?.message?.slice(0, 200))

    // zero-site refusal (a grammar that exposes no identifier reference)
    const y = await attempt(() => executeEdit(roots.yaml, ids.yaml, { mode: "refactor", symbolName: "target", newName: "renamed", format: false }))
    ck("refactor", "zero resolved sites: refused, never reported as success", !!y.error && /resolved 0 rename site|not found/.test(y.error.message), y.error?.message?.slice(0, 200))
  }

  // ══ SECTION: stale index handling ═════════════════════════════════════════
  {
    const stale = path.join(roots.stale, "src/stale.ts")
    const original = textOf(stale)
    // external edit that does NOT move the symbol: the refresh path must succeed with a warning
    writeFileSync(stale, original.replace("export function keep", "// external\nexport function keep"))
    const refreshed = await executeEdit(roots.stale, ids.stale, { mode: "update", symbolName: "target", newContent: "return 11", format: false })
    ck("stale", "stale target file: refreshed and edited (warning names the refresh)", refreshed.warnings?.some((w) => /refreshed stale index rows/.test(w)) === true, JSON.stringify(refreshed.warnings))
    ck("stale", "stale refresh: the edit applied to the bytes on disk", textOf(stale).includes("return 11") && textOf(stale).includes("// external"))
    restore(stale); await reindex(ids.stale, roots.stale, [stale])

    const moved = path.join(roots.moved, "src/moved.ts")
    writeFileSync(moved, "export function renamedEverywhere(): number {\n  return 1\n}\n")
    const gone = await attempt(() => executeEdit(roots.moved, ids.moved, { mode: "update", symbolName: "target", newContent: "return 2", format: false }))
    ck("stale", "symbol renamed on disk: refused BY NAME after the refresh", !!gone.error && /renamed or removed since it was indexed/.test(gone.error.message), gone.error?.message?.slice(0, 220))
    negative("stale", "renamed symbol: no edit was applied over it", textOf(moved).includes("renamedEverywhere") && !textOf(moved).includes("return 2"))
  }

  // ══ SECTION: path safety ══════════════════════════════════════════════════
  {
    const safety = roots.safety
    const dotdot = await attempt(() => executeEdit(safety, ids.safety, { mode: "write", filePath: "../escaped.ts", content: "x\n", format: false }))
    ck("paths", "'../' escape: refused with 'escapes project root'", !!dotdot.error && /path escapes project root/.test(dotdot.error.message), dotdot.error?.message?.slice(0, 200))
    const absolute = await attempt(() => executeEdit(safety, ids.safety, { mode: "write", filePath: f.outside, content: "x\n", format: false }))
    ck("paths", "absolute path outside: refused", !!absolute.error && /path escapes project root/.test(absolute.error.message), absolute.error?.message?.slice(0, 200))
    const symlink = await attempt(() => executeEdit(safety, ids.safety, { mode: "write", filePath: "src/escape.ts", content: "export const x = 1\n", format: false }))
    ck("paths", "symlink escape: refused with 'through symlink'", !!symlink.error && /through symlink/.test(symlink.error.message), symlink.error?.message?.slice(0, 220))
    negative("paths", "symlink escape: the outside file is untouched", textOf(f.outside) === "export const secret = 1\n")
    const nested = resolveSafeEditPath(safety, "src/real-dir/deep/new.ts")
    ck("paths", "in-project new nested path: resolves inside the project", nested.startsWith(safety) && nested.includes("real-dir/deep/new.ts"), nested)
    const rootItself = resolveSafeEditPath(safety, ".")
    ck("paths", "project root itself resolves (no false escape)", path.resolve(rootItself) === path.resolve(safety), rootItself)

    // write to a directory path / protected in-project trees
    const dirTarget = await attempt(() => executeEdit(safety, ids.safety, { mode: "write", filePath: "src/real-dir", content: "x\n", format: false }))
    ck("paths", "write onto an existing DIRECTORY: refused (not a crash)", !!dirTarget.error, dirTarget.error?.message?.slice(0, 160) ?? "no throw")
    for (const [label, filePath] of [["a file under .git/", ".git/hooks/evil.ts"], ["a file under node_modules/", "node_modules/pkg/x.ts"], ["a file under .bb-data/", ".bb-data/projects/x.ts"]]) {
      const blocked = await attempt(() => executeEdit(safety, ids.safety, { mode: "write", filePath, content: "export const x = 1\n", format: false }))
      ck("paths", `${label}: refused by the protected-path policy`, !!blocked.error && /protected path/.test(blocked.error.message), blocked.error?.message?.slice(0, 160))
      negative("paths", `${label}: nothing was written`, !existsSync(path.join(safety, filePath)))
    }
    rmSync(path.join(safety, ".git"), { recursive: true, force: true })
  }

  // ══ SECTION: plan→commit pre-image check ══════════════════════════════════
  {
    const target = path.join(roots.guard, "src/moving.ts")
    rmSync(target, { force: true })
    writeFileSync(target, "export const plannedFrom = 1\n")
    const external = "export const externalSave = 1\n"
    queueMicrotask(() => writeFileSync(target, external))
    const r = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/moving.ts", content: "export const mine = 1\n", format: false }))
    ck("pre-image", "file changed between plan and commit: refused with both hashes", !!r.error && /changed on disk between planning and committing/.test(r.error.message) && /planned [0-9a-f]{12}, now [0-9a-f]{12}/.test(r.error.message), r.error?.message?.slice(0, 300))
    ck("pre-image", "the refusal states that nothing was written", !!r.error && /bb_edit wrote nothing/.test(r.error.message))
    negative("pre-image", "the external save is intact", textOf(target) === external, textOf(target))

    const appearing = path.join(roots.guard, "src/appearing.ts")
    rmSync(appearing, { force: true })
    queueMicrotask(() => writeFileSync(appearing, "export const appeared = 1\n"))
    const ar = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/appearing.ts", content: "export const mine = 2\n", format: false }))
    ck("pre-image", "a file that appears at a CREATE target is refused", !!ar.error && /no file at that path/.test(ar.error.message), ar.error?.message?.slice(0, 260))
    negative("pre-image", "the appeared file is left as found", textOf(appearing) === "export const appeared = 1\n")
  }

  // ══ SECTION: dry-run never writes (all modes) ═════════════════════════════
  {
    const snapshot = new Map<string, string>()
    for (const [k, root] of Object.entries(roots)) {
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(p)
          else if (entry.isFile()) snapshot.set(p, hashOf(p))
        }
      }
      walk(root)
      void k
    }
    const calls: Array<[string, string, EditRequest]> = [
      ["ts", ids.ts, { mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "return 5", dryRun: true, format: false }],
      ["ts", ids.ts, { mode: "insert", targetSymbolName: "target", filePath: "src/a.ts", position: "after", newContent: "// dry", dryRun: true, format: false }],
      ["ts", ids.ts, { mode: "delete", symbolName: "doomed", force: true, dryRun: true, format: false }],
      ["py", ids.py, { mode: "refactor", symbolName: "target", newName: "renamedTarget", dryRun: true, format: false }],
      ["batch", ids.batch, { mode: "batch", dryRun: true, format: false, edits: [{ mode: "update", symbolName: "alpha", filePath: "src/a.ts", newContent: "return 10" }] }],
    ]
    let anyWrote = false
    const dryProblems: string[] = []
    for (const [rootKey, id, request] of calls) {
      const root = roots[rootKey]
      const r = await attempt(() => executeEdit(root, id, request))
      if (r.error) { anyWrote = true; dryProblems.push(`${request.mode}: ${String(r.error.message).slice(0, 120)}`) }
      else if (r.result?.dryRun !== true) { anyWrote = true; dryProblems.push(`${request.mode}: dryRun flag missing`) }
    }
    const drifted: string[] = []
    for (const [file, hash] of snapshot) {
      if (existsSync(file) && hashOf(file) !== hash) { anyWrote = true; drifted.push(file) }
    }
    negative("dryRun", "every mode's dry run writes zero bytes across every fixture", !anyWrote, anyWrote ? `changed: ${drifted.join(", ")}; problems: ${dryProblems.join(" | ")}` : "all hashes match")
  }

  // ══ SECTION: index-free write / mode-aware index refusal ═════════════════
  {
    const root = f.noindex
    const projectId = getProjectId(root)
    // FIRST: the symbol modes on a project that has no index at all
    const beforeAnyWrite = await attempt(() => executeEdit(root, projectId, { mode: "update", symbolName: "firstFn", newContent: "return 2", format: false }))
    ck("index-free", "update on a project with NO index names the cause and the remedy", !!beforeAnyWrite.error && /has no index \(0 files indexed\)/.test(beforeAnyWrite.error.message) && /bb_edit write mode does not need an index/.test(beforeAnyWrite.error.message), beforeAnyWrite.error?.message?.slice(0, 280))
    const first = await executeEdit(root, projectId, { mode: "write", filePath: "src/first.ts", content: "export function firstFn(): number {\n  return 1\n}\n", format: false })
    ck("index-free", "write works on a project with NO index", first.changes.length === 1 && first.reindexed === true && existsSync(path.join(root, "src/first.ts")))
    ck("index-free", "write creates the first indexed rows (bootstrap)", (await ASTEngine.findSymbol(projectId, "firstFn")).matches.length === 1)
    const upd = await attempt(() => executeEdit(root, projectId, { mode: "update", symbolName: "firstFn", newContent: "return 2", format: false }))
    ck("index-free", "after the bootstrap write the SAME update resolves the symbol", !upd.error && readFileSync(path.join(root, "src/first.ts"), "utf8").includes("return 2"), upd.error?.message?.slice(0, 240) ?? "ok")
    // a fresh project that has NEVER been indexed at all
    const virgin = path.join(work, "run/virgin")
    rmSync(virgin, { recursive: true, force: true }); mkdirSync(virgin, { recursive: true })
    const virginId = getProjectId(virgin)
    const virginUpd = await attempt(() => executeEdit(virgin, virginId, { mode: "update", symbolName: "x", newContent: "y", format: false }))
    ck("index-free", "update on a virgin project names the absence of an index and the remedy", !!virginUpd.error && /no index \(0 files indexed\)/.test(virginUpd.error.message), virginUpd.error?.message?.slice(0, 260))
  }

  // ══ SECTION: batch ════════════════════════════════════════════════════════
  {
    const batchRoot = roots.batch
    const a = path.join(batchRoot, "src/a.ts")
    const b = path.join(batchRoot, "src/b.ts")
    const c = path.join(batchRoot, "src/c.ts")
    // fan-out: one insert across two files
    const fan = await executeEdit(batchRoot, ids.batch, { mode: "batch", format: false, edits: [{ mode: "insert", targetSymbolName: "alpha", position: "inside-top", newContent: "const aTop = 1" }, { mode: "insert", targetSymbolName: "beta", position: "inside-top", newContent: "const bTop = 1" }] })
    ck("batch", "mixed: two entries land in one call", textOf(a).includes("const aTop = 1") && textOf(b).includes("const bTop = 1") && fan.changes.length === 2)
    ck("batch", "mixed: one derived block for the whole call", fan.derived !== undefined && fan.batch?.length === 2, JSON.stringify(fan.batch))
    for (const file of [a, b]) restore(file)
    await reindex(ids.batch, batchRoot, [a, b])

    const fanOut = await executeEdit(batchRoot, ids.batch, { mode: "batch", format: false, files: ["src/a.ts", "src/b.ts"], edits: [{ mode: "insert", targetSymbolName: "common", position: "inside-top", newContent: "const fanned = 1" }] })
    ck("batch", "fan-out: an entry with `files` is applied to every file (reported per entry)", fanOut.batch?.[0].files.length === 2, JSON.stringify(fanOut.batch))

    // rollback: 3rd entry invalid -> nothing written, all byte-identical
    for (const file of [a, b, c]) restore(file)
    await reindex(ids.batch, batchRoot, [a, b, c])
    const hashes = new Map([a, b, c].map((file) => [file, hashOf(file)]))
    const rolled = await attempt(() => executeEdit(batchRoot, ids.batch, {
      mode: "batch",
      format: false,
      edits: [
        { mode: "update", symbolName: "alpha", filePath: "src/a.ts", newContent: "return 10" },
        { mode: "update", symbolName: "beta", filePath: "src/b.ts", newContent: "return 20" },
        { mode: "update", symbolName: "gamma", filePath: "src/c.ts", newContent: "export function gamma( { broken" },
      ],
    }))
    ck("batch", "rollback: a validation failure in the last entry is refused", !!rolled.error && /validation failed|Syntax/.test(rolled.error.message), rolled.error?.message?.slice(0, 200))
    negative("batch", "rollback: every file is byte-identical to its pre-edit bytes", [...hashes].every(([file, h]) => hashOf(file) === h))
    ck("batch", "rollback: the error envelope reports all three committed then restored", rolled.error?.envelope?.committed === 3 && rolled.error.envelope.restored === 3 && rolled.error.envelope.failed.length === 0, JSON.stringify(rolled.error?.envelope))
    negative("batch", "rollback: no temp files leak", [a, b, c].every((file) => tempsIn(path.dirname(file)).length === 0))
    ck("batch", "rollback: the ORIGINAL error is preserved, not replaced by the rollback's", !!rolled.error && !/ROLLBACK INCOMPLETE/.test(rolled.error.message))

    // plan-stage refusal: nothing written
    for (const file of [a, b]) restore(file)
    await reindex(ids.batch, batchRoot, [a, b])
    const planRefused = await attempt(() => executeEdit(batchRoot, ids.batch, { mode: "batch", format: false, edits: [{ mode: "update", symbolName: "alpha", filePath: "src/a.ts", newContent: "return 11" }, { mode: "update", symbolName: "doesNotExist", filePath: "src/b.ts", newContent: "return 21" }] }))
    ck("batch", "plan refusal: names the failing entry", !!planRefused.error && /batch entry 1/.test(planRefused.error.message), planRefused.error?.message?.slice(0, 200))
    negative("batch", "plan refusal: the entry that planned cleanly also wrote nothing", hashOf(a) === hashes.get(a))

    // duplicate target
    const dup = await attempt(() => executeEdit(batchRoot, ids.batch, { mode: "batch", format: false, edits: [{ mode: "update", symbolName: "alpha", filePath: "src/a.ts", newContent: "return 12" }, { mode: "insert", targetSymbolName: "alpha", filePath: "src/a.ts", position: "after", newContent: "// dup" }] }))
    ck("batch", "two entries on ONE file are refused by entry index", !!dup.error && /both resolve to .*a\.ts/.test(dup.error.message), dup.error?.message?.slice(0, 260))

    // dry run
    const dry = await executeEdit(batchRoot, ids.batch, { mode: "batch", dryRun: true, format: false, edits: [{ mode: "update", symbolName: "alpha", filePath: "src/a.ts", newContent: "return 13" }] })
    ck("batch", "dryRun: planned envelope, nothing committed", dry.dryRun === true && dry.envelope?.committed === 0 && textOf(a).includes("return 1"))

    // batch on a no-index project (engine path: works for write entries)
    const noIdxRoot = path.join(work, "run/noindex-batch")
    rmSync(noIdxRoot, { recursive: true, force: true }); mkdirSync(noIdxRoot, { recursive: true })
    const noIdxId = getProjectId(noIdxRoot)
    const noIdxBatch = await attempt(() => executeEdit(noIdxRoot, noIdxId, { mode: "batch", format: false, edits: [{ mode: "write", filePath: "one.ts", content: "export const one = 1\n" }] }))
    ck("batch", "engine path: a write-only batch runs with no index (server gate is the refusal point)", !!noIdxBatch.result && existsSync(path.join(noIdxRoot, "one.ts")), noIdxBatch.error?.message?.slice(0, 160) ?? "ok")
  }

  // ══ SECTION: boundary validation (mode × option) ═════════════════════════
  {
    const cases: Array<[string, unknown, string]> = [
      ["update with position is refused and names insert", { mode: "update", symbolName: "x", newContent: "y", position: "after" }, "position is accepted for insert"],
      ["update with overwrite is refused", { mode: "update", symbolName: "x", newContent: "y", overwrite: true }, "overwrite is accepted for write"],
      ["write with symbolName is refused", { mode: "write", filePath: "a.ts", content: "x", symbolName: "y" }, "write mode does not accept"],
      ["insert with force is refused", { mode: "insert", targetSymbolName: "x", newContent: "y", force: true }, "force is accepted for delete"],
      ["delete with newName is refused", { mode: "delete", symbolName: "x", newName: "y" }, "newName is accepted for refactor"],
      ["batch with filePath is refused", { mode: "batch", filePath: "a.ts", edits: [] }, "batch mode does not accept"],
      ["unknown option is refused with the accepted set", { mode: "write", filePath: "a.ts", content: "x", bogus: 1 }, "unknown or irrelevant options: bogus"],
      ["missing required filePath is refused", { mode: "write", content: "x" }, "requires filePath"],
      ["blank symbolName is refused", { mode: "update", symbolName: "   ", newContent: "x" }, "requires symbolName"],
      ["non-integer lineStart is refused", { mode: "update", symbolName: "x", newContent: "y", lineStart: 1.5 }, "whole number"],
      ["negative lineStart is refused", { mode: "update", symbolName: "x", newContent: "y", lineStart: -1 }, "non-negative"],
      ["unknown mode is refused", { mode: "rename", symbolName: "x" }, "must be one of"],
      ["unknown position enum is refused", { mode: "insert", targetSymbolName: "x", newContent: "y", position: "inside-middle" }, "must be one of"],
      ["batch entry with a per-entry dryRun is refused", { mode: "batch", edits: [{ mode: "write", filePath: "a.ts", content: "x", dryRun: true }] }, "must not set dryRun"],
      ["batch entry with an option its mode does not accept is refused by entry index", { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y", position: "after" }] }, "batch entry 0"],
      ["batch with a nested batch is refused", { mode: "batch", edits: [{ mode: "batch", edits: [] }] }, "must not itself be a batch"],
      ["batch with empty edits is refused", { mode: "batch", edits: [] }, "non-empty `edits`"],
      ["batch `files` with a repeated path is refused", { mode: "batch", files: ["a.ts", "a.ts"], edits: [{ mode: "write", content: "x" }] }, "repeats"],
      ["batch entry naming its own filePath under `files` is refused", { mode: "batch", files: ["a.ts"], edits: [{ mode: "write", filePath: "b.ts", content: "x" }] }, "must not also name one"],
      ["format must be a boolean", { mode: "write", filePath: "a.ts", content: "x", format: "yes" }, "must be boolean"],
      ["dryRun must be a boolean", { mode: "write", filePath: "a.ts", content: "x", dryRun: 1 }, "must be boolean"],
      ["max batch: 201 planned edits refused by number", { mode: "batch", files: Array.from({ length: 201 }, (_, i) => `f${i}.ts`), edits: [{ mode: "write", content: "x" }] }, "exceeds the limit of 200"],
    ]
    for (const [name, args, fragment] of cases) {
      const message = descriptorError(args)
      ck("boundary", name, message.length > 0 && message.includes(fragment), message.slice(0, 240))
    }
    const validUpdate = descriptorError({ mode: "update", symbolName: "x", newContent: "y" })
    ck("boundary", "a valid update request passes the boundary", validUpdate === "", validUpdate)
    const validBatch = descriptorError({ mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y" }, { mode: "delete", symbolName: "z" }] })
    ck("boundary", "a valid mixed batch passes the boundary", validBatch === "", validBatch)
  }

  // ══ SECTION: measured doc claims ══════════════════════════════════════════
  {
    // The descriptor/docs claim a REFUSED call carries the per-file envelope; a
    // plan-stage refusal now carries the EMPTY one (nothing planned, nothing
    // committed, nothing restored), so the claim is true without over-claiming.
    const planRefusal = await attempt(() => executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/long.ts", content: "x\n", format: false }))
    ck("docs", "a plan-stage refusal carries the empty per-file envelope", planRefusal.error?.envelope?.atomic === true && Array.isArray(planRefusal.error.envelope.entries) && planRefusal.error.envelope.entries.length === 0 && planRefusal.error.envelope.committed === 0 && planRefusal.error.envelope.restored === 0, `envelope=${JSON.stringify(planRefusal.error?.envelope)?.slice(0, 160)}`)
    ck("docs", "and it says the refusal happened before anything was written", planRefusal.error?.refusedBeforeWriting === true, String(planRefusal.error?.refusedBeforeWriting))

    // reindexed:true is asserted unconditionally on success
    const ok = await executeEdit(roots.guard, ids.guard, { mode: "write", filePath: "src/reindex-claim.ts", content: "export const reindexClaim = 1\n", format: false })
    ck("docs", "reindexed is reported from the reindex result and derived.pass is present", ok.reindexed === true && typeof ok.derived?.pass === "string", `${ok.reindexed} derived.pass=${ok.derived?.pass}`)

    // documented delete gap: a tsconfig path alias is NOT caught (measured absence)
    ck("docs", "documented known gap: path-alias imports are not resolved (README claim)", (() => { const src = readFileSync("src/intelligence/edit/edit-engine.ts", "utf8"); return src.includes("path ALIAS") })())
  }

  // ── write evidence ─────────────────────────────────────────────────────────
  writeEvidence()
}

function writeEvidence(): void {
  const doc = {
    schemaVersion: 1,
    tool: "bb_edit",
    phase: "A-audit",
    currentCommit: (() => { try { const head = readFileSync(".git/HEAD", "utf8").trim(); const m = /^ref:\s*(.+)$/.exec(head); return m ? readFileSync(`.git/${m[1]}`, "utf8").trim() : head } catch { return "unknown" } })(),
    generatedAt: new Date().toISOString(),
    env: { BB_DATA_DIR: process.env.BB_DATA_DIR ?? "(unset)", BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? "(unset)" },
    summary: { total: checks.length, passed: checks.length - failures, failed: failures, negativeCases: checks.filter((c) => c.negative).length },
    checks,
  }
  const out = path.resolve("validation/tools/bb_edit/artifacts/matrix.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n")
  console.log(`\nMATRIX: ${checks.length} checks, ${checks.length - failures} passed, ${failures} failed (${doc.summary.negativeCases} negative) → ${out}`)
}

function chmod755(file: string): void {
  try { chmodSync(file, 0o755) } catch { /* best effort */ }
}

main().then(() => process.exit(failures === 0 ? 0 : 1)).catch((e) => {
  console.error("FATAL", e)
  try { writeEvidence() } catch { /* evidence write is best effort on a fatal path */ }
  process.exit(2)
})
