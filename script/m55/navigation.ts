// script/m55/navigation.ts — M55.T2: the ONE rule for "the click navigated".
//
// T2's requirement is that clicking a caller row in the call hierarchy LANDS
// somewhere — the editor opens the caller. Two gestures produce a changed
// editor region and only one of them is a navigation:
//
//   navigation:   the editor shows ANOTHER FILE, so the changed pixels reach
//                 the top of the visible content (the first lines differ).
//   cursor move:  the click never selected a tree row (so focus stayed in the
//                 editor and the following Return edited the open file), or the
//                 arrow keys only moved inside it — the changes are confined to
//                 a band where the cursor/selection sits, while the top of the
//                 file is byte-identical.
//
// The rule is shared by the rig (which refuses to RECORD a frame that did not
// navigate) and by the V1 gate (which refuses to PASS one), so the two can
// never disagree about what the frames prove. Import-safe: no side effects, no
// I/O, no editor imports.

/** The editor content box, as a fraction of the editor WINDOW rectangle (the
 *  rig records that rectangle per frame; there is no window manager on the
 *  virtual display, so regions are read relative to it, never to the display).
 *  Measured against validation/m55/frames/live-17/11-call-hierarchy-click.png
 *  (the navigation) and live-19/11 (the dismissed view). */
export const EDITOR_CONTENT_REGION: [number, number, number, number] = [0.19, 0.08, 0.63, 0.27]

/** The diff shape pixel-read.py's `diff` command emits. */
export interface RegionDiff {
  ok?: boolean
  changedPixels?: number
  box?: [number, number, number, number] | null
}

/** A region is 292 px tall on the 1920x1080 session window. A navigation
 *  changes the first lines, so its changed box starts at the top; the observed
 *  numbers are 0 (live-17, navigation) versus 196 (live-19, cursor move). The
 *  band thresholds are declared here rather than inlined at the call sites so
 *  a change is one edit and the mutants below target the same numbers. */
export const NAV_TOP_BAND_PX = 40
export const NAV_MIN_SPAN_PX = 120
export const NAV_MIN_CHANGED_PX = 500

/** True when the editor content region changed like a journey to another file. */
export function navigationSpannedFile(d: RegionDiff | null | undefined): boolean {
  if (d === null || d === undefined || d.ok !== true) return false
  if ((d.changedPixels ?? 0) < NAV_MIN_CHANGED_PX) return false
  const box = d.box
  if (box === null || box === undefined) return false
  const [, y0, , height] = box
  return y0 <= NAV_TOP_BAND_PX && height >= NAV_MIN_SPAN_PX
}

/** The reason string used when the rule fails — one wording for the rig's
 *  declared blocked record and for the gate's failure detail. */
export function noNavigationReason(d: RegionDiff | null | undefined): string {
  const box = d?.box ?? null
  return box === null
    ? "the editor content did not change after the click (no navigation at all)"
    : `the editor content changed only in a band (y=${box[1]}, height=${box[3]} of the ${NAV_TOP_BAND_PX}/${NAV_MIN_SPAN_PX} px rule) — a cursor move inside the open file, not a journey to another file`
}
