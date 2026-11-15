#!/bin/bash
# Clone the GraphQL corpus. Pinned revisions recorded in repositories.json.
set -u
D=/home/ishaq2321/bb_tests/graphql/repos
clone() { # name url rev
  local n="$1" u="$2" r="${3:-}"
  if [ -d "$D/$n/.git" ]; then echo "$n: present"; return; fi
  rm -rf "$D/$n"
  if git clone --filter=blob:none --no-checkout --depth 1 "$u" "$D/$n" >/dev/null 2>&1; then
    cd "$D/$n" || return
    if [ -n "$r" ]; then git fetch --depth 1 origin "$r" >/dev/null 2>&1; git checkout "$r" >/dev/null 2>&1 || git checkout FETCH_HEAD >/dev/null 2>&1
    else git checkout >/dev/null 2>&1; fi
    echo "$n: $(git rev-parse HEAD 2>/dev/null)"
  else
    echo "$n: CLONE FAILED"
  fi
}
clone graphql-js        https://github.com/graphql/graphql-js
clone apollographql     https://github.com/apollographql/apollographql
clone github-schema    https://github.com/github/graphql-schema
clone neo4j-graphql     https://github.com/neo4j/graphql
clone medusa           https://github.com/medusajs/medusa
clone backstage        https://github.com/redhat-developer/backstage
clone graphiql         https://github.com/graphql/graphiql
clone fagraphql        https://github.com/wpengine/fagraphql
