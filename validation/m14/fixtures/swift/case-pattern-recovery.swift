// #938 (swift lane, full extent): a switch-case pattern WITH an associated value
// does not reduce in the pinned grammar — the header is recovered as a
// call_expression whose callee navigation STARTS AT THE `case` KEYWORD.
//
// Probe-verified shape (pinned wasm):
//
//   call_expression
//     navigation_expression
//       simple_identifier "case"          <- the reserved keyword, as an identifier
//       navigation_suffix . simple_identifier "websocket"
//     call_suffix
//       value_arguments ( value_argument "let"  ERROR websocketChannel )
//
// A pattern match is not a call and not construction, so NOTHING may be emitted
// for it. Before the fix the analyzer took the leaf and published
// `calls -> websocket` / `calls -> notUpgraded` (measured on the 554-file
// swift-nio draw: three fabricated edges over Client.swift and Server.swift).
// Enum construction (`UpgradeResult.websocket(1)`) must keep working — it is
// the genuinely different site that shares the leaf name.

enum UpgradeResult {
    case websocket(Int)
    case notUpgraded
}

final class SocketServer {
    func handle(_ result: UpgradeResult) {
        switch result {
        case .websocket(let channel):
            consume(channel)
        case .notUpgraded:
            return
        }
    }

    func consume(_ channel: Int) {}

    func build() -> UpgradeResult {
        return UpgradeResult.websocket(1)
    }
}
