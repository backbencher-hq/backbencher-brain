function describe(user, { verbose } = {}) {
  if (verbose) {
    return user;
  }
  return null;
}

module.exports = { describe };
