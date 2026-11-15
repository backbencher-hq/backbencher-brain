// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Checked {
    /// @notice The CORRECT case: every parameter is documented and there is a return.
    /// @param a the first
    /// @param b the second
    /// @return sum a + b
    function correct(uint256 a, uint256 b) public pure returns (uint256 sum) {
        return a + b;
    }

    /// @notice AN UNDOCUMENTED PARAMETER. Benign — plenty of code documents only the
    ///         interesting ones — and reported as a coverage figure, not a defect.
    function undocumented(uint256 a, uint256 b) public pure returns (uint256) {
        return a + b;
    }

    /// @notice A `@param` naming a parameter that DOES NOT EXIST. A real error: the
    ///         documentation describes an argument the function has not got, and a
    ///         reader following it will look for something that is not there.
    /// @param real the one that exists
    /// @param ghost the one that does not
    function overDocumented(uint256 real) public pure returns (uint256) {
        return real;
    }

    /// @notice A `@return` on a function that returns NOTHING. The mirror of the case
    ///         above, and equally a real error.
    /// @return nothing at all
    function returnWithoutReturn() public pure {
        // deliberately empty
    }
}
