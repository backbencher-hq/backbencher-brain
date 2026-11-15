import { readFileSync } from "fs";
import { helper } from "./util";
import * as path from "path";
import lodash from "lodash";
import { thing } from "@scope/pkg/sub";
import process from "process";
import { sep } from "node:path";

export const x = 1;
export const y = [helper, readFileSync, path, lodash, thing, process, sep];
