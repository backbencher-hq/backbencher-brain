// D3 (#959): one edge per pair, for the shapes where many sites express ONE fact.
//
// The lane enforced that for `uses` (`usesSeen`) and for nothing else, so two
// other row kinds repeated themselves:
//
//   contains    841 excess rows over 554 real C++ files. Containment is a
//               relation between two NAMED ENTITIES: `person contains
//               constructor` is a fact about the class, not about each of its
//               14 overloads. But constructors normalize to the single name
//               "constructor" (the family contract, C# parity) and operator
//               overloads keep their spelling, so a class with 14 constructors
//               published 14 identical rows.
//   references   87 excess rows. An `#include` is a compile-time DEPENDENCY, and
//               a file that writes `#include <vector>` six times depends on
//               `vector` once.
//
// `calls` is NOT in this fixture's forbids, and that is the measured distinction
// the first cut of the register got wrong (it reported 29,708): line N calling
// `foo` and line M calling `foo` are TWO facts, each carrying its own M59.A7
// `line_number`, and the C, TypeScript and Java lanes all emit both. The repeated
// calls at the bottom of `talker()` are pinned as EXPECTED for that reason.

#include <vector>
#include <vector>
#include <string>
#include <string>
#include <string>
#include <map>
#include <map>

using std::vector;
using std::vector;
using std::string;

struct Person {
    Person() : name_(""), age_(0) {}
    explicit Person(const std::string& n) : name_(n), age_(0) {}
    Person(const std::string& n, int a) : name_(n), age_(a) {}
    Person(const std::string& n, int a, bool) : name_(n), age_(a) {}
    Person(Person&&) = default;
    Person& operator=(Person&&) = default;

    std::string name_;
    int age_;
    int age() const { return age_; }
    int age(int v) { age_ = v; return age_; }
    int age(int v, int w) { age_ = v + w; return age_; }
};

// D3a: 14 constructor overloads, all named "constructor". ONE contains edge.
struct Overloads {
    Overloads() {}
    Overloads(int) {}
    Overloads(int, int) {}
    Overloads(double) {}
    Overloads(char) {}
    Overloads(int*) {}
    Overloads(int**, int) {}
    Overloads(int, int*) {}
    Overloads(int, char) {}
    Overloads(char, int) {}
    Overloads(long) {}
    Overloads(unsigned) {}
    Overloads(short) {}
    Overloads(float) {}
    int run() const { return 1; }
};

// D3b: four `age` overloads. ONE contains edge — the first declaration's line.
int talker() {
    Person p("a", 1);
    int x = p.age();     // call site 1
    int y = p.age(2);    // call site 2
    int z = p.age(3, 4); // call site 3
    // D3c: the SAME call three times. THREE call facts, not one — each carries
    // its own line_number, and the C/TypeScript/Java lanes all emit both.
    int w = p.age();
    w = p.age();
    w = p.age();
    return x + y + z + w + p.age_;
}

int main() {
    std::vector<int> v;
    v.push_back(1);
    v.push_back(2);
    v.push_back(3);
    Overloads o;
    Person p;
    return talker() + o.run() + (int)v.size() + p.age();
}
