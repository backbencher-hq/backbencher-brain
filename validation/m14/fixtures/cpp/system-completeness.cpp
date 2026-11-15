#include <vector>
#include <memory>

// CPPD12 regression (deep review 2026-09-05): using-declarations must persist
// as {module, items} imports + a references edge (the legacy {source,
// imported} shape was dropped by the persister).
using namespace std;
using std::pair;

class Base {
public:
    virtual void draw() = 0;
};

class Shape : public Base {
public:
    void draw() override {}
    Shape() { data_ = std::make_unique<int>(7); }
    ~Shape() {}
private:
    std::unique_ptr<int> data_;
};

void render(Shape& s) {
    s.draw();
}

Shape* build() {
    // CPPD8 regression (M37.9, fmt gtest Message ctor): leading global-scope
    // `::` nests an extra qualified_identifier level — `new
    // ::std::stringstream` is qualified > qualified("std::stringstream") >
    // type_identifier, so one unwrap leaves "std::stringstream" (still
    // qualified) and the leaf regex dropped the edge. Must descend to the
    // innermost name.
    auto buf = new ::std::stringstream();
    (void)buf;
    return new Shape();
}
