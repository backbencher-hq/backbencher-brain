/**
 * SQL TRUTH — an independent derivation of a SQL file's schema edges, for the differential.
 *
 * WHY THIS FILE EXISTS. SQL-G14: `script/m14/differential.ts` carried 34 `derive*Edges` oracle
 * branches and NONE for sql, so a scoped SQL run ended "derived ZERO truth edges" and the lane could
 * not produce a floor (sections E/F of #419). This is the first half of that oracle.
 *
 * THE ONE RULE THAT MATTERS: this file shares NOTHING with `src/ast/real-sql-analyzer.ts` — no import,
 * no shared constant, no shared traversal, no shared string formatter. A shared helper is not a second
 * opinion; it is one function called twice, and the programme has already paid for that lesson in
 * markdown and python. Every edge below is derived by walking the TREE, which is why a match between
 * this file and the analyzer means something.
 *
 * SCOPE, STATED RATHER THAN IMPLIED — THIS IS THE FIRST HALF, NOT THE WHOLE ORACLE:
 *
 *   DERIVED HERE (the structural bulk):
 *     contains    table -> column, table -> index, table -> named constraint
 *     references  column-level and constraint-level `REFERENCES <table>`
 *   NOT YET DERIVED (deliberately, and the differential will count them as `unexplained` until they
 *   are, which is the honest reading of a partial oracle):
 *     calls        invocation nodes inside a declaration
 *     uses         member/column reads (needs the analyzer's `uses` policy settled first)
 *     imports      psql `\i`/`\ir` and CREATE EXTENSION (text- and node-based, two mechanisms)
 *     overrides    CREATE OR REPLACE same-kind same-file redeclaration
 *     instantiates composite-type casts
 *
 * EDGE IDENTITY, which the differential compares as strings, is stated as POLICY here rather than
 * imported from the analyzer:
 *   - a `contains` OWNER is the declared name as written (the bare table/index name);
 *   - a `contains` MEMBER target is the member's QUALIFIED name, `<file module>::<owner>.<member>`,
 *     because containment is the one relation whose member is declared in THIS parse result — the
 *     file is the unit of a SQL migration and is the member's real owner (SQL's containment tree is
 *     file -> table -> column; this file is the member's owner for exactly that reason);
 *   - `references` targets stay BARE: they name a table that may be declared in another file, and a
 *     file-qualified spelling would be inventing which file that is.
 */

export type SqlTruthEdge = { label: string; from: string; target: string }

/** Named children, in order. */
function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** Every descendant of a type, in tree order. Walks NAMED children only — the oracle derives from
 *  structure, never from anonymous punctuation, so a tree it cannot read produces no edge rather than
 *  a guessed one. */
function descendants(n: any, type: string, out: any[] = []): any[] {
  if (!n) return out
  if (n.type === type) out.push(n)
  for (const c of kids(n)) descendants(c, type, out)
  return out
}

/** A tree the parser could not read is not evidence: no edge is derived from a damaged subtree. */
function damaged(n: any): boolean {
  return (n?.hasError ?? false) === true || descendants(n, "ERROR").length > 0
}

/**
 * THE NAME A DECLARATION IS KNOWN BY, derived from the language rather than from the analyzer.
 *
 * Two rules, each stated because each could otherwise be "that is what the analyzer does":
 *   - A QUOTED name arrives as a `literal` node in this grammar, never as an `identifier`. The
 *     delimiters are SQL syntax, not part of the name: `"Id"` names Id. Read from the tree, this is
 *     the only spelling that yields the name the language itself would resolve.
 *   - A SYMBOL IS NAMED BY ITS LEAF. `app.users` is the table `users` in schema `app`; the schema is
 *     a qualifier, not part of the symbol's name. (The lane measured the resolution consequence too —
 *     bare leaves resolve at 0.89 against qualified spellings at 0.31 — but the rule stands on the
 *     language: a qualifier says WHERE, not WHAT.)
 */
function writtenName(n: any): string {
  if (!n) return ""
  const norm = (raw: unknown): string => {
    let t = String(raw ?? "").trim()
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("`") && t.endsWith("`")))) t = t.slice(1, -1)
    const dot = t.lastIndexOf(".")
    if (dot >= 0) t = t.slice(dot + 1)
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("`") && t.endsWith("`")))) t = t.slice(1, -1)
    return t.trim()
  }
  if (n.type === "identifier" || n.type === "literal") return norm(n.text)
  const id = kids(n).find((c: any) => c.type === "identifier" || c.type === "literal")
  return norm(id ? id.text : n.text)
}

/** The node after `marker` among its named siblings. */
function after(n: any, marker: string): any | null {
  const ks = kids(n)
  const i = ks.findIndex((c: any) => c.type === marker)
  return i >= 0 ? ks[i + 1] ?? null : null
}

/** `contains <owner> -> <module>::<owner>.<member>`. */
function pushContains(out: SqlTruthEdge[], moduleName: string, owner: string, member: string): void {
  if (!owner || !member) return
  out.push({ label: "contains", from: owner, target: `${moduleName}::${owner}.${member}` })
}

export function deriveSqlTruth(root: any, moduleName: string): SqlTruthEdge[] {
  const out: SqlTruthEdge[] = []
  // A DAMAGED SUBTREE IS NOT EVIDENCE, BUT A DAMAGED FILE IS NOT A DEAD FILE. The first version of
  // this oracle returned NOTHING for any file with a single ERROR anywhere, which discarded every
  // intact statement in the lane's own `sqld7`/`sqld12`/`sqld13`/`sqld15` fixtures — four files that
  // exist precisely to carry damaged regions beside real declarations. Damage is checked PER
  // STATEMENT below, so a broken region costs its own edges and nothing else.

  // ── CONTAINS: table -> column ────────────────────────────────────────────────────────────────────
  // POLICY: a column belongs to the table that declares it. The owner is the table's first
  // object_reference; the member is the column_definition's FIRST identifier (a column's name is
  // written before its type, and the type is a bare anonymous token or a named type spelling, so the
  // first identifier is the name — asserted against the tree dump rather than assumed: for
  // `b integer REFERENCES o (id)` the first identifier is `b`, and `id` is a sibling of the
  // object_reference, not a child of the column_definition's name position).
  for (const ct of descendants(root, "create_table")) {
    if (damaged(ct)) continue
    const owner = writtenName(kids(ct).find((c: any) => c.type === "object_reference"))
    if (!owner) continue
    for (const cd of descendants(ct, "column_definition")) {
      const member = writtenName(kids(cd)[0])
      pushContains(out, moduleName, owner, member)
    }
  }

  // ── CONTAINS: table -> index ────────────────────────────────────────────────────────────────────
  // An index is declared as a member of the table it is ON (the grammar makes `ON <table>` mandatory,
  // so there is no shape here without an owner).
  for (const ci of descendants(root, "create_index")) {
    if (damaged(ci)) continue
    const indexName = writtenName(kids(ci).find((c: any) => c.type === "identifier"))
    const owner = writtenName(after(ci, "keyword_on"))
    if (indexName && owner) pushContains(out, moduleName, owner, indexName)
  }

  // ── CONTAINS: table -> named constraint ─────────────────────────────────────────────────────────
  // POLICY: only a NAMED constraint is a member. An unnamed constraint declares no nameable symbol,
  // so publishing one would invent a member the file does not declare.
  for (const ct of descendants(root, "create_table")) {
    if (damaged(ct)) continue
    const owner = writtenName(kids(ct).find((c: any) => c.type === "object_reference"))
    if (!owner) continue
    for (const cn of descendants(ct, "constraint")) {
      const nameNode = kids(cn).find((c: any) => c.type === "identifier")
      if (nameNode) pushContains(out, moduleName, owner, writtenName(nameNode))
    }
  }

  // ── REFERENCES: `<column> ... REFERENCES <table>` and `FOREIGN KEY ... REFERENCES <table>` ──────
  // POLICY: the reference target is the object_reference written AFTER `keyword_references` — the
  // grammar's own positional statement of which reference is the FK, which is exactly what SQL-D1
  // reads and NOT "any object_reference in the column". A column's custom TYPE is also an
  // object_reference here and is deliberately not an edge (SQL-D1's ruling); deriving it from the
  // position is what keeps this oracle independent while still agreeing about what the language says.
  for (const ct of descendants(root, "create_table")) {
    if (damaged(ct)) continue
    const owner = writtenName(kids(ct).find((c: any) => c.type === "object_reference"))
    if (!owner) continue
    for (const cd of descendants(ct, "column_definition")) {
      const ref = after(cd, "keyword_references")
      const tgt = writtenName(ref)
      if (tgt) out.push({ label: "references", from: owner, target: tgt })
    }
    for (const cn of descendants(ct, "constraint")) {
      const ref = after(cn, "keyword_references")
      const tgt = writtenName(ref)
      if (tgt) out.push({ label: "references", from: owner, target: tgt })
    }
  }

  return out
}
