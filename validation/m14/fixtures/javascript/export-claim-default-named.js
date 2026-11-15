// EXPORTS CLAIM EVIDENCE — a NAMED default declaration. The public name is `default` (ECMAScript);
// the declaration's own name is EVIDENCE in metadata, never the target (targeting `fragment` would
// fabricate a public name the module does not export — the defect this lane already fixed once).
export default function fragment() {
  return 1;
}

export const named = 2;
