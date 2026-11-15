// M49 W4 (T3, second rotated-sample finding) — a skipped call EDGE must not
// skip the SUBTREE.
//
// Probe (script/m14/tmp/t3-nested-call-probe.ts) on the pre-fix tree:
//   console.log(m.text())        analyzer=[text] oracle=[text]   (control, fine)
//   console[method](m.text())    analyzer=[]     oracle=[text]   <- EDGE LOSS
// The subscript branch did `return` before processNode's child recursion, so
// every real call in the arguments vanished. Surfaced as
// `MISSING calls .../runtime-browser/test.ts -> text` (line 203
// `console[method](message.text());`) once #760's rotation sampled the file.
//
// Authored BEFORE the analyzer run.
declare const console: any;

export function report(
  message: { text(): string },
  method: string,
  handlers: Array<(s: string) => void>,
  i: number,
) {
  console[method](message.text());
  handlers[i](message.text());
}
