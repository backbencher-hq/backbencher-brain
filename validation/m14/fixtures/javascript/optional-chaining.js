class Guard {
  probe(user) {
    return user?.account?.owner?.label;
  }
}
