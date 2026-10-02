import packageJson from "../package.json"

export const BACKBENCHER_BRAIN_VERSION = packageJson.version
/**
 * The published package name, read from package.json rather than written out
 * here. `bb upgrade` compares against this registry entry, so a hardcoded copy
 * would silently compare against the wrong package the day the name changed —
 * and would still print a confident version.
 */
export const PKG_NAME: string = packageJson.name
