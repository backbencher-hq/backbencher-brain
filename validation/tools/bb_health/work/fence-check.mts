// Prove the BB_HEALTH.md json fence parses as JSON and each element is a real,
// runtime-accepted bb_health invocation (the docs-truth gate's executed class).
import { readFileSync } from "node:fs"
import path from "node:path"
import { descriptor } from "../../../../src/mcp/tools/bb_health/descriptor"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const md = readFileSync(path.join(REPO, "docs/BB_HEALTH.md"), "utf8")
const fences = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1].trim())
const out: any[] = []
for (const raw of fences) {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error("fence is valid JSON but not an array of call objects")
    const results = parsed.map((entry, i) => {
      try {
        validateToolArguments(descriptor as any, entry as Record<string, unknown>)
        return { index: i, accepted: true }
      } catch (e: any) {
        return { index: i, accepted: false, error: String(e?.message ?? e) }
      }
    })
    out.push({ parses: true, entries: results.length, allAccepted: results.every((r) => r.accepted), results })
  } catch (e: any) {
    out.push({ parses: false, error: String(e?.message ?? e) })
  }
}
console.log(JSON.stringify({ fences: out.length, detail: out }, null, 2))
if (!out.every((f) => f.parses && f.allAccepted)) process.exit(1)
