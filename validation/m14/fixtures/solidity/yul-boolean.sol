contract T {
  function t() public pure {
    assembly { let x := true }
  }
}
