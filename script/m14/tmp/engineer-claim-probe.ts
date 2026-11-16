// The engineer's claim, measured at all three layers:
//   1. ANALYZER: does the java analyzer put a startLine on every symbol it emits?
//   2. STORE:   does line_start land in the DB for every inserted symbol?
//   3. INDEX:   same, over a real corpus repo, through the production pipeline.
// Answer with counts per layer and the exact shapes that fall to 0/NULL —
// never with an opinion.
import { readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function layer1Analyzer() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-java.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-java-analyzer.ts"))
  const parser = new P()
  parser.setLanguage(grammar)
  // One file exercising every java symbol shape.
  const SRC = `package com.example;

import java.util.List;

/** docs */
@Deprecated
public class Outer {
  private int field = 1;
  static final String CONSTANT = "x";
  Outer() {}
  public int method(int a) { return a; }
  static void util() {}
  class Inner {}
  interface Iface { void go(); }
  enum Color { RED, GREEN }
  record Rec(int x) {}
}
interface Top { void go(); }
enum TopEnum { A, B }
record TopRec(int y) {}
`
  const tree = parser.parse(SRC)
  const res = await new mod.RealJavaAnalyzer().analyze(tree.rootNode, SRC, "S.java")
  const syms = res.symbols ?? []
  const withLine = syms.filter((s: any) => typeof s.range?.startLine === "number" && s.range.startLine >= 1)
  console.log("=== LAYER 1: analyzer payload ===")
  console.log(`symbols=${syms.length} withStartLine=${withLine.length} without=${syms.length - withLine.length}`)
  for (const s of syms) if (!(s.range?.startLine >= 1)) console.log(`   NO LINE: ${s.kind} ${s.name}`)
}

async function layer23Store() {
  process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m868claim-"))
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const idxMod: any = await import(path.join(ROOT, "src/index.ts"))
  const indexProjectParallel = idxMod.indexProjectParallel
  const brain: any = await import(path.join(ROOT, "src/brain/database.ts"))
  const getRaw = (id: string) => brain.BrainDatabase.getRawInstance(id)
  const repo = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/grails-core"
  const projectId = getProjectId(repo) as any
  const t0 = Date.now()
  const stats = await indexProjectParallel(projectId, repo, {})
  const raw = await getRaw(projectId)
  console.log(`=== LAYER 2/3: fresh index of ${repo} (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`)
  console.log(`   files=${stats.totalFiles} symbols=${stats.symbolsExtracted} rels=${stats.relationshipsFound}`)
  const byLang = raw.prepare(`
    SELECT f.language lang, COUNT(*) n,
           SUM(CASE WHEN s.line_start IS NOT NULL AND s.line_start >= 1 THEN 1 ELSE 0 END) withLine,
           SUM(CASE WHEN s.line_start IS NULL THEN 1 ELSE 0 END) nullLine
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    GROUP BY f.language ORDER BY n DESC LIMIT 8`).all()
  for (const r of byLang) console.log(`   ${r.lang.padEnd(10)} n=${String(r.n).padStart(6)} withLine=${String(r.withLine).padStart(6)} null=${r.nullLine}`)
  const zeroLine = raw.prepare(`
    SELECT f.language lang, s.symbol_type t, COUNT(*) n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.line_start IS NULL GROUP BY f.language, s.symbol_type ORDER BY n DESC LIMIT 12`).all()
  console.log("   --- NULL-line shapes ---")
  for (const r of zeroLine) console.log(`   ${r.lang}.${r.t}: ${r.n}`)
}

async function main() {
  await layer1Analyzer()
  await layer23Store()
}
main()
