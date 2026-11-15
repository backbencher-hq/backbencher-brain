// API contracts and the exports surface — three shapes the analyzer used to
// get wrong, pinned together because they are all "a name or a path the
// consumer resolves":
//
//   1. an ARROW-FUNCTION handler is a Function symbol and must get the same
//      contract extraction a `function` declaration gets. The analyzer's
//      `extractApiContract` already had an `arrow_function` branch; the
//      variable path simply never called it, so the dominant handler shape
//      (Next.js/Astro/Express arrow consts) reported no contract at all while
//      the byte-identical `function` form reported `/api/fn`.
//   2. an ANONYMOUS default export has no binding name. `export default
//      function(){}` / `export default 42` each emitted an `exports` edge to a
//      target named `default`, which no symbol in this or any other file can
//      own. The ExportInfo row is real information and stays; the dangling
//      EDGE does not.
//   3. `linesOfCode` is a cross-language metric: the same source must not
//      report a different LOC as .ts and as .js.
//
// Authored BEFORE the analyzer run: every pre-fix value was measured by probe
// (arrow contract undefined, `default` edges present, TS 6 vs JS 9 on the
// shape below) before these pins were written.
const arrowGet = () => {
  return fetch("/api/items");
};

const arrowPost = () => {
  return axios.post("/api/items", { name: "x" });
};

const notAHandler = () => {
  return compute(1);
};

function declarationHandler() {
  return fetch("/api/decl");
}

export default function () {
  return 1;
}

export const named = 1;
