int real_fn(int x) { return x * 2; }

TEST(my_suite, does_things) {
  int local_tmp = real_fn(41);
  int check = local_tmp + 1;
}

TEST_F(other_suite, more_things) {
  int other_tmp = real_fn(1);
}

BOOST_AUTO_TEST_CASE(solo_case) {
  int solo_tmp = real_fn(2);
}
