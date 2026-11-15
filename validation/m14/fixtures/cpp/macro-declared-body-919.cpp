// #919: a MACRO-DECLARED BODY — a call-shaped macro standing as the whole
// heading of a block. The pinned grammar reads the heading as an
// `expression_statement` whose `;` is MISSING and leaves the block as a
// SIBLING, so the body sat inside NO function scope: its locals published as
// file-scope symbols and every read in it was attributed to `global`.
// Measured before the fix on the two cpp corpora: 3,003 bodies, 5,680 leaked
// symbols, 28,172 edges sourced at `global`.
//
// Control: `control_fn` is a real `function_definition` with the same locals
// and the same read — the recovery must leave it exactly as it was.

int file_value = 7;

int real_fn(int x) { return x + file_value; }

TEST(my_case, keeps_its_locals) {
  int local_tmp = real_fn(41);
  int check = local_tmp + file_value;
  (void)check;
}

TEST_CASE("sectioned body") {
  int case_local = real_fn(1);
  SECTION("inner") {
    int section_local = case_local + file_value;
    (void)section_local;
  }
}

int control_fn() {
  int local_tmp = real_fn(2);
  return local_tmp + file_value;
}
