// fixture: javascript/destructured-binding-lines
// M59 (#825) follow-up, measured on element-plus drawer.vue (SFC script via
// the vue seam): every destructured binding ranges at its own NAME line — the
// old nodeToRange(declarator) stamped `const {` for a wrapped binding list.
const {
  plain,
  renamed: local,
  withDefault = 5,
  ...rest
} = source;
