// Read-only proof of the m55 live-surface prerequisites (blocked-leg evidence).
import path from "node:path"
import { existsSync } from "node:fs"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const { rigPreflight, DECLARED_FIXTURE, FRAMES_DIR } = await import(path.join(ROOT, "script/m55/screenshot-protocol.ts"))
import { readdirSync } from "node:fs"
const pre = rigPreflight()
console.log(JSON.stringify({
  fixture: DECLARED_FIXTURE,
  fixturePresent: existsSync(DECLARED_FIXTURE),
  rigOk: pre.ok,
  rigMissing: pre.missing,
  rigNotes: pre.notes,
  framesDir: path.relative(ROOT, FRAMES_DIR),
  captureRuns: existsSync(FRAMES_DIR) ? readdirSync(FRAMES_DIR).slice(0, 5) : [],
  command: "npx tsx script/m55/verify-live-surface.ts",
  whyNotRun: "V1 needs the declared external fixture + display tooling (Xvfb/xdotool/import/PIL) to capture frames; its probe leg needs the fixture's index. Its own contract (script/m55/screenshot-protocol.ts header) declares a missing prerequisite a BLOCKED session, never green. The gate also calls ensureServerBuilt(), which would rebuild shared dist/; Phase A is read-only outside validation/tools/bb_impact/**, so the blocked state is proven from the gate's own preflight instead.",
}, null, 2))
