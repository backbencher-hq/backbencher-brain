#include <vector>

int g_counter;
void take(int v);

namespace N {
int x;
int getx() { return x; }
}

using namespace N;

struct S {
  int count;
  void bump() { count = count + 1; }
  static void reset_all();
};

enum Color { RED, GREEN };

int g_var;
void f(int p) {
  int local = g_var;
  g_var = p;
  take(g_var);
}

void h() {
  int g_var = 0;
  g_var = 1;
}

void cb_user(void (*cb)(int));
void target_fn(int v);
void reg() { cb_user(target_fn); }

int use_enum(Color c) {
  switch (c) {
    case RED: return 1;
    default: return 0;
  }
}

int use_ns() { return x + g_counter; }

template <typename T>
T ident(T v) { return v; }
int use_tmpl() { return ident<int>(g_counter); }

static void hidden_helper() {}
void shown_caller() { hidden_helper(); take(g_counter); }

// CP5 (second review): out-of-line member reads resolve through the
// owning class (the scope carries its class; inline and out-of-line
// bodies behave identically).
struct Meter {
  int total;
  void add(int v);
};
void Meter::add(int v) {
  total = total + v;
}

// CP7 (second review): nested out-of-line definitions resolve through
// the INNERMOST class. (Source attribution follows the analyzer's
// qualified method symbol name.)
struct Outer {
  struct Inner {
    int n;
    void step();
  };
};
void Outer::Inner::step() {
  n = n + 1;
}

// CP6 (second review): structured bindings declare every name (never
// read). `a` collides with the file value on purpose: pre-fix it leaked
// as uses destructure->a.
int a = 10;
struct Pair { int first; int second; };
int g_alpha = 1;
void destructure() {
  Pair pr{0, 0};
  auto [a, b] = pr;
  int z = a + b + g_alpha;
}

// CP8 (second review): member/enumerator declarator segments — the first
// identifier of a fresh segment declares, the rest read (`bound`/`A`
// declare; LIMIT reads).
int LIMIT = 100;
struct Config {
  int bound = LIMIT;
};
enum Level { LOW = LIMIT, HIGH = 200 };
