// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./sol21-base.sol";

/// @notice Inherits a base AND an interface that live in ANOTHER file. Both are
/// DIRECT bases on purpose: an inheritance edge is only emitted for a DIRECT base, so
/// listing only FeedBase would put IThing one level up and OUT of the graph entirely,
/// which is what the first draft of this fixture did — and it made the index look as
/// though it had nothing to settle.
contract Feed is FeedBase, IThing {
    using Lib for uint256;

    /// @dev Calls a free function of the OTHER file LIBRARY through a using
    ///     directive. The name is a project member, but WHICH type is meant is not
    ///     decided by the call site, so this must stay a CANDIDATE and not a resolution.
    function doubled(uint256 x) external pure returns (uint256) {
        return x.twice();
    }

    /// @dev Calls a member of the OTHER file's base. Undecidable without an index.
    function current() public view returns (uint256) {
        return latest();
    }

    /// @dev Implements the OTHER file's interface function.
    function feedKind() external pure override returns (uint256) {
        return 7;
    }
}
