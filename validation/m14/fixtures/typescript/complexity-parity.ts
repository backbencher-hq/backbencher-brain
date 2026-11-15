function f(x: number): number {
    if (x > 0) { return 1 } else { return 2 }
    for (let i = 0; i < 3; i++) { }
    return x > 1 && x < 5 ? 3 : 4
}

// F6 coverage (2026-09-02): array/assignment/pair/rest patterns, call_signature,
// catch_clause, conditional_type, construct_signature, do_statement, false,
// for_in_statement, generator_function_declaration, import_alias,
// import_require_clause, namespace_import, nested_identifier,
// nested_type_identifier, optional_type, private_property_identifier, regex,
// shorthand_property_identifier, switch_case, switch_statement, undefined,
// variable_declaration, while_statement — declared handled_verified, now exercised.
import fs = require("fs");
import { readFile as readFsFile } from "fs";
import * as pathNs from "path";

type Cond<T> = T extends string ? "str" : "other";
// F6: optional_type (tuple element with `?` — probe-verified shape).
type Tup = [number, string?];
// F6: nested_type_identifier (qualified type inside generic args).
type NTI = Promise<NodeJS.Timeout | null>;

enum Color2 {
    Red = "red",
}

declare function f6Declared(seed: number): string;

module f6Legacy {
    export const inner = 1;
}

import f6Alias = f6Legacy.inner;

interface f6Props {
    id?: number;
    "on-change"?: (v: string) => void;
    new (init: string): object;
    (raw: string): void;
}

class f6Widget {
    #hidden = 0;

    async drain(raw: string): Promise<void> {
        const { id, ...restProps } = { id: 1, a: 2, b: 3 };
        const [arrDefault = 2] = restProps ? [id] : [];
        const objWithDefault = { id = 9 } = restProps as any;
        const pairRenamed = { id: renamed } = restProps as any;
        let [first, second] = [raw, id];
        [first, second] = [second, first];
        let acc = 0;
        do {
            acc += 1;
        } while (acc < 2);
        for (const key in restProps) {
            acc += key.length;
        }
        while (acc < 5) {
            acc += 1;
        }
        switch (acc) {
            case 1:
                break;
            default:
                break;
        }
        const isTrue = true, isFalse = false, nada = undefined;
        const re = /f6-[a-z]+/g;
        const nested = { deep: { deeper: { id: 7 } } };
        acc += nested.deep?.deeper.id ?? 0;
        try {
            throw new Error("x");
        } catch (err) {
            acc += 1;
        }
        acc += isTrue ? 1 : 0;
        this.#hidden = acc;
        void isFalse;
        void nada;
        void re;
        void readFsFile;
        void pathNs;
        void fs;
    }

    *gen(): Generator<number> {
        yield 1;
    }
}

function* f6TopGen(): Generator<number> {
    yield 2;
}

const f6FnExpr = function (w: number) {
    return w;
};

var f6VarDecl = 3;

namespace A.B.Nested {
    export const deep = 1;
}

const shorthand = { f6VarDecl };
void f6FnExpr;
void f6TopGen;
void f6Alias;
void shorthand;
