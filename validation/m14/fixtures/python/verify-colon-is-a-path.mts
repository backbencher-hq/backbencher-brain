import { pathLikeTarget, verifyExternalClaim } from "../script/m14/incoming-rule"
const cases = ["os:path", "foo:bar", "os.path", "collections:OrderedDict", "plain_name", "a/b"]
console.log("target".padEnd(26), "pathLike", " claim")
for (const t of cases) {
  const p = pathLikeTarget(t)
  const c = verifyExternalClaim(new Map(), t)
  console.log(t.padEnd(26), String(p).padEnd(9), c)
}
