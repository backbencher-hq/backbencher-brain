// THE TRIPLE-SLASH REFERENCE DIRECTIVE — `part_of` (R2: this lane's patched grammar).
//
// Each of the three roles must become ONE `part_of` edge naming the specifier inside the quotes and
// carrying its role in metadata. Under the SERVED grammar this file yields NOTHING, because all
// three lines lex as ordinary comments — which is why the fixture is the red-able proof of the
// grammar swap and not a description of it.
/// <reference types="vite/client" />
/// <reference path="./ambient.d.ts" />
/// <reference lib="dom" />
// An ordinary comment must stay a comment, and must not become a `part_of` edge.
const answer: number = 42
