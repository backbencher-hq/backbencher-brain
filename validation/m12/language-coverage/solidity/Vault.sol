// SPDX-License-Identifier: MIT
// Minimal Solidity fixture for the M12 language-coverage gate.
//
// Solidity was ABSENT from SUPPORTED_LANGUAGES while the engine already had a
// wasm case, an analyzer and a pinned grammar (see the note on that entry), so it
// is exactly the kind of language this gate has to reach end to end. An interface
// and a contract with a named function.

pragma solidity ^0.8.0;

interface ICoverageVault {
    function deposit(uint256 amount) external;
}

contract CoverageVault is ICoverageVault {
    uint256 public total;

    function deposit(uint256 amount) public override {
        total += amount;
    }
}
