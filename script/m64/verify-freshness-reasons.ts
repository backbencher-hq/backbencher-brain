// script/m64/verify-freshness-reasons.ts — M64.R.
//
// "215 stale" is not actionable. It is three conditions with three different
// fixes, and the resolver has always computed which is which — bb_health read
// `.statuses` and discarded `.reasons`, so the tool reported one undifferentiated
// number and offered one remedy for all of it.
//
// The map before this change, on a 6-file fixture with one edit, one delete and
// one permission loss:
//
//   hash-differs         src/f0.ts, src/f2.ts   (edited  -> reindex those two)
//   file-gone            src/f1.ts              (deleted -> a pruning refresh)
//   metadata-fast-path   src/f3..f5.ts          (unchanged, never read)
//
// The gate is adversarial by construction. A breakdown that renders correctly on
// a clean index proves nothing; the categories that matter are the ones a clean
// index never produces. Per the m13 Harness rule, positive-only fixtures cap at
// `partial`, so the cases below are the point of the file.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync, utimesSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { resolveRowsFreshnessDetailed, ROW_FRESHNESS_REASONS } from "../../src/brain/freshness"

const harness = new Harness({
  issue: "M64",
  code: "H64r",
  tool: "bb_health",
  title: "bb_health freshness reasons: every category reachable, distinguishable, and reconciling with the headline",
  layers: ["unit", "integration"],
  decisions: {
    vocabulary: "RowFreshnessReason is exported and typed at the resolver; a tally cannot be published without it",
    freshSplit: "hash-match and metadata-fast-path are reported apart — one read the bytes, one did not",
    limitation: "the metadata fast path's error bound is stated on the LINE, not only in a source comment",
    placement: "the mix is in the DEFAULT output, not verbose: the defect is that the number is unactivable by default",
    reconciliation: "reasons nest under status and must sum to `checked` exactly once",
  },
  limitations: [
    "The unreadable case is produced with chmod, which does not restrict root — on a runner that ignores file modes the case degrades to a read that succeeds. The gate asserts the category is REACHABLE, not that it occurs on every platform.",
  ],
})

const rows = async (pid: string) => {
  const raw = await BrainDatabase.getRawInstance(pid as any)
  return raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id=? ORDER BY relative_path, id").all(pid) as any[]
}
const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

// ══ 1. every category is reachable and distinct ═══════════════════════════
// A clean index produces ONE category. The five others have to be manufactured,
// and each has to come back as itself rather than as a neighbour.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64r-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const N = 8
  for (let i = 0; i < N; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const all = await rows(pid)
    // f0 edited (content differs), f1 deleted, f2 chmod 000 (unreadable),
    // f3 preserved-content but forced off the fast path so the HASH is read,
    // f4..f7 untouched.
    const abs = (n: number) => path.join(root, "src", `f${n}.ts`)
    writeFileSync(abs(0), readFileSync(abs(0), "utf8") + "\n// edited\n")
    rmSync(abs(1))
    try { chmodSync(abs(2), 0o000) } catch {}

    const res = resolveRowsFreshnessDetailed(await BrainDatabase.getRawInstance(pid as any), pid, all.map((r) => ({ fileId: r.id })), { freshnessMode: "complete" })
    const byPath = (n: number) => res.reasons.get(all[n].id)
    const byName = new Map(all.map((r, i) => [r.relative_path, i]))

    harness.check("an edited file is `hash-differs`", byPath(0) === "hash-differs", `f0 -> ${byPath(0)}`)
    harness.check("a deleted file is `file-gone`", byPath(1) === "file-gone", `f1 -> ${byPath(1)}`)
    harness.check("an untouched file is `metadata-fast-path`", byPath(7) === "metadata-fast-path", `f7 -> ${byPath(7)}`)
    // f2: reaching `unreadable` takes TWO things, and the first attempt at this
    // gate only did one. chmod 000 alone returns `metadata-fast-path`, because
    // the fast path is decided by a stat and never opens the file — so the
    // permission loss is real and the verdict is still fast-path fresh. The mtime
    // has to be pushed too, so the read is actually attempted and actually
    // fails. That is the category working as designed, and it is worth stating:
    // an unreadable file can be reported fresh without this being noticed.
    const f2stat = statSync(abs(2))
    utimesSync(abs(2), f2stat.atime, new Date(f2stat.mtimeMs + 5_000))
    const res3 = resolveRowsFreshnessDetailed(await BrainDatabase.getRawInstance(pid as any), pid, all.map((r) => ({ fileId: r.id })), { freshnessMode: "complete" })
    const f2 = res3.reasons.get(all[2].id)
    harness.check("an unreadable file is `unreadable` (needs BOTH a mode change and a missed fast path)", f2 === "unreadable" || f2 === "hash-match", `f2 -> ${f2}; chmod 000 alone yields ${byPath(2)} because the stat still matches and the file is never opened`)
    harness.check("and it is reported MISSING, never fresh", f2 === "unreadable" ? res3.statuses.get(all[2].id) === "missing" : true, `status -> ${res3.statuses.get(all[2].id)}`)

    // `hash-match` needs the fast path to miss while the content is identical:
    // touch the mtime only. Same bytes, different mtime -> the file is read and
    // found unchanged. This is the case that makes the two fresh verdicts
    // distinguishable, and it is the whole reason for splitting them.
    const st = statSync(abs(6))
    utimesSync(abs(6), st.atime, new Date(st.mtimeMs + 5_000))
    const res2 = resolveRowsFreshnessDetailed(await BrainDatabase.getRawInstance(pid as any), pid, all.map((r) => ({ fileId: r.id })), { freshnessMode: "complete" })
    const f6 = res2.reasons.get(all[6].id)
    harness.check("a same-content file with a changed mtime is `hash-match` — the bytes were actually read", f6 === "hash-match", `f6 -> ${f6} (touched mtime only, content identical; this is what separates the two 'fresh' verdicts)`)
    harness.check("and it is reported FRESH, not stale", res2.statuses.get(all[6].id) === "fresh", `status -> ${res2.statuses.get(all[6].id)}`)
    harness.negative("the two fresh kinds are genuinely different categories", f6 !== byPath(7), `f6=${f6} vs f7=${byPath(7)}`)

    // `no-row` is the sixth category and the resolver's own bookkeeping: an id
    // with no DB row. Reachable through the public API by asking about a file
    // that was never indexed.
    const ghost = resolveRowsFreshnessDetailed(await BrainDatabase.getRawInstance(pid as any), pid, [{ fileId: "not-a-real-file-id" }], { freshnessMode: "complete" })
    harness.check("an id with no index row is `no-row`", ghost.reasons.get("not-a-real-file-id") === "no-row", `-> ${ghost.reasons.get("not-a-real-file-id")}`)

    // Every category in the exported vocabulary is one the resolver can emit.
    const emitted = new Set<string>([...res.reasons.values(), ...res2.reasons.values(), ...res3.reasons.values(), ...ghost.reasons.values()])
    const missing = ROW_FRESHNESS_REASONS.filter((r) => !emitted.has(r))
    harness.check("every category in the exported vocabulary is REACHABLE", missing.length === 0, `unreached: ${missing.join(", ") || "none"}`)
    void byName
  } finally { clean(root, pid) }
}

// ══ 2. the published breakdown reconciles with the headline ════════════════
// The precise failure this review exists to prevent: a breakdown that does not
// add up to the number printed above it. Reasons NEST under status, so they
// partition `checked` exactly once.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64r2-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 12; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const abs = (n: number) => path.join(root, "src", `f${n}.ts`)
    writeFileSync(abs(0), readFileSync(abs(0), "utf8") + "\n// edit\n")
    rmSync(abs(1))
    const r = await getUnifiedHealth(pid, root, { freshness: "complete" })
    const f = r.freshness
    const k = f.reasons.byKind

    harness.check("reasons + unclassified == checked, exactly once", Object.values(k).reduce((a, b) => a + b, 0) + f.unresolved === f.checked, `reasons=${Object.values(k).reduce((a, b) => a + b, 0)} unresolved=${f.unresolved} checked=${f.checked}`)
    harness.check("fresh == hash-match + metadata-fast-path", f.fresh === k["hash-match"] + k["metadata-fast-path"], `fresh=${f.fresh} vs ${k["hash-match"]}+${k["metadata-fast-path"]}`)
    harness.check("stale == hash-differs", f.stale === k["hash-differs"], `stale=${f.stale} vs ${k["hash-differs"]}`)
    harness.check("missing == file-gone + unreadable + no-row", f.missing === k["file-gone"] + k["unreadable"] + k["no-row"], `missing=${f.missing} vs ${k["file-gone"]}+${k["unreadable"]}+${k["no-row"]}`)
    harness.check("the two fresh splits are exposed, and they are the counts", f.reasons.freshVerifiedByContent === k["hash-match"] && f.reasons.freshVerifiedByMetadata === k["metadata-fast-path"], `content=${f.reasons.freshVerifiedByContent} metadata=${f.reasons.freshVerifiedByMetadata}`)
    harness.check("every category key is present, even at zero", ROW_FRESHNESS_REASONS.every((x) => typeof k[x] === "number"), Object.keys(k).join(","))
    harness.check("a complete scan is not marked as a sample", f.reasons.isSample === false, `isSample=${f.reasons.isSample}`)
    harness.check("the edited and deleted counts are real", k["hash-differs"] === 1 && k["file-gone"] === 1, `hash-differs=${k["hash-differs"]} file-gone=${k["file-gone"]}`)
  } finally { clean(root, pid) }
}

// ══ 3. the mix is legible, and honest about the fast path ══════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64r3-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 10; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const abs = (n: number) => path.join(root, "src", `f${n}.ts`)
    writeFileSync(abs(0), readFileSync(abs(0), "utf8") + "\n// edit\n")
    rmSync(abs(1))

    const full = formatUnifiedHealth(await getUnifiedHealth(pid, root, { freshness: "complete" }))
    const why = full.split("\n").find((l) => l.startsWith("freshness why:"))!
    harness.check("the default output carries the reason mix (not verbose-only)", !!why, why.slice(0, 120))
    harness.check("it names the content change", /1 stale: content changed/.test(why), why.slice(0, 160))
    harness.check("it names the deletion, with its different remedy", /1 missing: deleted from disk/.test(why), "")
    harness.check("it states the fast path's error bound ON THE LINE", /file not read/.test(why) && /same-size edit/.test(why), why.match(/fresh by mtime\+size only[^;]*/)?.[0]?.slice(0, 120) ?? "absent")
    harness.negative("and does not present a bare `N fresh` as if the bytes were read", !/\b10 fresh\b/.test(why), "the fast-path count must be attributed, not merged into 'fresh'")

    // The warning a caller reads to decide WHAT TO DO must carry the mix too.
    const warn = (await getUnifiedHealth(pid, root, { freshness: "complete" })).warnings.find((w) => w.code === "STALE_FILES")!
    harness.check("the STALE_FILES warning names the mix", /1 changed on disk, 1 deleted from disk/.test(warn.message), warn.message.slice(0, 140))

    // A sampled report must mark ITS OWN breakdown as a sample. Publishing an
    // estimate of the reason mix as though it were the project's would repeat
    // the exact defect this file exists to remove.
    const sampled = formatUnifiedHealth(await getUnifiedHealth(pid, root, { freshness: "sampled", sampleSize: 4 }))
    const sampledWhy = sampled.split("\n").find((l) => l.startsWith("freshness why:"))!
    harness.check("a SAMPLED breakdown says it is a sample", /over the 4-file SAMPLE/.test(sampledWhy), sampledWhy.slice(0, 150))
    harness.check("and a complete one does not claim to be a sample", !/SAMPLE/.test(why), "")

    // A clean index must still render a mix rather than an empty line. The
    // first version of this check wrote f0's content back to itself and called
    // the index clean — which it was not, because rewriting a file changes its
    // mtime and so leaves it stale. The check passed for the wrong reason on its
    // way to failing for the right one, which is the same "assert on a fixture
    // you did not actually establish" mistake twice in one file.
    await indexProjectParallel(pid as any, root, { isIncremental: true })
    const cleanIdx = await getUnifiedHealth(pid, root, { freshness: "complete" })
    harness.check("a reindexed index is genuinely clean", cleanIdx.freshness.stale === 0 && cleanIdx.freshness.missing === 0, `stale=${cleanIdx.freshness.stale} missing=${cleanIdx.freshness.missing} (deleting f1 back out of the index is the indexer's job, not this gate's)`)
    const cleanWhy = formatUnifiedHealth(cleanIdx).split("\n").find((l) => l.startsWith("freshness why:"))!
    // Match the RENDERED wording, not the category keys. The split is
    // deliberate: `freshness.reasons.byKind` is the machine vocabulary a
    // consumer branches on, and the text line is prose a human reads. A first
    // version of this check grepped for `metadata-fast-path` in the text and
    // failed, because the text says "fresh by mtime+size only" — which is the
    // right rendering, and the mismatch is the point.
    harness.check("a clean index still renders a reason mix in prose, not category keys", /fresh by (mtime\+size only|content hash)/.test(cleanWhy) && !/metadata-fast-path/.test(cleanWhy), cleanWhy.slice(0, 130))
    harness.check("and the prose still attributes the fast path rather than saying 'fresh'", /file not read/.test(cleanWhy), "")
  } finally { clean(root, pid) }
}

harness.emit()
