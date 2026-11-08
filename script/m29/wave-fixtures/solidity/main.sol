// SPDX-License-Identifier: MIT
// PINS the solidity wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: contract Greeter with function greet, exercised in greetAll.

pragma solidity ^0.8.20;

/// @title Greeter
/// @notice A greeter that reports the number of items it stores.
contract Greeter {
    string[] private items;

    constructor(string[] memory initialItems) {
        items = initialItems;
    }

    /// @notice Returns the greeting for the stored items.
    function greet() public view returns (uint256) {
        return items.length;
    }

    /// @notice Exercises greet from a second function.
    function greetAll() public view returns (uint256) {
        return greet() + 1;
    }
}
