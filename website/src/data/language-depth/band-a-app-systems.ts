// Band A — Application & systems (15 families).
//
// Every record below was written by reading the family's own analyzer in
// src/ast/ — the file name is `real-<lang>-analyzer.ts` — and, where one
// exists, its contract in docs/analyzers/. The claims are checked against the
// module's SymbolKind and RelationshipType sites, not against anything the
// website said about the language before.
//
// `limitations` is the most valuable field here. Each line names a specific
// construct the analyzer declines, filters or bounds, because that boundary is
// what a reader actually needs and no dataset can supply it.
//
// TWO RULES THAT CHANGED THE SHAPE OF EVERY RECORD BELOW:
//
// 1. A missing relationship type is a fact about the FORMAT, not about analyzer
//    quality. Go has no inheritance, so it has no `overrides`. Rust has no
//    overriding, so a trait impl is `implements`. Erlang has no inheritance at
//    all. Zig composes rather than inherits. C has no class heritage. Those
//    families are written as having what their format expresses, and the
//    absence is stated as the format fact it is. The opposite case is not
//    softened either: a language that HAS call syntax and whose analyzer does
//    not resolve it would be a real defect, and none is claimed here.
//
// 2. Every family here has a hand-written analyzer. `GenericAnalyzer` is the
//    unreachable `default:` branch of getAnalyzer and describes code that never
//    runs, so no record below may claim a family is missing one.
//
// (Where the word "tier" appears further down it means a CONFIDENCE tier inside
// an analyzer's override resolver — Java's and Swift's three-tier pass — which is
// the engine's own vocabulary. It is not the removed `LangFamily.tier` label.)

import type { LanguageDepth } from "./types"

export const BAND_DEPTH: Record<string, LanguageDepth> = {
  TypeScript: {
    headline:
      "TypeScript is one of only two families bb supports that construct all ten relationship types, and the one where they connect: imports and exports name both what a symbol reaches and who reaches it, so an agent can walk out from a declaration to everything that breaks if it changes.",
    agentAsks: [
      "Which functions and components import this one?",
      "What breaks downstream if I rename this export?",
      "Which classes implement this interface, and which member implements which?",
      "Which class does this method override?",
    ],
    limitations: [
      "Runtime globals are excluded from construction: new Promise() and new Map() record no instantiation edge, because those build the platform's runtime rather than a type declared in the repository.",
      "A computed call names no callee, so handlers[key]() records nothing, and a decorator's argument list is walked for names but not for calls.",
      "Override matching abstains instead of pairing: when a name is overloaded on either side, or the base type is not in the indexed set, the member is left unmatched rather than attached to a candidate.",
    ],
    sample: {
      caption: "A class, its interface and the member that implements it",
      code: `export interface Cacheable {                  // bb records: interface Cacheable
  drop(id: string): void                   // bb records: method drop
}

export class TokenStore implements Cacheable {
  private cache = new Map<string, Token>()   // bb records: property cache
  drop(id: string): void {                   // bb records: an override of drop
    this.cache.delete(id)
  }
}`,
    },
    whereItShowsUp: [
      ".ts and .tsx are separate registry languages, so a JSX component is indexed under tsx rather than folded into .ts.",
      "Declaration files (.d.ts) carry types with no bodies: the symbols are recorded and there is nothing to walk into.",
      "Path aliases (@/lib/…) resolve through tsconfig, so a barrel index.ts sits between the import and the file that declares the symbol.",
    ],
  },

  JavaScript: {
    headline:
      "JavaScript is indexed per file with real containment — a class's methods, its accessors and its X.prototype.m = fn assignments are recorded as symbols the class owns — and CommonJS export shapes are read, not just ESM ones.",
    agentAsks: [
      "Which functions call this one?",
      "Which methods belong to this class, including ones added on the prototype?",
      "What does this module export, including its CommonJS exports?",
      "Which decorators does this component carry?",
    ],
    limitations: [
      "A CommonJS require(\"m\") says the module was loaded, not which member was taken, so the edge names the module as a wildcard and is published as unresolved rather than guessed at.",
      "A computed call names no callee: handlers[key]() records no call edge at all.",
      "An override of a base declared in another file cannot be verified from this file alone. It falls back to the first parent in the hierarchy, published at a lower confidence with the guess marked as one.",
    ],
    sample: {
      caption: "A class, a method, and a prototype method — three symbols owned by one class",
      code: `import { Store } from "./store";

export class Cart extends Store {            // bb records: class Cart · extends Store
  total() { return this.items.length }       // bb records: method total
}

Cart.prototype.clear = function () {         // bb records: method clear on Cart
  this.items = []
}`,
    },
    whereItShowsUp: [
      "A package usually mixes CommonJS require and ESM import, sometimes for one dependency, so both edge shapes appear in a single repository.",
      "Pre-ES6 libraries attach methods with X.prototype.m = fn, which bb records as members the class owns rather than as loose functions.",
      "A bundler emits one very large generated .js per entry point, so the same class can appear twice — once as source, once inside the build.",
    ],
  },

  Python: {
    headline:
      "Python is indexed with forward resolution: a class declared below the line that uses it is still recognised, so construction and call edges land on real names instead of dangling — and a module's __all__ becomes a queryable export surface.",
    agentAsks: [
      "Which classes extend this base, and which method overrides which?",
      "What does this module export through __all__?",
      "Which functions in this file call that one?",
      "Which attributes does this class assign to self, and which methods read them?",
    ],
    limitations: [
      "Builtins are excluded from the call graph on purpose: a builtin is a call into the interpreter, not a node in the repository. The same rule drops every __dunder__ call.",
      "A callee that is not a plain name or an attribute names nothing statically, so (f if flag else g)(), FACTORIES[k](x) and f()() all record nothing — a fallback to the first child node was removed because it produced fabrications.",
      "A decorator call is never a call edge, and a def nested inside another function publishes no symbol at all: its body is attributed to the enclosing function, because a local function is a scope, not a declaration.",
    ],
    sample: {
      caption: "A class with two methods, plus the type its annotation names",
      code: `from .models import User

class Cart(Base):                       # bb records: class Cart · extends Base
    def add(self, user: User) -> None:  # bb records: method add · references User
        self.count += 1                 # bb records: attribute count

    def total(self) -> int:             # bb records: method total
        return self.count`,
    },
    whereItShowsUp: [
      "__init__.py marks a package, so a bare import utils inside one is relative to the importing file — the same name can mean different modules in different directories.",
      "Framework code is mostly inheritance: models, views and serializers subclass bases that live in the framework or in another installed app.",
      "Type annotations name types across module boundaries, so a method's parameters carry references to types the file never declares.",
    ],
  },

  Rust: {
    headline:
      "Rust is indexed with its trait algebra intact: an impl Trait for Type becomes an implements edge, a supertrait bound becomes extends, and every method lands on the impl that owns it — so an agent can ask what a type can do.",
    agentAsks: [
      "Which types implement this trait?",
      "What does this trait require of its implementers?",
      "Which methods in this impl block are trait methods, and which are inherent?",
      "Which handler serves this route path?",
    ],
    limitations: [
      "Construction is resolved in-file and deferred: Vec::new() records a call to new and no instantiation, because Vec is not declared in this file, and a bare Ok(()) never resolves to a local struct Ok — that spelling belongs to the prelude's own variant.",
      "There is no override edge, and that is a fact about Rust rather than about the analyzer: a trait impl is implements, and nothing in the format says one inherent method replaces another.",
      "A macro named str! is unreachable as a call target: the lexer reads it as the primitive-type keyword. 475 of the 476 affected files in the pinned corpus parse once str! is substituted with a same-length spelling.",
    ],
    sample: {
      caption: "A trait, the impl that satisfies it, and the struct it is written on",
      code: `pub trait Handler {                       // bb records: trait Handler
    fn handle(&self, req: Request) -> Response;   // bb records: method handle
}

pub struct Router { pool: Pool }        // bb records: struct Router · field pool

impl Handler for Router {                // bb records: Router implements Handler
    fn handle(&self, req: Request) -> Response {
        self.pool.submit(req)
    }
}`,
    },
    whereItShowsUp: [
      "A Cargo workspace splits a system across member crates, so a trait and its implementers routinely sit in different directories and often different crates.",
      "derive attributes and macro_rules! bodies generate code the analyzer walks as templates rather than as executed Rust.",
      "Attribute macros such as #[get(\"/users\")] put a route next to the handler, and bb records the route path as an edge so a handler can be found by URL.",
    ],
  },

  Go: {
    headline:
      "Go is indexed with interfaces treated as contracts rather than decoration: implicit satisfaction is decided by comparing method sets — including methods promoted from embedded structs — so an agent can ask whether a type really implements something.",
    agentAsks: [
      "Does this type satisfy that interface, counting the methods it embeds?",
      "Which functions call this one?",
      "Which structs embed this type, and which methods do they gain from it?",
      "Which interface members does each implementer actually have?",
    ],
    limitations: [
      "Generics are declined for satisfaction: deciding whether Lattice[T] implements Lattice[U] needs type unification over instantiations, so both sides are skipped rather than compared as signature text.",
      "A bare call resolves only when this file declares the target, so a call into a sibling package arrives as a name. Under a dot import the file cannot say which names arrived from where, so those calls resolve leniently while bare value reads stay strict — the two channels are deliberately not symmetric.",
      "Go has no inheritance, so there is no extends in the class sense and no override edge at all. What looks like one is a struct embedding, recorded as a promotion of that type's methods.",
    ],
    sample: {
      caption: "An interface, a struct, and the method that satisfies the interface",
      code: `package cart

type Reader interface {              // bb records: interface Reader
	Read(p []byte) (int, error)      // bb records: method Read
}

type Cart struct {                  // bb records: struct Cart · field items
	items []Item
}

func (c *Cart) Read(p []byte) (int, error) { return 0, nil }`,
    },
    whereItShowsUp: [
      "Interfaces are satisfied implicitly, so the type that owes a contract and the interface it owes it are almost always in different files.",
      "Struct embedding promotes methods without writing them, which is how a type satisfies an interface using fields it does not declare.",
      "A go f() or defer f() statement is still a call, and bb records the spawn and the cleanup as distinct patterns on the edge.",
    ],
  },

  Java: {
    headline:
      "Java is indexed with the framework annotations read, not just the keywords: @Table becomes an edge to the table name, @GetMapping composes a class base path with a method route, and overrides resolve in three tiers of descending confidence.",
    agentAsks: [
      "Which controller method serves this route?",
      "Which entity is mapped to this table?",
      "Which classes extend this one, and which methods override which?",
      "Which members here are generated rather than written in the file?",
    ],
    limitations: [
      "A table or column name taken from the ORM's naming convention rather than from text written in the annotation is published as an inference and marked below the fabrication threshold: the edge is kept, the certainty is not.",
      "Cross-file override resolution reads a shared companion index of declared member names. Where that index is absent, an unannotated method is left unmatched, and only an @Override-annotated one falls back to the first parent in its hierarchy at reduced confidence.",
      "A static import is recorded but not expanded per member, so import static Util.helper gives you the import rather than a resolved edge to every name it brings in.",
    ],
    sample: {
      caption: "An entity, the table it maps, and the route its method serves",
      code: `@Entity @Table(name = "auction_item")   // bb records: AuctionItem uses auction_item
public class AuctionItem extends BaseItem {   // bb records: extends BaseItem
    private final String name;                // bb records: property name

    @GetMapping("/items/{id}")                // bb records: route /items/{id} on render
    public String render(Object o) { return name; }
}`,
    },
    whereItShowsUp: [
      "A Spring service is annotations over plain Java: the class name says little and the mapping annotations carry the URL contract.",
      "Record components and Lombok annotations declare members nobody wrote in the file, so those members are published as generated rather than as source.",
      "Packages are the namespace, so two classes with the same qualified name in different jars are one name as far as this view is concerned.",
    ],
  },

  "C++": {
    headline:
      "C++ is indexed with the preprocessor in view: a #define becomes a symbol so the reads inside it can resolve, a TEST(...) heading is given the scope its body needs, and class, struct and union all land as types with their members attached.",
    agentAsks: [
      "Which class does this method override?",
      "Where is this macro defined, and which files read it?",
      "Which namespace declares this function?",
      "What does this test case actually call?",
    ],
    limitations: [
      "There is no implements edge and that is a fact about C++: the format has no separate interface construct, so class X : public I records extends whatever I turns out to be, and whether I is a class or an abstract base is not stored separately.",
      "Overrides resolve inside one translation unit. A base declared in a header this file does not include is invisible here, so a cross-header override is not an edge at all.",
      "Preprocessor text is not code: a name appearing only inside a #define replacement list is a read of the macro, never a call inside a function. A trailing annotation macro on a function head — virtual int f(...) GUARD_(m) {} — is refused whole, symbol and stolen body together.",
    ],
    sample: {
      caption: "A macro, a class with a pure virtual, and a test heading that owns its body",
      code: `#define JSON_ASSERT(x) assert(x)     // bb records: macro JSON_ASSERT

class GTEST_API_ Widget {            // bb records: class Widget
 public:
  virtual void value(int n) const = 0;   // bb records: method value
  int count_{0};                         // bb records: property count_
};

TEST(Box_Int, KeepsLocals) {        // bb records: a scope for the macro body
  auto* b = new Box<int>;           // bb records: Box instantiated here
}`,
    },
    whereItShowsUp: [
      "A C++ project declares in headers and defines in .cpp files, so a symbol's prototype and its body are usually in different files and are recorded separately.",
      "Google Test and similar frameworks write function bodies under a macro heading; without a scope for that body every call inside a test would have no owner.",
      "Templates write the same class once and use it at many concrete types, so the index holds the generic form with its arguments stripped.",
    ],
  },

  C: {
    headline:
      "C is indexed with the parts a static reader usually loses: a struct's field set and its memory layout are computed from the declarations in the file, a function-like macro becomes a macro symbol rather than a mystery, and an EXPORT_SYMBOL(...) marker is read as the export it is.",
    agentAsks: [
      "How large is this struct, and which fields does it have?",
      "Which symbols does this file export to other modules?",
      "Which macros does this file define?",
      "Which members does this flag enum carry?",
    ],
    limitations: [
      "C has no class heritage, so there is no extends, implements or override edge to draw. What the format does offer is containment, and it is computed from the declarations in the file.",
      "A macro-generated member is unrecoverable: in #define BIT(x) int x : 1 the member name depends on the replacement list, so the declaration is recorded as partly unmeasured rather than given an invented name.",
      "Cross-translation-unit resolution is not attempted. An allocation cast to a type declared in another header is still recorded as a call, but no size, field or signature is resolved from it.",
    ],
    sample: {
      caption: "A macro, a struct with bitfields, and a kernel-style export marker",
      code: `#define BIT(x) int x : 1         // bb records: macro BIT

struct flags {                      // bb records: struct flags
    unsigned int a : 1;             // bb records: property a
    unsigned int n;                 // ...and the computed size of the struct
};

EXPORT_SYMBOL(my_init, GPL);        // bb records: my_init as an export
int my_init(void) { return 0; }`,
    },
    whereItShowsUp: [
      "A C project is mostly headers: one struct is declared once and used in a dozen .c files, so bb records the declaration and reads the uses as references.",
      "Feature detection is a wall of #if blocks, so a declaration that only exists on one platform is still parsed and published.",
      "Generated C — parser output, protobuf, configuration headers — is indistinguishable from a hand-written file to any static reader.",
    ],
  },

  "C#": {
    headline:
      "C# is indexed with the member contract made explicit: an explicitly implemented interface member is recorded as an implementation, a target-typed new() resolves through the declared collection to its element type, and an event is a first-class symbol.",
    agentAsks: [
      "Which class members implement this interface member?",
      "Which types implement this interface?",
      "Where is this event declared, and which type declares it?",
      "What does this override replace?",
    ],
    limitations: [
      "A C# base list carries no keyword distinguishing a class from an interface, so the split depends on a companion index of what each name was declared as. Without it the language rule applies: the first base extends and the rest implement.",
      "Compiler-generated record members — ToString, Equals, GetHashCode, Deconstruct — and the enum ordinal are not materialized as symbols, because nobody wrote them in the file.",
      "A where T : Dep constraint clause is not part of the declared-type graph, and neither is an attribute's argument types; both are real dependency positions left unwritten rather than approximated.",
    ],
    sample: {
      caption: "A class, its interface, a target-typed new and an explicit member",
      code: `namespace Acme;

public class Widgets : IThing {        // bb records: class Widgets · implements IThing
    private List<Widget> _items = new();   // bb records: instantiates Widget

    public override string ToString() => nameof(Widget);

    void IThing.Explicit() { }          // bb records: an implementation of IThing.Explicit
}`,
    },
    whereItShowsUp: [
      "WinForms and WPF split one class across a designer file and a hand-written file with partial, so a form's members live in two places.",
      "An async method returns a task; awaiting a call does not change which symbol the call edge points at.",
      "Interfaces are declared in one project and implemented in several, so the contract and the implementation are rarely in the same file.",
    ],
  },

  Swift: {
    headline:
      "Swift is indexed with extensions and protocols treated as real structure: an extension is its own symbol carrying the type it extends, a protocol is recorded as an interface, and a self.init or super.init is a construction rather than a call.",
    agentAsks: [
      "Which protocols does this type adopt?",
      "Which methods does this extension add to the type?",
      "Where is this initializer reached from?",
      "Which enum case does this expression construct?",
    ],
    limitations: [
      "Override resolution runs in three tiers — an exact match inside the file, then the shared companion index, then a deterministic first-parent guess. The last tier is published at reduced confidence precisely because the parent may not declare that member at all.",
      "A member call resolves to its written leaf: users.first is a call to first with no owner, so an extension method and a member method of the same name are one target in the graph.",
      "Initializer delegation is never a call edge, because init is a keyword rather than a name in this vocabulary — so which initializer chains to which is not a question the graph answers. deinit and subscript declarations publish no symbols either.",
    ],
    sample: {
      caption: "A protocol, the extension that adopts it, and a struct's stored property",
      code: `protocol Cacheable {                       // bb records: interface Cacheable
    func load() -> Data
}

extension Cache: Cacheable {          // bb records: extension Cache · method load
    func load() -> Data { return Data() }
}

struct Entry { var id: Int }          // bb records: struct Entry · property id`,
    },
    whereItShowsUp: [
      "Swift reopens a type across many files: the declaration is in one, its behaviour in an extension per protocol in the others.",
      "SwiftUI state is declared with property wrappers such as @State and @Published, so the attribute often says more than the property's own type does.",
      "Backtick-escaped keywords are legal identifiers, and bb strips the backticks so a published name matches how the case is actually written.",
    ],
  },

  Kotlin: {
    headline:
      "Kotlin is indexed with both spellings of an override — a keywordless implementation of an abstract member is matched just as an override one is — and a data class's generated members are recorded as generated rather than as if a person had written them.",
    agentAsks: [
      "Which classes implement this interface?",
      "Which of these members did the data class generate?",
      "Which extension function is declared for this receiver type?",
      "Where is this coroutine launched from?",
    ],
    limitations: [
      "An expression-body function has no inferable return type: fun f() = 42 reports none rather than guessing Int from the literal.",
      "An extension function is recorded against the receiver type it extends as a use carrying an is-extension marker, never as extends — labelling it inheritance would fabricate hierarchy that is not in the code.",
      "A generated data-class member is published at reduced confidence and with no line number, because it is derived from the class rather than written in it, and a line would point at the wrong place.",
    ],
    sample: {
      caption: "A data class with generated members, an interface, and a suspending method",
      code: `data class Column(val type: String)   // bb records: class Column · generated component1

interface Repo { fun findAll(): List<Column> }

class ColumnController(private val repo: Repo) {
    // bb records: method list, marked as suspending
    suspend fun list(): List<Column> = repo.findAll()
}`,
    },
    whereItShowsUp: [
      "A Kotlin service is usually an interface plus its implementation in the same file, so the contract and its only implementer sit together.",
      "Jetpack Compose builds a UI out of nested function calls, and the annotation sits on the enclosing function rather than on a type.",
      "Extension functions live at file scope in a file that may not import the type they extend, so the receiver type is often the only thing connecting them.",
    ],
  },

  Dart: {
    headline:
      "Dart is indexed with the Dart 3 shapes included: a mixin is its own symbol distinct from a class, an extension type carries its representation field as a real property, and a named constructor call is recognised as a construction.",
    agentAsks: [
      "Which mixins does this class apply?",
      "Which interfaces does this type implement?",
      "Where is this named constructor called from?",
      "Which extension methods exist for this type?",
    ],
    limitations: [
      "A named constructor declared in another file stays a call to its leaf: construction is recognised only inside the translation unit that declares it.",
      "An extension method records its target type as metadata rather than as an edge from the extension to that type, so the graph does not connect the two.",
      "Box<String>('x') misparses as a relational expression in the pinned grammar. That is an upstream grammar ambiguity, so no edge is drawn and no text workaround is applied to paper over it.",
    ],
    sample: {
      caption: "A mixin, the class that applies it, and a factory constructor redirect",
      code: `mixin Loggable on Shape {                     // bb records: mixin Loggable · extends Shape
  void log() {}
}

class Poly with Loggable implements Shape {   // bb records: class Poly · implements Shape
  final double sides;                        // bb records: property sides
  factory Poly.unit() = Poly;                // bb records: a factory redirect to Poly
}`,
    },
    whereItShowsUp: [
      "Flutter code separates widget, model and generated code, with part / part of tying a generated file back to the library it belongs to.",
      "A mixin carries behaviour the class body never wrote, so reading the class alone understates what the type can do.",
      "Build runners emit .g.dart and .freezed.dart files that are ordinary Dart to the analyzer and are often the bulk of a project's file count.",
    ],
  },

  Zig: {
    headline:
      "Zig is indexed around the decision that actually matters: a container declaration's right-hand side decides whether it is a struct, union, enum, opaque or error set, and @import is recorded from every shape that can spell one.",
    agentAsks: [
      "Which fields does this struct carry?",
      "Which modules does this file import from?",
      "Which functions are declared inside this container?",
      "Which error set members does this function declare?",
    ],
    limitations: [
      "Zig has no class inheritance, so there is no extends, implements or override edge. Composition is a field named after the other type and usingnamespace mixes names into a scope — neither is a subtype relation, and neither is recorded as one.",
      "A builtin call publishes no call edge: @intCast and friends are compile-time intrinsics with no declaration in any repository behind them, so there is nothing for an edge to point at.",
      "Instantiation is recorded only for a type declared in the same file, so ArrayList(u8) over a standard-library type records nothing at all rather than a construction with an unresolvable target.",
    ],
    sample: {
      caption: "A struct with a method, an error set, and a module import",
      code: `pub const Point = struct {          // bb records: struct Point · property x
    x: f64,
    pub fn norm(self: Point) f64 { return @sqrt(self.x * self.x); }
};

pub const Err = error{ NotFound };     // bb records: enum Err · member NotFound

const std = @import("std");            // bb records: an import of "std"`,
    },
    whereItShowsUp: [
      "A build.zig at the root of a Zig project is a program, not only configuration, so its statements are part of the build graph.",
      "Generic code is written once and monomorphised, so one body is written against several concrete types.",
      "Almost everything in the standard library arrives through a single @import(\"std\"), so a file's dependency usually terminates at the standard library rather than at a symbol.",
    ],
  },

  "Objective-C": {
    headline:
      "Objective-C is indexed per translation unit with selectors kept whole: a method is recorded under its full selector — storeImage:forName:, not storeImage — so a message send can actually be matched to the declaration it reaches.",
    agentAsks: [
      "Which methods does this category add to the class?",
      "Which protocols does this class conform to?",
      "Where is this selector sent from?",
      "Which properties and instance variables does this implementation declare?",
    ],
    limitations: [
      "The unit is the .m file: a header in the same project is a separate parse, so an instance variable declared there reads as undeclared here and an override of a base named in that header falls back to a first-parent guess at reduced confidence.",
      "A message send is recorded by selector name, not by a resolved receiver type. Nothing follows respondsToSelector: or a runtime-typed object, so dynamic dispatch is an edge to a name.",
      "An @class forward declaration and an @protocol(P) type query produce no symbol and no edge at all.",
    ],
    sample: {
      caption: "A category, its protocol, and a method recorded under its full selector",
      code: `#import <UIKit/UIKit.h>

@interface NSString (Trim) <NSCoding>   // bb records: extension NSString · protocol NSCoding
- (NSString *)bb_trim:(BOOL)compact;   // bb records: method bb_trim:
@end

@implementation MyCache { NSLock *_lock; }   // bb records: class MyCache · property _lock
- (void)storeImage:(UIImage *)image { [self clear]; }   // bb records: method storeImage:
@end`,
    },
    whereItShowsUp: [
      "An Objective-C library is a header plus a .m file, and the public surface lives in the header — the half the implementation file cannot see.",
      "Categories are how a project adds methods to a type it does not own, so the category file is a first-class place in the tree rather than a subclass.",
      "Most message sends target a framework type, so the far end of a call edge is usually a name with no declaration behind it.",
    ],
  },

  "Visual Basic": {
    headline:
      "Visual Basic is indexed with the .NET member contract intact: an Implements clause on a type or on a single member, an Overrides modifier, an Imports list, and a call edge for every invocation — including New Foo(a, b), which the grammar spells as a construction and not a call.",
    agentAsks: [
      "Which types implement this interface?",
      "Which member implements IThing.Refresh, and what does it override?",
      "Which namespaces does this file import?",
      "Which members does this class declare, and which of them are events?",
    ],
    limitations: [
      "The header-clause form is not split: in Class C : Inherits B, Implements I every name after the header colon is published as extends. implements reaches the graph through the line form and through the member-level clause instead.",
      "Eight constructs that carry a real relationship are classified as known but uncollected and counted rather than derived: constructor chaining, AddHandler and RemoveHandler, lambdas, RaiseEvent, event members and property getters and setters. Handles members alone were measured at 2,602 across the corpus.",
      "Multiple Partial Class parts are not merged into one type, so a Windows Forms dialog's designer half and its code half read as two declarations of the same name rather than one type with two halves.",
    ],
    sample: {
      caption: "Declarations in a .vb file — heritage, an override and a resolved call",
      code: `Imports System.Text            ' bb records: an import of the System.Text namespace

Partial Public Class Dialog1             ' bb records: class Dialog1 · marked partial
    Private Const MaxRows As Integer = 20 ' bb records: constant MaxRows

    Public Overrides Sub Refresh() Implements IThing.Refresh
        Me._names.Add(u)                 ' bb records: a call edge to Add
    End Sub
End Class`,
    },
    whereItShowsUp: [
      "A VB.NET codebase is mostly Windows Forms or WPF, and the designer emits one .Designer.vb half of every form beside the hand-written half.",
      "Imports names a namespace rather than a module path, so the same short name can arrive from several places in one project.",
      "COM interop appears as Declare statements naming an unmanaged entry point — the one place a VB file reaches outside managed code.",
    ],
  },
}