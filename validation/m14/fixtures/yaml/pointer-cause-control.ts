// POINTER-CAUSE CONTROL — the reason a pointer misses must be TRUE, and it must be able to fire.
//
// WHY IT EXISTS. `resolvePointerReferences` reported every miss as
// `pointer-not-declared-in-file`. That string is a claim about the DOCUMENT, and over the whole
// corpus it was false for 729 of 762 unresolved pointer edges: docker's `api/docs/*.yaml` declare
// the pointers (`v1.25.yaml` has `definitions:` and `MountType:`; Python's parser reads 51
// definitions from it) but the pinned grammar ERROR-recovers on a quoted scalar, so the pointer
// index is built from a tree whose paths the document does not have.
//
// A reason string is not checkable by reading source, so this probe runs the PRODUCTION path
// (`pool-worker.parseFile`) over two files and pins BOTH directions:
//   * a CLEAN document whose pointer is genuinely absent -> `pointer-not-declared-in-file`
//   * a document the grammar cannot parse            -> `parse-error-in-document`
// and it asserts `hasError` for each input through the engine's own parser, so a probe that
// silently stopped exercising the error path fails instead of passing.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/pointer-cause-control.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)

const ROOT = join(REPO, ".tmp-yaml", "pointer-cause-control")
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })

// (a) CLEAN: valid YAML, and the `$ref` names a pointer the document does not declare.
const CLEAN = `definitions:
  Present:
    type: string
paths:
  x:
    $ref: "#/definitions/Absent"
`
// (b) ERROR-RECOVERED: the SAME clean shape plus the construct the pinned grammar rejects — a
//     double-quoted scalar whose continuation line is under-indented, taken from docker's
//     `api/docs/v1.25.yaml` where it makes the whole document an ERROR. Python's YAML parser
//     reads both files; the point is the GRAMMAR's behaviour, not the document's validity.
const BROKEN = `definitions:
  Present:
    type: string
    description: "a quoted scalar whose continuation
  is under-indented."
paths:
  x:
    $ref: "#/definitions/Absent"
`
writeFileSync(join(ROOT, "clean.yaml"), CLEAN)
writeFileSync(join(ROOT, "broken.yaml"), BROKEN)

const parser = await getParser("yaml")
const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}

for (const [file, wantError, wantReason] of [
  ["clean.yaml", false, "pointer-not-declared-in-file"],
  ["broken.yaml", true, "parse-error-in-document"],
] as const) {
  const abs = join(ROOT, file)
  // THE PRECONDITION, measured with the engine's own parser: if the malformed input ever stops
  // producing an ERROR, this control fails rather than quietly asserting the happy path twice.
  const pr = await parser.parse(await (await import("node:fs/promises")).readFile(abs, "utf8"), abs)
  check(`${file}: engine reports hasError=${wantError}`, pr.rootNode.hasError, wantError)
  const res = await parseFile(abs, ROOT, { projectRoot: ROOT })
  const missing = (res?.relationships ?? []).filter(
    (e) => e.metadata?.relationshipType === "yaml_json_pointer" && e.metadata?.resolved !== true,
  )
  check(`${file}: one unresolved pointer edge`, missing.length, 1)
  check(`${file}: reason is truthful`, missing[0]?.metadata?.unresolvedReason, wantReason)
  check(`${file}: confidenceReason agrees`, missing[0]?.metadata?.confidenceReason, wantReason)
  check(`${file}: metadata.parseHadError is recorded`, res?.metadata?.parseHadError, undefined)
}

// 5. THE RECOVERY FALLBACK, pinned on the file that found it. A minimal synthetic reproducer for
//    the FLATTENING was not found — two small malformed documents both recover locally and keep
//    their `definitions` level — so the control uses the corpus file the defect was measured on.
//    That is deliberate: this is the input whose tree really does hoist, and a control that pins
//    the real case is worth more than one that pins a shape I invented.
//
//    What it asserts: the tree has an ERROR; the pointers resolve anyway; the resolutions are
//    marked with their provenance rather than posing as exact hits; and the ONE pointer whose
//    declaration the file does not publish at all is NOT force-resolved — the fallback refuses
//    rather than fabricating a binding.
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DOCKER = join(CORPUS, "docker", "api", "docs", "v1.25.yaml")
if (!existsSync(DOCKER)) {
  console.log(`  SKIP  corpus file not present: ${DOCKER}`)
} else {
  const pr = await parser.parse(await (await import("node:fs/promises")).readFile(DOCKER, "utf8"), DOCKER)
  check("docker v1.25.yaml: the tree really does carry an ERROR", pr.rootNode.hasError, true)
  const res = await parseFile(DOCKER, join(CORPUS, "docker"), { projectRoot: join(CORPUS, "docker") })
  const refs = (res?.relationships ?? []).filter((e) => e.metadata?.relationshipType === "yaml_json_pointer")
  const recovered = refs.filter((e) => e.metadata?.resolvedVia === "document-shape-suffix")
  const unresolved = refs.filter((e) => e.metadata?.resolved !== true)
  check("...and 36 pointer edges are emitted", refs.length, 36)
  check("...35 of them resolve (was 0 before the fallback)", refs.length - unresolved.length, 35)
  check("...all 35 by the recovered-tree path, named as such", recovered.length, 35)
  check("...and the one the file does not publish stays UNRESOLVED", unresolved.length, 1)
  check("...which is the declaration the file really lacks", String(unresolved[0]?.target), "#/definitions/EndpointSpec")
}

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
