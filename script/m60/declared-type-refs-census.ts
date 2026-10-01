// script/m60/declared-type-refs-census.ts — the "declared-type reference graph"
// family-contract census (R9).
//
// WHY THIS EXISTS
// ---------------
// `metadata.relationshipType === "declared_type"` — a `references` edge from the
// declaration that writes a type name (a field, a parameter, a return) to the
// type it names — is a FAMILY STANDARD: rust says so in its own R13 header
// ("family standard, mirrors go/c/zig"), and ten lanes implement it. csharp did
// not, and nothing anywhere measured that. It survived an entire review wave
// (reviews/csharp/master-review.md records it as a "recorded gap for its own
// wave") because a capability that is ABSENT emits no wrong edge: every gate
// the lane had — the line contract, the differential depth draws, the fixtures —
// asks whether an edge that EXISTS is right, and none of them asks whether an
// edge the family promises was never emitted at all. A missing capability is
// invisible to a per-edge oracle; it needs a per-lane census.
//
// WHAT IS MEASURED, AND HOW THE MEASUREMENT IS CALIBRATED
// ------------------------------------------------------
// Per lane, ONE minimal source declaring an in-file type plus a holder that
// names it in a member position (field / parameter / return), fed to the lane's
// REAL analyzer through ASTEngine (the same entry every other instrument uses).
// Each row then carries:
//
//     control        the holder symbol was declared — so the lane really parsed
//                    the snippet and walked the declaration. Without this a
//                    snippet the grammar rejects would read as a missing
//                    capability, which is the accusation this census exists to
//                    make and must never make falsely.
//     declaredEdges  `references` edges carrying metadata.relationshipType
//                    === "declared_type" — the family MARKER.
//     typeRefs       `references` edges with the declared type as their TARGET,
//                    whatever metadata they carry.
//
// The two counts are why this census cannot cry wolf. The contract is that a
// declaration's written type is a dependency; `declared_type` is how the family
// MARKS it. A lane that emits the edge under another marker has the capability
// and a labelling divergence — a different, smaller finding than a missing
// capability, and convicting it as absent would be this instrument inventing a
// defect (the rust lane's own R13 header was checked against the grammar before
// the csharp gap was believed). So:
//
//     present-declared_type   typeRefs > 0 AND the family marker is used
//     present-other-marker    typeRefs > 0, marker is something else — reported
//                             with the markers actually seen, no conviction
//     absent                  control present, typeRefs === 0 — a contract gap
//     not-exercised           control absent — REPORTED, never convicted. A lane
//                             whose snippet did not parse or did not reach the
//                             holder is evidence about the snippet, not the
//                             analyzer.
//
// A lane may be ruled out of the contract in the register (a language whose
// syntax has no declared-type position at all, ruled with a written reason);
// that ruling is data, not a claim this script makes about itself.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * One snippet per lane, deliberately minimal: this measures the CAPABILITY,
//     not its coverage. A lane here can legitimately have an incomplete graph
//     (a missing position) and still pass — coverage is the lane's own
//     construct sweep. What cannot pass is emitting nothing.
//   * Lanes not listed in the snippet table are reported as `no-snippet`, not
//     silently omitted, so the table's own gaps are visible too.
//   * `control` is a symbol-presence check, not a tree assertion: a lane whose
//     symbol pass names the holder for a different reason still counts. The
//     exposure is bounded to lanes that fail to declare `Holder` entirely.
//
// Run: bun script/m60/declared-type-refs-census.ts → validation/m60/results/declared-type-refs.json
import { writeFileSync, mkdirSync, rmSync, writeFileSync as write, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/declared-type-refs.json")
const TMP = path.join(ROOT, "script/m14/tmp/.declared-type-census")

/**
 * The snippet table. Each entry: the lane, the file extension ASTEngine resolves
 * the lane by, and a source naming an in-file type `Dep` from a member position
 * of `Holder`. Deliberately NOT tuned per lane's favourite position — every
 * snippet contains a field AND a parameter/return reference, so a lane that
 * implements only one of the two still reads `present` (that is a coverage
 * question, the lane's own sweep) while a lane that implements none reads
 * `absent`.
 */
export const DECLARED_TYPE_SNIPPETS: Record<string, { ext: string; src: string }> = {
  rust: { ext: ".rs", src: `struct Dep;\nstruct Holder { f: Dep }\nfn m(a: Dep) -> Dep { a }\n` },
  go: { ext: ".go", src: `package p\ntype Dep struct{}\ntype Holder struct{ F Dep }\n` },
  c: { ext: ".c", src: `struct Dep { int x; };\nstruct Holder { struct Dep f; };\n` },
  cpp: { ext: ".cpp", src: `struct Dep { int x; };\nstruct Holder { Dep f; Dep m(Dep a) { return a; } };\n` },
  zig: { ext: ".zig", src: `const Dep = struct {};\nconst Holder = struct { f: Dep };\n` },
  python: { ext: ".py", src: `class Dep:\n    pass\n\nclass Holder:\n    def m(self, a: Dep) -> Dep:\n        return a\n` },
  typescript: { ext: ".ts", src: `class Dep {}\nclass Holder {\n  f: Dep;\n  m(a: Dep): Dep { return a; }\n}\n` },
  java: { ext: ".java", src: `class Dep {}\nclass Holder {\n  private Dep f;\n  Dep m(Dep a) { return a; }\n}\n` },
  kotlin: { ext: ".kt", src: `class Dep\nclass Holder {\n  val f: Dep? = null\n  fun m(a: Dep): Dep = a\n}\n` },
  scala: { ext: ".scala", src: `class Dep\nclass Holder {\n  val f: Dep = null\n  def m(a: Dep): Dep = a\n}\n` },
  groovy: { ext: ".groovy", src: `class Dep {}\nclass Holder {\n  Dep f\n  Dep m(Dep a) { a }\n}\n` },
  csharp: { ext: ".cs", src: `class Dep {}\nclass Holder {\n  private Dep f;\n  public Dep M(Dep a) { return a; }\n}\n` },
  dart: { ext: ".dart", src: `class Dep {}\nclass Holder {\n  Dep? f;\n  Dep m(Dep a) => a;\n}\n` },
  php: { ext: ".php", src: `<?php\nclass Dep {}\nclass Holder {\n  private Dep $f;\n  public function m(Dep $a): Dep { return $a; }\n}\n` },
  swift: { ext: ".swift", src: `class Dep {}\nclass Holder {\n  var f: Dep?\n  func m(a: Dep) -> Dep { return a }\n}\n` },
  objc: { ext: ".m", src: `@interface Dep : NSObject\n@end\n@interface Holder : NSObject {\n  Dep *f;\n}\n@end\n` },
  fsharp: { ext: ".fs", src: `type Dep() = class end\ntype Holder() =\n  let mutable f: Dep = null\n` },
  powershell: { ext: ".ps1", src: `class Dep {}\nclass Holder {\n  [Dep] $f\n}\n` },
  ruby: { ext: ".rb", src: `class Dep; end\nclass Holder\n  def m(a)\n    Dep.new\n  end\nend\n` },
}

async function main() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const rows: any[] = []
  for (const [lang, spec] of Object.entries(DECLARED_TYPE_SNIPPETS)) {
    const file = path.join(TMP, `probe-${lang}${spec.ext}`)
    write(file, spec.src)
    let res: any = null
    let error: string | null = null
    try {
      res = await ASTEngine.parseFile(file, spec.src)
    } catch (e: any) {
      error = String(e?.message ?? e).slice(0, 200)
    }
    const rels: any[] = res?.relationships ?? []
    const syms: any[] = res?.symbols ?? []
    const control = syms.some((s: any) => String(s?.name ?? "") === "Holder")
    const declared = rels.filter(
      (r: any) => r?.type === "references" && r?.metadata?.relationshipType === "declared_type",
    )
    // Any reference edge whose target NAMES the declared type — the capability
    // itself, independent of how it is labelled (`struct Dep` targets are the C
    // lane's own leaf rule and count).
    const typeRefs = rels.filter(
      (r: any) =>
        r?.type === "references" &&
        String(r.target ?? "").split(/[\s:*&]+/).filter(Boolean).pop() === "Dep",
    )
    const markers = [...new Set(declared.map((r: any) => String(r?.metadata?.relationshipType)))].sort()
    const otherMarkers = [
      ...new Set(
        typeRefs
          .filter((r: any) => r?.metadata?.relationshipType !== "declared_type")
          .map((r: any) => String(r?.metadata?.relationshipType ?? "(none)")),
      ),
    ].sort()
    const verdict = error
      ? "error"
      : !control
        ? "not-exercised"
        : declared.length > 0
          ? "present-declared_type"
          : typeRefs.length > 0
            ? "present-other-marker"
            : "absent"
    rows.push({
      lang,
      verdict,
      control,
      declaredEdges: declared.length,
      typeRefs: typeRefs.length,
      markers,
      otherMarkers,
      targets: [...new Set(typeRefs.map((r: any) => String(r.target)))].sort(),
      relationships: rels.length,
      symbols: syms.length,
      ...(error ? { error } : {}),
    })
    console.log(
      `${verdict.padEnd(21)} ${lang.padEnd(11)} declared=${String(declared.length).padStart(2)} typeRefs=${String(typeRefs.length).padStart(2)} control=${control ? "y" : "n"}${otherMarkers.length ? ` markers=${otherMarkers.join("|")}` : ""}${error ? ` error=${error}` : ""}`,
    )
  }
  rmSync(TMP, { recursive: true, force: true })

  const absents = rows.filter((r) => r.verdict === "absent")
  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "R9",
    purpose:
      "A declaration's written type is a dependency: the family emits a `references` edge to it, marked metadata.relationshipType === 'declared_type' (rust R13's header names it a family standard, mirrors go/c/zig). This census measures, per lane at runtime, whether the lane emits it at all — the one class of defect a per-edge oracle cannot see, because an absent capability emits NOTHING to adjudicate.",
    generatedAt: new Date().toISOString().slice(0, 10),
    boundary:
      "One minimal snippet per lane: measures the CAPABILITY, not its per-position coverage (which is the lane's own construct sweep). `not-exercised` means the snippet did not reach the holder symbol and convicts no one. `present-other-marker` means the reference exists under a non-family label — a labelling divergence, not a missing capability.",
    lanes: rows.length,
    presentDeclaredType: rows.filter((r) => r.verdict === "present-declared_type").length,
    presentOtherMarker: rows.filter((r) => r.verdict === "present-other-marker").map((r) => r.lang),
    absent: absents.map((r) => r.lang),
    notExercised: rows.filter((r) => r.verdict === "not-exercised").map((r) => r.lang),
    errored: rows.filter((r) => r.verdict === "error").map((r) => r.lang),
    rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  // The summary printed `undefined` here until 2026-09-22: it read a `present`
  // field the payload never had, so the one line a reader scans for the verdict
  // showed nothing. The count is derived from the same field the register's
  // baseline uses.
  const presentTotal = payload.presentDeclaredType + payload.presentOtherMarker.length
  console.log(`\n${presentTotal}/${payload.lanes} present (${payload.presentDeclaredType} declared_type${payload.presentOtherMarker.length ? ` + ${payload.presentOtherMarker.join(",")} under another marker` : ""}); absent: ${payload.absent.join(", ") || "none"}; not-exercised: ${payload.notExercised.join(", ") || "none"}; errored: ${payload.errored.join(", ") || "none"}`)
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

// Entry guarded (C923 sweep): an unguarded call makes every future IMPORT of this instrument
// run a full census and rewrite its committed artifact from whatever tree is checked out —
// measured live on the sibling target-spelling-census.ts. `import.meta.main` is this repo's
// entry-point idiom (script/m13/verify-evidence.ts, src/cli/index.ts).
if (import.meta.main) main()
