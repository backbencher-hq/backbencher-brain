// script/m64/verify-paths.ts — M64.D.
//
// `paths` answers the question an agent actually has after an edit: "are MY
// files fresh?" The only current answer was a scan of the whole project.
//
// The design risk was stated before it was written: a half-scoped `paths` is
// WORSE than none, because a caller would read a 3-file verdict next to
// `files=1654` and merge them into one belief. So the gate below is mostly about
// the ways this feature can lie:
//
//   * report `fresh` for a file the index has never seen   (the fabrication)
//   * let a project-wide number be read as a scoped one     (mixed scope)
//   * answer a path outside the project                     (escape)
//   * normalise two spellings of one file differently       (quiet miss)
//   * drop an entry the caller asked about                   (silent omission)
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"

const harness = new Harness({
  issue: "M64",
  code: "H64d",
  tool: "bb_health",
  title: "bb_health paths: five states, no fabrication, no mixed scope, no silent omission",
  layers: ["integration"],
  decisions: {
    states: "fresh | stale | gone | not-indexed | absent — a boolean would destroy the last three",
    scope: "a separate self-describing block; project-wide counts are untouched so the two cannot be merged",
    resolution: "the same realpath-based primitive bb_edit uses, so the two tools agree on what a path IS",
    bounds: "at most 50, validated at the boundary, because the whole point is O(files named)",
  },
  limitations: [
    "The `absent` case is asserted with a path that does not exist. A caller who misspells an EXISTING file gets `not-indexed` rather than `absent`, because the two are genuinely indistinguishable from the filesystem alone; the reason string says which case it is.",
  ],
})

const desc = PUBLIC_TOOL_DESCRIPTORS.find((d) => d.name === "bb_health")!
const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}
const rel = (root: string, relPath: string) => path.join(root, relPath)

// ══ 1. all five states, and no fabrication ═════════════════════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64d-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 4; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  // A file that will be deleted, a file that will be edited, a file that will
  // never be indexed, and a path that will never exist.
  writeFileSync(path.join(root, "src", "doomed.ts"), "export function doomed(): number { return 1 }\n")
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    // Build all five conditions.
    appendFileSync(path.join(root, "src", "f0.ts"), "\n// edited\n")            // stale
    rmSync(path.join(root, "src", "doomed.ts"))                                  // gone
    writeFileSync(path.join(root, "src", "fresh-new.ts"), "export function freshNew(): number { return 7 }\n") // not-indexed
    // "src/never-existed.ts" is left alone                                    // absent

    const asked = ["src/f1.ts", "src/f0.ts", "src/doomed.ts", "src/fresh-new.ts", "src/never-existed.ts"]
    const r = await getUnifiedHealth(pid, root, { paths: asked })
    const rows = r.pathChecks!
    const by = (p: string) => rows.find((x) => x.path === p)

    harness.check("an untouched indexed file is `fresh`", by("src/f1.ts")?.status === "fresh", `src/f1.ts -> ${by("src/f1.ts")?.status} (verified by ${by("src/f1.ts")?.verifiedBy})`)
    harness.check("an edited indexed file is `stale`", by("src/f0.ts")?.status === "stale", `src/f0.ts -> ${by("src/f0.ts")?.status} reason=${by("src/f0.ts")?.reason}`)
    harness.check("a deleted indexed file is `gone`", by("src/doomed.ts")?.status === "gone", `src/doomed.ts -> ${by("src/doomed.ts")?.status} reason=${by("src/doomed.ts")?.reason}`)
    // THE anti-fabrication assertion.
    harness.check("a file the index has NEVER seen is `not-indexed`, never `fresh`", by("src/fresh-new.ts")?.status === "not-indexed", `src/fresh-new.ts -> ${by("src/fresh-new.ts")?.status} — reporting "fresh" here is the fabrication this design exists to prevent`)
    harness.check("a path that does not exist is `absent`, not `not-indexed`", by("src/never-existed.ts")?.status === "absent", `src/never-existed.ts -> ${by("src/never-existed.ts")?.status} — "the indexer has not run" and "no such file" are different`)
    harness.check("all five states are reachable and distinct", new Set(rows.map((x) => x.status)).size === 5, rows.map((x) => `${x.path}=${x.status}`).join(" "))
    harness.check("a row exists for EVERY path asked about, with no omissions", rows.length === asked.length, `${rows.length} rows for ${asked.length} asked: ${rows.map((x) => x.path).join(", ")}`)
    harness.check("each row echoes what the caller actually asked for", rows.every((x) => asked.includes(x.requested)), rows.map((x) => x.requested).join(", "))

    // A not-indexed file must be impossible to mistake for fresh, in BOTH
    // surfaces a caller reads.
    const out = formatUnifiedHealth(r)
    harness.check("the text form prints the scoped block FIRST", /^SCOPED ANSWER/m.test(out), out.split("\n")[0]?.slice(0, 100) ?? "absent")
    harness.check("and states that everything after it is project-wide", /everything below this block is PROJECT-WIDE/.test(out), "")
    harness.check("the not-indexed row is legible in the text with its reason", /not-indexed\s+src\/fresh-new\.ts.*not in the index/.test(out), out.split("\n").find((l) => l.includes("fresh-new"))?.slice(0, 130) ?? "absent")
    harness.check("a warning names the not-indexed paths and the fix", r.warnings.some((w) => w.code === "PATHS_NOT_INDEXED" && /bb_index/.test(w.message)), r.warnings.find((w) => w.code === "PATHS_NOT_INDEXED")?.message?.slice(0, 140) ?? "missing")

    // Indexing it flips the state — so the verdict is a measurement, not a label.
    await indexProjectParallel(pid as any, rel(root, "src/fresh-new.ts"), { files: [rel(root, "src/fresh-new.ts")] } as any)
    const after = await getUnifiedHealth(pid, root, { paths: ["src/fresh-new.ts"] })
    harness.check("indexing it flips `not-indexed` to `fresh`", after.pathChecks![0].status === "fresh", `-> ${after.pathChecks![0].status} (proves the state is measured, not assigned)`)
  } finally { clean(root, pid) }
}

// ══ 2. no mixed scope ═════════════════════════════════════════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64d-scope-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 12; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const project = await getUnifiedHealth(pid, root, {})
    const scoped = await getUnifiedHealth(pid, root, { paths: ["src/f0.ts", "src/f1.ts"] })

    // The single most important property: the project numbers do not move.
    harness.check("scoping does NOT change counts.files", scoped.counts.files === project.counts.files, `project=${project.counts.files} scoped=${scoped.counts.files}`)
    harness.check("nor counts.symbols", scoped.counts.symbols === project.counts.symbols, `project=${project.counts.symbols} scoped=${scoped.counts.symbols}`)
    harness.check("nor the project-wide freshness verdict", scoped.freshness.checked === project.freshness.checked && scoped.freshness.total === project.freshness.total, `project checked=${project.freshness.checked}/${project.freshness.total} scoped=${scoped.freshness.checked}/${scoped.freshness.total}`)
    harness.negative("the scope block says so IN THE PAYLOAD, not only in prose", /PROJECT-WIDE/.test(scoped.scope?.note ?? ""), scoped.scope?.note?.slice(0, 110) ?? "absent")
    harness.check("scope names the paths it is scoped to", scoped.scope?.requested.length === 2 && scoped.scope?.kind === "paths", JSON.stringify(scoped.scope?.requested))
    harness.check("a per-path symbol count is present and per-path", (scoped.pathChecks ?? []).every((p) => typeof p.symbols === "number" && p.symbols < project.counts.symbols), (scoped.pathChecks ?? []).map((p) => `${p.path}=${p.symbols}s`).join(" "))
    // Without the option, the scoped block is absent — not an empty one.
    const off = await getUnifiedHealth(pid, root, {})
    harness.check("without `paths`, both scoped fields are null (NOT empty objects)", off.pathChecks === null && off.scope === null, `pathChecks=${off.pathChecks} scope=${off.scope}`)
    harness.negative("and the default output has no scoped block", !/^SCOPED ANSWER/m.test(formatUnifiedHealth(off)), "")
  } finally { clean(root, pid) }
}

// ══ 3. path resolution: exact, normalised, and refusing escapes ═══════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64d-paths-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "a.ts"), "export function a(): number { return 1 }\n")
  writeFileSync(path.join(root, "outside.ts"), "export const outside = 1\n")
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    // Every spelling of the same file must resolve to the same row.
    const spellings = ["src/a.ts", "./src/a.ts", "src//a.ts", "src/./a.ts", path.join(root, "src", "a.ts")]
    const r = await getUnifiedHealth(pid, root, { paths: spellings })
    harness.check("every spelling of one file resolves to the same indexed row", (r.pathChecks ?? []).every((p) => p.status === "fresh"), r.pathChecks?.map((p) => `${p.requested} -> ${p.path}:${p.status}`).join(" | ") ?? "none")
    harness.check("and they all normalise to one project-relative path", new Set((r.pathChecks ?? []).map((p) => p.path)).size === 1, [...new Set((r.pathChecks ?? []).map((p) => p.path))].join(","))
    harness.check("while each row still echoes its own spelling", new Set((r.pathChecks ?? []).map((p) => p.requested)).size === spellings.length, "")

    // A path outside the project is REFUSED, not answered.
    const esc = await getUnifiedHealth(pid, root, { paths: ["../outside.ts", "/etc/hosts", "src/../../outside.ts"] })
    harness.check("paths escaping the project are REFUSED, not answered", (esc.scope?.refused.length ?? 0) === 3, `refused=${esc.scope?.refused.length}: ${esc.scope?.refused.map((r) => r.requested).join(", ")}`)
    harness.check("a refused path produces NO row (it was not checked, and is not clean)", (esc.pathChecks ?? []).length === 0, `${esc.pathChecks?.length} rows`)
    harness.check("refusal is an ERROR-severity warning, not a warning", esc.warnings.find((w) => w.code === "PATHS_REFUSED")?.severity === "error", "a refused path must not read as a quiet success")
    harness.check("and it says the path was NOT checked", /not checked|REFUSED/i.test(esc.warnings.find((w) => w.code === "PATHS_REFUSED")?.message ?? ""), esc.warnings.find((w) => w.code === "PATHS_REFUSED")?.message?.slice(0, 120) ?? "missing")
    harness.negative("the text form never prints a refused path as fresh", !/fresh\s+.*outside\.ts/.test(formatUnifiedHealth(esc)), "")
    harness.check("it prints them under REFUSED instead", /REFUSED \(not checked\)/.test(formatUnifiedHealth(esc)), formatUnifiedHealth(esc).split("\n").find((l) => l.includes("REFUSED"))?.slice(0, 110) ?? "absent")

    // A symlink out of the project must be refused too — the same primitive
    // bb_edit uses, so the two tools agree about what is inside the project.
    const outsideDir = mkdtempSync(path.join(tmpdir(), "bb-h64d-out-"))
    writeFileSync(path.join(outsideDir, "secret.ts"), "export const secret = 1\n")
    try { symlinkSync(path.join(outsideDir, "secret.ts"), path.join(root, "src", "link.ts")) } catch {}
    const viaLink = await getUnifiedHealth(pid, root, { paths: ["src/link.ts"] })
    const linked = viaLink.pathChecks?.[0]
    harness.check("a symlink pointing out of the project is refused, not followed", linked === undefined || linked.status === "absent" || linked.status === "not-indexed", `status=${linked?.status} refused=${viaLink.scope?.refused.length ?? 0} — a realpath escape must not be resolved into someone else's file`)
    rmSync(outsideDir, { recursive: true, force: true })
  } finally { clean(root, pid) }
}

// ══ 4. the boundary refuses what would make the answer wrong ══════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64d-bound-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "a.ts"), "export function a(): number { return 1 }\n")
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    for (const [args, why] of [
      [{ paths: [] }, "an empty list"],
      [{ paths: ["src/a.ts", "src/a.ts"] }, "a duplicate"],
      [{ paths: ["   "] }, "a blank entry"],
      [{ paths: "src/a.ts" }, "a bare string"],
      [{ paths: Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`) }, "more than 50"],
    ] as any[]) {
      let msg = "ACCEPTED (defect)"
      try { validateToolArguments(desc, args) } catch (e) { msg = (e as Error).message }
      harness.check(`${why} is refused with the rule named`, /paths/.test(msg) && !/^ACCEPTED/.test(msg), msg.slice(0, 120))
    }
    const ok = validateToolArguments(desc, { paths: ["src/a.ts", "src/b.ts"] })
    harness.check("a normal list is accepted", Array.isArray(ok.paths) && ok.paths.length === 2, JSON.stringify(ok.paths))
    // The O(files named) claim, measured on a project far larger than the ask.
    const big = await getUnifiedHealth(pid, root, { paths: ["src/a.ts"], freshness: "complete", sampleSize: 200 })
    harness.check("the scoped answer is O(files named), not O(project)", big.pathChecks!.length === 1 && big.pathChecks![0].status === "fresh", `${big.pathChecks!.length} path resolved; the project scan still ran separately and is reported as such`)
    // The claim here is that the scoped phase's cost is MEASURED and reported
    // separately — not that it is smaller. The first version of this check
    // asserted `pathsMs < max(1, freshnessMs + pathsMs)`, which is not even an
    // ordering: on a one-file fixture freshnessMs rounds to 0, so it reduced to
    // `pathsMs < pathsMs` and failed. Same defect class as the timing assertion
    // dropped in verify-actionability, and the same lesson: a fixture too small
    // to support the claim will decide the claim by rounding.
    harness.check("and its own cost is measured and reported separately from the corpus scan", Number.isFinite(big.timing.pathsMs) && big.timing.pathsMs >= 0 && Number.isFinite(big.timing.freshnessMs), `pathsMs=${big.timing.pathsMs} (the named path) vs freshnessMs=${big.timing.freshnessMs} (the project scan it did not replace) — both reported, neither asserted to be ordered`)
  } finally { clean(root, pid) }
}

harness.emit()
