// #924 (swift half, M60 name surface): an enum CASE with a preceding
// `@available(...)` attribute puts a `modifiers` node FIRST in the pinned
// grammar (probe-verified shape):
//
//   enum_entry
//     modifiers            "@available(*, deprecated, message: \"Cannot be thrown\")"
//       attribute
//     case (anon) "case"
//     simple_identifier    "invalidHost"
//
// The member-name pick took the FIRST named child, so the attribute PAYLOAD was
// published as the case's name: five cases in swift-nio HTTPTypes.swift became
// `@available(*, deprecated, message: "Cannot be thrown")`, the real names
// (invalidHost/invalidPort/invalidPath/invalidQueryString/invalidFragment) were
// ABSENT, and the dedupe folded all five into a single `contains` target that is
// a decorator payload, not a name (measured by the R10 whitespace split,
// script/m60/target-spelling-census.ts: `payloadSigil` 1 on the 64-file draw).
//
// The name is the identifier after `case`; the attribute is metadata. Both the
// real names and the PAYLOAD's absence are pinned here, plus the positive case
// that unattributed cases (and construction from a named case) still work.
//
// Language note: in the real corpus the five payload strings are IDENTICAL, so
// a payload-name defect produces ONE name (five declarations collapse into it) —
// this fixture spells two DIFFERENT payloads so a revert cannot hide behind that
// dedupe.

enum ParseError {
    @available(*, deprecated, message: "Cannot be thrown")
    case invalidHost

    @available(*, deprecated, message: "Legacy spelling")
    case invalidPort(Int)

    case invalidChunkSize

    static func legacy() -> ParseError {
        return ParseError.invalidPort(0)
    }
}
