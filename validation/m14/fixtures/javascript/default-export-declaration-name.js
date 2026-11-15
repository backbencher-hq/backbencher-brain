import { named } from './named.js';

// A default export of a NAMED declaration exports the name `default`.
// ECMAScript: `export default function fragment(){}` is exported as `default`;
// `fragment` is a local binding importers cannot reach, and nothing named
// `fragment` is exported at all.
//
// This is load-bearing because the mistake is INVISIBLE to the differential:
// the import edge's target leaf is the LOCAL binding
// (`import fragment from './fragment.js'` publishes `fragment`), so publishing
// the declaration's name as the export name made the two errors cancel and the
// exports class read 100%/0/0 with both sides wrong. It was found by
// `script/m14/verify-js-imports-corpus.ts` asking the question a graph tool
// asks — does this module's export surface contain the name an importer wants?
// — and reporting 15 default-import rows whose target exports did not.

export default function fragment() {
  return named;
}

export default class Widget {}

export function helper() {}

const local = 1;
export { local };
