// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./sol25-lib.sol";

// SOL-25 — four shapes, two of which must be rewritten and three of which must NOT be.
contract Child is BaseA {
    using Lib for Lib.T;

    Lib.T internal stored;

    // 1. RECEIVER-TYPED. `t` is declared `Lib.T`, whose closure declares `shared` exactly once,
    //    and `shared` is declared by two project types, so the bare spelling is ambiguous and the
    //    site's own declared type determines the declarer. Target: `Lib.shared`.
    function viaMember(Lib.T storage t) internal view returns (uint256) {
        return t.shared();
    }

    // 2. RECEIVER-TYPED, state variable: same evidence, the receiver is a state declaration.
    //    Target: `Lib.shared`.
    function viaStored() internal view returns (uint256) {
        return stored.shared();
    }

    // 3. IMPLICIT `this`. `inherited` is declared by BaseA and BaseZ, so the bare name collides
    //    project-wide; Child's inheritance closure names BaseA as the one declarer.
    //    Target: `BaseA.inherited`.
    function viaThis() internal {
        inherited();
        unique();          // 4. CONTROL — `unique` is declared by ONE type, so the bare name
                           //    already names one declaration and the pass stays out.
    }
}

// 5. NEGATIVE — the declarer is the ENCLOSING type (its own override), so there is no ancestor to
//    qualify to and the row keeps its bare target.
contract Both is BaseA, BaseZ {
    function inherited() internal override(BaseA, BaseZ) {}

    function callOwn() internal {
        inherited();
    }
}

// 6. NEGATIVE — the same NAME is declared with two types in this file, so the receiver's type is
//    not a fact about the site; a candidate is not a resolution.
contract Shadow {
    Lib.T internal dup;

    function viaDup(Lib2.T storage dup) internal view returns (uint256) {
        return dup.shared();
    }
}

// 7. STATIC CALL — the SOURCE names the owner. Target: `LibMath.min`.
contract StaticUse {
    function viaStatic() internal pure returns (uint256) {
        return LibMath.min(1, 2);
    }
}

// 8. NEGATIVE for the static rule — a VALUE shadows the library's name, so the object is a
//    receiver, not the type: the site's declared type decides, and the target is `Lib2.shared`,
//    never `Lib.shared`.
contract ShadowedLibrary {
    Lib2.T internal Lib;

    function viaShadowed() internal view returns (uint256) {
        return Lib.shared();
    }
}

// 9. CONTAINER receiver — the value is not a declared variable but an ELEMENT of one. The
//    mapping's VALUE TYPE (`Lib.T`) names the receiver. Target: `Lib.shared`.
contract ContainerUse {
    mapping(bytes32 => Lib.T) private _byKey;

    function viaContainer(bytes32 k) internal view returns (uint256) {
        return _byKey[k].shared();
    }
}

// 10. CONVERSION receiver — the source itself states the type. Target: `IThing.ping`.
contract ConversionUse {
    function viaConversion(address a) internal view returns (uint256) {
        return IThing(a).ping(1);
    }
}

// 11. INHERITED MODIFIER — applied here, declared on the base in the other file, with the SAME
//     name declared by a second type. Target: `BaseA.onlyBoss`.
contract ModUser is BaseA {
    function viaModifier() internal onlyBoss {}
}
