import { List } from "./data";
import { Logger } from "@pkg/core";
import type { Config } from "./types";

export class Importer {
  items: List<Config> = [];
  log(): void {
    Logger.info("boot");
  }
}
