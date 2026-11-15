/**
 * `overrides` ENDPOINT FORM — does the bare-name endpoint cost ambiguity?
 *
 * ## Why this exists
 *
 * The lane's Contract row says every relationship type emits QUALIFIED PATHS on both ends,
 * with one declared fallback (`imports`, whose target is another FILE). `overrides` was found
 * emitting a BARE NAME on both ends — the last type to do so — by
 * `namespace-orphan-probe.ts`, which reported 9 `DEFECT-in-document-target` edges on
 * duckdb/data/json/11152.json while `census.ts` reported `overrides` at 100.00% resolution
 * and `incoming-check.ts` reported 0 unresolved and 0 ambiguous. Three instruments, three
 * answers, on the same files. This probe says which is right and by how much.
 *
 * The disagreement is explainable and the explanation is the finding: `census.ts` resolves
 * "by name OR qualifiedName" and `incoming-check.ts` resolves by name into a last-wins map,
 * so a bare target naming FOUR symbols still reads as 100% resolved and 0 ambiguous. Neither
 * instrument can see the ambiguity because both collapse the name to one symbol. This probe
 * counts the COLLISION SET instead of collapsing it.
 *
 * ## What it measures, per `overrides` edge
 *
 *   - how many published symbols the bare SOURCE name matches
 *   - how many the bare TARGET name matches
 *   - how many the qualified SOURCE path matches
 *   - how many the qualified TARGET path matches
 *
 * and whether the `contains` edges of the same document already publish that path, i.e.
 * whether a qualified endpoint is AVAILABLE or would have to be minted.
 *
 * ## No regex
 *
 * Tree-driven; it compares `symbol.name`, `symbol.qualifiedName` and edge endpoint strings for
 * equality. No pattern matching over any text.
 *
 * ## Chunking
 *
 * Per-repository child processes, the same shape `census.ts` uses. An in-process walk of the
 * whole population is not reproducible on this lane (docs/analyzers/json.md
 * limitation 9 — the WASM parse trap is a property of the RUN, not of any file), so the
 * population is walked in chunks that terminate.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/overrides-endpoint-probe.ts [--files N]
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_BYTES = 512 * 1024

type FileRow = { repo: string; dir: string; rel: string; abs: string }

const argv = process.argv.slice(2)
const argOf = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

interface Row {
  file: string
  source: string
  target: string
  /** The bare NAMES this edge would have carried, from the analyzer's own metadata. */
  bareSource: string
  bareTarget: string
  bareSourceCollisions: number
  bareTargetCollisions: number
  sourceCollisions: number
  targetCollisions: number
  targetIsPath: boolean
  sourceIsPath: boolean
  containsPublishesPath: boolean
}

/** Does this endpoint string name a SYMBOL rather than a position? Cheap and exact. */
function isPathLike(s: string, names: Set<string>): boolean {
  return !names.has(s)
}

async function childRun(manifest: string, outFile: string): Promise<void> {
  const files = JSON.parse(readFileSync(manifest, "utf8")) as string[]
  const rows: Row[] = []
  const overrideFiles = new Set<string>()
  let parseFailures = 0
  let symbols = 0

  for (const f of files) {
    let res: any
    try {
      res = await parseFile(f, "json")
    } catch {
      parseFailures++
      continue
    }
    const syms = (res.symbols ?? []) as any[]
    symbols += syms.length
    const rels = (res.relationships ?? []) as any[]
    const ovr = rels.filter((e) => e.type === "overrides")
    if (ovr.length === 0) continue
    overrideFiles.add(f)

    const byName = new Map<string, number>()
    const byPath = new Map<string, number>()
    for (const s of syms) {
      const n = String(s.name ?? "")
      const q = String(s.qualifiedName ?? "")
      byName.set(n, (byName.get(n) ?? 0) + 1)
      byPath.set(q, (byPath.get(q) ?? 0) + 1)
    }
    const names = new Set(byName.keys())

    // Does a `contains` edge in this same document already publish the target as a path?
    const containsPaths = new Set<string>()
    for (const e of rels) {
      if (e.type !== "contains") continue
      const p = (e.metadata as any)?.fullPath
      if (typeof p === "string") containsPaths.add(p)
    }

    for (const e of ovr) {
      const source = String(e.source ?? "")
      const target = String(e.target ?? "")
      const meta = (e.metadata ?? {}) as Record<string, unknown>
      // The bare NAMES, from the analyzer's own metadata when it publishes them, so this
      // probe compares the two endpoint FORMS against the same symbol set without
      // re-deriving either. Before the fix the endpoints were themselves the bare names.
      const bareSource = typeof meta.ownerName === "string" ? meta.ownerName : source
      const bareTarget = typeof meta.key === "string" ? meta.key : target
      rows.push({
        file: f.slice(CORPUS.length + 1),
        source,
        target,
        bareSource,
        bareTarget,
        bareSourceCollisions: byName.get(bareSource) ?? 0,
        bareTargetCollisions: byName.get(bareTarget) ?? 0,
        sourceCollisions: byPath.get(source) ?? 0,
        targetCollisions: byPath.get(target) ?? 0,
        targetIsPath: isPathLike(target, names),
        sourceIsPath: isPathLike(source, names),
        containsPublishesPath: containsPaths.has(target),
      })
    }
  }

  writeFileSync(
    outFile,
    JSON.stringify({ rows, overridesFiles: [...overrideFiles], parseFailures, symbols }),
  )
}

/**
 * The admitted population, enumerated exactly as `census.ts` enumerates it: per repository
 * directory under the corpus root, git-TRACKED files only, over the 512 KB cap, admitted by
 * the same `detectLanguageFromPath` test. The corpus ROOT is not itself a git repository, so
 * `git ls-files` has to be run per repository.
 */
function admitted(): FileRow[] {
  const out: FileRow[] = []
  for (const e of readdirSync(CORPUS).sort()) {
    const dir = join(CORPUS, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
        .sort()
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > MAX_BYTES) continue
        text = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs, text) !== "json") continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  out.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  return out
}

async function main(): Promise<void> {
  const manifestArg = argOf("--manifest", "")
  const outArg = argOf("--out", "")
  if (manifestArg && outArg) {
    await childRun(manifestArg, outArg)
    return
  }

  const LIMIT = Number(argOf("--files", "0"))
  const all = admitted()
  const files = (LIMIT > 0 ? all.slice(0, LIMIT) : all).map((r) => r.abs)

  console.log(`json overrides endpoint probe — ${files.length} admitted file(s)`)
  console.log(`corpus: ${CORPUS}`)

  const byRepo = new Map<string, string[]>()
  for (const f of files) {
    const repo = f.slice(CORPUS.length + 1).split("/")[0]
    const arr = byRepo.get(repo)
    if (arr) arr.push(f)
    else byRepo.set(repo, [f])
  }

  const dir = mkdtempSync(join(tmpdir(), "json-ovr-"))
  const outFile = join(dir, "child.json")
  const manifest = join(dir, "manifest.json")
  const rows: Row[] = []
  const overrideFiles = new Set<string>()
  let parseFailures = 0
  let symbolsTotal = 0

  for (const [, repoFiles] of [...byRepo.entries()].sort()) {
    writeFileSync(manifest, JSON.stringify(repoFiles))
    await new Promise<void>((resolve) => {
      const child = spawn(
        "npx",
        [
          "tsx",
          join(import.meta.dirname, "overrides-endpoint-probe.ts"),
          "--manifest",
          manifest,
          "--out",
          outFile,
        ],
        {
          stdio: ["ignore", "ignore", "ignore"],
          env: { ...process.env, BB_LOG_LEVEL: process.env.BB_LOG_LEVEL ?? "error" },
        },
      )
      child.on("exit", () => resolve())
    })
    if (!existsSync(outFile)) {
      parseFailures += repoFiles.length
      continue
    }
    const res = JSON.parse(readFileSync(outFile, "utf8")) as {
      rows: Row[]
      overridesFiles: string[]
      parseFailures: number
      symbols: number
    }
    rows.push(...res.rows)
    for (const f of res.overridesFiles) overrideFiles.add(f)
    parseFailures += res.parseFailures
    symbolsTotal += res.symbols
  }

  const n = rows.length
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0)
  const bareTgtAmb = rows.filter((r) => r.bareTargetCollisions > 1).length
  const pathTgtAmb = rows.filter((r) => r.targetCollisions > 1).length
  const bareSrcAmb = rows.filter((r) => r.bareSourceCollisions > 1).length
  const pathSrcAmb = rows.filter((r) => r.sourceCollisions > 1).length
  const bareTgtTotal = sum((r) => r.bareTargetCollisions)
  const pathTgtTotal = sum((r) => r.targetCollisions)

  console.log("")
  console.log(`admitted ${files.length}   parse failures ${parseFailures}   symbols in scope ${symbolsTotal}`)
  console.log(`files carrying overrides ${overrideFiles.size}   overrides edges ${n}`)
  console.log("")
  console.log("endpoint FORM")
  console.log("---------------------------------------------------------------")
  console.log(`target is a QUALIFIED PATH (the contract says all)  ${rows.filter((r) => r.targetIsPath).length} of ${n}`)
  console.log(`source is a QUALIFIED PATH                          ${rows.filter((r) => r.sourceIsPath).length} of ${n}`)
  console.log(`the document already publishes that target path     ${rows.filter((r) => r.containsPublishesPath).length} of ${n}`)
  console.log("")
  console.log("COLLISION SET — how many published symbols the endpoint matches")
  console.log("---------------------------------------------------------------")
  console.log(`target, BARE NAME   ambiguous ${bareTgtAmb} of ${n}   symbols matched in total ${bareTgtTotal}   mean ${(bareTgtTotal / (n || 1)).toFixed(2)}`)
  console.log(`target, PATH        ambiguous ${pathTgtAmb} of ${n}   symbols matched in total ${pathTgtTotal}   mean ${(pathTgtTotal / (n || 1)).toFixed(2)}`)
  console.log(`source, BARE NAME   ambiguous ${bareSrcAmb} of ${n}`)
  console.log(`source, PATH        ambiguous ${pathSrcAmb} of ${n}`)
  console.log("")
  const sets = [...new Set(rows.map((r) => r.targetCollisions))].sort((a, b) => a - b)
  console.log(`distinct target collision-set sizes under the path form: ${sets.join(", ")}`)
  console.log("(2 is the FLOOR for this edge type: the two declarations of one duplicated key")
  console.log(" share a name AND a qualified path, and only `overridesLine` tells them apart.)")

  const notable = rows.filter((r) => r.bareTargetCollisions > r.targetCollisions)
  if (notable.length) {
    console.log("")
    console.log("edges where the path form NARROWS the collision set:")
    for (const r of notable) {
      console.log(`  ${r.file}: ${r.bareSource} -> ${r.bareTarget}   bare=${r.bareTargetCollisions}  path=${r.targetCollisions}  (${r.target})`)
    }
  } else {
    console.log("")
    console.log("no edge had its target collision set narrowed by the path form")
  }

  console.log("")
  // Stated as measured. An earlier version of this string claimed the path form left every
  // collision set at exactly 2; the table above says otherwise (2, 3, 5 and 7 all occur), so
  // the claim was withdrawn rather than the table being re-read until it agreed.
  const narrowed = notable.length
  const verdict =
    pathTgtTotal < bareTgtTotal
      ? `PARTIAL. Source ambiguity is closed (${bareSrcAmb} -> ${pathSrcAmb} of ${n}). Target ambiguity is NOT closed: ${bareTgtAmb} of ${n} targets are ambiguous under the bare name and ${pathTgtAmb} of ${n} under the path, and the collision set shrinks only from ${bareTgtTotal} to ${pathTgtTotal} bindings, narrowing on ${narrowed} of ${n} edges. Two causes, both properties of the document: the two declarations of one duplicated key share a name AND a qualified path, and a key repeated across the top-level values of a CONCATENATED document shares one module-qualified path.`
      : `NO NARROWING of the target collision set: ${bareTgtTotal} -> ${pathTgtTotal} bindings over ${n} edges. Source ambiguity ${bareSrcAmb} -> ${pathSrcAmb}.`
  console.log(`VERDICT: ${verdict}`)
}

main()