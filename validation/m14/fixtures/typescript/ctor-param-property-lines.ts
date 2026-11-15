// fixture: typescript/ctor-param-property-lines
// M59 (#825) follow-up, measured on element-plus cascader-panel/node.ts.
// Constructor parameter properties (readonly data/parent/...) are class
// members whose names are written on their own PARAMETER lines — not on the
// `constructor(` line. The symbol range and its contains edge must name the
// parameter's line (the line belongs to the name).
class Node {
  constructor(
    readonly data: string,
    readonly parent?: Node,
  ) {}
}
