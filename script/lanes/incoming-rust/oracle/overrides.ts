/**
 * INCOMING_RUST — `overrides` truth for the F5 differential. LANE-OWNED, ready
 * to import; `script/m14/differential.ts` is the master's file and this lane
 * does not edit it.
 *
 * ## WHY IT IS HERE AND NOT IN DIFFERENTIAL.TS
 *
 * The differential's compared-label set already admits `overrides` for rust
 * (every lane except csharp/dart/swift/cpp/go), and the harness has a standing
 * check — G20, "A LABEL COMPARED WITH NO TRUTH FAILS THE RUN" — that fails a
 * lane whose compared label has analyzer edges and zero truth rows. The analyzer
 * now emits 48 `overrides` edges over 3 files of ripgrep and the oracle derived
 * none, so the lane reports `overrides (37 comparable, 0 truth)` and exits 6.
 * Two ways out: drop the edges, or derive the truth. Dropping them would put a
 * real Rust construct back to zero coverage on the strength of a harness gap,
 * which is the `overrides`-in-bash failure this programme already paid for once.
 *
 * To wire it, one import and one loop beside the rust block at
 * differential.ts:22629:
 *
 *     import { deriveRustTraitImplOverridesTruth } from "../../src/ast/..."  // or wherever
 *     ...
 *     if (lang === "rust") {
 *       for (const e of deriveRustTraitImplOverrides(root)) { ;(truth as any[]).push(e) }
 *
 * ## WHAT INDEPENDENCE THESE DERIVATIONS HAVE, AND WHAT THEY DO NOT
 *
 * This is a SECOND WALKER over the same wasm grammar, written from the TRAIT's
 * side (collect what each trait declares, then find the impl of that trait) —
 * the analyzer's walks forward from each impl and asks what it supplies. They
 * share the grammar and they share the premise that a same-named method of an
 * implemented trait is an override, so a wrong PREMISE reads green on both
 * sides: the harness cannot adjudicate the rule, only the extraction. That is
 * the same disclosed limit as `deriveRustBareUses`, and it is why the rule's
 * evidence is the fixture plus the lane's source-level mutants, not this file.
 *
 * ## NO REGEX
 *
 * Node types, fields and named children only. Casing is decided by an ASCII
 * range test, not by a pattern, so this file can be read by anyone who distrusts
 * the family habit of reaching for `/^[A-Z]/`.
 */
import { readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

export interface RustOverridesEdge {
  label: "overrides"
  from: string
  target: string
}

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

export function deriveRustTraitImplOverridesTruth(root: any): RustOverridesEdge[] {
  const out: RustOverridesEdge[] = []
  const seen = new Set<string>()

  const namedChildren = (n: any): any[] => {
    const out2: any[] = []
    if (!n) return out2
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild(i)
      if (c) out2.push(c)
    }
    return out2
  }
  /** the LAST `::` segment with generics stripped — the leaf a consumer can
   *  resolve, matching the analyzer's leaf-target contract */
  const leaf = (text: string): string => {
    const noGenerics = text.split("<")[0]
    const segs = noGenerics.split("::").filter((s) => s !== "")
    return segs.length ? segs[segs.length - 1] : noGenerics.trim()
  }
  /** `&mut T` / `*const T` / `(T)` do not change what the type is NAMED: the
   *  innermost nominal name is the answer, which is the analyzer's own
   *  `nominalTypeNode` rule. */
  const nominalLeaf = (typeNode: any): string | null => {
    let cur: any = typeNode
    for (let guard = 0; cur && guard < 16; guard++) {
      const t = cur.type
      if (t === "reference_type" || t === "pointer_type" || t === "parenthesized_type") {
        const inner = cur.childForFieldName?.("type") ?? (cur.namedChildCount ? cur.namedChild(cur.namedChildCount - 1) : null)
        if (!inner) return null
        cur = inner
        continue
      }
      break
    }
    if (!cur) return null
    if (cur.type === "type_identifier" || cur.type === "primitive_type" || cur.type === "scoped_type_identifier" || cur.type === "generic_type") {
      return leaf(String(cur.text))
    }
    return null
  }
  /** the names an item DECLARES as generic parameters — a locally bound name is
   *  never published as a type on either endpoint */
  const typeParametersOf = (item: any): Set<string> => {
    const out = new Set<string>()
    const tp = item.childForFieldName?.("type_parameters")
    if (!tp) return out
    const w: any[] = [tp]
    while (w.length > 0) {
      const q = w.pop()
      if (!q) break
      if (q.type === "lifetime") continue
      if (q.type === "identifier" || q.type === "type_identifier") out.add(String(q.text))
      for (let i = 0; i < (q.namedChildCount ?? 0); i++) { const c = q.namedChild(i); if (c) w.push(c) }
    }
    return out
  }
  const declarationList = (n: any): any => {
    for (const c of namedChildren(n)) if (c.type === "declaration_list") return c
    return null
  }
  const isMethod = (n: any): boolean => n.type === "function_item" || n.type === "function_signature_item"
  const methodName = (n: any): string | null => {
    if (!isMethod(n)) return null
    const nm = n.childForFieldName?.("name")?.text
    return nm && nm !== "" ? nm : null
  }

  // pass 1 — what each trait DECLARES (its own items, never a nested fn)
  const declared = new Map<string, Set<string>>()
  const pass1: any[] = [root]
  while (pass1.length > 0) {
    const n = pass1.pop()!
    if (n.type === "trait_item") {
      const name = n.childForFieldName?.("name")?.text
      if (name) {
        const ms = new Set<string>()
        for (const item of namedChildren(declarationList(n))) {
          const m = methodName(item)
          if (m) ms.add(m)
        }
        declared.set(name, ms)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) pass1.push(c)
    }
  }

  // pass 2 — which of those methods an impl of THAT trait supplies
  const pass2: any[] = [root]
  while (pass2.length > 0) {
    const n = pass2.pop()!
    if (n.type === "impl_item") {
      const traitNode = n.childForFieldName?.("trait")
      const typeNode = n.childForFieldName?.("type")
      if (traitNode && typeNode) {
        const traitLeaf = leaf(String(traitNode.text))
        const typeLeaf = nominalLeaf(typeNode)
        // a generic PARAMETER is not a type name: `impl<'a, M: Matcher> Matcher
        // for &'a M` implements the trait for one caller's reference to whatever
        // M is bound to, and this file has no name for that
        const params = typeParametersOf(n)
        const ms = declared.get(traitLeaf)
        // the in-file condition is the analyzer's and this truth's: a trait
        // declared nowhere in this file has no member symbol here to name
        if (ms && typeLeaf && !params.has(typeLeaf)) {
          for (const item of namedChildren(declarationList(n))) {
            const m = methodName(item)
            if (!m || !ms.has(m)) continue
            const from = `${typeLeaf}.${m}`
            const target = `${traitLeaf}.${m}`
            const k = `${from}|${target}`
            if (seen.has(k)) continue
            seen.add(k)
            out.push({ label: "overrides", from, target })
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) pass2.push(c)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Self-check: does this derivation agree with the analyzer over a real corpus?
 *
 * Run: bun script/lanes/incoming-rust/oracle/overrides.ts [corpusName]
 *
 * Reports edges only the oracle derives, edges only the analyzer emits, and the
 * two counts. A non-zero disagreement is a finding, not a rounding error: it is
 * either a dropout in one walker or a fabrication in the other, and the file
 * names them.
 */
if (import.meta.main) {
  const corpus = process.argv[2] ?? "ripgrep"
  const dir = path.join(CR, corpus)
  const files = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").filter((f) => f.endsWith(".rs"))
  const pin = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const { ASTEngine } = await import(path.resolve(path.join(import.meta.dir, "..", "..", "..", "..", "src", "ast", "engine.ts")))

  let oracleN = 0, analyzerN = 0, filesWith = 0
  const oracleOnly: string[] = [], analyzerOnly: string[] = []
  for (const rel of files) {
    const abs = path.join(dir, rel)
    let content: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      content = readFileSync(abs, "utf8")
    } catch { continue }
    let root: any
    try {
      const pt = await ASTEngine.parseTree(abs, content)
      root = pt.tree?.rootNode
    } catch { continue }
    const truth = deriveRustTraitImplOverridesTruth(root)
    let mine: any[] = []
    try {
      const res = await ASTEngine.parseFile(abs, content)
      mine = (res.relationships ?? []).filter((r: any) => String(r.type ?? r.relationshipType ?? "") === "overrides")
    } catch { continue }
    if (truth.length) filesWith++
    oracleN += truth.length
    analyzerN += mine.length
    const ts = new Set(truth.map((e) => `${e.from}|${e.target}`))
    const ms = new Set(mine.map((r: any) => `${r.source}|${r.target}`))
    for (const k of ts) if (!ms.has(k) && oracleOnly.length < 20) oracleOnly.push(`${corpus}/${rel} ${k.replace("|", " -> ")}`)
    for (const k of ms) if (!ts.has(k) && analyzerOnly.length < 20) analyzerOnly.push(`${corpus}/${rel} ${k.replace("|", " -> ")}`)
  }
  console.log(`overrides oracle vs analyzer — ${corpus}@${pin.slice(0, 7)}, ${files.length} tracked .rs`)
  console.log(`oracle ${oracleN} edges, analyzer ${analyzerN} edges, ${filesWith} file(s) with at least one`)
  console.log(`oracle-only: ${oracleOnly.length}${oracleOnly.length ? `\n  ${oracleOnly.join("\n  ")}` : ""}`)
  console.log(`analyzer-only: ${analyzerOnly.length}${analyzerOnly.length ? `\n  ${analyzerOnly.join("\n  ")}` : ""}`)
  if (oracleOnly.length > 0 || analyzerOnly.length > 0) {
    console.log(`\nDISAGREEMENT — one of the two walkers is wrong about the rows above.`)
    process.exit(1)
  }
  console.log(`\nthe two walkers agree on every edge`)
}