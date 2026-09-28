import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void { if (condition) console.log(`  ok: ${label}`); else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) } }

const root = mkdtempSync(path.join(tmpdir(), "bb-cli-surface-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function cliTarget(): string { return 'ok' }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  // M40.A7: explicit mode:"symbols" is REJECTED (the symbols listing is the
  // documented omitted-mode default) — call the gateway in the documented
  // form so this check exercises the public surface, not the rejection.
  const output = execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_search", "--dir", root, "--args", JSON.stringify({ query: "cliTarget" })], { cwd: process.cwd(), encoding: "utf8" })
  check("CLI gateway executes public bb_search", output.includes("cliTarget"), output.slice(0, 160))
  const fileOutput = execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_search", "--dir", root, "--args", JSON.stringify({ mode: "file", filePath: "src/app.ts" })], { cwd: process.cwd(), encoding: "utf8" })
  const filePayload = JSON.parse(fileOutput)
  check("CLI file search returns source envelope", filePayload.searchMode === "file" && filePayload.file === "src/app.ts" && filePayload.content.includes("cliTarget"), fileOutput.slice(0, 180))
  try {
    execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_search", "--dir", root, "--args", JSON.stringify({ query: "" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    check("CLI gateway rejects empty search query", false)
  } catch (error: any) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`
    check("CLI gateway rejects empty search query", text.includes("non-empty query"), text.slice(0, 180))
  }
  try {
    execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_search", "--dir", root, "--args", JSON.stringify({ query: "cliTarget", irrelevant: true })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    check("CLI gateway rejects irrelevant options", false)
  } catch (error: any) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`
    check("CLI gateway rejects irrelevant options", text.includes("unknown or irrelevant options"), text.slice(0, 180))
  }
} catch (error) { check("CLI surface fixture", false, error instanceof Error ? error.stack ?? error.message : String(error)) }
finally { rmSync(root, { recursive: true, force: true }); rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) }
console.log(failures === 0 ? "\nCLI SURFACE: PASS" : `\nCLI SURFACE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
