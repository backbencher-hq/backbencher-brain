// heritage-comment-targets — a heritage clause's TRIVIA is not a base name.
//
// In this grammar a `comment` (and an ERROR node) is a NAMED CHILD of extends_clause /
// extends_type_clause / implements_clause. The extractor used to publish every named child's TEXT as
// an extends/implements target, so a comment became a target (`extends Hooks -> "/* note */"`) and a
// ZERO-WIDTH comment became an EMPTY target — the gate's `noTarget` class, measured at whole
// population on pixie's react-table-config.d.ts (1 extends edge across 13,950 files).
//
// The second half pins the OTHER targetless construct: a JSX fragment inside a `.ts` file (error
// recovery inserts a zero-width MISSING type_identifier) used to publish a `references` row with an
// empty target (redwood, one file, one row across the whole population).

export interface Base {}

export interface WithComment extends /* note */ Base {}

export class Base2 {}

export class Sub extends /* note */ Base2 {}

// Error-recovery shapes: parsed, never compiled. Nothing in them names anything.
export interface Erased extends
{}

export const fragmentInTs = () => <>Hello</>
