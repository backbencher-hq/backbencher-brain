# JavaScript corpus — freshly cloned for the completeness campaign

Cloned under `.corpus/<name>` (gitignored). Every number in the verification pages names
the repo and commit here so it can be reproduced with:

```
git clone --depth 1 --single-branch <url> .corpus/<name> && git -C .corpus/<name> reset --hard <commit>
```

| repo | url | commit | JS files |
| --- | --- | --- | --- |
| axios | https://github.com/axios/axios.git | `c0d4c900515a55bd1e258eee16adb25c404d56ed` | 231 |
| bootstrap | https://github.com/twbs/bootstrap | `c1f9b9db4dd14d5353e34462ec589cdf8c7270d3` | 124 |
| chartjs | https://github.com/chartjs/Chart.js.git | `56682e54a082bc7a83d4e3c04f779ef0e0021a4f` | 654 |
| consul | https://github.com/hashicorp/consul.git | `913703ef5dfdb325536820a30fb039a683fa0b21` | 1281 |
| d3 | https://github.com/d3/d3.git | `db118c93a429e82b83f091dbaa18fd0a82c06130` | 14 |
| express | https://github.com/expressjs/express.git | `43fca52d28a422c8be48fd489cbd4f2d6152bab6` | 142 |
| jquery | https://github.com/jquery/jquery.git | `6ff7ce6ff3e66ea3c99713238bf0ade6b103b3c3` | 227 |
| lodash | https://github.com/lodash/lodash.git | `a666ba591064c8011988275790ad7d625279f09c` | 55 |
| moment | https://github.com/moment/moment.git | `c2a703a4d84aa57ee2722ff8fb4a8016279fb3c4` | 776 |
| mongoose | https://github.com/Automattic/mongoose.git | `a8204d30c4db4ba1138bc75a879c79cf5127670d` | 482 |
| nomad | https://github.com/hashicorp/nomad.git | `3a9af341c94ee3b08826f8057195e11ef55cd6d7` | 967 |
| preact | https://github.com/preactjs/preact.git | `34b99c691166a28fffcb8e279c79a1669156552f` | 207 |
| prettier | https://github.com/prettier/prettier.git | `3c329a708d715932b7a71195f6bb20a2feac2db5` | 5312 |
| proxicall | https://github.com/ishaq2321/ProxiCall.git | `3b6ebd409f1b1d235776cd72d3ad0809992ed060` | 878 |
| ramda | https://github.com/ramda/ramda.git | `f4b2e35ff433e18c751326b82acc3c6ab3585e18` | 687 |
| react | https://github.com/facebook/react.git | `6ff257439b3919fc8dcc643b635e09d62fa74d0e` | 3912 |
| socket.io | https://github.com/socketio/socket.io.git | `cbbcb195f8230560d65231e24f9242f0e4f7c710` | 200 |
| svelte | https://github.com/sveltejs/svelte.git | `26786e92985842a6d563c67049a43bc5857bf792` | 3383 |
| three | https://github.com/mrdoob/three.js.git | `fad374c211d3fd8759cebe41f09e40975a6de04b` | 1774 |
| underscore | https://github.com/jashkenas/underscore.git | `5c1e5f686f8500af9c9d15614ed60289d6d35d6b` | 188 |
| vault | https://github.com/hashicorp/vault.git | `c848fd3dc7d44fc1fe8edc7eb4e193db1da1a323` | 1729 |
| vue | https://github.com/vuejs/vue.git | `9e88707940088cb1f4cd7dd210c9168a50dc347c` | 38 |
| webpack | https://github.com/webpack/webpack.git | `df7ef44f1e990f4d579bc74f45444b9b3eb7b392` | 25620 |

Excluded from measurement by the census: `dist/`, `build/`, `node_modules/`, `vendor/`, `umd/`,
`www/`, `coverage/`, `__snapshots__/`, and `*.min.js` / `*.bundle.js` — build output is the
bundler's code, not the project's. Measured before excluding: ramda's `dist/ramda.js` bundle
produced 18 phantom "JSDoc declarations missed" for minified names (`s`, `Symbol`) and moment
reported 41,821 variable declarators, most of them in `dist/` and `.min.js` files.
