// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-16 — NatSpec. Authored 2026-09-30 from the analyzer's measured output.
//
// Before SOL-16 this lane read NO documentation: 5,254 `comment` nodes over the
// 389-file corpus, zero reaching a symbol, so `brain_symbol.docstring` was NULL
// for every Solidity symbol the index has ever produced. Solidity's `///` and
// slash-star forms are exactly what the TypeScript lane extracts from JSDoc, so
// this was the single largest depth gap between the two analyzers.

/// @title A documented library
/// @notice Does documented things.
/// @author Someone
library Docs {
    /// @notice Storage slot 0.
    /// @dev Written by hand.
    uint256 internal constant SLOT = 0;

    /**
     * @notice Read the slot.
     * @param self the receiver
     * @return v the value
     */
    function read(Docs self) internal pure returns (uint256 v) {
        return SLOT;
    }

    // A plain line comment, NOT NatSpec. Pinned because Solidity has three comment
    // forms and a lane that reads documentation should be able to say which one it
    // read — a stray remark above a declaration is not documentation of it.
    uint256 internal other;
}

/// @notice A documented interface.
interface IThing {
    /// @notice Ping it.
    function ping() external;
}

// A trailing remark that documents nothing: Solidity attaches documentation to what
// FOLLOWS it, so this run has no declaration to land on and must not be published.