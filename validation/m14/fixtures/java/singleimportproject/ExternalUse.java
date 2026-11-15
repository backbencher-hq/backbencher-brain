package singleimportproject;

import com.vendor.ext.Tool;
import com.vendor.ext.Unique;
import singleimportproject.Own;

/**
 * THE EXTERNAL SINGLE-TYPE-IMPORT BINDING CLAIM — THE INDEXED HALF (java lane, 2026-10-20).
 *
 * POSITIVE: `import com.vendor.ext.Tool;` binds the simple name `Tool`, and the PROJECT declares
 * `Tool` in TWO places (ToolOwners.Tool and ToolOwners.Other.Tool) — so the name-keyed resolver
 * TIES on the name, and the tie is a WALL. The imported type is outside the project (the index
 * does not declare `com.vendor.ext.Tool`), and inside this file the import decides which `Tool` the
 * name means (JLS 6.4.1). The claim says exactly that, and the arbiter verifies it against the
 * run's OWN import evidence: the import edge publishes `metadata.importedBindings: ["Tool"]` and
 * `metadata.module: "com.vendor.ext.Tool"`, and the type-position edge whose target is `Tool`
 * publishes `metadata.importedBinding: {specifier: "com.vendor.ext.Tool", binding: "Tool"}`.
 *
 * NEGATIVE 1 — DO NOT DISPLACE A RESOLUTION: `import com.vendor.ext.Unique;` binds `Unique`, and
 * the project declares `Unique` ONCE, so the name model RESOLVES that row. A claim there would
 * trade a resolution for a claim and add no verified class: there must be neither evidence nor
 * claim.
 *
 * NEGATIVE 2 — A PROJECT IMPORT: `import singleimportproject.Own;` names the PROJECT's own type
 * (declared twice, so the tie holds), so the claim is refused on externality: it must resolve
 * through the owner/name model.
 *
 * NEGATIVE 3 — NOT A TYPE POSITION: `Tool.make()` is a CALL whose target is a member leaf, not
 * the bound name, so no claim may attach to it.
 */
public class ExternalUse {
  Tool tool;
  Unique unique;
  Own own;

  void make() {
    Tool.make();
  }
}
