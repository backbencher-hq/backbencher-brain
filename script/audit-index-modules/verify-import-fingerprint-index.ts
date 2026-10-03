/**
 * `import-resolution.ts`, `fingerprint.ts`, `project-index.ts` and the
 * `override-*.ts` trio have no behavioural gate. Four real defects, and two
 * places where the honest answer turned out to be "this module is not the one
 * that does that".
 *
 * THE DEFECTS
 * -----------
 * 1. `resolveSpecifierPath` CLAMPS `..` AT THE PROJECT ROOT instead of
 *    refusing it (import-resolution.ts:112-117: `out.pop()` on an empty array
 *    is a no-op). So a root-level `app.ts` importing `"../shared/b"` — a
 *    specifier that points OUTSIDE the project — normalizes to `shared/b`, and
 *    `buildImportResolutionIndex` then resolves it to a REAL file in the index.
 *    That is a fabricated cross-file edge: `bb_graph` and `bb_impact` report
 *    `app.ts -> shared/b.ts` as truth, and nothing flags it. The same clamp
 *    swallows `../../b` and `../../../escape` identically.
 *
 * 2. `INDEX_BASENAMES` contains `".cjs"` where every other entry is
 *    `"index.<ext>"` (import-resolution.ts:103). `candidatePaths` appends each
 *    entry to the base, so a directory whose entry point is `index.cjs`
 *    produces the candidate `bar/.cjs` — which never exists. `import "./bar"`
 *    from a file next to `bar/index.cjs` is unresolvable while `./foo` next to
 *    `foo/index.js` resolves.
 *
 * 3. `fingerprint.ts`'s walk does NOT mirror `ParallelIndexerConfig.skipPatterns`,
 *    so the fingerprint's file set is strictly LARGER than the indexed set and
 *    `computeDbFingerprint` never equals `computeCheckoutFingerprint`. The walk
 *    keeps its own `cliSkipPatterns` copy (fingerprint.ts:64-71, 16 entries)
 *    while discovery applies the 40+ entry `skipPatterns` at
 *    parallel-indexer.ts:1008. Measured on a 9-file fixture: the walk sees 9
 *    files, the index holds 3. `project-registry.ts:246-248` therefore can
 *    never adopt a DB that lacks the `codebase_fingerprint` column, silently.
 *
 *    This is the SAME defect fingerprint.ts:117-122 documents as already fixed
 *    ("the fingerprint stopped matching the indexed set and adoption silently
 *    never fired"), re-introduced through a different list.
 *
 * 4. `buildProjectIndexStreaming` never increments `index.stats.files`
 *    (project-index.ts:450-483), so it returns `{ files: 0, damaged: 0 }` for
 *    ANY corpus. Its docstring at :444-448 claims "the result is byte-identical
 *    to the collecting form". It is not. The collecting form counts; the
 *    streaming form also swallows a read error (`catch { continue }`, :467) and
 *    a parse error (`catch {}`, :472) without recording the shortfall, so a
 *    coverage figure built from it reads "0 files" for a project it just
 *    indexed completely.
 *
 * WHERE THE HONEST ANSWER IS "NOT THIS MODULE"
 * -------------------------------------------
 * `.gitignore`, size caps and symlink loops are NOT project-index.ts's job: it
 * takes an INJECTED list of already-parsed files and never touches the disk
 * walk (the `readTree`/parser injection is documented at :386-390). Discovery
 * is `parallel-indexer.discoverAndFilterFiles`. Asserting gitignore handling
 * here would be asserting a module that does not do it.
 *
 * WHAT IS SOUND (pinned green, because a gate that only lists defects is not
 * evidence of an audit)
 * ------------------------------------------------------
 * `planImportResolutions` CANNOT fabricate an edge to a symbol that does not
 * exist: it resolves only when the target file EXPORTS the wanted name
 * (:314-315) and that name is unique in the file (:317), and it declines
 * ambiguity rather than guessing (:274-291). Exercised below with a name the
 * file does not export, an ambiguous pair, a namespace import, and a default
 * import. `deserializeProjectIndex` returns null for every hostile shape.
 * `localEdgeLabel` / `findDeclaringParent` are cycle-safe.
 *
 * Run: npx tsx script/audit-index-modules/verify-import-fingerprint-index.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA = mkdtempSync(path.join(tmpdir(), "a3-auditidx-"))
process.env.BB_DATA_DIR = DATA

let green = 0
const red: string[] = []
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { green++; console.log(`  ok    ${name}${detail ? `  ${detail}` : ""}`) }
  else { red.push(name); console.log(`  RED   ${name}${detail ? `  ${detail}` : ""}`) }
}

const imports = await import(path.join(ROOT, "src/ast/import-resolution.ts")) as any
const fp = await import(path.join(ROOT, "src/ast/fingerprint.ts")) as any
const pi = await import(path.join(ROOT, "src/ast/project-index.ts")) as any
const octx = await import(path.join(ROOT, "src/ast/override-context.ts")) as any

try {
  console.log("── GREEN: import-resolution normalises the ordinary cases ──")
  {
    ok("`./b` from src/a.ts", imports.resolveSpecifierPath("src/a.ts", "./b") === "src/b")
    ok("`../b` from src/a.ts", imports.resolveSpecifierPath("src/a.ts", "../b") === "b")
    ok("a bare scoped package is not a project path", imports.resolveSpecifierPath("src/a.ts", "@scope/pkg") === null)
    ok("a node builtin is not a project path", imports.resolveSpecifierPath("src/a.ts", "node:fs") === null)
    ok("an empty specifier is refused", imports.resolveSpecifierPath("src/a.ts", "") === null)

    // Directory-index resolution, with the importer in src/ so `./foo` = src/foo.
    const files = [
      { fileId: "imp", relativePath: "src/imp.ts" },
      { fileId: "j1", relativePath: "src/foo/index.js" },
      { fileId: "m1", relativePath: "src/baz/index.mjs" },
      { fileId: "t1", relativePath: "src/qux/index.ts" },
      { fileId: "c1", relativePath: "src/bar/index.cjs" },
    ]
    const idx = imports.buildImportResolutionIndex(files, [], ["./foo", "./baz", "./qux", "./bar"].map((importPath) => ({ fileId: "imp", importPath })), []) as any
    ok("`./foo` finds src/foo/index.js", (idx.pathTargets.get("./foo") ?? new Set()).has("j1"))
    ok("`./baz` finds src/baz/index.mjs", (idx.pathTargets.get("./baz") ?? new Set()).has("m1"))
    ok("`./qux` finds src/qux/index.ts", (idx.pathTargets.get("./qux") ?? new Set()).has("t1"))
    ok("GREEN/DOCUMENTED: `.d.ts` entry points are not probed — discovery never indexes them",
      (idx.pathTargets.get("./qux") ?? new Set()).size === 1)
  }

  console.log("\n── RED: `..` is clamped at the root instead of refused (import-resolution.ts:112-117) ──")
  {
    for (const [importer, spec, why] of [
      ["a.ts", "../shared/b", "root-level importer climbs out of the project"],
      ["a.ts", "../b", "root-level importer, one level"],
      ["a.ts", "../../b", "root-level importer, two levels"],
      ["src/deep/a.ts", "../../../escape", "escapes two levels and clamps"],
    ] as const) {
      const got = imports.resolveSpecifierPath(importer, spec)
      ok(`${why}: \`${spec}\` from \`${importer}\` is REFUSED (null), not clamped`, got === null, `got ${JSON.stringify(got)}`)
    }

    // The consequence, which is the part that reaches the graph: a clamped path
    // that names a REAL file in the index becomes a resolved edge.
    const files = [
      { fileId: "app", relativePath: "app.ts" },
      { fileId: "shb", relativePath: "shared/b.ts" },
    ]
    const idx = imports.buildImportResolutionIndex(files, [], [{ fileId: "app", importPath: "../shared/b" }], []) as any
    const hit = [...(idx.pathTargets.get("../shared/b") ?? [])]
    ok(
      "an out-of-project specifier resolves to NO file (no fabricated cross-file edge)",
      hit.length === 0,
      hit.length ? `resolved to ${JSON.stringify(hit)} = shared/b.ts — bb_graph would report app.ts -> shared/b.ts as truth` : "",
    )
  }

  console.log("\n── RED: INDEX_BASENAMES has \".cjs\" instead of \"index.cjs\" (import-resolution.ts:103) ──")
  {
    const files = [
      { fileId: "imp", relativePath: "src/imp.ts" },
      { fileId: "c1", relativePath: "src/bar/index.cjs" },
    ]
    const idx = imports.buildImportResolutionIndex(files, [], [{ fileId: "imp", importPath: "./bar" }], []) as any
    ok("`./bar` finds src/bar/index.cjs", (idx.pathTargets.get("./bar") ?? new Set()).has("c1"),
      `the probe list is ["index.js","index.mjs",".cjs","index.ts","index.tsx","index.jsx"] — the 3rd entry yields src/bar/.cjs`)
  }

  console.log("\n── GREEN: planImportResolutions cannot fabricate an edge ──")
  {
    const files = [
      { fileId: "f1", relativePath: "src/t.ts" },
      { fileId: "f2", relativePath: "src/amb.ts" },
      { fileId: "f3", relativePath: "lib/amb.ts" },   // SAME tail as f2 -> ambiguous
    ]
    const symbols = [
      { fileId: "f1", name: "real", symbolId: "S_REAL" },
      { fileId: "f1", name: "internal", symbolId: "S_INTERNAL" },   // exists but NOT exported
      { fileId: "f2", name: "shared", symbolId: "S_A" },
      { fileId: "f3", name: "shared", symbolId: "S_B" },
    ]
    const exportsOf = [
      { fileId: "f1", name: "real" },
      { fileId: "f2", name: "shared" },
      { fileId: "f3", name: "shared" },
    ]
    const idx = imports.buildImportResolutionIndex(files, symbols, [], exportsOf) as any
    const row = (id: string, targetExternal: string, metadata?: any) => ({ id, target_external: targetExternal, metadata })
    const planned = (rows: any[]) => imports.planImportResolutions(rows, idx)
    const known = new Set(["S_REAL", "S_INTERNAL", "S_A", "S_B"])

    ok("a name the target file does not EXPORT is declined (not joined)",
      planned([row("r1", "src/t:internal")]).length === 0, "the `exportsByFile.has(wanted)` gate at import-resolution.ts:314-315")
    ok("a name the target file DOES export resolves",
      planned([row("r2", "src/t:real")])[0]?.symbolId === "S_REAL")
    ok("an ambiguous two-file target (src/amb.ts + lib/amb.ts) is DECLINED, never guessed",
      planned([row("r3", "src/amb:shared")]).length === 0, "the refusal at :274-291")
    ok("a namespace import (`*`) is declined", planned([row("r4", "src/t:*")]).length === 0)
    ok("a `path:item` with no colon component is declined",
      planned([row("r5", "nocolon")]).length === 0)
    for (const p of planned([row("r6", "src/t:real"), row("r7", "src/t:internal")])) {
      ok(`every planned resolution names a REAL symbol (${p.symbolId})`, known.has(p.symbolId))
    }
    ok("no planned resolution ever names an unknown symbol id",
      planned([row("r8", "src/t:real"), row("r9", "src/amb:shared"), row("rA", "src/t:*"), row("rB", "src/t:ghost")])
        .every((p) => known.has(p.symbolId)))
  }

  console.log("\n── RED: the fingerprint walk does not mirror discovery (fingerprint.ts:64-71) ──")
  {
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const root = mkdtempSync(path.join(tmpdir(), "a3-auditfp-"))
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(path.join(root, "package.json"), '{"name":"x"}\n')
    writeFileSync(path.join(root, "src", "app.ts"), "export function app(){ return 1 }\n")
    writeFileSync(path.join(root, "src", "util.ts"), "export const u = 1\n")
    // One file per rule DISCOVERY applies and the walk does not.
    const divergent: Record<string, string> = {
      "src/generated/api.ts": "export function gen(){}\n",
      "schema.json": '{"a":1}\n',
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "types/api.d.ts": "export declare function f(): void\n",
      "bower_components/a.js": "module.exports=1\n",
      "src/out/gen.ts": "export const o=1\n",
    }
    for (const [rel, body] of Object.entries(divergent)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), body)
    }
    const pid = "a3-auditfp"
    await indexProjectParallel(pid as any, root, {})
    const raw = await BrainDatabase.getRawInstance(pid)
    const indexed = new Set((raw.prepare("SELECT relative_path FROM brain_file").all() as any[]).map((r) => String(r.relative_path)))
    const checkout = await fp.computeCheckoutFingerprint(root)

    for (const rel of Object.keys(divergent)) {
      ok(`the walk EXCLUDES \`${rel}\` (discovery skips it, so the fingerprint must not carry it)`,
        !indexed.has(rel) ? true : false,
        `brain_file has it? ${indexed.has(rel)}`)
    }
    const dbFp = fp.computeDbFingerprint(raw, checkout.git)
    ok(
      "computeDbFingerprint === computeCheckoutFingerprint (the adoption invariant)",
      dbFp === checkout.fingerprint,
      `db=${dbFp} checkout=${checkout.fingerprint} — indexed=${indexed.size} files, walk saw ${checkout.fileCount}`,
    )
    ok(
      "the walk's file COUNT matches the indexed file count",
      checkout.fileCount === indexed.size,
      `walk ${checkout.fileCount} vs indexed ${indexed.size}`,
    )
    // Direction 2: does the fingerprint move when nothing changed?
    const again = await fp.computeCheckoutFingerprint(root)
    ok("re-running the fingerprint on an unchanged tree is stable", again.fingerprint === checkout.fingerprint)
    // Direction 3: does it move when a file the INDEX ignores is added? It must not.
    writeFileSync(path.join(root, "schema2.json"), '{"b":2}\n')
    const after = await fp.computeCheckoutFingerprint(root)
    ok(
      "adding a file discovery skips does NOT move the fingerprint",
      after.fingerprint === checkout.fingerprint,
      after.fingerprint === checkout.fingerprint ? "" : "the walk counts files the indexer will never index",
    )
    rmSync(root, { recursive: true, force: true })
  }

  console.log("\n── RED: buildProjectIndexStreaming reports zero files (project-index.ts:450-483) ──")
  {
    const wasm = path.join(ROOT, "wasm", "tree-sitter-python.wasm")
    if (!existsSync(wasm)) {
      console.log(`  SKIP  tree-sitter python wasm not present at ${wasm}`)
    } else {
      const dir = mkdtempSync(path.join(tmpdir(), "a3-pidx-"))
      // Python source against the Python grammar and the PYTHON spec: the spec
      // matches `class_definition`, so the fixture must actually contain classes
      // or every comparison below passes vacuously on an empty index.
      const a = path.join(dir, "a.py")
      writeFileSync(a, "class Alpha:\n    def m(self):\n        return 1\n\nclass Beta(Alpha):\n    def m(self):\n        return 2\n")
      const b = path.join(dir, "b.py")
      writeFileSync(b, "def top_level():\n    return 3\n\nclass Gamma:\n    pass\n")
      const collecting = await pi.buildProjectIndexFromDisk(wasm, [a, b], pi.PYTHON_DECLARATION_SPEC)
      const streaming = await pi.buildProjectIndexStreaming(wasm, [a, b], pi.PYTHON_DECLARATION_SPEC)
      ok("GREEN: the fixture actually declares something (so the comparison is not vacuous)",
        collecting.typeKinds.size >= 3,
        `typeKinds=${JSON.stringify([...collecting.typeKinds])}`)
      ok("streaming stats.files equals the number of files indexed (2)", streaming.stats?.files === 2,
        `got ${JSON.stringify(streaming.stats)} — the collecting form reports ${JSON.stringify(collecting.stats)}`)
      ok("streaming stats match the collecting form, as its docstring claims",
        JSON.stringify(streaming.stats) === JSON.stringify(collecting.stats),
        `streaming ${JSON.stringify(streaming.stats)} vs collecting ${JSON.stringify(collecting.stats)}`)
      // The declaration CONTENT agrees; only the accounting differs.
      ok("the recorded declarations agree between the two forms",
        [...streaming.typeKinds].sort().join(",") === [...collecting.typeKinds].sort().join(",") &&
        [...streaming.symbolNames].sort().join(",") === [...collecting.symbolNames].sort().join(","),
        `types ${JSON.stringify([...streaming.typeKinds])}, names ${JSON.stringify([...streaming.symbolNames])}`)
      // A file that cannot be read must not vanish without a trace.
      const withMissing = await pi.buildProjectIndexStreaming(wasm, [a, path.join(dir, "gone.py")], pi.PYTHON_DECLARATION_SPEC)
      ok("streaming records a file it could not read (no silent shortfall)",
        (withMissing.stats?.files ?? 0) === 2,
        `stats=${JSON.stringify(withMissing.stats)} — the collecting form throws ENOENT on the same input`)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  console.log("\n── GREEN: project-index and override-context on hostile input ──")
  {
    for (const [label, raw2] of [["null", null], ["a string", "nope"], ["an array", []], ["a number", 7], ["{typeKinds:1}", { typeKinds: 1 }], ["{} proto poison", JSON.parse('{"__proto__":{"x":1}}')]] as any[]) {
      ok(`deserializeProjectIndex(${label}) returns null`, pi.deserializeProjectIndex(raw2) === null)
    }
    ok("buildResolutionTables over an empty index does not throw",
      pi.buildResolutionTables(pi.emptyProjectIndex()) !== null)
    ok("localEdgeLabel drops empty segments", octx.localEdgeLabel("Foo.") === "Foo")
    ok("localEdgeLabel strips call arguments", octx.localEdgeLabel("X.foo(String)") === "X.foo")
    ok("localEdgeLabel on an empty fqn returns \"\"", octx.localEdgeLabel("") === "")
    const companion = new Map([["Base", new Set(["m"])]])
    ok("findDeclaringParent finds the declaring ancestor",
      octx.findDeclaringParent("m", ["Child"], companion, () => ["Base"]) === "Base")
    ok("findDeclaringParent returns null when no ancestor declares it",
      octx.findDeclaringParent("zzz", ["Child"], companion, () => ["Base"]) === null)
    // A cycle in the hierarchy must terminate.
    ok("findDeclaringParent terminates on a cyclic hierarchy",
      octx.findDeclaringParent("m", ["A"], new Map(), (t: string) => (t === "A" ? ["B"] : ["A"])) === null)
  }

  console.log(`\n${green}/${green + red.length} checks green; ${red.length} RED`)
  if (red.length) { console.log(`RED: ${red.join(" | ")}`); process.exitCode = 1 }
} finally {
  try { rmSync(DATA, { recursive: true, force: true }) } catch {}
}