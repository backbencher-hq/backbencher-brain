#!/bin/bash
# Cheap .graphql census over many candidate repos: fetch the tree only
# (--filter=blob:none --no-checkout), then count tracked .graphql/.graphqls/.gql
# paths from the object database. No blobs are downloaded.
set -u
OUT="$(cd "$(dirname "$0")/../.." && pwd)/script/m14/tmp/graphql/out/repo-census.tsv
: > "$OUT"
CAND="
https://github.com/github/graphql-schema
https://github.com/graphql/graphiql
https://github.com/neo4j/graphql
https://github.com/apollographql/apollo-server
https://github.com/hasura/graphql-engine
https://github.com/graphql-hive/hive
https://github.com/wundergraph/cosmo
https://github.com/graphql-hive/graphql-config
https://github.com/dotansimha/graphql-code-generator
https://github.com/99designs/gqlgen
https://github.com/graphql-java/graphql-java
https://github.com/rmosolgo/graphql-ruby
https://github.com/graphql/graphql-js
https://github.com/Shopify/graphql-client
https://github.com/directus/directus
https://github.com/strapi/strapi
https://github.com/medusajs/medusa
https://github.com/redhat-developer/backstage
https://github.com/apollo-server/apollo-server
https://github.com/type-graphql/type-graphql
https://github.com/MichalLytek/type-graphql
https://github.com/enisdenjo/graphql-modules
https://github.com/ardatan/graphql-tools
https://github.com/ardatan/graphql-mesh
https://github.com/graphql-hive/graphql-yoga
https://github.com/graphql-hive/lint
https://github.com/bkeepers/graphql
https://github.com/o8design/graphql
https://github.com/GraphQL-Java/graphql-java
https://github.com/kortexnet/graphql
https://github.com/vasilypesotsky/graphql
"
for u in $CAND; do
  name=$(basename "$u")
  tmp=$(mktemp -d)
  if git clone --filter=blob:none --no-checkout --depth 1 "$u" "$tmp/r" >/dev/null 2>&1; then
    rev=$(git -C "$tmp/r" rev-parse HEAD)
    n=$(git -C "$tmp/r" ls-tree -r HEAD --name-only 2>/dev/null | grep -cE '\.(graphql|graphqls|gql)$' || true)
    sz=$(git -C "$tmp/r" ls-tree -r HEAD --long 2>/dev/null | grep -E '\.(graphql|graphqls|gql)$' | awk '{s+=$4} END{print s+0}')
    printf "%-45s %-42s %6s files %10s bytes\n" "$u" "$rev" "$n" "$sz" | tee -a "$OUT"
  else
    printf "%-45s %-42s %6s\n" "$u" "UNREACHABLE" "-" | tee -a "$OUT"
  fi
  rm -rf "$tmp"
done
echo "=== done ==="
