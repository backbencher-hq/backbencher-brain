// ONTOLOGY/D23 — a pure virtual is how C++ spells an interface operation, and the
// analyzer's own statement that a class is ABSTRACT was under-firing.
//
// A pure virtual is `= 0`, and this grammar writes the `0` in ONE OF TWO PLACES:
//
//   field_declaration [declarator=function_declarator type=primitive_type]
//     virtual, primitive_type "int", function_declarator …            <- `0` DIRECT
//
//   declaration [declarator=init_declarator type=primitive_type]
//     virtual, primitive_type "int",
//       init_declarator [declarator=function_declarator value=number_literal]
//                                                                        <- ONE LEVEL DOWN
//
// The old rule looked for a `number_literal` `0` among a node's DIRECT children, so
// it saw the first shape and could not see the second. Measured over the two pinned
// C++ corpora (7 pure-virtual sites in 4 files, counted structurally by
// `script/cpp-review/pure-virtual-census.ts`): the rule flagged 3 and MISSED 4.
//
// Nothing about the member SYMBOL changed — the name does not depend on the `0` —
// so no symbol count and no differential could see it. What was lost is
// `metadata.isPureVirtual` on 4 members and `metadata.isAbstract` on the classes that
// own them, and `BenchmarkReporter` was one of the misses: it is the corpus's
// most-inherited abstract base, named by 9 of the 42 `extends` edges.
//
// A SECOND HALF, in the same class of defect. A macro-decorated class head
// (`class BENCHMARK_EXPORT Reporter {`) is recovered by the grammar as a
// `function_definition` whose specifier has no body of its own and whose PARENT's
// `compound_statement` IS the body. The scope this analyzer built for it carried no
// `symbolRef`, and `isAbstract` is copied from the scope onto the class SYMBOL at
// scope exit — so the flag could not fire for a decorated head even when the member
// was found. `DecoratedReporter` below is that shape.
//
// And the rule now REQUIRES the declarator to be a `function_declarator`, which the
// direct-child scan did not: `virtual int zeroMember = 0;` is a member with an
// initialiser, not an interface operation.

// ---- SHAPE 1: the `0` is a direct child ---------------------------------------

class Channel {
 public:
  virtual ~Channel() = default;
  virtual int open(const char* name) = 0;
  virtual int close() = 0;
  // A defaulted parameter is still an interface operation.
  virtual int sync(int handle, int flags = 0) = 0;
  // A virtual with a BODY is not a pure virtual, so `Channel` is abstract because of
  // the three above and NOT because of this one.
  virtual int flush(int handle) { return handle; }
  // A non-virtual member is never an override target.
  int Helper(int handle) const { return handle; }
};

// ---- SHAPE 2: the `0` is one level down, behind `init_declarator` ---------------

struct Sink {
  virtual ~Sink() = default;
  virtual int deliver(int bytes) = 0;
};

// ---- SHAPE 2 again, inside a MACRO-DECORATED head (the second D9 half) --------

#define SINK_EXPORT

class SINK_EXPORT DecoratedReporter {
 public:
  virtual int begin(int run) = 0;
  virtual int end(int run) = 0;
};

// ---- SHAPE 2 inside a class whose head is decorated AND carries a base clause --
//
// `class MACRO Name : public Base {` is the A2 recovery shape, so this head has no
// specifier body either, and its inheritance clause is in an ERROR node. It is here
// because a class that is BOTH abstract and inherited is the population any
// `implements` reading would key on, and the two facts must not interfere.

class SINK_EXPORT DecoratedDerived : public DecoratedReporter {
 public:
  int begin(int run) override;
  int end(int run) override;
};

// ---- the CONTROL for the declarator requirement --------------------------------
//
// `virtual int zeroMember = 0;` carries a `0` and a `virtual`, and is neither a pure
// virtual nor an interface operation. Pre-D9 the direct-child scan could not reach
// this shape either (`= 0` sits in an `init_declarator`), so this class was
// accidentally right; the new rule reaches it and must still say no.

class WithZeroMember {
 public:
  virtual int zeroMember = 0;
  virtual int counted() const { return zeroMember; }
};

// ---- derived classes, so `overrides` has somewhere to resolve to ----------------

class FileChannel : public Channel {
 public:
  int open(const char* name) override;
  int close() override;
  int sync(int handle, int flags) override;
};

class NullChannel : public Channel {
 public:
  int open(const char*) override { return 0; }
  int close() override { return 0; }
  int sync(int handle, int) override { return handle; }
  // CONTROL for name hiding: a DIFFERENT parameter TYPE is not an override.
  int Helper(int handle, int extra) { return handle + extra; }
};

int FileChannel::open(const char*) { return 1; }
int FileChannel::close() { return 0; }
int FileChannel::sync(int handle, int) { return handle; }
int DecoratedDerived::begin(int run) { return run; }
int DecoratedDerived::end(int run) { return run; }
