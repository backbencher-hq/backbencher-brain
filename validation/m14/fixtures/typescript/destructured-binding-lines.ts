// fixture: typescript/destructured-binding-lines
// M59 (#825) follow-up, measured on element-plus drawer.vue: every binding
// ranges at its own NAME line. Same rewrite also fixes two latent defects:
// `{ renamed: local }` named the KEY (or nothing) instead of the bound VALUE,
// and `{ withDefault = 5 }` (object_assignment_pattern) was dropped entirely.
const {
  plain,
  renamed: local,
  withDefault = 5,
  ...rest
}: Source = source;
