// ONTOLOGY `overrides`: a PURE VIRTUAL is how C++ spells an interface, and it was
// invisible to the analyzer in two separate ways.
//
// (1) THE SYMBOL. `= 0` parses with the declarator one level down:
//
//     virtual bool ReportContext(const Context& context) = 0;
//       declaration [declarator=init_declarator type=primitive_type]
//         init_declarator [declarator=function_declarator value=number_literal]
//           function_declarator [declarator=identifier parameters=parameter_list]
//
// `init_declarator` was missing from the declarator-wrapper list in
// `getFunctionDetails`, so the lookup missed the declarator and returned null — and
// the caller takes the function's SYMBOL and its SCOPE out of that result. So the
// interface's own methods were published NOWHERE: `BenchmarkReporter` published
// `ReportRunsConfig`, `Finalize`, `List` and nine more, and not `ReportContext` or
// `ReportRuns` — the two members that ARE the interface.
//
// (2) THE SIGNATURE KEY. The override matcher built a parameter signature with a
// SECOND, weaker name lookup (a `declarator`-FIELD chain only). A parameter
// declared `const Context& context` has its name under a `reference_declarator` as
// a plain NAMED child, so the name resolved to nothing and the whole parameter text
// — name included — became the "type". Then a base naming its parameter `report`
// and a derived naming the SAME TYPE `reports` produced two different keys and no
// edge. A name is not part of a C++ signature, so those ARE one signature and the
// override is real virtual dispatch.
//
// Measured before/after on `cpp-sample/include/benchmark/reporter.h`:
// `overrides` 0 -> 6 rows, and `BenchmarkReporter.ReportContext` / `.ReportRuns`
// went from unpublished to published members.
//
// The two cases at the bottom are the CONTROL in both directions: a same-name
// parameter must still match, and a genuinely DIFFERENT parameter type must still
// not (C++ name hiding, not virtual dispatch).

struct Context { int a; };
struct Run { int b; };

class Base {
 public:
  virtual ~Base() = default;
  // Pure virtuals — the interface.
  virtual bool ReportContext(const Context& context) = 0;
  virtual void ReportRuns(const std::vector<Run>& report) = 0;
  // A defaulted parameter is not part of a signature either.
  virtual int Weighted(int seed, int weight = 1) = 0;
  // A non-virtual member is never overridden.
  int Helper(int seed) const { return seed; }
};

class Same : public Base {
 public:
  bool ReportContext(const Context& context) override;
  void ReportRuns(const std::vector<Run>& report) override;
};

class Renamed : public Base {
 public:
  // SAME TYPES, different parameter NAMES. This is the case the second name rule
  // got wrong: `report` vs `reports`, `context` vs `ctx`.
  void ReportRuns(const std::vector<Run>& reports) override;
  bool ReportContext(const Context& ctx) override;
};

class Hidden : public Base {
 public:
  // A DIFFERENT parameter TYPE. C++ name hiding, NOT an override — and the one
  // control that proves the type-only signature still discriminates.
  void ReportRuns(const Context& context) override;
  int Weighted(int seed, int weight, int extra) override;
};

bool Same::ReportContext(const Context& context) { return context.a > 0; }
void Same::ReportRuns(const std::vector<Run>& report) { (void)report.b; }
void Renamed::ReportRuns(const std::vector<Run>& reports) { (void)reports.b; }
bool Renamed::ReportContext(const Context& ctx) { return ctx.a > 0; }
void Hidden::ReportRuns(const Context& context) { (void)context.a; }
int Hidden::Weighted(int seed, int weight, int extra) { return seed + weight + extra; }

// THE SHAPE THAT NEEDS THE `init_declarator` DESCENT.
//
// A pure virtual inside an ordinary class parses as
//
//   field_declaration [declarator=function_declarator type=primitive_type]
//     virtual, primitive_type "int", function_declarator …            <- DIRECT
//
// and inside a MACRO-DECORATED class it parses as
//
//   declaration [declarator=init_declarator type=primitive_type]
//     init_declarator [declarator=function_declarator value=number_literal]
//       function_declarator …                                          <- ONE LEVEL DOWN
//
// Both occur in real code in the same corpus (4 sites vs 3 over 128 admitted
// files), and only the second is invisible to a shallow declarator lookup. Since
// the `Base` above is an ordinary class, it does NOT exercise the descent — this
// block is what does, and it is why the base's own pure virtuals below are the
// ones that were missing from the graph.
#define IFACE_EXPORT

class IFACE_EXPORT Decorated {
 public:
  virtual ~Decorated() = default;
  virtual int tick(int seed) = 0;
  virtual void flush(bool hard) = 0;
};

class IFACE_EXPORT Impl : public IFACE_EXPORT Decorated {
 public:
  int tick(int seed) override;
  void flush(bool hard) override;
};

int Impl::tick(int seed) { return seed + 1; }
void Impl::flush(bool hard) { (void)hard; }