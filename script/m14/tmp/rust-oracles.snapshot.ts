/** rust F5 oracles, lifted VERBATIM from /tmp/opencode/diff-good.ts by extract-rust-oracles.ts (TS AST, not brace counting). Oracle logic unchanged; only packaging differs. */

// Rust truth: call edges (identifier + member-leaf callees), implements
// (impl <Trait> for Type), extends (supertrait bounds on trait items).
// Exported like the zig/cpp oracles so lane replicas and probes can verify
// the mirror directly.
export function deriveRustEdges(root: any): {
    label: string;
    from: string;
    target: string;
}[] {
    const edges: {
        label: string;
        from: string;
        target: string;
    }[] = [];
    const seenCalls = new Set<string>();
    const impls: {
        ty: string;
        trait: string;
    }[] = [];
    // Prototype-safe (M14.0.F13): this registry is keyed by SOURCE type names, and a plain
    // `{}` answers for `toString`/`__proto__` before the source has said anything.
    const supertraits: Record<string, string[]> = Object.create(null);
    // D2 mirror (rust extreme review): the analyzer resolves `Self` to the
    // enclosing impl type in struct literals (`Self { }`), `Self::new()` and
    // bare `Self(..)` (cargo src/compiler/rustdoc.rs + manifest/mod.rs lanes:
    // oracle emitted raw Self while the analyzer emitted RustdocExternMap /
    // RegistryName — one disagreement surfacing as a MISSING+UNEXPLAINED
    // pair). Same rule here: resolve via the enclosing impl_item's type leaf,
    // fall back exactly like the analyzer (struct literals keep raw "Self",
    // calls drop it).
    const enclosingImplType = (n: any): string | null => {
        let cur: any = n ? n.parent : null;
        while (cur) {
            // R10 mirror: `Self` is the implemented TYPE, so it resolves to that
            // type's nominal LEAF — and when the type has none, to ABSENCE.
            if (cur.type === "impl_item")
                return rustImplSelfTypeName(cur.childForFieldName?.("type"));
            cur = cur.parent;
        }
        return null;
    };
    // In-file declared type names (struct/enum/type-alias/impl targets),
    // mirroring the analyzer's deferred-instantiation contract: ctor
    // instantiates resolve ONLY to types declared in this file (std/foreign
    // receivers like String::new() are deliberately not truth). Impl types
    // are stored as FULL text (io::Error) to mirror the analyzer's inFile
    // symbol names - a foreign type implemented here is not a local
    // declaration and must not resolve io::Error::new() to the leaf Error.
    const declaredTypes = new Set<string>();
    {
        const pre: any[] = [root];
        while (pre.length > 0) {
            const n = pre.pop()!;
            if (n.type === "struct_item" || n.type === "enum_item" || n.type === "type_item") {
                const nm = n.childForFieldName?.("name") ?? n.namedChild(0);
                if (nm)
                    declaredTypes.add(nm.text);
            }
            else if (n.type === "impl_item") {
                // R10 mirror: the impl participates in the deferred ctor filter under
                // the name the analyzer PUBLISHES for it (the type's own un-wrapped
                // spelling, or the declared synthetic when it has no nominal name).
                const typeN = n.childForFieldName?.("type");
                if (typeN)
                    declaredTypes.add(rustImplSymbolName(typeN) ?? "anonymous_impl");
            }
            for (let k = 0; k < n.namedChildCount; k++)
                pre.push(n.namedChild(k));
        }
    }
    const stack: any[] = [root];
    const leafOf = (fn: any): string | undefined => {
        if (!fn)
            return undefined;
        if (fn.type === "identifier") {
            // R10 mirror: `Self(..)` calls the enclosing impl type's constructor —
            // `Self` is a KEYWORD, never a symbol name, so the callee's name is the
            // type's; unresolvable (a trait default body) means the callee has no
            // name and the edge is not truth either.
            if (fn.text === "Self")
                return enclosingImplType(fn) ?? undefined;
            return fn.text;
        }
        // turbofish: foo::<T>() wraps the real callee - unwrap it.
        if (fn.type === "generic_function") {
            const inner = fn.childForFieldName?.("function");
            return leafOf(inner);
        }
        if (fn.type === "field_expression" || fn.type === "scoped_identifier") {
            const leaf = fn.namedChildren[fn.namedChildCount - 1];
            return leaf?.type === "field_identifier" || leaf?.type === "identifier" ? leaf.text : undefined;
        }
        return undefined;
    };
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (n.type === "macro_invocation") {
            // macro invocations are real call sites (format!/write!/vec!...)
            const mn = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier");
            let mname = mn ? mn.namedChildren[mn.namedChildCount - 1]?.text ?? mn.text : undefined;
            if (mname && !seenCalls.has("macro:" + mname)) {
                seenCalls.add("macro:" + mname);
                edges.push({ label: "calls", from: "(expr)", target: mname });
            }
        }
        if (n.type === "call_expression") {
            const fn = n.childForFieldName?.("function");
            const name = leafOf(fn);
            if (name && !seenCalls.has(name)) {
                seenCalls.add(name);
                edges.push({ label: "calls", from: "(expr)", target: name });
            }
            // ::new / Type() constructor instantiation truth mirrors the family:
            // receiver-type leaf for ::new, PascalCase leaf for tuple ctors.
            // FILTERED to in-file declared types - the analyzer resolves ctor
            // instantiates only for locally-declared types (deferred resolution),
            // so std/foreign receivers (String::new(), Arc::new()) are not truth.
            if (fn) {
                // Mirror the analyzer's ctor contract EXACTLY:
                //   Foo::new() on a field/scoped receiver -> instantiates(Foo leaf)
                //   Bare PascalCase Foo(...) identifier callee -> instantiates(Foo)
                // Enum-variant constructions (Token::Literal('.')) are CALLS, not
                // instantiates - the analyzer emits calls Literal there and never
                // instantiates Token (fixture-pinned contract). Bare identifiers
                // have no named children, so calleeLeaf is undefined - use fn.text.
                const calleeLeaf = fn.namedChildren[fn.namedChildCount - 1];
                const isNewCtor = calleeLeaf?.text === "new";
                const barePascal = fn.type === "identifier" && /^[A-Z]/.test(fn.text);
                if ((isNewCtor && (fn.type === "field_expression" || fn.type === "scoped_identifier")) ||
                    (barePascal && fn.type === "identifier")) {
                    let recv: string | undefined;
                    if (fn.type === "identifier")
                        recv = fn.text;
                    else {
                        const r2 = fn.childForFieldName?.("value") ?? fn.childForFieldName?.("path");
                        recv = lastSegment((r2?.text ?? "").split("<")[0].trim());
                    }
                    // D2 mirror: a `Self` receiver / bare `Self(..)` constructs the
                    // enclosing impl type (matches the analyzer's enclosingImplType
                    // rule; unresolvable Self drops like the analyzer's ?? null).
                    if (recv === "Self")
                        recv = enclosingImplType(n) ?? "";
                    if (recv && /^[A-Z]/.test(recv) && declaredTypes.has(recv) && !seenCalls.has("inst:" + recv)) {
                        seenCalls.add("inst:" + recv);
                        edges.push({ label: "instantiates", from: "(expr)", target: recv });
                    }
                }
            }
        }
        else if (n.type === "struct_expression") {
            const typeNode = n.childForFieldName?.("name") ?? n.namedChild(0);
            // CARGO-D1 (two-corpus gate, cargo tree.rs:242): a QUALIFIED struct
            // literal `cargo_tree::TreeOptions { .. }` carries a scoped_type_
            // identifier whose text starts LOWERCASE (the crate/module path), so a
            // whole-text /^[A-Z]/ test silently dropped the construction while the
            // analyzer (leaf contract) emitted instantiates TreeOptions. Casing is
            // judged on the LEAF segment (the type), matching the analyzer.
            if (typeNode) {
                const rawLeaf = lastSegment(typeNode.text);
                // D2 mirror: `Self { }` constructs the enclosing impl type
                // (analyzer emits the resolved type immediately with no in-file
                // filter; unresolvable Self keeps the raw leaf on both sides).
                let t2 = rawLeaf.split("<")[0].trim();
                // R10 mirror: an unresolvable `Self` literal constructs an UNNAMED
                // type, and the analyzer now emits nothing for it (R7 absence) — the
                // old `?? "Self"` kept a target no symbol has.
                if (t2 === "Self")
                    t2 = enclosingImplType(n) ?? "";
                if (/^[A-Z]/.test(t2) && !seenCalls.has("struct:" + t2)) {
                    seenCalls.add("struct:" + t2);
                    edges.push({ label: "instantiates", from: "(expr)", target: t2 });
                }
            }
        }
        else if (n.type === "impl_item") {
            const traitN = n.childForFieldName?.("trait");
            const typeN = n.childForFieldName?.("type");
            if (traitN && typeN) {
                // R10 mirror: the edge's SOURCE is the impl symbol's published name.
                const tName = rustImplSymbolName(typeN) ?? "anonymous_impl";
                const trName = lastSegment(traitN.text.split("<")[0].trim());
                if (tName && trName) {
                    edges.push({ label: "implements", from: tName, target: trName });
                    impls.push({ ty: tName, trait: trName });
                }
            }
        }
        else if (n.type === "trait_item") {
            const nameNode = n.childForFieldName?.("name");
            const boundsNode = n.childForFieldName?.("bounds");
            if (nameNode && boundsNode) {
                const supers: string[] = [];
                for (const c of boundsNode.namedChildren) {
                    if (!c || c.type === "type_parameters" || c.type === "where_clause")
                        continue;
                    let bn = c.text.split("<")[0].split(":").pop() || "";
                    bn = lastSegment(bn.trim());
                    if (/^[A-Za-z_]/.test(bn))
                        supers.push(bn);
                }
                if (supers.length)
                    supertraits[nameNode.text] = supers;
            }
        }
        for (let k = 0; k < n.namedChildCount; k++)
            stack.push(n.namedChild(k));
    }
    // supertrait extends truth
    for (const [tr, supers] of Object.entries(supertraits)) {
        for (const sp of supers)
            edges.push({ label: "extends", from: tr, target: sp });
    }
    return edges;
}

// Rust truth: bare value reads AND field reads (`uses`). R1 mirror (rust
// review #798): the analyzer emitted both while this oracle derived neither,
// so rust's entire read surface sat OUTSIDE the comparison by construction —
// a restored read rode a fixture and its mutant but no corpus lane, which is
// the declared limitation the issue recorded (and the same gap groovy's G7
// closed the same way).
//
// Same contract as the analyzer, rule for rule: file-scope VALUE resolution
// (const/static/fn/enum-variant/struct/enum/union/type, module-scoped),
// use-imported leaves (alias- and scoped-path-aware), declaration positions
// (item-name rule), call callees (turbofish `generic_function` +
// `parenthesized_expression` climb), member leaves owned by the field path,
// qualified non-leaves, LHS writes, macro-rule bodies vs invocation args,
// attributes, use paths, where-bounds, and shadowing via per-function
// pattern bindings (incl. closure params, destructured/let-condition/for/
// match-arm patterns and the uppercase path-pattern rule).
//
// DISCLOSED, not hidden: this is a mirror, so it cannot adjudicate the one
// thing it shares with the analyzer — a wrong RULE reads green on both sides.
// It catches dropouts and fabrications against the rule, which is what a
// coverage oracle is for; the independent evidence for the rule itself stays
// the fixtures (rust/bare-value-reads) and the six reverting mutants.
export function deriveRustBareUses(root: any): {
    label: string;
    from: string;
    target: string;
}[] {
    const out: {
        label: string;
        from: string;
        target: string;
    }[] = [];
    const owners = new Map<string, Set<string>>();
    const useImported = new Set<string>();
    const addOwner = (name: string | null, mods: string[]): void => {
        if (!name)
            return;
        let s = owners.get(name);
        if (!s) {
            s = new Set<string>();
            owners.set(name, s);
        }
        if (mods.length === 0)
            s.add("");
        else
            for (const m of mods)
                s.add(m);
    };
    const leftmostId = (n: any): string | null => {
        let cur: any = n;
        while (cur) {
            if (cur.type === "identifier")
                return cur.text;
            cur = cur.namedChild(0);
        }
        return null;
    };
    // The analyzer's useLeafNames: a bare path binds its leaf; a scoped path
    // binds its LAST segment (only when it is a direct path or a group leaf);
    // `as` binds the alias.
    const useLeafNames = (node: any): string[] => {
        const res: string[] = [];
        const walk = (n: any): void => {
            if (!n)
                return;
            if (n.type === "identifier" || n.type === "type_identifier") {
                if (n.parent && (n.parent.type === "use_declaration" || n.parent.type === "use_list"))
                    res.push(n.text);
                return;
            }
            if (n.type === "scoped_identifier") {
                const par = n.parent;
                if (par && (par.type === "use_declaration" || par.type === "use_list")) {
                    const last = n.namedChild(n.namedChildCount - 1);
                    if (last && (last.type === "identifier" || last.type === "type_identifier")) {
                        const t = last.text;
                        if (t && t !== "self" && t !== "super" && t !== "crate")
                            res.push(t);
                    }
                }
                return;
            }
            if (n.type === "use_as_clause") {
                const alias = n.childForFieldName?.("alias") || n.namedChild(n.namedChildCount - 1);
                if (alias)
                    res.push(alias.text);
                return;
            }
            if (n.type === "self")
                return;
            for (let i = 0; i < n.namedChildCount; i++) {
                const c = n.namedChild(i);
                if (c)
                    walk(c);
            }
        };
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c && c.type !== "visibility_modifier" && c.type !== "use" && c.type !== "crate")
                walk(c);
        }
        return res;
    };
    // ---- inventory: file-visible VALUES with their module scopes -----------
    {
        const stack: Array<{
            n: any;
            mods: string[];
            inFn: boolean;
            inImpl: boolean;
        }> = [
            { n: root, mods: [], inFn: false, inImpl: false },
        ];
        while (stack.length > 0) {
            const { n, mods, inFn, inImpl } = stack.pop()!;
            const t = n.type;
            if (t === "mod_item") {
                const nm = n.childForFieldName?.("name")?.text;
                const body = n.namedChild(n.namedChildCount - 1);
                const hasBody = !!body && body.type === "declaration_list";
                if (nm && hasBody) {
                    for (let i = n.namedChildCount - 1; i >= 0; i--)
                        stack.push({ n: n.namedChild(i), mods: [...mods, nm], inFn, inImpl });
                    continue;
                }
            }
            else if (t === "function_item") {
                if (!inImpl) {
                    const nm = n.childForFieldName?.("name")?.text;
                    if (nm)
                        addOwner(nm, mods);
                }
                for (let i = n.namedChildCount - 1; i >= 0; i--)
                    stack.push({ n: n.namedChild(i), mods, inFn: true, inImpl });
                continue;
            }
            else if (t === "impl_item" || t === "trait_item") {
                for (let i = n.namedChildCount - 1; i >= 0; i--)
                    stack.push({ n: n.namedChild(i), mods, inFn, inImpl: true });
                continue;
            }
            else if (!inFn && (t === "const_item" || t === "static_item")) {
                const nm = n.childForFieldName?.("name")?.text ?? leftmostId(n);
                if (nm && nm !== "_" && !inImpl)
                    addOwner(nm, mods);
                for (let i = n.namedChildCount - 1; i >= 0; i--)
                    stack.push({ n: n.namedChild(i), mods, inFn: true, inImpl });
                continue;
            }
            else if (!inFn && !inImpl && (t === "struct_item" || t === "enum_item" || t === "union_item" || t === "type_item")) {
                const nm = n.childForFieldName?.("name")?.text;
                if (nm)
                    addOwner(nm, mods);
            }
            else if (t === "enum_variant") {
                const nm = n.childForFieldName?.("name")?.text ?? n.namedChild(0)?.text;
                if (nm && !inFn)
                    addOwner(nm, mods);
            }
            else if (t === "use_declaration") {
                for (const leaf of useLeafNames(n)) {
                    if (leaf && leaf !== "self" && leaf !== "*")
                        useImported.add(leaf);
                }
            }
            for (let i = n.namedChildCount - 1; i >= 0; i--)
                stack.push({ n: n.namedChild(i), mods, inFn, inImpl });
        }
    }
    const enclosingMods = (node: any): string[] => {
        const res: string[] = [];
        let cur: any = node ? node.parent : null;
        while (cur) {
            if (cur.type === "mod_item") {
                const nm = cur.childForFieldName?.("name")?.text;
                if (nm)
                    res.unshift(nm);
            }
            cur = cur.parent;
        }
        return res;
    };
    const resolves = (nm: string, mods: string[]): boolean => {
        const o = owners.get(nm);
        if (!o)
            return useImported.has(nm);
        if (o.has(""))
            return true;
        if (useImported.has(nm))
            return true;
        for (const m of mods)
            if (o.has(m))
                return true;
        return false;
    };
    const collectPatternIds = (node: any, bound: Set<string>, mods: string[], isDecl: boolean): void => {
        if (!node)
            return;
        if (node.type === "identifier") {
            const nm = node.text;
            if (!nm || nm === "_" || nm.startsWith("$"))
                return;
            const first = nm.charCodeAt(0);
            if (first >= 65 && first <= 90 && !isDecl && resolves(nm, mods))
                return;
            bound.add(nm);
            return;
        }
        if (node.type === "type_identifier" || node.type === "scoped_identifier" ||
            node.type === "field_identifier" || node.type === "lifetime" ||
            node.type === "primitive_type")
            return;
        if (node.type === "tuple_struct_pattern") {
            for (let i = 1; i < node.namedChildCount; i++)
                collectPatternIds(node.namedChild(i), bound, mods, isDecl);
            return;
        }
        for (let i = 0; i < node.namedChildCount; i++)
            collectPatternIds(node.namedChild(i), bound, mods, isDecl);
    };
    // ---- per-function bound-name sets (shadowing) --------------------------
    const fnBindings = new Map<number, Set<string>>();
    {
        const stack: any[] = [root];
        const fns: any[] = [];
        while (stack.length > 0) {
            const n = stack.pop()!;
            if (n.type === "function_item")
                fns.push(n);
            for (let i = n.namedChildCount - 1; i >= 0; i--)
                stack.push(n.namedChild(i));
        }
        for (const fn of fns) {
            const bound = new Set<string>();
            const fnMods = enclosingMods(fn);
            const params = fn.childForFieldName?.("parameters");
            if (params) {
                for (let i = 0; i < params.namedChildCount; i++) {
                    const p = params.namedChild(i);
                    if (!p || p.type === "self_parameter")
                        continue;
                    const pat = p.childForFieldName?.("pattern") ?? p;
                    collectPatternIds(pat, bound, fnMods, true);
                }
            }
            const body: any[] = [fn];
            while (body.length > 0) {
                const m = body.pop()!;
                if (m.type === "let_declaration") {
                    const pat = m.childForFieldName?.("pattern") ?? m.namedChild(0);
                    collectPatternIds(pat, bound, fnMods, true);
                }
                else if (m.type === "let_condition") {
                    collectPatternIds(m.namedChild(0), bound, fnMods, false);
                }
                else if (m.type === "for_expression") {
                    collectPatternIds(m.namedChild(0), bound, fnMods, true);
                }
                else if (m.type === "closure_expression") {
                    for (let i = 0; i < m.namedChildCount; i++) {
                        const c = m.namedChild(i);
                        if (c && c.type === "closure_parameters")
                            collectPatternIds(c, bound, fnMods, true);
                    }
                }
                else if (m.type === "match_arm") {
                    const patField = m.childForFieldName?.("pattern");
                    if (patField) {
                        const psub: any[] = [patField];
                        while (psub.length > 0) {
                            const q = psub.pop()!;
                            if (q !== patField && (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression"))
                                continue;
                            if (q.type === "match_pattern" || q.type === "identifier" ||
                                q.type === "tuple_pattern" || q.type === "struct_pattern" ||
                                q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
                                q.type === "or_pattern" || q.type === "slice_pattern")
                                collectPatternIds(q, bound, fnMods, false);
                            for (let i = q.namedChildCount - 1; i >= 0; i--)
                                psub.push(q.namedChild(i));
                        }
                    }
                    const sub: any[] = [m];
                    while (sub.length > 0) {
                        const q = sub.pop()!;
                        if (q !== m && (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression"))
                            continue;
                        if (q.type === "tuple_pattern" || q.type === "struct_pattern" ||
                            q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
                            q.type === "or_pattern" || q.type === "slice_pattern")
                            collectPatternIds(q, bound, fnMods, false);
                        for (let i = q.namedChildCount - 1; i >= 0; i--)
                            sub.push(q.namedChild(i));
                    }
                }
                if (m !== fn && (m.type === "function_item" || m.type === "const_item" || m.type === "static_item"))
                    continue;
                for (let i = m.namedChildCount - 1; i >= 0; i--)
                    body.push(m.namedChild(i));
            }
            fnBindings.set(fn.startIndex, bound);
        }
    }
    const hasAncestor = (node: any, types: string | string[], stopAt: string[] | null): boolean => {
        const want = Array.isArray(types) ? types : [types];
        let cur: any = node.parent;
        while (cur) {
            if (want.includes(cur.type))
                return true;
            if (stopAt)
                for (const s of stopAt)
                    if (cur.type === s)
                        return false;
            cur = cur.parent;
        }
        return false;
    };
    const isItemNamePosition = (node: any, parent: any): boolean => {
        switch (parent.type) {
            case "function_item":
            case "struct_item":
            case "enum_item":
            case "trait_item":
            case "mod_item":
            case "type_item":
            case "associated_type":
            case "static_item":
            case "const_item":
            case "enum_variant":
            case "field_declaration":
            case "extern_crate_declaration":
                break;
            default: return false;
        }
        for (let i = 0; i < parent.namedChildCount; i++) {
            const c = parent.namedChild(i);
            if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
                return c.startIndex === node.startIndex && c.endIndex === node.endIndex;
            }
        }
        return false;
    };
    // ---- reads -------------------------------------------------------------
    const seen = new Set<string>();
    const emit = (target: string): void => {
        if (!target || seen.has(target))
            return;
        seen.add(target);
        out.push({ label: "uses", from: "global", target });
    };
    const stack: any[] = [root];
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (n.type === "identifier") {
            const name = n.text;
            const p = n.parent;
            let skip = !name || name === "_" || name === "self" || name === "Self" || name === "super" || name === "crate" || name.startsWith("$");
            if (!skip) {
                if (hasAncestor(n, "macro_definition", ["macro_invocation"]))
                    skip = true;
                else if (hasAncestor(n, "attribute_item", ["function_item", "struct_item", "enum_item", "impl_item", "trait_item", "mod_item"]))
                    skip = true;
                else if (hasAncestor(n, "use_declaration", null))
                    skip = true;
                else if (hasAncestor(n, "where_predicate", null))
                    skip = true;
            }
            if (!skip) {
                // callee (climbs turbofish + parenthesized wrappers)
                let top: any = n;
                let up: any = p;
                while (up && (up.type === "generic_function" || up.type === "parenthesized_expression")) {
                    top = up;
                    up = up.parent;
                }
                if (up && up.type === "call_expression") {
                    const fnField = up.childForFieldName?.("function");
                    if (fnField && fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex)
                        skip = true;
                    const first = up.namedChild(0);
                    if (!skip && first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex)
                        skip = true;
                }
            }
            if (!skip && p && p.type === "field_expression") {
                const field = p.childForFieldName?.("field");
                if (field && field.startIndex === n.startIndex)
                    skip = true;
            }
            if (!skip && p && p.type === "scoped_identifier") {
                const last = p.namedChild(p.namedChildCount - 1);
                if (!last || last.startIndex !== n.startIndex)
                    skip = true;
            }
            else if (!skip && hasAncestor(n, "scoped_identifier", ["call_expression", "field_expression"])) {
                skip = true;
            }
            if (!skip && p && (p.type === "assignment_expression" || p.type === "compound_assignment_expr")) {
                const lhs = p.namedChild(0);
                if (lhs && lhs.startIndex === n.startIndex && lhs.endIndex >= n.endIndex)
                    skip = true;
            }
            if (!skip && p && isItemNamePosition(n, p))
                skip = true;
            if (!skip) {
                let fnNode: any = p;
                while (fnNode && fnNode.type !== "function_item")
                    fnNode = fnNode.parent;
                if (fnNode) {
                    const bound = fnBindings.get(fnNode.startIndex);
                    if (bound && bound.has(name))
                        skip = true;
                }
            }
            if (!skip && resolves(name, enclosingMods(n)))
                emit(name);
        }
        else if (n.type === "field_expression") {
            // The analyzer's field branch: a field_identifier read is a `uses` edge
            // unless it is the LHS of a write or the callee of a call (tuples parse
            // as field_expression with an integer_literal field — not a symbol).
            const field = n.childForFieldName?.("field");
            const par = n.parent;
            let isAssignLhs = false;
            if (par && (par.type === "assignment_expression" || par.type === "compound_assignment_expr")) {
                const left = par.namedChild(0);
                if (left && left.startIndex === n.startIndex && left.endIndex === n.endIndex)
                    isAssignLhs = true;
            }
            if (!isAssignLhs && field && field.type === "field_identifier" &&
                String(field.text).trim() && par?.type !== "call_expression")
                emit(field.text);
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--)
            stack.push(n.namedChild(i));
    }
    return out;
}

// Rust truth: declared-type `references` (R13). The analyzer published these
// from fn params/returns, struct/union/enum field types, type aliases and
// const/static types, while the oracle derived none of it — 2,883 edges over
// 84 of ripgrep's 110 files sat outside the comparison. Rule for rule mirror
// (generic-parameter exclusion incl. the enclosing-item climb, `Self` → the
// enclosing impl type, macro-rule bodies excluded, where-bounds and
// type-parameter lists never collected, field NAME identifiers never types).
export function deriveRustDeclaredTypeRefs(root: any): {
    label: string;
    from: string;
    target: string;
}[] {
    const out: {
        label: string;
        from: string;
        target: string;
    }[] = [];
    const emitted = new Set<string>();
    const enclosingImplType = (n: any): string | null => {
        let cur: any = n ? n.parent : null;
        while (cur) {
            // R10 mirror: `Self` is the implemented TYPE, so it resolves to that
            // type's nominal LEAF — and when the type has none, to ABSENCE (R7).
            if (cur.type === "impl_item")
                return rustImplSelfTypeName(cur.childForFieldName?.("type"));
            cur = cur.parent;
        }
        return null;
    };
    const genericParamsOf = (item: any): Set<string> => {
        const res = new Set<string>();
        let gcur: any = item;
        while (gcur) {
            if (gcur.type === "function_item" || gcur.type === "trait_item" ||
                gcur.type === "struct_item" || gcur.type === "enum_item" ||
                gcur.type === "type_item" || gcur.type === "impl_item") {
                const tp = gcur.childForFieldName?.("type_parameters");
                if (tp) {
                    const pw: any[] = [tp];
                    while (pw.length > 0) {
                        const m = pw.pop()!;
                        if (m.type === "type_identifier" || m.type === "identifier")
                            res.add(m.text);
                        for (let k = 0; k < m.namedChildCount; k++)
                            pw.push(m.namedChild(k));
                    }
                }
                break;
            }
            gcur = gcur.parent;
        }
        return res;
    };
    const push = (source: string, leafNode: any, gparams: Set<string>): void => {
        let target = leafNode.text;
        if (!target || target === "Self") {
            const resolved = enclosingImplType(leafNode);
            if (!resolved)
                return;
            target = resolved;
        }
        if (gparams.has(target))
            return;
        // Dedupe keyed by TARGET alone, i.e. by (label, target) here, because this
        // oracle emits exactly one label. That is the file-wide TRUTH-SIDE
        // INVARIANT every oracle in this harness keeps (see the note at the
        // analyzer-collapse site: "The tree-truth oracles already emit UNIQUE
        // (label,target) edges per file") and it is what the coverage match reads —
        // the match is deliberately site-agnostic, comparing label+normTarget and
        // never `from`. A source-scoped key was tried and reverted: it made truth
        // carry duplicate (references, Err) rows for `fn b<..>() -> T::Err` and
        // `fn c<..>() -> T::Err`, so treeEdgesTotal inflated 6,309 -> 8,278 on
        // ripgrep and the lane's number stopped being comparable to its peers'
        // (the analyzer side is collapsed to unique (label,target), so the same
        // edge counted twice on one side and once on the other). An oracle must
        // mirror the GATE; a synthetic probe that compares `from` as well is
        // asking a question this comparison does not ask.
        if (emitted.has(target))
            return;
        emitted.add(target);
        out.push({ label: "references", from: source, target });
    };
    // R8/R15 mirror: the generic parameters bound by EVERY enclosing generic item
    // (the analyzer walks the whole chain — see real-rust-analyzer.ts), used to
    // exclude locally-bound names from a where predicate.
    const chainGenericParams = (n: any): Set<string> => {
        const res = new Set<string>();
        let cur: any = n ? n.parent : null;
        while (cur) {
            if (cur.type === "function_item" || cur.type === "function_signature_item" ||
                cur.type === "trait_item" || cur.type === "struct_item" ||
                cur.type === "enum_item" || cur.type === "type_item" || cur.type === "impl_item") {
                const tp = cur.childForFieldName?.("type_parameters");
                if (tp) {
                    const pw: any[] = [tp];
                    while (pw.length > 0) {
                        const m = pw.pop()!;
                        if (m.type === "type_identifier" || m.type === "identifier")
                            res.add(m.text);
                        for (let k = 0; k < m.namedChildCount; k++)
                            pw.push(m.namedChild(k));
                    }
                }
            }
            cur = cur.parent;
        }
        return res;
    };
    const collectLeaves = (typeNode: any): any[] => {
        const res: any[] = [];
        if (!typeNode)
            return res;
        const w: any[] = [typeNode];
        while (w.length > 0) {
            const m = w.pop()!;
            if (m !== typeNode && (m.type === "where_clause" || m.type === "type_parameters"))
                continue;
            if (m.type === "type_identifier")
                res.push(m);
            for (let i = m.namedChildCount - 1; i >= 0; i--)
                w.push(m.namedChild(i));
        }
        return res;
    };
    const fieldTypeLeaves = (owner: any, src: string, gparams: Set<string>): void => {
        const fw: any[] = [owner];
        while (fw.length > 0) {
            const m = fw.pop()!;
            if (m !== owner && (m.type === "where_clause" || m.type === "type_parameters"))
                continue;
            if (m.type === "field_declaration") {
                for (let i = 0; i < m.namedChildCount; i++) {
                    const c = m.namedChild(i);
                    if (c && c.type !== "field_identifier" && c.type !== "visibility_modifier" && c.type !== "attribute_item") {
                        for (const leaf of collectLeaves(c))
                            push(src, leaf, gparams);
                    }
                }
                continue;
            }
            if (m.type === "ordered_field_declaration_list") {
                for (let i = 0; i < m.namedChildCount; i++) {
                    const c = m.namedChild(i);
                    if (c)
                        for (const leaf of collectLeaves(c))
                            push(src, leaf, gparams);
                }
                continue;
            }
            for (let i = m.namedChildCount - 1; i >= 0; i--)
                fw.push(m.namedChild(i));
        }
    };
    const walk: any[] = [root];
    while (walk.length > 0) {
        const n = walk.pop()!;
        const t = n.type;
        if (t === "macro_definition")
            continue;
        if (t === "function_item") {
            const src = n.childForFieldName?.("name")?.text ?? "global";
            const gparams = genericParamsOf(n);
            const params = n.childForFieldName?.("parameters");
            if (params) {
                for (let i = 0; i < params.namedChildCount; i++) {
                    const p = params.namedChild(i);
                    if (!p || p.type === "self_parameter")
                        continue;
                    const ty = p.type === "parameter" ? p.childForFieldName?.("type") : null;
                    for (const leaf of collectLeaves(ty))
                        push(src, leaf, gparams);
                }
            }
            const ret = n.childForFieldName?.("return_type");
            for (const leaf of collectLeaves(ret))
                push(src, leaf, gparams);
        }
        else if (t === "struct_item" || t === "union_item" || t === "enum_item") {
            const src = n.childForFieldName?.("name")?.text ?? "global";
            const gparams = genericParamsOf(n);
            fieldTypeLeaves(n, src, gparams);
        }
        else if (t === "type_item" || t === "associated_type") {
            const src = n.childForFieldName?.("name")?.text ?? "global";
            const gparams = genericParamsOf(n);
            const nameNode = n.childForFieldName?.("name") ?? n.namedChild(0);
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
                const c = n.namedChild(i);
                if (!c || c.type === "type_parameters" || c.type === "where_clause")
                    continue;
                if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex)
                    continue;
                for (const leaf of collectLeaves(c))
                    push(src, leaf, gparams);
                break;
            }
        }
        else if (t === "const_item" || t === "static_item") {
            const nm = n.childForFieldName?.("name")?.text;
            if (nm && nm !== "_") {
                const ty = n.childForFieldName?.("type");
                const gparams = genericParamsOf(n);
                for (const leaf of collectLeaves(ty))
                    push(nm, leaf, gparams);
            }
        }
        else if (t === "where_clause") {
            // R8/R15: the bounded side emits its TYPE LEAVES (never raw text), and a
            // predicate whose left side names a locally-bound generic parameter — of
            // ANY enclosing item — is not a dependency. A lifetime outlives bound
            // (`where 'a: 's`) yields no type leaf at all, which is exactly right: a
            // lifetime is not a symbol.
            const gparams = chainGenericParams(n);
            const src = n.parent?.childForFieldName?.("name")?.text ?? "global";
            // The bounded side contributes its type NAME(S): a scoped path yields its
            // `name` leaf (`anyhow::Error` -> Error, `T::Err` -> Err, `<T as X>::Err`
            // -> Err — never the module prefix or the raw text), lifetimes are not
            // types, and a name bound by ANY enclosing generic item is locally bound.
            const boundNames = (b: any): any[] => {
                if (!b)
                    return [];
                if (b.type === "scoped_type_identifier" || b.type === "scoped_identifier" || b.type === "qualified_type") {
                    const nm = b.childForFieldName?.("name");
                    if (nm)
                        return [nm];
                    const last = b.namedChild(b.namedChildCount - 1);
                    return last && (last.type === "type_identifier" || last.type === "identifier") ? [last] : [];
                }
                const res: any[] = [];
                const w: any[] = [b];
                while (w.length > 0) {
                    const m = w.pop()!;
                    if (m.type === "lifetime")
                        continue;
                    if (m.type === "type_identifier")
                        res.push(m);
                    for (let k = m.namedChildCount - 1; k >= 0; k--)
                        w.push(m.namedChild(k));
                }
                return res;
            };
            // Shares `emitted` with the declared-type paths above, so the two
            // together still yield unique (label,target) per file (one label here):
            // a bound that the declared-type pass already published is not emitted
            // twice. The analyzer, by contrast, may push the same target from
            // several owners — the harness collapses its side for exactly that
            // reason, so the two are equivalent under the comparison.
            for (let i = 0; i < n.namedChildCount; i++) {
                const pred = n.namedChild(i);
                if (!pred || pred.type !== "where_predicate")
                    continue;
                for (const leaf of boundNames(pred.namedChild(0))) {
                    if (!leaf.text || gparams.has(leaf.text))
                        continue;
                    if (emitted.has(leaf.text))
                        continue;
                    emitted.add(leaf.text);
                    out.push({ label: "references", from: src, target: leaf.text });
                }
            }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--)
            walk.push(n.namedChild(i));
    }
    return out;
}

/** The name `Self` resolves to: the unwrapped type's LEAF (`Error` for
 *  `std::io::Error`), or `null` when the type has no nominal name. */
function rustImplSelfTypeName(t: any): string | null {
    const n = rustNominalTypeNode(t);
    if (!n)
        return null;
    const text = String(n.text ?? "");
    const lt = text.indexOf("<");
    const base = lt >= 0 ? text.slice(0, lt) : text;
    return base.split("::").filter(Boolean).pop() || null;
}

/** The impl SYMBOL's name: generics stripped, path qualification PRESERVED
 *  (`std::io::Error` stays qualified — the deferred ctor filter reads in-file
 *  symbol names, so flattening a foreign `io::Error` to `Error` would make
 *  `Error::new()` look like a local construction). */
function rustImplSymbolName(t: any): string | null {
    const n = rustNominalTypeNode(t);
    if (!n)
        return null;
    const text = String(n.text ?? "");
    const lt = text.indexOf("<");
    return (lt >= 0 ? text.slice(0, lt) : text) || null;
}

function lastSegment(name: string): string {
    const parts = name.split(/::|\./).filter(Boolean);
    return parts[parts.length - 1] ?? name;
}

// ---------------------------------------------------------------------- R10
// rust #798: the impl-target NAME surface. Both rust oracles below need the
// same two answers the analyzer gives (real-rust-analyzer.ts:
// `nominalTypeNode` / `implTypeSymbolName` / `implSelfTypeName`), so they are
// written once here rather than twice — the drift class this program keeps
// paying for.
//
// WHY THEY ARE TWO ANSWERS. The OLD rule took `typeNode.text` verbatim, so
// `impl Trait for &mut ProcessBuilder` published the source TEXT `&mut
// ProcessBuilder` as a name — on the impl symbol, on the `implements` edge's
// source, and (through `Self`) on every `references` target inside the block.
// The differential is STRUCTURALLY BLIND to it because its truth derives from
// the same rule: both sides spelled the fabrication identically and every
// per-edge gate read green. The M60 target-spelling census convicted it instead
// (6 `references` targets over 2 files).
//
// A reference/pointer/parenthesized wrapper does not change what a type is
// NAMED, so it is transparent; a type with no nominal name at all (a slice
// `[u8]`, a tuple `(T, U)`, a unit, a never type, a fn pointer, `dyn Trait`,
// `<T as Trait>::Assoc`) has no name to publish and each caller takes the
// honest state — the analyzer's declared synthetic `anonymous_impl` for the
// impl SYMBOL, and ABSENCE for `Self` resolution.
function rustNominalTypeNode(t: any): any {
    let cur: any = t;
    for (let guard = 0; cur && guard < 16; guard++) {
        const ty = cur.type;
        if (ty === "reference_type" || ty === "pointer_type" || ty === "parenthesized_type") {
            const inner = cur.childForFieldName?.("type") ?? cur.namedChild(cur.namedChildCount - 1);
            if (!inner)
                return null;
            cur = inner;
            continue;
        }
        break;
    }
    if (!cur)
        return null;
    const ty = cur.type;
    if (ty === "type_identifier" || ty === "primitive_type" || ty === "scoped_type_identifier" || ty === "generic_type")
        return cur;
    return null;
}
