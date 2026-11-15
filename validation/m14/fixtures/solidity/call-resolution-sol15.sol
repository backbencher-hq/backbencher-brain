// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-15 — call-edge resolution. Authored 2026-09-30.
//
// This fixture exists because the CORPUS cannot test the interesting half of
// SOL-15. Measured over 389 files and 3,878 `calls` edges, `localFunction` and
// `inheritedMember` are both ZERO: OpenZeppelin is modularised so thoroughly
// that nearly every call leaves the file it is written in. So the branches that
// actually RESOLVE something had no row anywhere, and the first version of the
// classifier was wrong in a way no corpus row could have caught — it tested the
// member CLOSURE, which already contains the inherited members, so an inherited
// call classified as `localFunction` and `inheritedMember` could never fire.

library Helpers {
  function twice(uint256 x) internal pure returns (uint256) {
    return x * 2;
  }

  function tripled(uint256 x) internal pure returns (uint256) {
    return x * 3;
  }

  function isTriple(uint256 x) internal pure returns (bool) {
    return x == tripled(x);
  }
}

contract Base {
  function inheritedFn() internal view returns (uint256) {
    return 1;
  }
}

error Boom(uint256 code);

contract Child is Base {
  using Helpers for uint256;

  function localFn() internal pure returns (uint256) {
    return 7;
  }

  function everything() external view returns (uint256) {
    localFn();          // localFunction    — declared on Child
    inheritedFn();      // inheritedMember  — declared on Base, reached through `is`
    uint256(1).twice();  // inFileTypeMember — Helpers, reached through `using for`
    return Helpers.twice(4);  // a receiver-qualified call: `Helpers.twice`
  }

  function boom() external pure {
    revert Boom(1);     // errorRevert — a custom error, not a function
  }
}

// The ALIASED `using` form, at FILE scope — the only shape the grammar accepts
// without an ERROR, and the shape the corpus uses (4 occurrences, all in
// contracts/account/utils/draft-ERC7579Utils.sol). Its `using_alias` case had NEVER
// FIRED: it looked for DIRECT `identifier` children, while the grammar nests the name
// as `using_alias (user_defined_type (identifier)) (user_definable_operator)`, so the
// loop body never ran and 4 real nodes produced 0 edges.
//
// The aliased name is BARE, exactly as the corpus writes it (`using {eqCallType as
// ==} for CallType global`). `using {Helpers.isTriple as ==}` is not accepted by this
// grammar — the qualified path parses as ERROR — and the qualified form is also why an
// earlier draft of this fixture pointed the edge at `Helpers` rather than at the
// function, which is the one name this construct exists to record.
using {isTriple as ==} for uint256 global;
