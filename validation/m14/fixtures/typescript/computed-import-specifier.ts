// A module specifier is a MODULE only when it is written out.
//
//   await import(`data:text/javascript,${encodeURIComponent(src)}`)
//
// is a computed specifier: the module is assembled at run time and no file in
// any project is its path. The analyzer used to publish
// `imports gen -> "data:text/javascript,:*"` — the template's LITERAL PREFIX,
// read out of its `string_fragment` child as if it were the whole path. That
// names a module no injector can serve and no exporter can publish, and it was
// the single row of 2,926 on a 200-file draw that the independent `imports`
// oracle derived and the analyzer did not.
//
// The two controls below are the same statement in the other direction: a
// literal dynamic import and a literal `require` are module dependencies and
// must still publish.
export async function generateFromSource(src: string): Promise<void> {
    await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`);
}

export async function loadLiteral(): Promise<void> {
    await import("./helper.js");
}

export function loadRequire(): unknown {
    return require("node:path");
}