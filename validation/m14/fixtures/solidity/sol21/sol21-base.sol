// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice An interface declared in ANOTHER file, which is the whole point.
interface IThing {
    function feedKind() external pure returns (uint256);
}

/// @notice A base declared in ANOTHER file.
abstract contract FeedBase is IThing {
    function latest() public view virtual returns (uint256) {
        return 1;
    }
}

/// @notice A LIBRARY in the other file. A using-directive makes its members
/// callable without putting Lib in the contract's INHERITANCE chain, so a call to one
/// is a project member but not a RESOLVABLE inherited member. That distinction is the
/// whole reason projectMemberCandidate exists as a separate grade.
library Lib {
    function twice(uint256 x) internal pure returns (uint256) {
        return x * 2;
    }
}
