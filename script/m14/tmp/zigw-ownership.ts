/**
 * ZIG WAVE 3 — the OWNERSHIP verifier (Z19/Z21/Z22's class).
 *
 * WHY NOT THE DIFFERENTIAL. The obvious instrument for the `contains` class is
 * the F5 oracle, and it would be nearly vacuous here: the harness's coverage
 * match is `label + normTarget(target)` — site-agnostic, and the SOURCE is not
 * part of the key. Z19 and Z21 both moved 335 edges to a DIFFERENT OWNER while
 * keeping every member name, so a truth edge `contains Value -> libc` would have
 * been "covered" by the analyzer's own `contains Outer -> libc`. A `contains`
 * audit through that match cannot see an ownership error by construction. (The
 * nim lane's `contains` join has the same property; that is a property of the
 * matching rule, not of the oracle.)
 *
 * So the ownership contract gets an instrument whose key IS the owner: this
 * verifier re-derives (owner, member) pairs from the tree with its own
 * traversal — the Z19 executable-body rule, the Z21 anonymous-container rule,
 * the container-field / error-set / function-member rules — and compares them
 * with the analyzer's `ownerName`/`name` pairs.
 *
 * Four verdicts, because the class has four shapes:
 *   AGREE       the derived owner and the published owner match
 *   PHANTOM_OWN an (owner, member) edge the derivation does not produce — the
 *               Z19/Z21 shape (a block local attributed to its container)
 *   ORPHAN      a symbol with no owner the tree can justify
 *   COLLISION   two DISTINCT declarations published under one (owner, name) —
 *               the RSD3 identity class, which is how Z21 was found
 *
 * Usage: npx tsx script/m14/tmp/zigw-ownership.ts [files] [--out <path>]
 * A red result is a real finding; a green one is the claim this file exists for.
 */
import * as fs from "fs"
import * as path from "path"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { stripZigQuoting } from "../../../src/ast/real-zig-analyzer"

const CONTAINERS = new Set(["struct_declaration", "union_declaration", "enum_declaration", "error_set_declaration", "opaque_declaration"])
const SKIP_INFN = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block", "function_signature"])

interface Derived { owner: string; member: string; line: number; kind: string }

async function main(): Promise<void> {
  await init()
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : null
  const limitArg = args.find((a) => /^\d+$/.test(a))
  const limit = limitArg ? Number(limitArg) : 1200
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  let agree = 0, phantomOwn = 0, orphan = 0, collision = 0, sameNameContainers = 0, trueDuplicates = 0, resolvedByEnclosure = 0
  const phantomEx: string[] = [], orphanEx: string[] = [], collisionEx: string[] = []
  let symbols = 0, owned = 0, filesWithOwnerDefect = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)
    const syms = res.symbols as any[]

    // ── the derivation: a container stack, plus the executable/anonymous scopes
    const derived: Derived[] = []
    const visit = (n: any, owner: string | null, inFn: boolean, anon: boolean): string | null => {
      let nextOwner = owner
      let nextAnon = anon
      let nextInFn = inFn

      if (CONTAINERS.has(n.type)) {
        const p = n.parent
        const isDeclRhs = !!p && p.type === "variable_declaration" && p.namedChildCount > 0 && p.namedChild(p.namedChildCount - 1)?.id === n.id
        if (!isDeclRhs) {
          // Z21: an anonymous container in an expression position owns nothing
          nextAnon = true
        } else {
          // the declaring name is the first identifier child of the variable_declaration
          const nameKid = p && p.namedChildCount > 0 ? p.namedChild(0) : null
          if (nameKid && nameKid.type === "identifier") nextOwner = stripZigQuoting(String(nameKid.text ?? ""))
          // an error set's members are identifiers DIRECTLY under it, and they
          // belong to the set. (The first version of this verifier had this as a
          // sibling `else if`, where the container branch above always won and
          // every error-set member therefore read as a phantom ownership — the
          // instrument was wrong, not the analyzer, and a new gate has to be
          // calibrated on a known case before its verdict means anything.)
          if (n.type === "error_set_declaration" && nextOwner) {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c.type === "identifier") derived.push({ owner: nextOwner, member: stripZigQuoting(String(c.text ?? "")), line: c.startPosition.row + 1, kind: "error_member" })
            }
          }
        }
      } else if (n.type === "container_field") {
        const nameKid = firstIdent(n)
        if (owner && nameKid) derived.push({ owner, member: nameKid, line: n.startPosition.row + 1, kind: "field" })
      } else if (n.type === "function_declaration") {
        // Z26: a `function_signature` is a function-pointer TYPE and mints no
        // symbol. This derivation used to take `firstIdent(function_signature)`,
        // which returned the return type or a parameter's qualified segment —
        // so it AGREED with the analyzer's fabrication and could not convict it.
        // A mirror that reproduces the defect it exists to find is self-agreeing;
        // that is why zigw-contains.ts was written from the grammar instead.
        const nameKid = firstIdent(n)
        if (owner && !anon && nameKid) derived.push({ owner, member: nameKid, line: n.startPosition.row + 1, kind: "member" })
        nextInFn = true
      } else if (n.type === "variable_declaration") {
        const nameKid = firstIdent(n)
        // a CONTAINER-scope declaration inside a container is its member
        if (owner && !anon && !inFn && nameKid) {
          derived.push({ owner, member: nameKid, line: n.startPosition.row + 1, kind: "decl" })
        }
      }

      if (SKIP_INFN.has(n.type)) nextInFn = true
      if (n.type === "block") nextInFn = true
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, nextOwner, nextInFn, nextAnon)
      }
      return nextOwner
    }
    visit(root, null, false, false)

    // `~~` is the owner/member key SEPARATOR: it cannot occur inside a Zig
    // identifier, so the composite key is unambiguous. (A literal NUL would do
    // the same job and did — but it made this file binary to git, and a probe
    // that cannot be reviewed as text is a probe nobody reviews.)
    const SEP = "~~"
    const derivedKeys = new Set(derived.map((d) => `${d.owner}${SEP}${d.member}`))
    const derivedLine = new Map(derived.map((d) => [`${d.owner}${SEP}${d.member}`, d.line]))
    // how many CONTAINER symbols does this file declare per name? A name with
    // more than one is the shape the store cannot resolve: `nameToSymbol.get(
    // ownerName)` returns ONE row, so every member of every same-named container
    // is filed under the same `owner_symbol_id` (parallel-indexer.ts, the
    // `owner_symbol_id = ${fileId}:${parentSymbol.name}:${parentStartLine}` line).
    const containerDeclsByName = new Map<string, number>()
    // Z49: each container's DECLARATION EXTENT, so ownership can be resolved the
    // way the STORE resolves it rather than counted as unresolvable.
    //
    // This verifier has reported "COLLISION 1,485" for several waves as though
    // same-named containers were an unresolved defect, and filed #963 on that
    // basis. Both were wrong about the store: `parallel-indexer.ts` resolves a
    // symbol's owner with `enclosingStoreableIdByName`, preferring the innermost
    // same-name candidate whose extent COVERS the child's line, measured over ten
    // pinned heavy repos (`zig zig 71,957 / 12,421 / 8,097 / 7,153` in
    // validation/m14/measurements/containment-owner-span-612.json). The anchoring
    // data it needs is the container symbols' own ranges, which the analyzer
    // already publishes — so nothing was missing from the analyzer either, and the
    // honest question is not "is this ambiguous" but "is it ambiguous AFTER
    // containment", which is the only question a consumer actually faces.
    const containerExtents = new Map<string, Array<{ start: number; end: number }>>()
    for (const s2 of syms as any[]) {
      if (["struct", "enum", "union", "type"].includes(String(s2.kind))) {
        const nm = String(s2.name)
        containerDeclsByName.set(nm, (containerDeclsByName.get(nm) ?? 0) + 1)
        const st = s2.range?.startLine ?? 0
        const en = s2.range?.endLine ?? Number.MAX_SAFE_INTEGER
        containerExtents.set(nm, [...(containerExtents.get(nm) ?? []), { start: st, end: en }])
      }
    }
    // Would this member's line fall inside exactly ONE of its same-named
    // containers' extents? If yes the store resolves it and there is no defect.
    const coveringCount = (ownerName: string, memberLine: number): number =>
      (containerExtents.get(ownerName) ?? []).filter((e) => memberLine >= e.start && memberLine <= e.end).length
    const published = new Map<string, any[]>()
    for (const s of syms) {
      symbols++
      if (!s.ownerName) continue
      owned++
      const k = `${s.ownerName}${SEP}${s.name}`
      published.set(k, [...(published.get(k) ?? []), s])
    }

    let fileBad = false
    for (const [k, list] of published) {
      if (list.length > 1) {
        collision++
        fileBad = true
        // SEP, not a literal: the key is built with SEP, and when the NUL
        // separator became `~~` (so the file stops being binary to git) this
        // split kept the old escape and silently classified every collision as
        // "the owner name is declared once" — 50 of 50, against the 1,509-row
        // measurement that put 100% of them on same-named containers. A probe
        // edit that leaves a second copy of a constant behind is a measurement
        // that quietly inverts, and nothing turns red.
        const ownerName = k.split(SEP)[0]
        const ownerDecls = containerDeclsByName.get(ownerName) ?? 1
        // How many of the colliding members does ENCLOSURE disambiguate? Counted
        // per member, not per key: one key can hold two members at two lines, and
        // they can land in different containers.
        const disambiguated = list.filter((m: any) => coveringCount(ownerName, m.range?.startLine ?? 0) === 1).length
        if (disambiguated > 0) resolvedByEnclosure++
        const stillAmbiguous = list.length - disambiguated
        if (stillAmbiguous > 0) {
          sameNameContainers++
          if (ownerDecls === 1) trueDuplicates++
        }
        if (collisionEx.length < 12) {
          const lines = list.map((s: any) => `${rel}:${s.range?.startLine}:${s.kind}`).join("  |  ")
          collisionEx.push(`${k}  x${list.length}  ${ownerDecls > 1 ? `SAME-NAMED CONTAINERS: \`${ownerName}\` is declared ${ownerDecls}x in this file` : "the owner name is declared ONCE: a genuine duplicate member declaration"}  ${lines}`)
        }
        continue
      }
      if (derivedKeys.has(k)) agree++
      else {
        phantomOwn++
        fileBad = true
        if (phantomEx.length < 12) {
          const s = list[0]
          phantomEx.push(`${rel}:${s.range?.startLine}  published ${s.ownerName} -> ${s.name} (${s.kind})  derived: ${derivedLine.has(k) ? "line " + derivedLine.get(k) : "no such owner"}`)
        }
      }
    }
    // an owned symbol the derivation never produced AND never as an unowned one
    if (fileBad) filesWithOwnerDefect++
    tree.delete()
  }

  // orphans: owned symbols whose owner is not a container symbol the file declares
  for (const f of files.slice(0, 400)) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    // ANY container-kind symbol may own members, nested ones included: `pub const
    // Key = struct { arch: ... }` inside another container owns `arch`. (The
    // first version of this test asked for a FILE-SCOPE container and reported 52
    // orphans in 150 files — the instrument, not the graph.)
    const declaredContainers = new Set(
      (res.symbols as any[])
        .filter((s: any) => ["struct", "enum", "union", "type"].includes(String(s.kind)))
        .map((s: any) => String(s.name)),
    )
    for (const s of res.symbols as any[]) {
      if (!s.ownerName) continue
      if (!declaredContainers.has(String(s.ownerName))) {
        orphan++
        if (orphanEx.length < 12) orphanEx.push(`${rel}:${s.range?.startLine}  ${s.ownerName} -> ${s.name} (owner is not a file-scope container symbol)`)
      }
    }
    tree.delete()
  }

  console.log(`files: ${files.length}  symbols: ${symbols}  owned: ${owned}`)
  console.log(`ownership AGREE: ${agree}`)
  console.log(`PHANTOM_OWN:     ${phantomOwn}   <- the Z19/Z21 shape`)
  console.log(`ORPHAN owner:    ${orphan}    <- an owner the file does not declare as a container`)
  console.log(`COLLISION:       ${collision}   <- two declarations under one (owner, name) [RSD3]`)
  console.log(`   of which ENCLOSURE disambiguates: ${resolvedByEnclosure} member(s) — the store resolves these by extent, so they are not defects`)
  console.log(`   genuinely ambiguous after containment: ${sameNameContainers} key(s)`)
  console.log(`   of which SAME-NAMED CONTAINERS: ${sameNameContainers}   <- the store's name-keyed owner lookup cannot resolve these`)
  console.log(`   of which a genuine duplicate under a unique owner: ${trueDuplicates}`)
  console.log(`files with an ownership defect: ${filesWithOwnerDefect}`)
  if (phantomEx.length) { console.log("\n=== PHANTOM_OWN samples ==="); for (const e of phantomEx) console.log(`   ${e}`) }
  if (collisionEx.length) { console.log("\n=== COLLISION samples ==="); for (const e of collisionEx) console.log(`   ${e}`) }
  if (orphanEx.length) { console.log("\n=== ORPHAN samples ==="); for (const e of orphanEx) console.log(`   ${e}`) }
  const red = phantomOwn + collision + orphan
  console.log(`\nverdict: ${red === 0 ? "ownership agrees with the derivation" : `${red} ownership defect(s)`}`)

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify({
      schemaVersion: 1,
      milestone: "M14",
      kind: "zig_ownership_verification",
      generatedAt: new Date().toISOString(),
      instrument: "script/m14/tmp/zigw-ownership.ts",
      note: "The differential cannot audit this class: its coverage match is `label + normTarget(target)` and the SOURCE is not part of the key, so an edge that keeps its member name and changes owner is still 'covered'. This verifier keys on the owner. (owner, member) pairs are re-derived from the tree; the analyzer's own symbols are NOT used as the expectation.",
      corpus: { root: process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories", repos: ["zig", "zls", "ghostty"], filesMeasured: files.length, orphanScanFiles: Math.min(400, files.length) },
      totals: {
        symbols, owned, agree, phantomOwnership: phantomOwn, orphanOwner: orphan,
        collisions: collision,
        collisionsFromSameNamedContainers: sameNameContainers,
        collisionsFromGenuineDuplicates: trueDuplicates,
        filesWithOwnerDefect: filesWithOwnerDefect,
      },
      samples: { phantomOwnership: phantomEx, collisions: collisionEx, orphanOwner: orphanEx },
      verdict: red === 0 ? "ownership agrees with the derivation" : `${red} ownership defect(s)`,
    }, null, 2) + "\n")
    console.log(`wrote ${out}`)
  }
}

// Z43: CANONICALIZE, because the comparison is between this string and a
// PUBLISHED SYMBOL NAME, and the two spell the same name differently. A quoted
// identifier is an `identifier` node in this grammar whose `text` carries its
// `@"..."` syntax, while the symbol the analyzer publishes has that syntax
// stripped (Z34). So `@"1Monochrome"` was derived as `@"1Monochrome"` and
// compared against a published `1Monochrome`, and the key never matched: 701
// PHANTOM_OWN, all of them quoted enum members in the macOS pixel-format
// bindings, which are quoted precisely because the C names begin with digits.
//
// This is the SIXTH appearance of one defect — a rule applied on one side of a
// comparison and not the other (Z24, Z25, Z29, Z34, Z41, and now this), which is
// why the canonicalizer is IMPORTED here rather than written again. The
// instrument was wrong, not the analyzer: `zigw-contains.ts`, which derives from
// the grammar and compares per owner, reads the same edges as 0 phantom, and the
// symbols themselves carry `ownerName: "PixelFormat"` correctly.
//
// A gate that cannot be shown to agree with a known-good case is not evidence,
// and this one had been reporting a defect for long enough that a document had
// started quoting its numbers.
function firstIdent(n: any): string | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "identifier") return stripZigQuoting(String(c.text ?? ""))
  }
  return null
}
void main()
