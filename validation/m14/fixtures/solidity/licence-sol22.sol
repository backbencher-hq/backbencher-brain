// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-22 — the LICENCE. Authored 2026-09-30 from the analyzer's measured output.
//
// `// SPDX-License-Identifier: MIT` is the first comment in essentially every Solidity
// file, and before SOL-22 it reached NOTHING: its next named sibling is the
// `pragma_directive`, which is not a DECLARATION, so SOL-16's attachment rule had no
// declaration to land on. Zero of 5,976 symbols carried a licence, on a corpus where
// 389 of 389 files state one. Coverage is now 100%, and the two distinct identifiers in
// the corpus are MIT and BSD-3-Clause.

/// @notice A documented contract. The licence is a FILE fact, not a declaration fact,
/// so it belongs to the module symbol and to nothing below it.
contract Licensed {
    /// @notice A function that carries no licence of its own.
    function f() public pure returns (uint256) {
        return 1;
    }
}
