/**
 * THE PROTOBUF DECLARATION SPEC, as a fixture artefact first.
 *
 * It lives here while the landing is priced; if the INDEX_SPEC lands, the spec moves into
 * `src/ast/real-protobuf-analyzer.ts` (this lane's file) and `parallel-indexer.ts` references it,
 * so `src/ast/project-index.ts` never has to learn protobuf.
 *
 * MEASURED: with the Solidity default (what any `PROJECT_INDEX_EXTENSIONS` entry would use TODAY,
 * because `specByLang` has no protobuf entry) the index holds **0 names** — a spec-less entry is an
 * entry that indexes the right shape and nothing else. With the spec below it holds **8,048 names**
 * over the same 847 files, and the walk's candidate `hashicorp.consul.internal.common.EnterpriseMeta`
 * is PRESENT while all seven declared-nowhere names stay absent.
 */
export const PROTOBUF_SPEC = {
  /**
   * `memberNodes` and `baseNodes` are REQUIRED (`spec.memberNodes.includes(...)` throws otherwise).
   * Both are empty on purpose: a protobuf field is not a member of a TYPE the way a method is, and
   * the language has no inheritance at all — which is why this lane's `extends`/`implements` columns
   * are empty, and why borrowing Solidity's arrays would fabricate structure the language lacks.
   */
  typeNodes: { message: "class", enum: "enum", service: "interface" },
  memberNodes: [] as string[],
  baseNodes: [] as string[],
  /**
   * THE GRAMMAR PUTS NO DECLARATION NAME IN A `name` FIELD: `message Foo { }` is a `message` node
   * whose first named child is `message_name` (`enum`/`rpc`/`service` behave the same). The generic
   * extractor reads `childForFieldName("name")`, undefined for every one of them, so a spec listing
   * only `typeNodes` indexes the right SHAPE and holds NOTHING.
   *
   * THE PACKAGE IS JOINED, and it is read from the ROOT's children: a `.proto` file is
   * `source_file > (syntax, package, import…, message…)`, so `package` is a SIBLING of the
   * declaration, not an ancestor — an upward walk never sees it, which is exactly the bug the first
   * version of this resolver had (it produced bare names, and the candidate read ABSENT while the
   * index held 6,377 names).
   *
   * The join is what makes the key space speak the spelling the walk builds: `EnterpriseMeta` alone
   * cannot answer `hashicorp.consul.internal.common.EnterpriseMeta`.
   */
  nameResolver: (n: any) => {
    const own = (n.namedChildren ?? []).find((c: any) => String(c.type).endsWith("_name"))?.text
      ?? n.childForFieldName("name")?.text ?? ""
    if (own.length === 0) return ""
    let root: any = n
    while (root.parent !== null && root.parent !== undefined) root = root.parent
    const pkgs: string[] = []
    for (const c of root.namedChildren ?? []) {
      if (c.type !== "package") continue
      const t = String(c.text ?? "").replace(/^\s*package\s+/, "").replace(/;\s*$/, "").trim()
      if (t.length > 0) pkgs.push(t)
    }
    return pkgs.length > 0 ? `${pkgs.join(".")}.${own}` : own
  },
}
