// binding-claims — the ORDER pin for two claim families on ONE row.
//
// `helper` is imported from an EXTERNAL package: the project-index pass claims the downstream call
// (isExternalTarget), and the imported-binding claim would also be eligible for that row. The
// arbiter's binding claims are SOLE AUTHORITY, so a row carrying both classifies as bindOK and the
// verified external claim disappears — the whole-population defect (extOK −27,459). The pipeline
// order therefore runs the external/index passes FIRST and lets the binding passes claim only rows
// nobody else claimed.
//
// With a complete index: the call carries isExternalTarget and NO importedBinding marker.
// Without an index (the fail-closed arm): the call carries importedBinding and no external marker.
import { helper } from 'external-pkg'

export function callExternalBinding(): void {
  helper.run()
}
