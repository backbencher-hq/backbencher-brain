contract T {
  function t() public pure {
    assembly {
      for { let i := 0 } lt(i, 3) { i := add(i, 1) } { if iszero(i) { continue } pop(i) }
    }
  }
}
