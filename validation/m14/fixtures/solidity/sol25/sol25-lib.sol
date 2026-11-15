// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-25 — the DECLARERS. Two libraries declare a member of the same name (`shared`), so a
// bare `shared` target can never name one declaration; the receiver's declared type does.
library Lib {
    struct T { uint256 x; }

    function shared(T storage self) internal view returns (uint256) { return self.x; }
    function only(T storage self) internal view returns (uint256) { return self.x + 1; }
}

library Lib2 {
    struct T { uint256 y; }

    function shared(T storage self) internal view returns (uint256) { return self.y; }
}

// A third library, reached only through its own NAME (`LibMath.min(...)`) — the static-call shape.
library LibMath {
    function min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}

// The type a CONVERSION receiver names (`IThing(a).ping()`).
interface IThing {
    function ping(uint256 x) external view returns (uint256);
}

// Two types declare `inherited`, so the bare spelling collides project-wide.
contract BaseA {
    modifier onlyBoss() { _; }
    function inherited() internal virtual {}
    function unique() internal {}
}

contract BaseZ {
    // The SAME modifier name in a second type, so the bare spelling collides project-wide.
    modifier onlyBoss() { _; }
    function inherited() internal virtual {}
}
