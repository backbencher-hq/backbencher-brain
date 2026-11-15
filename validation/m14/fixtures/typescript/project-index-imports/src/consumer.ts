// THE CONSUMER — one import of each class the index pass must decide, in one file.
//
//   @fixture/utils : WidgetOptions  declared ONCE  -> RESOLVE (re-spell bare)
//   @fixture/utils : makeWidget     declared ONCE  -> RESOLVE (name-only channel: a free function)
//   @fixture/utils : Twice          declared TWICE -> REFUSE (projectIndexAmbiguous, target unchanged)
//   @fixture/utils : missingThing   not declared   -> NO CLAIM, left unresolved (index cannot prove
//                                                     externality for a name inside the project's module)
//   vue            : vueOnly        external pkg   -> CLAIM (module-namespace, cited)
//   node:path      : join           node builtin   -> CLAIM (module-namespace, cited)
//   ./local        : localThing     relative       -> already bare, untouched
import { WidgetOptions, makeWidget, Twice, missingThing } from "@fixture/utils";
import { vueOnly } from "vue";
import { join } from "node:path";
import { localThing } from "./local";

export function use(options: WidgetOptions): number {
  return makeWidget() + options.size + localThing + Twice.length + missingThing + join("a", "b") + vueOnly;
}
