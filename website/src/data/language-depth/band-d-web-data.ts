// Band D — Web, data & config (15 families).
//
// SQL · HTML · CSS · SCSS / Sass · JSON · YAML · GraphQL · HCL / Terraform ·
// Vue · Svelte · Markdown · TOML · XML · Make · Protobuf
//
// CSS and SCSS are two records because there are two analyzer modules behind
// them: `real-css-analyzer.ts` (2,949 lines) walks a stylesheet, and
// `real-scss-analyzer.ts` (988 lines) delegates the CSS subset to the first and
// adds what Sass has on top. Folding them into one family hid a dedicated
// analyzer behind a shared name.
//
// Every claim below is read off the family's own analyzer module
// (`src/ast/real-<lang>-analyzer.ts`) and its contract doc
// (`docs/analyzers/<lang>.md`), cross-checked against the
// `emits` array and `extracts` string in ../brain-languages. Where a
// relationship type is absent from `emits`, the record below says why the
// FORMAT cannot produce it — an absent type is a fact about the language, not a
// shortfall in the analyzer, and calling it one would be a false claim.
//
// See the honesty rules at the top of ./types.ts.

import type { LanguageDepth } from "./types"

export const BAND_DEPTH: Record<string, LanguageDepth> = {
  SQL: {
    headline:
      "SQL is read as the schema it declares and the calls it makes: tables, columns, views, indexes, stored functions, triggers, types and schemas each get an identity, a foreign key is a reference to another table, and a trigger that executes a function — or a call to a function the database does not provide — is a call edge.",
    agentAsks: [
      "Which columns does this table actually have, and which of them are keys?",
      "Which trigger runs on this table, and which function does it execute?",
      "Where is this view defined, and which tables does it select from?",
      "Which foreign keys point at this table from somewhere else?",
    ],
    limitations: [
      "Procedural bodies are where most declarations sit, and the grammar is the limit. On the versioned PostgreSQL extension corpus, distinct-name function recall is 1,004 of 1,170 (85.8%), 282 of 387 files still carry at least one parse error, and 56 of those files publish no symbols at all. The name-based figure is the one to use, because a count ratio measures how often a function is re-declared across version scripts rather than how many were found.",
      "Dynamic SQL is unresolved on purpose. The recovery pass that reads `EXECUTE 'CREATE TRIGGER …'` recovers the KIND of the declaration and cannot recover its NAME, because 94% of the extension corpus's `EXECUTE` literals are concatenated fragments whose identifier is computed by the database at run time. It invents no name to fill the gap.",
      "A call to something the database provides is not a call into your code. Names like `generate_series`, `jsonb_build_object`, `current_setting` and `uuid_generate_v4` are held in a builtin list and filtered, because an edge to one resolves to nothing and would show a call into a table name. What is left unresolvable is bucketed — catalog, information_schema, implicit schema, platform — and the buckets are published in the file's metadata so an unresolved edge can be read as a fact rather than guessed at.",
    ],
    sample: {
      caption: "A table with a key column, the function a trigger runs, and the trigger's call edge",
      code: `CREATE TABLE audit_log (                -- bb records: table audit_log
  id         BIGSERIAL PRIMARY KEY,    -- bb records: column id
  actor      TEXT NOT NULL             -- bb records: column actor
);

CREATE FUNCTION archive_actor() RETURNS trigger AS $$
BEGIN
  RETURN NEW;                          -- the body is ordinary SQL, which is the only shape that parses
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_after BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION archive_actor();   -- bb records: calls -> archive_actor`,
    },
    whereItShowsUp: [
      "Migrations are the interesting half — the same table name appears in every schema revision, so the history is queryable, and an index is recorded as owned by the table it indexes so the containment edge and the reference edge point the same way.",
      "A view, a materialised view and a table are all `class` symbols, and a stored function, a procedure and a trigger are all `function` symbols. The distinction survives in metadata, so anything that has to tell a view from a table reads the declaration rather than the kind.",
      "Anonymous queries have no owner of their own and their edges are sourced from the file, so a `SELECT` in a migration is still attached to the file it was written in. A CTE name, by contrast, is scoped to its own statement: a name declared in one `WITH` cannot satisfy a reference in the next, and leaking it would publish a table that does not exist.",
    ],
  },

  HTML: {
    headline:
      "An element becomes a symbol because something can address it — an `id`, or a `name` when there is no id — and the inline `<script>` and `<style>` blocks in the page are handed to the real JavaScript/TypeScript and CSS analyzers, so a component whose logic is inlined gets that logic's call graph rather than an empty one.",
    agentAsks: [
      "Which elements in this document can be addressed, and by which attribute?",
      "Which resources does this page load, and which of them are inline rather than separate files?",
      "Which id in this document appears more than once?",
      "Which functions does this page's inline script declare and call?",
    ],
    limitations: [
      "Every `calls` edge comes from the delegate, and the measurement says so exactly: 3,016 `calls` across 400 corpus files, 3,016 of them from the inline-block seam and 0 from the markup itself. Markup has no invocation semantics — a `<form action>` is a navigation the browser performs, which is why it is a member read and never a call.",
      "An external URL is not a dependency of this codebase. Absolute, protocol-relative and `mailto:`/`tel:`/`javascript:`/`data:` URLs produce no edge at all, because an earlier version published one per external link and 51 documents were measured emitting 237 such edges into a graph where every edge is scored for architectural criticality.",
      "Most elements produce no symbol. An element is recorded only when something can address it, and `class` is a shared styling hook that many elements legitimately carry, so it can never name one — it stays readable on the symbol's own attributes. A duplicate `id` is invalid HTML: the first in document order keeps the plain name, later ones take a `#N` suffix flagged as such, and a reference to the handle is marked ambiguous rather than pointed at one of them.",
    ],
    sample: {
      caption: "Two addressable elements, one that has no address, and an inline script that is not empty",
      code: `<main id="checkout">            <!-- bb records: element main, named "checkout" -->
  <h1 class="title">Cart</h1>  <!-- no symbol: class is a shared hook, never an identity -->
  <input name="coupon">         <!-- bb records: element input, named "coupon" -->
  <input name="coupon">         <!-- bb records: "coupon#2", flagged as a duplicate -->
</main>

<script>                    <!-- run through the real JavaScript analyzer -->
  function track(id) { return id }
  track("checkout")           <!-- bb records: calls -> track, from the delegate -->
</script>`,
    },
    whereItShowsUp: [
      "A server-rendered page often inlines its whole bundle, so its JavaScript lives inside a `<script>` block rather than in a `.js` file — which is precisely the case where reading the document gives you the JavaScript analyzer's call graph instead of an empty one. A pipeline that minifies the inline block away before the file is committed removes it from the index entirely.",
      "Each embedded-language delegate is resolved in its own `try/catch`, so a broken or unavailable grammar costs exactly the blocks it would have served and the document's own elements, containment, resources, references and lines are untouched. The loss is disclosed on the result rather than swallowed, because a silently missing block set reads as a page with no code in it.",
      "`<template>` content and `<slot>` fallback are inert where they are written. A named element inside one is owned by the nearest addressable ancestor and flagged, because it never enters the document at that position.",
    ],
  },

  CSS: {
    headline:
      "A stylesheet is indexed as the selectors it declares: each rule is a symbol carrying its own declarations, a custom property read from `var()` is a reference to the rule that declares it, and an `animation:` naming a keyframes block is a use of that block — edges the production pipeline used to discard and now keeps.",
    agentAsks: [
      "Which selectors does this stylesheet define, and what does each one declare?",
      "Which custom property does this value read, and which rule declares it?",
      "Which keyframes block does this `animation:` name?",
      "Which layer, container or media query wraps this selector?",
    ],
    limitations: [
      "A selector is not a symbol reference. `.btn` is recorded as the selector it is written as, and bb does not connect it to the HTML or JSX that carries `class=\"btn\"`, so \"which components use this rule\" is a question this graph cannot answer.",
      "Declarations ride the selector's own symbol rather than becoming symbols of their own — `border-color: var(--brand)` records the rule and the read of `--brand`, not a node named `border-color`. And `@apply`, `@theme` and `@tailwind` publish nothing, because they instruct a build tool rather than declare anything. `@page`, `@starting-style` and `@position-try` scope nothing an edge can name, so the rules inside them are recorded while the attribution is dropped.",
      "A custom property declared in a stylesheet outside the index stays unresolved, and the corpus shows the scale: over one component library's stylesheets the delegated `var()` reads resolved 14 of 220, because the set consumes a design system's theme tokens from a file most of it never includes. Those edges used to be hidden behind a contains-only rule in the pipeline, which was discarding 2,170 `var()` and `animation:` references — 1,437 of them resolving at both ends.",
    ],
    sample: {
      caption: "A custom property, the rule that reads it, and the keyframes an animation names",
      code: `:root { --brand: #e2553b; }      /* bb records: variable --brand */

.card {                          /* bb records: class .card */
  border-color: var(--brand);    /* bb records: references -> --brand */
  animation: fade-in 200ms;      /* bb records: uses -> fade-in, the @keyframes block */
}

@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }`,
    },
    whereItShowsUp: [
      "Specificity composition decides the kind, not the syntax: a bare `#id` is published as an interface, a bare tag as a type, a `.class` as a class, and a pseudo-class, attribute, descendant or complex selector as a class as well. `@layer` and `@container` become modules that scope the rules inside them; `@media` is a structural scope with containment edges and no symbol of its own; `@supports` is published because its query text names a scope.",
      "Real CSS nesting resolves to ONE symbol. `& .item` inside `.nav` publishes the scoped selector `.nav .item` with a `.nav contains .nav .item` edge, because the symbol's identity and the edge's target have to agree — an earlier shape published dangling bare identities like `card contains title`.",
      "A generated stylesheet — a Tailwind or Bootstrap build output committed under `dist/` — indexes as a very large flat set of selectors, while the source it was generated from is a separate set of files with its own shapes.",
    ],
  },

  "SCSS / Sass": {
    headline:
      "Sass is read by delegation: the CSS subset is handed to the real CSS analyzer, and this module adds everything Sass puts on top — `@mixin` and `@function` with their parameters, `$variables`, and the `@include`, function-call, `$var`-read and `@extend` edges between them.",
    agentAsks: [
      "Which mixins and functions does this partial declare?",
      "Which mixin does this rule include?",
      "Which variable does this value read, and which one declares it?",
      "Which selector does this `@extend` reach?",
    ],
    limitations: [
      "Both ends of an edge must resolve, so every Sass edge stays inside one file. An `@include` of a mixin declared in another partial, and a `map.$brand` read through a `@use … as map` namespace, produce no edge at all. That is deliberate — inventing an endpoint is the phantom the CSS lane removed once — but it is a real boundary, and it is the reason a function-call edge exists for `double(4px)` and not for a function two files away.",
      "The grammar does not reach everything modern Sass writes. 95 of 244 files in the pinned corpus still carry a parse error, and `@forward 'x' as prefix-*;` — the dashed-prefix form of the `as` clause — is unsupported because the rule conflicts with the grammar's own binary-expression rule. The corpus contains 359 `as *` uses and 1 `as common`, and the unsupported form occurs zero times, so it is declared rather than designed around.",
      "`@use` and `@forward` become import records on the file carrying the `as` namespace, because `@use 'sass:map' as map` and `@use 'sass:map' as m` are the same import and two different graphs. A namespaced call such as `map.merge($a, $b)` is then a use of the namespace THIS file declares, and the bare form `name(...)` in a value is a function call rather than a mixin invocation, so one call site never claims to be two different relationships.",
    ],
    sample: {
      caption: "A module import, a mixin, a variable, and the two edges a rule publishes",
      code: `@use "sass:map";

$radius: 4px;                  // bb records: variable $radius

@mixin card($pad: 1rem) {      // bb records: function @mixin card, with its parameters
  padding: $pad;
}

.card {                        // published by the CSS analyzer, which is delegated
  @include card(2rem);         // bb records: uses -> @mixin card (this file declares it)
  width: double($radius);      // bb records: uses -> the @function double
}`,
    },
    whereItShowsUp: [
      "Delegation is the architecture rather than a shortcut. The SCSS grammar extends the CSS grammar, so every CSS node type exists in a `.scss` file and the CSS walk already handles rule sets, `&` nesting, `@media`, `@layer`, `@scope`, `@keyframes` and `@import`. Reimplementing that would be roughly 2,700 duplicated lines whose only possible outcome is two implementations that agree today and drift tomorrow — and the grammar does not even inherit the CSS lane's local patches.",
      "The boundary is measured rather than assumed: the CSS analyzer publishes the selectors and their nesting chains and nothing for any SCSS statement, because `mixin_statement`, `include_statement` and `use_statement` are different node types that its at-rule dispatch never sees.",
      "A Sass variable is assigned in several places by design — a `!default` at the top and an override inside a theme — and `$brand` assigned twice is ONE symbol, kept at its first occurrence so the symbol points where the variable is introduced rather than at its last override.",
    ],
  },

  GraphQL: {
    headline:
      "A GraphQL document is read as a type system: object types, interfaces, unions, scalars, enums and input objects each get an identity, their fields are members, and every construct that names another type — a field's return and argument types, a variable's type, a union member, a fragment's condition — becomes a reference with the role it played.",
    agentAsks: [
      "Which types does this schema declare, and which interfaces do they implement?",
      "Which fields does this type expose, and what types do they return?",
      "Which operations and fragments does this document define?",
      "Which directive does this field apply, and what does it declare?",
    ],
    limitations: [
      "The relationship vocabulary is `contains`, `implements` and `uses`, and that is the format's shape rather than a shortfall: a GraphQL document declares types and names them. `imports` is empty by design — `#import` is a non-standard comment convention, not part of the specification — and a resolver lives in a JavaScript file bound to the schema by a naming convention the document never states, so the schema and its resolvers are two halves of the index.",
      "A field's arguments are parameters of the field, not symbols. `invoice(id: ID!)` gives you the argument's type; it does not give you something named `id` you can go and search for. Built-in scalars and introspection meta-fields are emitted as ordinary references, because they are specification vocabulary no declaration can own.",
      "`extend type X` splits a type across files, and which happens depends on this file: when it also declares `X`, the extension contributes members only; when it does not, a symbol is published for it marked `partial`. That is read from a pre-pass over the file's own top-level definitions rather than guessed, and `extend scalar S` publishes no symbol at all because it declares nothing.",
    ],
    sample: {
      caption: "A type, the two types its field names, and a root operation type",
      code: `type Invoice implements Payable {    // bb records: class Invoice, implements Payable
  id: ID!                            // bb records: property id on Invoice
  lines: [Line!]!                    // bb records: property lines; uses -> Line
}

type Query {                         // bb records: class Query
  invoice(id: ID!): Invoice          // id is a parameter of the field, not a symbol;
}                                    // the edge to Invoice is the field's return type`,
    },
    whereItShowsUp: [
      "A schema is usually a set of `.graphql` files mixing SDL and operations, or a directory of type files with a separate operations folder. Both index into one family and the two halves stay distinguishable, because a type declaration and an operation are different kinds.",
      "A `.gql` file sitting next to a component is the operation that component sends. The operation records its variables and its selections, and the component's own `fetch` belongs to a different file and a different edge.",
      "Codegen output — the TypeScript types generated from a schema — is ordinary TypeScript to the index, so a schema and its generated types do not join into one graph.",
    ],
  },

  JSON: {
    headline:
      "JSON has no declarations beyond its keys, so the index records the document's nesting shape: the file is a root, an object-valued key is a container, an array-valued key is a property carrying an array, and a `$ref` that names another file is recorded as the dependency it is — while a `$ref` inside `allOf` is a superset relationship rather than a bare reference.",
    agentAsks: [
      "What keys does this document declare at the top level?",
      "Where is this key set, and what is nested beneath it?",
      "Which fields does this schema mark as required?",
      "Which other files does this document reference?",
    ],
    limitations: [
      "Nothing in JSON calls anything, because the format has no way to express a call. What you get is shape: which key sits under which, and how deep the nesting goes. The vocabulary is `contains`, `references`, `imports`, `uses`, `exports` and `extends` — the last only for a `$ref` inside an `allOf` array, because a superset-of IS a relationship, while `anyOf` and `oneOf` are alternatives and publish only their references.",
      "A `$ref` is a string, so it is classified rather than assumed. One that names another file is recorded as both a dependency and a reference, because that is what it is; one naming a pointer inside this document resolves here; one naming neither stays unresolved and is stored at reduced confidence. Corpus-wide the ends are mostly ambiguous — 64.54% of reference endpoints match more than one symbol — so a `$ref` is a place to look, not a target to assume.",
      "Nothing is compared across documents, so `name` in `package.json` and `name` in a fixture are neither a conflict nor a match. And an inline array's scalar items publish nothing at all: array elements are positional and unnamed, so there is no identity to record, and only an object element inside an array becomes a symbol of its own.",
    ],
    sample: {
      caption:
        "A scalar key, an object container, an array key, and a file-naming $ref. bb records `name` and `dependencies` as properties, `scripts` as a container holding `build`, and the `$ref` as both a reference and a file dependency.",
      code: `{
  "name": "acme-api",
  "scripts": { "build": "tsc" },
  "dependencies": ["express", "pg"],
  "$ref": "common.json#/definitions/Base"
}`,
    },
    whereItShowsUp: [
      "`package.json`, `tsconfig.json`, a lockfile and a CI fixture are all `.json` and all index as one family; the file's stem is the root, so `package` and `tsconfig` are two independent roots rather than two views of one.",
      "A JSON Schema is the case where the nesting shape is the whole point: `properties`, `items` and `$defs` become containers you can walk, and `required` marks the individual properties inside them.",
      "Generated JSON — a build manifest, an API response fixture, a lockfile with tens of thousands of lines — is mostly leaf values, so the records worth having are the containers and the `$ref`s rather than the scalars. A Terraform plan JSON is the extreme case: over 10,000 symbols, nearly all of them repeating the same names.",
    ],
  },

  YAML: {
    headline:
      "YAML is read structurally: a mapping key becomes a property, an object-valued key a container, a sequence-valued key a list, and an anchor a named constant that the aliases in its own document point at — with merge keys recorded as inheritance and cross-document aliases recorded as failures with a stated reason.",
    agentAsks: [
      "What keys does this document declare, and how are they nested?",
      "Where is this key set, and what sits under it?",
      "Which sequence items live beneath this key?",
      "Which anchor does this alias resolve to, and did it resolve at all?",
    ],
    limitations: [
      "An alias resolves inside its own document, and the two failure modes are distinguished rather than pooled. An anchor declared in another document is stored at 0.5 with the reason `anchor-defined-in-another-document`; an anchor nothing declares is 0.8 with `anchor-not-declared`. Inside one document the nearest definition wins, which is what the specification says.",
      "An include is a closed list of ten spellings, and that list was measured rather than guessed: across 9,953 files in eight pinned corpora every one of the ten occurs zero times, while the tags Ansible actually uses are not on it. A template tag outside the list produces no import, and a `uses:` key is treated as an import only when the file's shape says GitHub workflow.",
      "A templated YAML file is where this lane stops. For files whose root node is an ERROR the parse tree covers roughly 28–31% of the document, so a heavily templated manifest publishes a fraction of its keys — and each recovered symbol is flagged with the line and width it was recovered through, so a partial publish is visible rather than mistaken for a short document.",
    ],
    sample: {
      caption: "A scalar key, an object container, a sequence-valued key and an anchor",
      code: `version: "3.9"                    # bb records: property version
services:                         # bb records: container services (object-valued key)
  api:                            # bb records: property api, owned by services
    image: acme/api                # an anonymous scalar: readable, but no symbol of its own
    ports: ["8080:80"]             # bb records: variable ports (sequence-valued key)
defaults: &base                   # bb records: constant base — the anchor`,
    },
    whereItShowsUp: [
      "CI workflows, compose files, Helm values and Kubernetes manifests are all YAML and all index as one family — a `services:` key means nothing in particular until you know which file it came from.",
      "Anchors and aliases are the YAML-specific case: a shared block written once as `&base` and reused as `*base` shows up as one anchor plus the keys that reference it, within that document only. A merge key `<<` inherits INTO the object that contains it, so the edge leaves the container rather than the key.",
      "A multi-document file (`---` separated) is one file with several roots, each named `<stem>` or `<stem>#<n>`, so a key repeated in each document is a separate record under its own document path rather than a duplicate of the first.",
    ],
  },

  "HCL / Terraform": {
    headline:
      "HCL is read as the configuration language it is: every block and attribute becomes a symbol with the enclosing block as its owner, and every dotted path an expression writes — `var.x`, `local.y`, `module.z`, `aws_s3_bucket.assets.id` — becomes a reference with its own line, while a module block's `source` becomes an import.",
    agentAsks: [
      "Which resources and modules does this file declare?",
      "Which variables and outputs does this module expose?",
      "Which variables does this resource reference?",
      "Which module sources does this configuration pull in?",
    ],
    limitations: [
      "There is no call edge, and that is a measurement rather than an assumption: across 12,977 function-call nodes in 9,079 corpus files over 144 distinct callees, none resolves to a symbol this format declares. The five that appear to are provable name collisions — four Terraform core functions, plus `object`, which is a type keyword in `type = object({…})`. The references read inside a call are still published.",
      "`count.index`, `each.key`, `each.value`, `path.module`, `self` and `terraform` are published as member reads rather than as references, because a target in the language's global namespace is not a project symbol — 2,029 edges, 4.6% of all references, led by `path.module` at 506.",
      "Terraform repeats blocks on purpose. Two `locals` blocks in one file become `locals` and `locals#2` with the plain address kept alongside, because a name that is not unique is an identity nothing downstream can resolve. A duplicate key INSIDE a block is deliberately left alone, since Terraform rejects that outright — 21 such identities remain in the corpus.",
    ],
    sample: {
      caption: "A resource, the variable it references, and a module block's source",
      code: `resource "aws_s3_bucket" "assets" {   // bb records: class aws_s3_bucket.assets
  bucket = var.bucket_name                  // bb records: references -> var.bucket_name
}

module "network" {                         // bb records: module network
  source = "./modules/network"             // bb records: imports -> ./modules/network
  region  = var.region                     // a project address: references, not a builtin use
}`,
    },
    whereItShowsUp: [
      "A Terraform root module is a directory of `.tf` files plus `.tfvars`; each file is its own root symbol, so the directory is a convention rather than something the index knows about.",
      "The same grammar covers the other HashiCorp DSLs — Packer's `.pkr.hcl`, Vault's `.hcl`, Nomad's job files — and framework detection is structural rather than extension-based, so a Consul agent config or a Packer template is recorded as HCL with no Terraform block in sight and an empty framework list rather than a guessed name.",
      "`moved.tf` and `removed.tf` hold a single label-less block each, which is the case that makes an ordinal rule for repeated sibling blocks necessary rather than decorative. The file's own stem is reserved in the name space first: `doc/book/book.toml`-style collisions were measured 308 times over the corpus, and the file's identity, derived from its path, is not negotiable.",
    ],
  },

  TOML: {
    headline:
      "A manifest is indexed as its dotted structure: the file is a module, every `[table]` is a namespace, every `key = value` is a property, and a symbol's name is its full path from the document root — so `[workspace.lints.rust]` is one symbol with exactly that name, not a leaf called `rust`.",
    agentAsks: [
      "Which tables does this manifest declare, and how deep does the key path go?",
      "Where is this key set, and which table owns it?",
      "Which dependencies does this package declare?",
      "Which ancestor tables are only implied by a deeper header?",
    ],
    limitations: [
      "The relationship vocabulary is `contains`, and that is the whole truth — not a thin graph but the format's shape. TOML defines no include, no import and no reference: `path = \"src/main.rs\"` is a string, and treating path-shaped strings as links would import ecosystem knowledge about which keys are paths in which tool into a format that has none. So there is no `uses` edge here, and the other types are absent for the same reason they are absent from HTML: no TOML construct produces them.",
      "An implied parent is recorded, not invented. `[a.b.c]` implies `a` and `a.b` whether or not the file writes them; the names land in the table's metadata and no symbol is fabricated for a header the document never declares, because an edge to a target that does not exist is the unresolvable-identity defect.",
      "An inline table's keys are not symbols. `x = { a = 1, b = \"two\" }` makes `x` the symbol and the inner key names ride on it in its metadata — a Cargo.toml with 200 dependencies written that way would otherwise publish 600+ names that nothing can navigate to on its own. A value of any type publishes nothing either: it is data, recorded as a value kind on its key.",
    ],
    sample: {
      caption: "A table header, the full dotted path it becomes, and a key beneath it",
      code: `[package]                 # bb records: table package
name = "acme"              # bb records: key package.name
version = "0.1.0"          # bb records: key package.version

[workspace.lints.rust]     # ONE symbol, named workspace.lints.rust — the whole dotted path
rust-version = "1.80"      # bb records: key workspace.lints.rust.rust-version

[dependencies]             # bb records: table dependencies
serde = "1"                # bb records: key dependencies.serde — and no edge to any file`,
    },
    whereItShowsUp: [
      "`Cargo.toml`, `pyproject.toml` and `rust-toolchain.toml` are the same document shape, and the file's stem is the root: `Cargo.toml` is the module `Cargo`, because `Cargo` is what a person would search for rather than a filename.",
      "`[[bin]]` and `[[patch]]` are arrays of tables. Each header opens a level the keys beneath it belong to, the second element takes a `#2` suffix, and its keys are prefixed with the ALLOCATED name — so `bin.name` and `bin#2.name` cannot collide.",
      "A lockfile is TOML as well: `Cargo.lock` is thousands of `[[package]]` entries, so a manifest and a lockfile are two very differently sized instances of one shape. Across cargo's 684 tracked files the analyzer published 6,409 symbols and 5,725 `contains` edges, with 0 duplicate names and 0 edge targets that resolve to nothing in the whole 835-file pool.",
    ],
  },

  XML: {
    headline:
      "XML is read as the element tree it declares: every element is a symbol contained by its parent, every attribute is a property, and an attribute value that names a declared type — `type=`, `ref=`, `base=` — becomes a reference whose metadata says whether it resolves inside this document, against a built-in, or outside.",
    agentAsks: [
      "Which elements does this document declare, and how are they nested?",
      "Which attributes does this element carry?",
      "Which types does this schema reference, and do they resolve here?",
      "Which namespace prefix does this document bind, and where?",
    ],
    limitations: [
      "An attribute value is a string, and only some of them are references. A prefixed value is one wherever it appears; an unprefixed value counts only on one of ten attributes the analyzer names — `type`, `base`, `ref`, `itemType`, `memberTypes`, `substitutionGroup`, `refer`, `portType`, `binding`, `pattern` — so `use=\"optional\"` and `maxOccurs=\"unbounded\"` produce no edge. That table came from a census of the corpus: 9,391 bare `key=` property names, 4,453 `use=` values and 1,404 `maxOccurs=` values that are plainly not type references.",
      "An element is named by its `name=` attribute only inside four vocabularies — 42 local names across XSD, RelaxNG, XSLT and WSDL. Outside them the tag is the identity, because 29,196 elements in the corpus carry a `name` attribute and nearly all of them are data; a rule keyed on the attribute alone once published a symbol named `xml` for `<xsl:output method=\"xml\"/>`.",
      "Exactly five entity names are predefined — `&lt;`, `&gt;`, `&amp;`, `&apos;`, `&quot;`. `&nbsp;` and `&mdash;` are not, so the corpus's 4,370 `&d;` sites and 1,381 `&nbsp;` sites stay unresolved unless the document declares them. That is what the specification says, and it is stated here because anyone arriving from HTML expects otherwise.",
    ],
    sample: {
      caption: "A namespaced element, its attribute, and a reference whose resolution is recorded",
      code: `<config xmlns:db="urn:acme:db">        <!-- bb records: element config -->
  <db:pool size="8">                    <!-- bb records: element pool under db, property size -->
    <entry ref="urn:acme:Invoice"/>      <!-- bb records: a reference: prefixed value on ref -->
  </db:pool>
</config>`,
    },
    whereItShowsUp: [
      "An XSD, a WSDL, a Spring or Maven descriptor and a Maven `pom.xml` are all XML, and the last two rely heavily on namespace prefixes to mean anything — which is exactly the shape the prefixed-value rule was built for. Namespace bindings are scoped, so an `xmlns:p` on one element does not resolve a prefix on its sibling.",
      "Every element is a symbol, so a large generated XML file publishes a very large tree. The address that helps is the containment path — `config > services > service` — rather than a flat list of tags, and there is no way to ask for only the leaves.",
      "A DTD brings a second vocabulary: `doctype` declarations, element and attribute declarations, entities and notations are recorded with their own roles, and a content-model member that no declaration in the file names gets a shadow target published for it rather than a dangling containment edge.",
    ],
  },

  Markdown: {
    headline:
      "Markdown is indexed as the section tree it draws: each heading is a section owned by its parent heading, tables and code fences are sites under the heading they sit in, and a link is a recorded use of its destination — so a documentation set's internal references and its outline are both queryable.",
    agentAsks: [
      "What sections does this document have, and how are they nested?",
      "Which links in this document point at a heading that exists here?",
      "Which files does this document link to?",
      "What does this document's front matter declare?",
    ],
    limitations: [
      "A heading, a table and a code fence are sites rather than declarations, so the same construct can legitimately appear twice under one section. The first occurrence keeps its exact spelling and only the Nth repeat is disambiguated, and the numbering is per owner rather than per file — 44% of this lane's symbols share a name with another symbol in the same file, and the line already separates them. Collapsing repeats instead is not an option: before sites were published per occurrence, 1,920 of the corpus's 4,078 fenced code blocks were erased, in 406 of 738 files.",
      "Links resolve to a heading's ANCHOR rather than to its written wording — `#install-now` is the spelling a target is matched against, not the heading's text. A fragment naming nothing is not published at all, and a `#section` fragment only resolves inside its own file, so a table of contents pointing at another page's anchor stays unresolved rather than reaching across the tree.",
      "The prose between the structure is not recorded and nothing is inferred from what it says. A heading's name is its display text with the ATX closing run removed per CommonMark, so a document that closes its headings and one that does not publish the same section name; a `#` with no space before it is kept as part of the text.",
    ],
    sample: {
      caption: "Two nested headings and the link that targets one of them",
      code: `# Getting started          <!-- bb records: section, owned by the document -->

## Install                  <!-- bb records: section Install, owned by Getting started -->

Run the [setup](#install) step first.   <!-- bb records: uses -> the install anchor`,
    },
    whereItShowsUp: [
      "A README, a `docs/` tree and the prose inside an `.mdx` component all index the same way, so a documentation site is one family whose only structure is heading hierarchy.",
      "One file carries both the documentation and the links between documents — `[migration](./migrate.md)` is recorded as a use of that destination — so the documentation graph is a graph of files.",
      "Links are read from a second grammar. tree-sitter-markdown models headings, lists, tables and fences as nodes but leaves inline content opaque, so the engine pre-parses every inline block with the companion inline grammar and hands the trees over; a link, image or autolink is therefore an AST fact rather than a stripped string.",
    ],
  },

  Make: {
    headline:
      "A makefile is indexed as the flat namespace it is: one module symbol per file owns every target, variable and macro, a prerequisite this file declares is a reference and everything else is a member read with the reason named — so the shape of a build graph is answerable without running Make.",
    agentAsks: [
      "Which targets does this makefile declare, and what does each one depend on?",
      "Which variable does this recipe read, and where is it assigned?",
      "Which files does this makefile include?",
      "Which macro does this recipe call?",
    ],
    limitations: [
      "Targets resolve inside the makefile. An `include` is an import edge, but the included file's targets are not folded into this file's set, so a rule reaching a dependency two files away reads as two files with two targets — and Make has exactly one declaration level, so a makefile is a flat set of declarations joined by references rather than a tree of blocks.",
      "A reference is `references` only when this file declares the target, and `uses` otherwise with the reason attached. A Make prerequisite is usually a file, a Make variable is often set by the command line or the environment, and Make ships builtins no file can declare; over the corpus the unresolved ends divide as 241 file paths, 183 external variables, 160 builtins, 213 automatic variables and 11 shell variables, and not one of them is a true dangler.",
      "`ifdef` and `ifeq` select between alternatives and are not evaluated, so a variable assigned in two branches becomes one record carrying the last assignment's operator and value. A worse case is a conditional that follows a rule with a recipe: the grammar nests the whole block inside that rule's recipe, so the walk always descends into children — including recipes — to keep the rules it swallowed.",
    ],
    sample: {
      caption: "Two variables, a target with a file prerequisite, and an include",
      code: `CC := gcc                        # bb records: variable CC
SRC := $(wildcard src/*.c)       # bb records: variable SRC

build: $(SRC)                    # bb records: target build; $(SRC) references SRC
\ttail -n +2 $< | $(CC) -o app   # $< is an automatic variable: a use, not a declaration

include config.mk                # bb records: an import -> config.mk`,
    },
    whereItShowsUp: [
      "A real project splits make across files with `include common.mk`; each file is its own module, the include is an import edge, and each target stays in the file that declares it. Both expansion spellings are normalised — `${VAR}` is Make's second form and appears 68 times across 14 of the corpus's 99 files, and handling only `$(` published each as two edges, one of them dangling.",
      "A macro is a callable: `define M … endef` publishes a function symbol with parameters, and `$(call M, …)` publishes a call edge to it. A loop variable bound by `$(foreach v,…)` is recorded as a local binder rather than as a project variable.",
      "Generated make is everywhere — CMake, `configure` and Autotools all emit it — so a build tree under `build/` is a large body of make whose prerequisites are files rather than source symbols, and almost every edge from it points outward to something Make can see and no file declares.",
    ],
  },

  Protobuf: {
    headline:
      "A `.proto` file is indexed as the declarations it makes and the types they name: a package, messages with their fields, enums, oneofs and services with their rpcs each get an identity, nesting is containment, and a field's declared type — or an rpc's request and response — is a reference to the type it names.",
    agentAsks: [
      "Which messages, enums, services and oneofs does this file declare?",
      "Which fields does this message have, and which types do they name?",
      "Which operations does this service expose, and what do they take and return?",
      "Which field numbers has this message reserved?",
    ],
    limitations: [
      "`extends` is deliberately unused, and the reason is the language rather than the analyzer. Proto's `extend Foo { … }` does not make the block a subclass of `Foo`; it adds FIELDS to `Foo`. So the extension block publishes no symbol of its own, its members are emitted with the extended type as their owner and marked `viaExtension`, and nothing in a schema should be read as an inheritance relationship.",
      "Reference resolution is per-file. The specification's own rule is implemented — a leading dot is absolute, anything else resolves from the innermost scope outward, and a forward reference to a message declared later in the file is fine because declarations are collected in a pre-pass — but it resolves against what THIS file declares. A dotted reference whose owner lives in another file falls back to the name as written, which is correct for the fully qualified names real schemas use and is where the 3 unresolved endpoints out of 17,411 relationships across all four pinned corpora come from.",
      "A scalar type is a keyword, not a reference, so `string` and `int32` produce no edge; whether a type node names something is decided by whether it holds a message-or-enum type, not by a list of known scalars. And per-field and per-enum-value options are not extracted — `option`, `reserved` and `extensions` ride on the file or the owning message as metadata rather than becoming declarations.",
    ],
    sample: {
      caption: "A package, a message with two fields, and a service with one rpc",
      code: `package acme.billing;               // bb records: namespace acme.billing

message Invoice {                    // bb records: class Invoice
  string id = 1;                     // bb records: property id — a scalar, so no edge
  repeated Line lines = 2;           // bb records: property lines; uses -> Line
}

service Billing {                    // bb records: interface Billing
  rpc Charge (Invoice) returns (Receipt);   // bb records: method Charge; uses -> Invoice and Receipt
}`,
    },
    whereItShowsUp: [
      "A schema is a directory of `.proto` files under a versioned package path, so `acme.billing.v1.Invoice` is the real address and the leading `v1` is a package segment rather than a kind. Against protobuf's own 108-file reference corpus this analyzer publishes 7,744 symbols and 9,073 relationships with 107 of 108 files clean.",
      "A `oneof` is a symbol and its fields still belong to the message, because a field number lives in the message's space and `msg.field` is how every protobuf tool refers to them — so the oneof is a union with containment edges to each member, and each member carries the oneof it belongs to.",
      "The proto2 `group` form declares a type AND a field, and both are published under distinct ids: `optional group G = 4 { … }` gives you `pkg.M.G` and `pkg.M.G#property`. A `#` cannot occur in a protobuf identifier, so no real name can forge the second one — which accounts for all 39 ownership changes measured when this analyzer replaced the grammar it shipped with.",
    ],
  },

  Vue: {
    headline:
      "A `.vue` file is indexed as one component with a surface: its props, computed values, methods, emitted events and the components its template renders are all recorded, while the script block itself is handed to the real JavaScript/TypeScript analyzer — so a component's logic and its component graph arrive together.",
    agentAsks: [
      "Which components does this template render?",
      "Which props and events does this component declare?",
      "Which methods does this component define, and what do they call?",
      "Which key does this component provide or inject?",
    ],
    limitations: [
      "The template is markup, not symbols. Template elements, attributes and directives are never recorded: a component usage comes from its tag name, a provide/inject key from its argument, and an identifier read in `{{ }}` or `:attr` from the expression — so a directive is read, never resolved.",
      "The seven compiler macros are how a file declares its own surface, so they publish props and events rather than edges. `withDefaults(defineProps(xPropsDefaults), …)` reads its defaults object within the file: a defaults constant imported from another module yields no defaults, because this lane does not resolve cross-file constants.",
      "A `<style>` block is skipped entirely, and it is not the CSS family's either unless a build step writes it out as a real stylesheet file. And a placeholder in a template is read as a name: two corpus files published components literally named `COMPONENT_NAME` with 64 edges between them, which is what a template awaiting substitution looks like to an identifier reader.",
    ],
    sample: {
      caption: "A script-setup component: the props and events it declares, and the tag it renders",
      code: `<script setup>
const props = defineProps({ id: String, total: Number })   // bb records: properties id, total
const emit  = defineEmits(['save'])                          // bb records: event save
</script>

<template>
  <!-- bb records: instantiates edge -> InvoiceRow, from the tag name alone -->
  <InvoiceRow :total="props.total" @save="emit('save')" />
</template>`,
    },
    whereItShowsUp: [
      "One component per file, and the file's own name is the component's name, so the class symbol, the parent's import and the tag in a template are the same string.",
      "Options API and `<script setup>` land in the same component symbol — `methods`, `computed`, `props`, `emits`, `watch`, `setup` and the lifecycle hooks are all members of it — so a codebase mid-migration reads as one graph rather than two.",
      "A component's real dependencies (a store, a router, an API client) are ordinary imports in its script block, handed to the JavaScript or TypeScript analyzer, so they sit in the same graph as the components it renders. Which of the two runs is decided per script block from the block's declared language rather than from the file extension.",
    ],
  },

  Svelte: {
    headline:
      "A `.svelte` file is read as the component it compiles to: its props, its reactive declarations, its methods and the components its markup renders are recorded, its script block goes through the real JavaScript/TypeScript analyzer, and the compiler's rune surface is split carefully enough that a rune call never masquerades as your code.",
    agentAsks: [
      "Which components does this template render?",
      "Which props does this component export?",
      "Which reactive values does this component declare?",
      "Which function does this $effect hand to the compiler?",
    ],
    limitations: [
      "Runes are compiler macros: the variables they initialise are the symbols, and the rune calls themselves are not call targets. The sharp edge is the invoking/value-taking split — `$effect(…)`, `$effect.pre`, `$effect.root`, `$effect.untracked`, `$derived.by` and `$host` invoke what they are given, so a named function handed to one does produce a call edge, while `$derived(expr)`, `$state(0)` and `$bindable(v)` hand over a value and produce none.",
      "The rune test is on the full dotted name plus its leaf, and a bare `$` prefix is never enough. The same `$name.member` shape is how ordinary user data is written — `$order.scoops`, `$value.foo`, `$formData.dob` — alongside SvelteKit's `$lib` import alias, which appears 3,549 times in the corpus — so two runes are recognised as exact names only, and a user's own `$`-prefixed function stays a call.",
      "Template elements, attributes and directives are never symbols. A component usage comes from its tag and an `on:` handler from the identifier in its expression, so `on:click={() => doThing()}` resolves through the call it makes rather than through the directive, and a `v-for`-style loop variable or a slot prop declared in the markup shadows the script binding of the same name rather than publishing a duplicate.",
    ],
    sample: {
      caption: "A legacy prop, a reactive declaration, an invoking rune, and the tag the component renders",
      code: `<script>
  export let total = 0                   // bb records: property total on the component
  $: doubled = total * 2                 // bb records: variable doubled (a reactive declaration)
  $effect(() => track(total))            // bb records: calls -> track, an invoking rune
</script>

<!-- bb records: instantiates -> InvoiceRow, and the on: handler's call edge -->
<InvoiceRow {total} on:save={save} />`,
    },
    whereItShowsUp: [
      "`export let` is how a Svelte 4 component declares a prop and `$props()` how a Svelte 5 one does; both land as properties on the component symbol, so a codebase spanning both styles reads the same way.",
      "`context=\"module\"` gives a file a second, instance-free script. Its exports are file-scope bindings rather than members of a component, so a store declared there belongs to the file.",
      "SvelteKit adds `+page.svelte` and `+layout.svelte` route files plus `server/` code; those are still `.svelte` and index as components, and the framework's own routing table is not part of the graph.",
    ],
  },
}