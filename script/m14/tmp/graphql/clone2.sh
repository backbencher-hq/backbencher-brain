#!/bin/bash
set -u
D=/home/ishaq2321/bb_tests/graphql/repos
clone() {
  local n="$1" u="$2"
  if [ -d "$D/$n/.git" ]; then echo "$n: present"; return; fi
  rm -rf "$D/$n"
  if git clone --depth 1 "$u" "$D/$n" >/dev/null 2>&1; then
    echo "$n: $(git -C $D/$n rev-parse HEAD)"
  else
    echo "$n: CLONE FAILED"
  fi
}
clone backstage    https://github.com/redhat-developer/backstage
clone graphiql     https://github.com/graphql/graphiql
clone directus     https://github.com/directus/directus
clone strapi       https://github.com/strapi/strapi
clone hasura       https://github.com/hasura/graphql-engine
clone apollo-server https://github.com/apollographql/apollo-server
clone saleor       https://github.com/saleor/saleor
clone wpgraphql    https://github.com/axe312ger/wp-graphql
clone lil-gui       https://github.com/lil-gui/lil-gui
clone graphql-md    https://github.com/graphql/graphql-js
clone netlify      https://github.com/netlify/netlify
clone payload      https://github.com/payloadcms/payload
