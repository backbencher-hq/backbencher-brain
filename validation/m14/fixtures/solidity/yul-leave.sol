contract T {
  function t() public pure {
    assembly {
      switch 1 default { leave }
    }
  }
}
