// M49 W4 (ledger T2, rotated-sample finding) — interface-member redeclaration
// in a derived interface, the shape every svelte-repo .d.ts carries:
//   `interface HTMLAttributes<T> extends DOMAttributes<T> { ontoggle?: … }`
// The analyzer emits the redeclaration as an override of the base member; the
// F5 oracle only registered method_signature, so those edges (19 in the
// rotated sample: elements.d.ts, legacy-nodes.d.ts, phases/types.d.ts,
// types/index.d.ts, reactivity/types.d.ts) surfaced as unexplained. The
// analyzer's contract is intentional and this fixture pins it; the oracle
// mirror (`property_signature` in the member set) is verified by the corpus.
//
// Authored BEFORE the analyzer run.
export interface DomAttributes {
  ontoggle?: (e: Event) => void;
  onmessage?: (e: Event) => void;
}

export interface HtmlAttributes extends DomAttributes {
  ontoggle?: (e: Event) => void;
  placeholder?: string;
}

export interface NodeBase {
  type: string;
}

export interface ElementBase extends NodeBase {
  type: string;
}
