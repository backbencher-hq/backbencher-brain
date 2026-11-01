// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the rendered mode → accepted-option contract that the bb_edit
//   reference page quotes, derived from the same constant the validator throws from.
// WHICH TOOL IT SERVES — bb_edit (limitations text), rendered by script/verify-tool-docs.ts.
// WHERE ITS EVIDENCE LIVES — src/mcp/tool-validation.ts (the enforcing constant),
//   docs/tools/bb_edit.md (the rendered page), script/m15/verify-contracts.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tool-validation.ts (EDIT_OPTIONS_BY_MODE),
//   script/tool-docs/curation/bb_edit.ts, and the generated bb_edit page.
// CONTRACTS IT MUST NOT BREAK — one copy of the contract: this module renders the
//   enforcing constant, it never restates the accepted options by hand.
// ─────────────────────────────────────────────────────────────────────────────

import { EDIT_OPTIONS_BY_MODE } from "../../src/mcp/tool-validation"

/**
 * The mode → accepted-option contract, rendered from the constant the validator
 * throws from (`EDIT_OPTIONS_BY_MODE`). A page that described this in its own
 * words could promise an option the validator rejects; rendering the enforcing
 * constant means the page and the error message cannot disagree.
 */
export const EDIT_MODE_CONTRACT = Object.entries(EDIT_OPTIONS_BY_MODE)
  .map(([mode, options]) => `\`${mode}\` → ${options.map((option) => `\`${option}\``).join(", ")}`)
  .join("; ")
