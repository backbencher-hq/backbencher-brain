// Two focused measurements:
// 1. does the AST validator see the HINDSIGHT-corrupted Haskell file the delete
//    pruner produced (partial import line)? (kept as the record of the F1 repro)
// 2. can `write` reach a language-mapped file under a protected directory
//    (.git/, .bb-data/)? The policy answer is NO: refuse by name, write nothing.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine"

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const ck = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`) }

async function main(): Promise<void> {
  const corrupted = "module Main where\n\n as M\n\nkeep y = M.lookup y\n"
  const parsed = await ASTEngine.parseFile("Main.hs", corrupted)
  // RECORDED BLIND SPOT (not a defect of the current pruner): the validator's
  // parse does not flag a Haskell FILE whose import line is a partial statement —
  // the old regex pruner produced exactly that shape and every delete reported
  // validated:true over it. The corruption path is gone (pruning is AST-only and
  // refuses to touch a language it cannot read), but the validator's limited
  // sensitivity to files (as opposed to fragments) is worth keeping on the record.
  ck("validator: the partial-import Haskell shape still parses clean — RECORDED blind spot (the corruption path itself is removed)", (parsed.errors ?? []).length === 0, `errors=${JSON.stringify((parsed.errors ?? []).map((e: any) => e.message).slice(0, 3))}`)

  const again = await ASTEngine.parseFile("Main.hs", "module Main where\n\nimport qualified Data.Map as M\n\nkeep y = M.lookup y\n")
  ck("validator control: the same file WITH its import parses cleanly", (again.errors ?? []).length === 0, JSON.stringify((again.errors ?? []).map((e: any) => e.message).slice(0, 2)))

  const root = path.resolve("validation/tools/bb_edit/work/run/git-reach")
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, "src.ts"), "export const x = 1\n")
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  const attempt = async (filePath: string): Promise<{ error?: any; written: boolean }> => {
    try {
      await executeEdit(root, projectId, { mode: "write", filePath, content: "export const x = 1\n", format: false })
      return { written: existsSync(path.join(root, filePath)) }
    } catch (error) {
      return { error, written: existsSync(path.join(root, filePath)) }
    }
  }
  for (const filePath of [".git/hooks/pre-commit.ts", ".bb-data/projects/x.ts", "node_modules/pkg/x.ts"]) {
    const r = await attempt(filePath)
    ck(`path policy: ${filePath} is REFUSED by the protected-path policy and nothing is written`,
      !!r.error && /protected path/.test(r.error.message) && !r.written, r.error?.message?.slice(0, 160))
    ck(`path policy: ${filePath} refusal carries the empty envelope + refusedBeforeWriting`, r.error?.envelope?.entries?.length === 0 && r.error?.refusedBeforeWriting === true)
  }
  const out = path.resolve("validation/tools/bb_edit/artifacts/validation+path.json")
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "A-audit-validation-path", generatedAt: new Date().toISOString(), checks }, null, 2) + "\n")
}
main().catch((e) => { console.error("FATAL", e); process.exit(2) })
