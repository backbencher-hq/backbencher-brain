// SPDX-License-Identifier: MIT
// Fixture: `using L for T` is NOT `mixes_in`, and this file is the control for that
// refusal — the DECLARED-HOST forms are forbidden here for the same reason the
// primitive and wildcard forms are, because the reason is not "no source symbol".
//
// THE TEMPTATION, stated plainly, because the refusal is only worth pinning if the
// near-miss is real: `using MathLib for Price;` names a member set (`MathLib`),
// attaches it to a declared type (`Price`), and declares NO CONFORMANCE. So
// `extends`/`implements` are false, and `uses` — a name READ — looks too weak for a
// directive that changes what `p.double()` means. That is exactly the shape the
// fleet publishes as `mixes_in` in PHP (`use Trait`) and Go (embedded struct).
//
// WHY IT IS NEVERTHELESS FALSE, in the vocabulary's own words (src/ast/types.ts):
// `mixes_in` is "a class COMPOSES a mixin into its SUPERTYPE CHAIN … the mixin is a
// SUPERTYPE MEMBER". The members must enter the composing type. PHP flattens the
// trait's members into the class's method table and Go PROMOTES the embedded
// struct's methods into the outer struct's method set; consumers of this value read
// it as supertype composition (src/intelligence/graph/graph-engine.ts ranks it
// between `implements` and `renders`).
//
// SOLIDITY ADDS NO MEMBER TO THE TYPE. After `using MathLib for Price`:
//   · `Price` has no member `double` — it is still `uint128` and nothing else;
//   · `Price`'s ABI, inheritance chain and type identity are unchanged;
//   · `p.double()` compiles as `MathLib.double(p)` only where the directive is IN
//     SCOPE (`global` widens the SCOPE, not the type).
// The composing actor is therefore the SCOPE, not the type, so the row would name
// the wrong actor as well as the wrong relation.
//
// WHAT IS PINNED HERE, IN BOTH DIRECTIONS:
//   FIRE  `references Market -> MathLib` — the TRUE relation: the file read the
//         library's name. It is published once per directive and it survives the
//         refusal, so nothing is lost by not publishing `mixes_in`.
//   FIRE  `extends Market -> BaseMarket`, `implements Market -> IRenderer` — the
//         conformance construct, beside the refusal, so "no conformance declared"
//         cannot be used to relabel a class header.
//   FIRE  `imports -> ./Counterpart.sol` and `instantiates make -> Market` — the
//         two neighbours a part_of or renders rule would steal.
//   FORBID `mixes_in` for EVERY form of the directive, including the two that a
//         declared-host rule WOULD have published: `using MathLib for Price` and
//         `using MathLib for Amount`. A fixture that forbade only the primitive and
//         wildcard forms would pass while the real defect was live — measured: an
//         emission that passed the declared-host test published 27 such rows over
//         the whole population before it was withdrawn.
//
// The construct population is measured, not argued:
// validation/m14/measurements/solidity-extended-census.json counts 124
// `using_directive` sites in 76 files, of which 27 have a declared host and one
// library (23 struct, 3 interface, 1 struct+type), 0 of which add a member to the
// type. See script/m14/spec/solidity-completeness.json coverage.excluded.mixes_in.

pragma solidity ^0.8.0;

import "./Counterpart.sol";

library MathLib {
    function double(uint256 x) internal pure returns (uint256) {
        return x * 2;
    }
}

// A file-level function, so the BRACED form has a function to name.
function plus(uint256 a, uint256 b) pure returns (uint256) {
    return a + b;
}

// The two user-defined host kinds a `using ... for` names.
type Price is uint128;

struct Amount {
    uint256 raw;
}

interface IRenderer {
    function draw(uint256 id) external view returns (string memory);
}

abstract contract BaseMarket {
    function label() public pure virtual returns (string memory);
}

contract Market is BaseMarket, IRenderer {
    // FORBID (1) — a DECLARED host. This is the form a declared-host rule published,
    // and the one that must not come back.
    using MathLib for Price;

    // FORBID (2) — a struct host, also declared in this file.
    using MathLib for Amount;

    // FORBID (3) — a primitive host: no source symbol exists.
    using MathLib for uint256;

    // FORBID (4) — the braced form: a SET of functions, not one member set.
    using {plus} for uint256;

    function label() public pure override(BaseMarket) returns (string memory) {
        return "Market";
    }

    function draw(uint256) external pure returns (string memory) {
        return "x";
    }

    function quote() external pure returns (Price) {
        return Price.wrap(1);
    }
}

// FORBID (5) — the wildcard form, legal only at file scope: no host type.
using MathLib for *;

contract ViewFactory {
    // A positive control beside the renders refusal: `new Market()` is a
    // CONSTRUCTION, and it publishes `instantiates` — the relation a render rule
    // must not steal.
    function make() external returns (Market) {
        return new Market();
    }

    // The renders negative: markup TEXT from a pure function is a value, not a
    // component, and the vocabulary has no component symbol kind.
    function html() external pure returns (string memory) {
        return "<div>market</div>";
    }
}
