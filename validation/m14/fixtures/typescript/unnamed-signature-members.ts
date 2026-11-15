// ─────────────────────────────────────────────────────────────────────────────
// PIN CORRECTED 2026-10-17 (Lead-authorised pin-change set, iteration 2d).
// Contract: a type MENTION emits a `uses` row and drops the DUPLICATE `references`
// row (one-label ruling, direction corrected). This fixture pinned the old
// `references` behaviour, so its pin moved with the contract:
//   expected `references X -> T`  ->  expected `uses X -> T`, and
//   forbid the duplicate `references X -> T`.
// Stated only where this fixture's own rows changed (see each row's note).
// ─────────────────────────────────────────────────────────────────────────────
// A TypeScript CALL SIGNATURE and a CONSTRUCT SIGNATURE declare no name.
//
//   interface Event<T> { (listener: (event: T) => unknown): Disposable }
//
// There is no identifier there to take, and the analyzer used to invent one:
// a Method symbol literally named `(call)` and a Constructor named `(new)`,
// plus a `contains Event -> (call)` edge. `(call)` is a placeholder literal
// (standing rule R7: a placeholder literal is not a name), no declaration
// anywhere carries it, and every interface in every file shares that ONE target
// name, so bb_graph aggregated unrelated declarations into a single node.
//
// The measured shape: 8 placeholder endpoints per 200 tracked files of
// microsoft/TypeScript, and they were the only `contains` rows of 6,357 that no
// independent oracle could derive — the differential read them as fabrications.
//
// The FACT is not lost. It is recorded on the interface that declares it,
// because that is the symbol a consumer actually asks about.
export interface Disposable {
    dispose(): void;
}

export interface Event<T> {
    (listener: (event: T) => unknown, thisArgs?: unknown): Disposable;
}

export interface Factory {
    new (seed: number): Disposable;
    readonly tag: string;
}

export function subscribe<T>(e: Event<T>, listener: (value: T) => void): Disposable {
    return e(listener);
}