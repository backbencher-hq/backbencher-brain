// M60.P1 #873 — the cpp rows whose ONLY line is the metadata mirror.
//
// The Calls and Instantiates rows this analyzer emits carry no `line_number`
// at all, so `metadata.line` is the row's whole line. It was stamped with
// `startPosition.row` (0-based) while every other line in the payload is
// 1-based, so it named the line ABOVE the site. Measured before the fix
// through the production pipeline: 708 cpp and 1,327 hpp such rows in a
// three-file-per-language sample (script/m59/probe-metadata-line-base.ts).
//
// The two sites below are on purpose neither the first nor the last line of
// their scope, so a pin cannot be satisfied by "the enclosing function's
// start line" — it has to be the site.
struct Widget {
  int size() const { return 1; }
};

int use() {
  Widget* w = new Widget();
  return w->size();
}
