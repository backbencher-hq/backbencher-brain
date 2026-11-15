// EXTERNAL IMPORT CLAIMS — the module-namespace claim is about the MODULE, not a declaration.
//
// An `imports` row spells `<module>:<item>`. When the MODULE is not a project-relative path the
// claim is that the module names something outside the project; the arbiter verifies the module
// ROOT against the project's own file/directory names and fails closed when the root is
// project-owned. A RELATIVE specifier is never claimed: it names a FILE in this project, and a
// file claim that misses is refuted against the lane, so those rows stay unclaimed.

import fs from "fs";
import { readFileSync } from "node:fs";
import * as path from "path";
import qunit from "qunit";
import { scoped } from "@scope/pkg";
import { local } from "./local.js";
