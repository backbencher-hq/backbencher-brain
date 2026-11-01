// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_edit handler: validates the discriminator, calls the
//   edit engine, and serialises success and refusal into the tool result.
// WHICH TOOL IT SERVES — bb_edit (mutability write, requiresIndex true, modes:
//   write, update, insert, delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — the engine owns every decision; the handler owns two
//   things a refusal must not lose. The first is the ERROR SHAPE: a refused edit
//   comes back as a structured JSON error (isError true) rather than an exception,
//   because hosts that do not wrap handler throws would otherwise lose the
//   rollback report. The second is `rolledBack`, which is measured and not
//   asserted: a restore that failed is named in `rollbackFailures`, and the same
//   answer cannot then claim the tree is back. `envelope` carries the per-file
//   answer the single boolean cannot, and a plan-stage refusal carries the empty
//   envelope with `refusedBeforeWriting` because that is what actually happened.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_edit.md (generated), docs/BB_EDIT.md
//   (hand page), validation/tools/bb_edit/**; gates: script/m13/verify-edit-*.ts,
//   script/m15/verify-edit-*.ts, script/m16/verify-edit-real-repo.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_edit/descriptor.ts,
//   src/intelligence/edit/edit-engine.ts, docs/BB_EDIT.md, and the gates above.
// CONTRACTS IT MUST NOT BREAK — a refusal is an error, never a success; a
//   rollback claim is false exactly when a restore failed; the per-file envelope is
//   passed through untouched; no option is interpreted here that the schema did not
//   accept.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { executeEdit, type EditRequest } from "../../../intelligence/edit/edit-engine"

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
  const request = args as EditRequest
  if (!(["write", "update", "insert", "delete", "refactor", "batch"] as const).includes(request.mode as any)) {
    return textResult("bb_edit requires mode: write|update|insert|delete|refactor|batch", true)
  }
  try {
    const result = await executeEdit(projectPath, projectId, request)
    return textResult(JSON.stringify(result, null, 2))
  } catch (e: any) {
    // The engine restores the pre-edit bytes before raising, and when a restore
    // itself fails it attaches the list. The tree is in its pre-edit state either
    // because the rollback succeeded or because nothing was written yet — so
    // `rolledBack` is true for an ordinary refusal and false exactly when a
    // restore failed, read from the error rather than assumed.
    const rollbackFailures: string[] = Array.isArray(e?.rollbackFailures) ? e.rollbackFailures : []
    return textResult(JSON.stringify({
      ok: false,
      mode: request.mode,
      error: e?.message ?? String(e),
      rolledBack: rollbackFailures.length === 0,
      ...(rollbackFailures.length > 0 ? { rollbackFailures } : {}),
      // The per-file answer to "is my working tree back?", measured from disk
      // after the restore loop. A plan-stage refusal attaches the empty envelope
      // and says so; a commit-stage failure attaches the real one.
      ...(e?.envelope ? { envelope: e.envelope } : {}),
      ...(e?.refusedBeforeWriting === true ? { refusedBeforeWriting: true } : {}),
    }, null, 2), true)
  }
}
