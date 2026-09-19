// tmp-elx-adv-corpus.ts — adversarial corpus sweep (Elixir): per-file
// replication of the differential's gate comparison (label + last-segment,
// analyzer dedupe by label|target) across the primary elixir corpus and the
// phoenix corpus, plus structural incidence counters for the attack shapes.
// Usage: bun run script/tmp-elx-adv-corpus.ts [--repo elixir|phoenix|both] [--limit N] [--verbose]
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()
const { deriveElixirEdges } = await import("./m14/differential")

function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
function normTarget(t: string): string {
  return lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}

const repos = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : "both"
const limitIdx = process.argv.indexOf("--limit")
const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : 0
const verbose = process.argv.includes("--verbose")
const DEBUG_LIMIT = 4 // files whose per-edge divergences are printed inline

const CORPUS: Record<string, string> = {
  elixir: "$HOME/fixtures/repositories/elixir",
  phoenix: "$HOME/fixtures/repositories/phoenix",
}
const REPOS = repos === "both" ? ["elixir", "phoenix"] : [repos]

const PROTO_KEYS = ["toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]
const PROTO_SET = new Set(PROTO_KEYS)
const KERNEL = new Set(["length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size", "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "ceil", "floor", "min", "max", "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function", "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port", "is_reference", "is_tuple", "is_nil", "is_struct", "is_exception", "map_get", "to_string", "inspect", "apply", "self", "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref", "node", "put_in", "get_in", "update_in", "get_and_update_in", "pop_in", "struct", "struct!", "binary_part", "binding", "tap", "then", "dbg", "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom", "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield", "match?", "function_exported?", "macro_exported?", "reraise"])
const DEFS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const SPECIAL = new Set(["if", "unless", "case", "cond", "receive", "for", "with", "try", "rescue", "catch", "after", "else", "quote", "unquote", "super", "raise", "throw", "exit", "fn", "do", "match"])

// generic helpers for shape scans
const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
const find = (n: any, pred: (c: any) => boolean): any => { for (const c of kids(n)) if (pred(c)) return c; return undefined }
const callTarget = (n: any): string => find(n, (c: any) => c.type === "identifier" || c.type === "dot")?.text ?? ""
const kwName = (kw: any): string => (kw?.text ?? "").split(":")[0].trim()
const lastSeg = (s: string): string => (s.split(".").filter(Boolean).pop() ?? s)

interface Stats {
  files: number
  gateFiles: number // files with MISSING or UNEXPLAINED
  missing: number
  unexplained: number
  perClass: Record<string, number>
  filesByClass: Record<string, string[]>
  gateFilesList: { file: string; missing: string[]; unexplained: string[] }[]
}
const stats: Record<string, Stats> = {}
for (const r of REPOS) stats[r] = { files: 0, gateFiles: 0, missing: 0, unexplained: 0, perClass: {}, filesByClass: {}, gateFilesList: [] }

function addClass(st: Stats, cls: string, file: string, detail?: string) {
  st.perClass[cls] = (st.perClass[cls] ?? 0) + 1
  if (!st.filesByClass[cls]) st.filesByClass[cls] = []
  if (st.filesByClass[cls].length < 8) st.filesByClass[cls].push(file + (detail ? ` :: ${detail}` : ""))
}

// shape scan per file (AST walk)
function scanShapes(root: any, file: string, st: Stats) {
  // We track entering quote subtrees to count attrs/unquotes inside.
  let quotesWithAttrs = 0
  let quotesWithEmitAttrs = 0
  let quotesWithUnquote = 0
  let unquoteCallCount = 0
  let sSigilInterp = 0
  let docNonFalse = 0
  const docNonFalseSamples: string[] = []
  const moduleNames: string[] = []
  const defNames: string[] = []
  const asAliases = new Map<string, string>() // as-name -> module expr text
  const usageSites: { kind: string; name: string }[] = []
  const attrNames = new Map<string, number>()
  const visit = (n: any, quoteDepth: number) => {
    const t = n.type
    if (t === "call") {
      const target = callTarget(n)
      if (target === "quote") {
        // count forms inside this quote subtree
        let attrs = 0, unquotes = 0, upperSigil = 0, emitAttrs = 0, unquoteRealCalls = 0
        const sub = (m: any) => {
          if (m.type === "unary_operator" && m.childCount > 0 && m.child(0)?.text === "@") {
            const attrCall = m.child(1)
            const an = attrCall?.type === "call" ? callTarget(attrCall) : ""
            if (an) { attrs++; attrNames.set(an, (attrNames.get(an) ?? 0) + 1) }
            if (an === "doc") {
              const dt = attrCall.text ?? ""
              if (!/\bfalse\b|\bnil\b/.test(dt)) {
                docNonFalse++
                if (docNonFalseSamples.length < 3) docNonFalseSamples.push(`L${m.startPosition.row + 1}: ${dt.slice(0, 60)}`)
              }
            }
            if (["behaviour", "behavior", "derive", "type", "typep", "opaque", "moduledoc", "doc"].includes(an)) emitAttrs++
          }
          if (m.type === "call" && ["unquote", "unquote_splicing"].includes(callTarget(m))) {
            unquotes++
            const args = find(m, (c: any) => c.type === "arguments")
            if (args) {
              const scanCalls = (x: any) => {
                if (x.type === "call") {
                  const tt = callTarget(x)
                  if (tt && !SPECIAL.has(tt) && !KERNEL.has(tt)) unquoteRealCalls++
                }
                for (const c of kids(x)) scanCalls(c)
              }
              scanCalls(args)
            }
          }
          if (m.type === "sigil") {
            const nameNode = m.child(1)
            const nm = nameNode?.text ?? ""
            // sigil name node text excludes ~; uppercase first letter = non-interpolating variant
            if (nm && nm[0] >= "A" && nm[0] <= "Z") {
              const hasInterp = kids(m).some((c: any) => c.type === "interpolation")
              if (hasInterp) upperSigil++
            }
          }
          for (const c of kids(m)) sub(c)
        }
        for (const c of kids(n)) sub(c)
        if (attrs > 0) quotesWithAttrs++
        if (emitAttrs > 0) quotesWithEmitAttrs++
        if (unquotes > 0) quotesWithUnquote++
        unquoteCallCount += unquoteRealCalls
        sSigilInterp += upperSigil
      }
      if (target === "alias") {
        const args = find(n, (c: any) => c.type !== "identifier")
        if (args) {
          const mod = find(args, (c: any) => c.type === "alias" || c.type === "dot")?.text ?? ""
          const kw = find(args, (c: any) => c.type === "keywords")
          if (kw) for (const pair of kids(kw)) {
            const kk = find(pair, (c: any) => c.type === "keyword")
            if (kwName(kk) === "as" && pair.namedChildCount > 1) {
              const v = pair.namedChild(1)
              if (v?.type === "alias" && mod) asAliases.set(v.text, mod)
            }
          }
        }
      }
      if (target === "use") {
        const args = find(n, (c: any) => c.type !== "identifier")
        const v = args ? find(args, (c: any) => c.type === "alias") : undefined
        if (v) usageSites.push({ kind: "use", name: v.text })
      }
      if (target === "defimpl") {
        const args = find(n, (c: any) => c.type !== "identifier" && c.type !== "do_block")
        const kw = args ? find(args, (c: any) => c.type === "keywords") : undefined
        if (kw) for (const pair of kids(kw)) {
          const kk = find(pair, (c: any) => c.type === "keyword")
          if (kwName(kk) === "for" && pair.namedChildCount > 1) {
            const v = pair.namedChild(1)
            if (v?.type === "atom") addClass(st, "defimpl-for-atom", file)
            if (v?.type === "alias") usageSites.push({ kind: "defimpl-for", name: v.text })
          }
        }
      }
      if (target.startsWith("__MODULE__.")) addClass(st, "self-qualified-call", file, `${target}`)
      const dotIdx = target.indexOf(".")
      if (dotIdx > 0) {
        const rootSeg = target.slice(0, dotIdx), leafSeg = target.slice(dotIdx + 1)
        if (rootSeg === "Kernel" && KERNEL.has(leafSeg)) addClass(st, "kernel-qualified-builtin-call", file, `${target}`)
      }
      const leaf = target.split(".").pop() ?? ""
      if (PROTO_SET.has(leaf) && !target.startsWith(":")) addClass(st, "proto-key-name-appears", file, target)
      if (PROTO_SET.has(leaf) && dotIdx === -1) addClass(st, "proto-key-call-unqualified", file, target)
      if (target === "defmodule" || target === "defprotocol") {
        const args = find(n, (c: any) => c.type !== "identifier" && c.type !== "do_block")
        if (args) {
          const al = find(args, (c: any) => c.type === "alias")
          if (al) moduleNames.push(al.text)
        }
      }
      if (DEFS.has(target)) {
        const sigs = kids(n).filter((c: any) => c.type !== "identifier" && c.type !== "do_block")
        let sig: any = sigs[0]
        if (sig?.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
        if (sig?.type === "binary_operator" && sig.childCount > 1 && sig.child(1)?.text === "when") sig = sig.child(0)
        let nm = ""
        if (sig?.type === "call") nm = find(sig, (c: any) => c.type === "identifier")?.text ?? ""
        else if (sig?.type === "identifier") nm = sig.text
        if (nm) defNames.push(nm)
        if (target === "defdelegate") addClass(st, "defdelegate-defs", file)
      }
      if (target === "import") {
        const args = find(n, (c: any) => c.type !== "identifier")
        if (args) {
          const kw = find(args, (c: any) => c.type === "keywords")
          let hasOnly = false
          if (kw) for (const pair of kids(kw)) {
            const kk = find(pair, (c: any) => c.type === "keyword")
            if (kwName(kk) === "only") hasOnly = true
          }
          if (hasOnly) {
            // function-scoped? walk up to first def call / quote
            let cur = n.parent, inDef = false, inQuote = false
            while (cur) {
              if (cur.type === "call" && callTarget(cur) === "quote") inQuote = true
              if (cur.type === "call" && DEFS.has(callTarget(cur))) { inDef = true; break }
              if (cur.type === "call" && (callTarget(cur) === "defmodule" || callTarget(cur) === "defprotocol")) break
              cur = cur.parent
            }
            addClass(st, inQuote ? "import-only-in-quote" : inDef ? "import-only-in-def" : "import-only-in-module", file)
          }
        }
      }
    }
    if (n.type === "unary_operator" && n.childCount > 0 && n.child(0)?.text === "@") {
      const attrCall = n.child(1)
      const attrTarget = attrCall?.type === "call" ? callTarget(attrCall) : ""
      if (attrTarget === "derive") {
        const args = find(attrCall, (c: any) => c.type === "arguments")
        const first = args && args.namedChildCount > 0 ? args.namedChild(0) : undefined
        if (first?.type === "list") addClass(st, "derive-list-form", file)
      }
    }
    for (const c of kids(n)) visit(c, quoteDepth + (n.type === "call" && callTarget(n) === "quote" ? 1 : 0))
  }
  visit(root, 0)
  if (quotesWithAttrs > 0) addClass(st, "quote-contains-attribute", file, `${quotesWithAttrs} quote(s)`)
  if (quotesWithEmitAttrs > 0) addClass(st, "quote-contains-emitting-attribute", file, `${quotesWithEmitAttrs} quote(s)`)
  if (quotesWithUnquote > 0) addClass(st, "quote-contains-unquote", file, `${quotesWithUnquote} quote(s)`)
  if (unquoteCallCount > 0) addClass(st, "unquote-arg-has-real-call", file, `${unquoteCallCount} call(s)`)
  if (sSigilInterp > 0) addClass(st, "uppercase-sigil-with-interpolation", file, `${sSigilInterp}`)
  if (docNonFalse > 0) addClass(st, "doc-in-quote-nonfalse", file, docNonFalseSamples.join(" ; "))
  // duplicate last-segment modules in one file
  const lasts = new Map<string, number>()
  for (const mn of moduleNames) { const l = mn.split(".").pop() ?? mn; lasts.set(l, (lasts.get(l) ?? 0) + 1) }
  for (const [, c] of lasts) if (c > 1) { addClass(st, "duplicate-last-segment-modules", file); break }
  for (const nm of defNames) if (PROTO_SET.has(nm)) { addClass(st, "proto-key-def-name", file, nm); break }
  // as-alias divergences: name used at struct/use/defimpl where last segments differ
  for (const [asName, mod] of asAliases) {
    if (lastSeg(mod) === asName) continue
    if (usageSites.find((u) => u.name === asName && u.kind === "use")) addClass(st, "as-alias-use-divergence", file, `${asName}=${mod}`)
    if (usageSites.find((u) => u.name === asName && u.kind === "defimpl-for")) addClass(st, "as-alias-defimpl-divergence", file, `${asName}=${mod}`)
    const findStruct = (x: any): boolean => {
      if (x.type === "map") {
        const s = find(x, (c: any) => c.type === "struct")
        const a = s ? find(s, (c: any) => c.type === "alias") : undefined
        if (a?.text === asName) return true
      }
      for (const c of kids(x)) if (findStruct(c)) return true
      return false
    }
    if (findStruct(root)) addClass(st, "as-alias-struct-divergence", file, `${asName}=${mod}`)
  }
  // attribute histogram
  for (const [an, cnt] of attrNames) addClass(st, `attr-in-quote:${an}`, file, `${cnt}`)
  // pattern-position struct literals (EX-D5 says executable position only)
  const isDefHeadMirror = (x: any): boolean => {
    let cur = x.parent
    while (cur) {
      if (cur.type === "do_block") return false
      if (cur.type === "pair") {
        const kw = find(cur, (c: any) => c.type === "keyword")
        const kwt = kw?.text ?? ""
        if (kwt === "do" || kwt.startsWith("do:")) return false
      }
      if (cur.type === "call" && DEFS.has(callTarget(cur))) return true
      cur = cur.parent
    }
    return false
  }
  const patSites: { line: number; alias: string; inHead: boolean }[] = []
  const scanPatterns = (x: any) => {
    if (x.type === "map") {
      const s = find(x, (c: any) => c.type === "struct")
      const a = s ? find(s, (c: any) => c.type === "alias") : undefined
      if (a?.text) {
        let cur = x.parent, isPattern = false
        while (cur) {
          if (cur.type === "stab_clause" && cur.childCount > 1) {
            const arrow = cur.child(1)
            if (arrow && x.endIndex <= arrow.startIndex) { isPattern = true; break }
          }
          if (cur.type === "binary_operator" && cur.childCount > 2 && ["=", "<-"].includes(cur.child(1)?.text ?? "")) {
            const op = cur.child(1)
            if (op && x.endIndex <= op.startIndex) { isPattern = true; break }
          }
          if (cur.type === "call" || cur.type === "do_block" || cur.type === "source") break
          cur = cur.parent
        }
        if (isPattern) patSites.push({ line: x.startPosition.row + 1, alias: a.text, inHead: isDefHeadMirror(x) })
      }
    }
    for (const c of kids(x)) scanPatterns(c)
  }
  scanPatterns(root)
  for (const p of patSites) addClass(st, p.inHead ? "pattern-struct-in-def-head" : "pattern-struct-executable", file, `${p.alias}@L${p.line}`)
  ;(globalThis as any).__lastPatSites = patSites
}

for (const repo of REPOS) {
  const st = stats[repo]
  const dir = CORPUS[repo]
  const files: string[] = []
  const walkDir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!e.name.startsWith(".") && e.name !== "_build" && e.name !== "deps" && e.name !== "node_modules") walkDir(p) }
      else if (e.name.endsWith(".ex")) files.push(p)
    }
  }
  walkDir(dir)
  const use = limit > 0 ? files.slice(0, limit) : files
  let debugged = 0
  for (const fp of use) {
    const src = fs.readFileSync(fp, "utf8")
    let tree: any, res: any, truth: any[]
    try {
      tree = parser.parse(src)
      res = analyzer.analyze(tree.rootNode, src, fp)
      truth = deriveElixirEdges(tree.rootNode)
    } catch (e) {
      console.log(`PARSE/ANALYZE FAIL ${fp}: ${(e as any)?.message?.slice(0, 100)}`)
      continue
    }
    st.files++
    const relF = path.relative(dir, fp)
    scanShapes(tree.rootNode, relF, st)
    // label histogram + NULL-line audit on ALL analyzer relationships
    for (const r of res.relationships as any[]) {
      const L = String(r.type ?? "")
      addClass(st, `emit-label:${L}`, relF)
      if (r.type === "calls" && r.line_number === undefined) addClass(st, "calls-edge-without-line", relF, `${r.source}->${r.target}`)
      if (r.type === "calls" && String(r.target ?? "").includes("(")) addClass(st, "calls-target-with-paren", relF, `${r.source}->${r.target} @L${r.line_number ?? "?"}`)
    }
    // ── gate replication ──
    const LABELS = new Set(["extends", "implements", "instantiates", "overrides", "calls", "references"])
    const rels = (res.relationships as any[])
      .map((r: any) => ({ label: String(r.type ?? ""), target: String(r.target ?? ""), from: String(r.source ?? ""), line: r.line_number ?? 0, confidence: typeof r.confidence === "number" ? r.confidence : 1 }))
      .filter((r: any) => LABELS.has(r.label))
      .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })
    const missing: string[] = [], unexplained: string[] = []
    for (const te of truth as any[]) {
      if (!rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) missing.push(`${te.label} ${te.from} -> ${te.target}`)
    }
    for (const r of rels) {
      if (!(truth as any[]).some((te: any) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))) {
        unexplained.push(`${r.label} ${r.from} -> ${r.target} (L${r.line}, conf=${r.confidence})`)
      } else {
        const exact = (truth as any[]).some((te: any) => te.label === r.label && te.target === r.target)
        if (!exact) {
          const eq = (truth as any[]).find((te: any) => te.label === r.label && normTarget(te.target) === normTarget(r.target))
          if (eq) addClass(st, "masked-norm-equal-raw-diff", relF, `${r.label}: analyzer=${r.target} oracle=${eq.target}`)
          else {
            const sub = (truth as any[]).find((te: any) => te.label === r.label && te.target.includes(normTarget(r.target)))
            if (sub) addClass(st, "substring-explained", relF, `${r.label}: analyzer=${r.target} oracle=${sub.target}`)
          }
        }
      }
    }
    // instantiates emitted at an executable-pattern struct site
    if (res.relationships) {
      const patLines = new Map<number, string>()
      for (const p of ((globalThis as any).__lastPatSites ?? []) as { line: number; alias: string; inHead: boolean }[]) if (!p.inHead) patLines.set(p.line, p.alias)
      for (const r of res.relationships as any[]) {
        if (String(r.type) === "instantiates" && r.line_number && patLines.has(r.line_number)) addClass(st, "instantiates-edge-at-pattern-line", relF, `L${r.line_number} ${patLines.get(r.line_number)}`)
      }
    }
    if (missing.length || unexplained.length) {
      st.gateFiles++
      st.missing += missing.length
      st.unexplained += unexplained.length
      if (st.gateFilesList.length < 60) st.gateFilesList.push({ file: relF, missing: missing.slice(0, 4), unexplained: unexplained.slice(0, 4) })
      if (debugged < DEBUG_LIMIT) {
        debugged++
        console.log(`\n◼◼ ${repo}/${relF}`)
        if (missing.length) console.log(`   MISSING: ${missing.slice(0, 6).join(" | ")}`)
        if (unexplained.length) console.log(`   UNEXPLAINED: ${unexplained.slice(0, 6).join(" | ")}`)
      }
    }
  }
  console.log(`\n════════ ${repo}: ${st.files} files scanned ════════`)
  console.log(`gate files (MISSING/unexplained > 0): ${st.gateFiles} | missing=${st.missing} unexplained=${st.unexplained}`)
  for (const gf of st.gateFilesList) console.log(`  ${gf.file}${gf.missing.length ? ` MISSING[${gf.missing.join(" | ")}]` : ""}${gf.unexplained.length ? ` UNEXPLAINED[${gf.unexplained.join(" | ")}]` : ""}`)
  console.log("── shape incidence (files) ──")
  const order = Object.keys(st.perClass).sort((a, b) => st.perClass[b] - st.perClass[a])
  for (const k of order) {
    const ex = (st.filesByClass[k] ?? []).slice(0, 3).join(" ; ")
    console.log(`  ${k}: ${st.perClass[k]}${verbose ? `   e.g. ${ex}` : ""}`)
  }
}
console.log("\ndone")
