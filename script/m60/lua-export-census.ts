// Census: classify the FIRST file-scope `return` expression of every Lua file in
// a corpus, using the WIRED grammar (not a regex). Purpose: size the LUA-09 gap
// per SHAPE before deciding which shapes the analyzer must publish, so the fix
// is scoped by measurement rather than by how many shapes I happened to think of.
//
// It also carries the CORPUS-SCALE PROOF for the fix, and that half runs the
// analyzer through parseWithAnalyzer (the DIRECT path) rather than parseFile.
// This is not a preference. Exports are discarded at the worker boundary
// (LUA-14), so the pipeline-based oracle reads ZERO exports no matter how
// correct the analyzer is — its `exports` label reports recall 0.000 on any
// corpus and would stay at 0.000 for a perfect analyzer. Measuring the fix
// through that path would be measuring the pipeline, not the fix.
//
// Expected names come from the grammar walk above; observed names come from the
// analyzer. Two independent derivations of the same question, which is the only
// shape in which "recall 1.0" means anything.
import { join } from "node:path"
import { readFileSync } from "node:fs"

// Derived from this file's own location. Hardcoding the main checkout made this
// script unreadable from a lane worktree.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const REPOS = "$HOME/fixtures/repositories"
const argOf = (k: string, d?: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const LIMIT = Number(argOf("--limit", "0")) || 0
const ONLY = argOf("--only")

const { loadWebTreeSitter } = await import(REPO + "/src/util/wasm")
const mod: any = await loadWebTreeSitter()
const { parseFile } = await import(REPO + "/src/ast/pool-worker")
await parseFile(join(REPOS, "luvit", "init.lua"), REPOS) // measured core-wasm warmup
const lang = await mod.Language.load(REPO + "/wasm/tree-sitter-lua.wasm")
const parser = new mod.Parser()
parser.setLanguage(lang)

// A module's return may sit inside a TERMINAL `if` or `do` block at file scope:
//   `if cond then return {a=1} else return {a=1} end` as the last statement is a
//   valid module return, and luvit/deps/tls/lcrypto.lua is exactly that (lines
//   42-46 of 46). Looking only at chunk's DIRECT children classified that file as
//   no-file-return, and the analyzer's correct `randomBytes` export was then
//   reported as SPURIOUS — an artifact blaming correct code, which is the one
//   failure mode this whole lane exists to catch.
//
// Measured node shapes (wired grammar, not assumed):
//   chunk > do_statement > block > if_statement > block > return_statement
//   chunk > if_statement > identifier, block [, block]
// so the descent has to go through `block`, which is the child of BOTH a
// do_statement and an if branch. Handling do_statement and if_statement but not
// `block` — the first version of this walker — silently dropped every return
// inside a file-scope `do`, and kong/kong/init.lua (a `do` at line 36 wrapping a
// conditional `return { init = ... }`) came out as a spurious analyzer export.
//
// What is deliberately NOT descended: FUNCTIONS. A return inside one is
// LUA-20's case and is not a module export. LOOPS ARE descended, because the
// analyzer's rule — and the gate's — is "a return reachable without entering a
// function is a file-scope return", and a loop body's `return` legally exits the
// chunk. An earlier version of this walker excluded loops on the reasoning that
// `return` must be the last statement of a block; that reasoning constrains
// whether a return is REACHED, not whether it is a possible module surface, and
// the two came apart here: the analyzer published the loop return, the census
// did not expect it, and the census called a defensible analyzer export spurious
// for the second time. The walker and the gate now state the same rule.
// EXPORTED so the two-walker gate cannot reimplement it. This walk was copied
// into script/m60/lua-export-truth-diff.ts to compare the census against the
// oracle, and the copy was updated when LUA-35 added the setmetatable rule while
// the original was not — the THIRD time the same code existing in two places has
// produced a phantom disagreement in this lane (LUA-24 was the first, 218 edges).
// A differential that re-implements one of its own participants is not a
// differential; it is two implementations and a diff, and the diff cannot say
// which one is wrong. One walk, imported by both.
export const NOT_A_SCOPE = new Set(["function_definition", "function_declaration"])

export const fileScopeReturns = (node: any, out: any[] = []): any[] => {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (NOT_A_SCOPE.has(c.type)) continue
    if (c.type === "return_statement") { out.push(c); continue }
    fileScopeReturns(c, out)
  }
  return out
}

const firstFileReturn = (root: any): any => {
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c && c.type === "return_statement") return c
  }
  return null
}

const firstExpr = (ret: any): any => {
  for (let i = 0; i < ret.namedChildCount; i++) {
    const c = ret.namedChild(i)
    if (c && c.type === "expression_list") return c.namedChild(0)
  }
  return null
}

// The nth named child of a call's `arguments` field, reached by FIELD because
// this grammar has no positional access — the LUA-00 lesson. Not regex, not a
// child index: `dao[method or context](dao, args)` and `f()()` both exist.
const argAt = (fc: any, index: number): any => {
  for (let i = 0; i < fc.childCount; i++) {
    const fn = typeof fc.fieldNameForChild === "function" ? fc.fieldNameForChild(i) : null
    if (fn !== "arguments") continue
    const args = fc.child(i)
    let k = 0
    for (let a = 0; a < args.namedChildCount; a++) {
      const c = args.namedChild(a)
      if (!c) continue
      if (k === index) return c
      k++
    }
  }
  return null
}

const nameBearing = (n: any): string | undefined => {
  if (!n) return undefined
  if (n.type === "identifier") return n.text
  if (n.type === "dot_index_expression" || n.type === "method_index_expression") return n.text
  return undefined
}

const fieldName = (f: any): any => {
  for (let i = 0; i < f.childCount; i++) {
    const fn = typeof f.fieldNameForChild === "function" ? f.fieldNameForChild(i) : null
    if (fn === "name") return f.child(i)
  }
  return null
}

const stringContent = (s: any): string | null => {
  for (let i = 0; i < s.namedChildCount; i++) {
    const c = s.namedChild(i)
    if (c && c.type === "string_content") return c.text
  }
  return null
}

const census = (root: any): { shape: string; names: string[] } => {
  const rets = fileScopeReturns(root)
  if (rets.length === 0) return { shape: "no-file-return", names: [] }
  // A return inside a terminal `if` names the SAME module surface on each
  // branch (luvit's lcrypto returns `randomBytes` either way), so the expected
  // set is the UNION across branches and the shape is reported from the first
  // one. Union rather than intersection: publishing a name that only one branch
  // offers is right, because the other branch is not taken at load time and a
  // consumer cannot know which.
  const first = rets[0]
  const shapes: string[] = []
  const names = new Set<string>()
  for (const ret of rets) {
    const one = classifyReturn(ret)
    shapes.push(one.shape)
    for (const n of one.names) names.add(n)
  }
  return { shape: rets.length > 1 ? `multi-return(${shapes.join("|")})` : shapes[0], names: [...names] }
}

export const classifyReturn = (ret: any): { shape: string; names: string[] } => {
  const e = firstExpr(ret)
  if (!e) return { shape: "bare-return", names: [] }
  if (e.type === "identifier") return { shape: "identifier", names: [e.text] }
  // M60 LUA-35, kept in step with the analyzer and with the oracle's truth side: a
  // `return setmetatable(<name>, mt)` publishes the name. All three must say the
  // same thing — that they are three separate derivations of one question is
  // exactly what let LUA-24's 218-edge phantom disagreement happen.
  if (e.type === "function_call") {
    let cn: string | null = null
    for (let i = 0; i < e.childCount; i++) {
      const fn = typeof e.fieldNameForChild === "function" ? e.fieldNameForChild(i) : null
      if (fn === "name") cn = e.child(i).text
    }
    if (cn !== "setmetatable") return { shape: `call:${cn ?? "anon"}`, names: [] }
    const a0 = argAt(e, 0)
    const nm = nameBearing(a0)
    return { shape: "call:setmetatable", names: nm ? [nm] : [] }
  }
  if (e.type === "table_constructor") {
    const names: string[] = []
    let anyUnnamed = false
    for (let i = 0; i < e.namedChildCount; i++) {
      const f = e.namedChild(i)
      if (!f || f.type !== "field") continue
      const nm = fieldName(f)
      if (!nm) { anyUnnamed = true; continue }
      if (nm.type === "identifier") names.push(nm.text)
      else if (nm.type === "string") { const s = stringContent(nm); if (s) names.push(s) }
      else anyUnnamed = true
    }
    if (names.length === 0) return { shape: anyUnnamed ? "table-unnamed-only" : "table-empty", names: [] }
    return { shape: anyUnnamed ? "table-named+unnamed" : "table-named-only", names }
  }
  if (e.type === "function_call") {
    let nm: any = null
    for (let i = 0; i < e.childCount; i++) {
      const fn = typeof e.fieldNameForChild === "function" ? e.fieldNameForChild(i) : null
      if (fn === "name") nm = e.child(i)
    }
    return { shape: nm ? `call:${nm.text}` : "call-anon", names: [] }
  }
  if (e.type === "dot_index_expression") {
    let fld: any = null
    for (let i = 0; i < e.childCount; i++) {
      const fn = typeof e.fieldNameForChild === "function" ? e.fieldNameForChild(i) : null
      if (fn === "field") fld = e.child(i)
    }
    return { shape: "dot-index", names: fld ? [fld.text] : [] }
  }
  return { shape: e.type, names: [] }
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const ent of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) { if (ent.name !== ".git") walk(p, out) }
    else if (ent.name.endsWith(".lua")) out.push(p)
  }
  return out
}

/** The expected name set for ONE file: the union of what every file-scope return can name. */
export function expectedExportNames(root: any): string[] {
  return census(root).names
}

for (const corpus of ["luvit", "kong"]) {
  if (ONLY && corpus !== ONLY) continue
  let files = walk(join(REPOS, corpus))
  if (LIMIT) files = files.slice(0, LIMIT)
  const byShape = new Map<string, { files: number; names: number }>()
  let errors = 0
  let multiReturn = 0
  const perFile: Array<{ file: string; expected: string[] }> = []
  for (const f of files) {
    let t: any
    try { t = parser.parse(readFileSync(f, "utf8")) } catch { continue }
    if (t.rootNode.hasError) { errors++; continue }
    // More than one file-scope return is not valid Lua; count it so the
    // first-return rule below is not silently wrong on some file.
    let fileReturns = 0
    for (let i = 0; i < t.rootNode.namedChildCount; i++) {
      const c = t.rootNode.namedChild(i)
      if (c && c.type === "return_statement") fileReturns++
    }
    if (fileReturns > 1) multiReturn++
    const { shape, names } = census(t.rootNode)
    const cur = byShape.get(shape) ?? { files: 0, names: 0 }
    cur.files++
    cur.names += names.length
    byShape.set(shape, cur)
    perFile.push({ file: f, expected: names })
  }
  console.log(`\n===== ${corpus}: ${files.length} files, ${errors} with parse errors, ${multiReturn} with >1 file-scope return =====`)
  const rows = [...byShape.entries()].sort((a, b) => b[1].files - a[1].files)
  for (const [shape, v] of rows.slice(0, 14)) {
    const pct = ((v.files / files.length) * 100).toFixed(1)
    console.log(`  ${shape.padEnd(24)} ${String(v.files).padStart(5)} files (${pct.padStart(5)}%)  ${v.names} nameable`)
  }

  // ---- the corpus-scale proof, through the DIRECT analyzer path
  const { parseWithAnalyzer } = await import(REPO + "/script/m60/lua-analyzer-direct")
  let expectedTotal = 0
  let observedTotal = 0
  let hit = 0
  let spurious = 0
  const missed: string[] = []
  const extra: string[] = []
  let timeouts = 0
  for (const { file, expected } of perFile) {
    let actual: string[] = []
    try {
      const d: any = await parseWithAnalyzer(file)
      actual = (d.exports ?? []).map((e: any) => e.name)
    } catch { timeouts++; continue }
    const exp = new Set(expected)
    const act = new Set(actual)
    for (const n of exp) {
      expectedTotal++
      if (act.has(n)) hit++
      else if (missed.length < 25) missed.push(`${file.replace(REPOS + "/", "")} -> ${n}`)
    }
    for (const n of act) {
      if (!exp.has(n)) {
        observedTotal++
        if (extra.length < 25) extra.push(`${file.replace(REPOS + "/", "")} -> ${n}`)
        spurious++
      }
    }
  }
  const recall = expectedTotal ? hit / expectedTotal : 1
  // Total names the analyzer published = the expected ones it hit + the ones it
  // invented. Precision is over that total; a corpus with no exports at all is 1.
  const observedNames = hit + spurious
  const precision = observedNames === 0 ? 1 : hit / observedNames
  console.log(`\n  --- export recall vs the grammar walk (DIRECT analyzer path) ---`)
  console.log(`  expected (grammar-derived): ${expectedTotal}    published by analyzer: ${observedNames}`)
  console.log(`  recall:    ${recall.toFixed(4)}   (${hit}/${expectedTotal})`)
  console.log(`  precision: ${precision.toFixed(4)}   (${hit}/${observedNames})`)
  console.log(`  spurious:  ${spurious}  (analyzer exported a name the grammar walk did not derive)`)
  if (timeouts) console.log(`  files that threw: ${timeouts}`)
  for (const m of missed.slice(0, 10)) console.log(`    MISSED  ${m}`)
  for (const m of extra.slice(0, 10)) console.log(`    EXTRA   ${m}`)
}
