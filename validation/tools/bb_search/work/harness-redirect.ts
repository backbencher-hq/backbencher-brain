// Preload shim: redirect M13 harness evidence into the bb_search owner area so the
// audit does not rewrite shared validation/m13 evidence.
import { Harness } from "$HOME/mcp/backbencher-brain/script/m13/harness.ts"
const DEST = "$HOME/mcp/backbencher-brain/validation/tools/bb_search/gates/evidence/m13"
const proto = Harness.prototype as any
const origWrite = proto.write
proto.write = function (codeOverride?: string) {
  if (!this.meta.resultsDir) this.meta = { ...this.meta, resultsDir: DEST }
  return origWrite.call(this, codeOverride)
}
console.error("[harness-redirect] active")
