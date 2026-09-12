// ide/vscode/src/identity-label.ts — M55.T1 (issue #770): the ONE
// substitution-label rule, vscode-free so the truth gate can read it.
//
// Truth Rule 2 (§15): identity is stated. When the server rooted a MEMBER
// through its owning declaration, every surface that names the result must say
// so. Before M55 the graph panel opened titled `Backencher Hub — Store` after
// the user asked for a constructor, with nothing said — the data was honest,
// the presentation silently relabeled.
//
// This module is deliberately free of `vscode` (and of every other editor
// import) for the same reason the renderer core is: a rule that cannot be
// executed headlessly cannot be gated, and a rule that is not gated is
// folklore. graph-panel/hub-panel/impact-panel all render through it — one
// rule, no per-panel fork.
//
// The label names BOTH sides of the substitution: the member the user asked
// for and the declaration that was actually rooted. Naming only the owner is
// the defect (see the gate's "label names the member" mutant).

/** The wire's declared resolution record (shape owned by src/lsp/identity.ts;
 *  restated structurally so the extension does not import server code). */
export interface MemberResolutionLike {
  through?: string
  memberName?: string
  ownerName?: string
  memberFile?: string
}

/** A panel-shaped object: the title rule needs nothing else. */
export interface TitleTarget {
  title: string
}

/** The declared outcome shape the panels pass in. */
export type PanelOutcome =
  | { ok: true; resolution?: MemberResolutionLike }
  | { ok: false; error: string }

/** The canonical substitution label, or null when nothing was substituted.
 *  Direct resolutions are NOT labeled: nothing changed, so nothing is said. */
export function substitutionLabel(resolution: MemberResolutionLike | undefined): string | null {
  if (!resolution || resolution.through !== "owning-declaration") return null
  const member = resolution.memberName
  const owner = resolution.ownerName
  if (!member || !owner) return null
  return `${member} → ${owner} (owning declaration)`
}

/** Apply the ONE title rule: the plain title, plus the member after its owner
 *  when (and only when) the server declared a substitution. `symbol` is what
 *  the user asked for — the label is attached to it, never replacing it. */
export function applyResolutionTitle(
  panel: TitleTarget,
  plainTitle: string,
  outcome: PanelOutcome,
  symbol: string,
  noun: string,
): void {
  panel.title = plainTitle
  if (!outcome.ok) return
  const label = substitutionLabel(outcome.resolution)
  if (label !== null) panel.title = `Backbencher ${noun} — ${symbol} → ${outcome.resolution?.ownerName} (owning declaration)`
}
