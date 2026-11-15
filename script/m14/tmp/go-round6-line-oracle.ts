// Round-6 line oracle for the Go lane.
//
// The F5 matcher compares `label + normTarget(target)` and reads no line
// (differential.ts:15634), so a WRONG line_number on a correct edge is invisible
// to every gate that exists. The fixtures pin ~40 lines by hand; nothing checked
// the other ~247,000. This script closes that gap WITHOUT re-implementing the
// analyzer's walk order, which is the one thing it must not do — copying the
// traversal would be a second derivation of the same guess (the C5 failure the
// round-6 truths were built to avoid).
//
// So the check is an INVARIANT, not an equality: for every published edge that
// carries a line, the recorded line must be a line on which that target is
// ACTUALLY WRITTEN, judged from the source text. A receiver line instead of a
// field line, an off-by-one, a line from the previous declaration, or a line
// belonging to a different symbol all fail it, and a correct line passes it for
// reasons the analyzer had no hand in.
//
// Conventions audited (read from the analyzer's own M59.A7 comments, then
// confirmed against live emission):
//   go_selector_use      the FIELD identifier's line, not the receiver's
//   identifier_usage     the identifier's own line
//   go_channel_operation the send/receive statement's line
//   references           the TYPE node's line
//   contains             the member's own declaration line
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const repos = process.argv.slice(2)
const LIMIT = Number(process.env.BB_LINE_FILES ?? 120)

/** The last identifier-shaped segment of a possibly qualified target. */
function leaf(target: string): string {
  const t = String(target ?? "").trim()
  const bracket = t.indexOf("[")
  const cut = bracket === -1 ? t : t.slice(0, bracket)
  const parts = cut.split(/[.:]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : cut
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const out: any = { checked: 0, agree: 0, missingLine: 0, perLabel: {}, firstSiteAgrees: {}, firstSiteDiverged: {}, failures: [] }
  for (const repo of repos) {
    const dir = path.join("/home/ishaq2321/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) continue
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "vendor" || e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith(".go")) files.push(p)
      }
    }
    walk(dir)
    files.sort()
    for (const abs of files.slice(0, LIMIT)) {
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      let tree: any
      try {
        tree = parser.parse(content)
      } catch {
        continue
      }
      let res: any
      try {
        res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, content, rel)
      } catch {
        continue
      }
      const lines = content.split("\n")

      // Node-based site index, built from the TREE. This is a fact about the
      // parse, not a second guess about the analyzer: "is there a
      // selector_expression whose field is `Name` that starts on line 91" is
      // decidable from the grammar alone. It replaces the text heuristic below,
      // which could only prove the name appears SOMEWHERE on the line.
      const sites: Record<string, Set<number>> = {
        "uses/go_selector_use": new Set(),
        "uses/identifier_usage": new Set(),
        "uses/go_channel_operation": new Set(),
        "references": new Set(),
        "contains": new Set(),
      }
      const firstSite: Record<string, Map<string, number>> = {
        "uses/go_selector_use": new Map(),
        "uses/identifier_usage": new Map(),
        "uses/go_channel_operation": new Map(),
        "references": new Map(),
        "contains": new Map(),
      }
      {
        const stack: any[] = [tree.rootNode]
        while (stack.length) {
          const nd = stack.pop()!
          const row0 = (nd.startPosition?.row ?? -1) + 1
          if (nd.type === "selector_expression") {
            const f = nd.childForFieldName?.("field")
            if (f) {
              // The FIELD's row, not the expression's start. A `selector_expression`
              // starts at its RECEIVER, and a receiver-continued chain is valid
              // Go — a multi-line composite literal ends `}).Dial` with the
              // expression starting several lines earlier. M59.A7 (#825) fixed
              // exactly that, and this index has to agree with it: keying on the
              // expression's start row reported the correct line 49 of
              // etcd/client/pkg/transport/timeout_transport.go as a mismatch.
              const fRow = (f.startPosition?.row ?? -1) + 1
              sites["uses/go_selector_use"].add(fRow)
              const nm = String(f.text ?? "")
              if (!firstSite["uses/go_selector_use"].has(nm)) firstSite["uses/go_selector_use"].set(nm, fRow)
            }
          } else if (nd.type === "identifier") {
            sites["uses/identifier_usage"].add(row0)
            const nm = String(nd.text ?? "")
            if (!firstSite["uses/identifier_usage"].has(nm)) firstSite["uses/identifier_usage"].set(nm, row0)
          } else if (
            nd.type === "send_statement" ||
            nd.type === "receive_statement" ||
            (nd.type === "unary_expression" && nd.child(0)?.type === "<-")
          ) {
            // The unary `<-x` form matters: it is the shape that a
            // receive_statement-only index misses, and on go-tools/terraform it
            // was 42 of 42 reported mismatches that were all CORRECT lines.
            sites["uses/go_channel_operation"].add(row0)
          } else if (nd.type === "type_identifier" || nd.type === "qualified_type" || nd.type === "generic_type") {
            sites["references"].add(row0)
            const nm = String(nd.text ?? "")
            if (!firstSite["references"].has(nm)) firstSite["references"].set(nm, row0)
          } else if (nd.type === "field_declaration") {
            sites["contains"].add(row0)
          }
          for (let i = 0; i < nd.namedChildCount; i++) { const c = nd.namedChild(i); if (c) stack.push(c) }
        }
      }
      for (const edge of res.relationships ?? []) {
        const m: any = edge.metadata ?? {}
        const label = String(edge.type)
        if (label !== "uses" && label !== "references" && label !== "contains") continue
        const key = `${label}/${m.relationshipType ?? "-"}`
        out.perLabel[key] ??= { checked: 0, agree: 0, missing: 0, bad: 0 }
        out.perLabel[key].checked++
        out.checked++
        const ln = edge.line_number
        if (typeof ln !== "number" || ln < 1) {
          out.missingLine++
          out.perLabel[key].missing++
          continue
        }
        // The target must be WRITTEN on the recorded line. A receiver-continued
        // selector, a multi-line composite literal and a commented-out example
        // are all cases where the token can be on another line, so those are
        // reported as `skipped`, never as agreement.
        const want = leaf(edge.target)
        const text = lines[ln - 1] ?? ""
        const trimmed = text.trim()
        const commented = /^\s*\/\//.test(text)
        // A preceding DOT is the normal case, not a counter-example: the target
        // is the FIELD's leaf (`Name` out of `b.Name`) and a declared type is
        // written qualified (`Reader` out of `io.Reader`). Excluding `.` here
        // reported 18,370 mismatches on the first run, every one a real site.
        const token = new RegExp(`(^|[^\\w$])${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w$]|$)`)
        const b = out.perLabel[key]
        // Node-based verdict where the node kind is decidable, text verdict as
        // the fallback. `firstSite` divergence is COUNTED, not judged: the
        // analyzer dedupes per (source,target) and keeps whichever site its walk
        // reaches first, which is not required to be the first in source order.
        const siteSet = sites[key]
        const nodeKnown = !!(siteSet && siteSet.size)
        const fsMap = firstSite[key]
        if (fsMap) {
          const f = fsMap.get(String(edge.target))
          if (typeof f === "number" && f !== ln) {
            out.firstSiteDiverged[key] = (out.firstSiteDiverged[key] ?? 0) + 1
          } else if (typeof f === "number") {
            out.firstSiteAgrees[key] = (out.firstSiteAgrees[key] ?? 0) + 1
          }
        }
        if (nodeKnown && !siteSet.has(ln)) {
          b.bad++
          if (out.failures.length < 40) {
            out.failures.push({ file: `${repo}/${rel}`, line: ln, kind: key, target: edge.target, text: trimmed.slice(0, 100) })
          }
          continue
        }
        if (!nodeKnown && (commented || !token.test(text))) {
          b.bad++
          if (out.failures.length < 40) {
            out.failures.push({ file: `${repo}/${rel}`, line: ln, kind: key, target: edge.target, text: trimmed.slice(0, 100) })
          }
          continue
        }
        b.agree++
        out.agree++
      }
    }
  }
  console.log(JSON.stringify(out, null, 2))
}
main()
