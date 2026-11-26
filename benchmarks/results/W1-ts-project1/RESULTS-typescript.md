# Level 2 — language `typescript`

> All project sets reported. This level is publishable as a language result.

## Conditions

| condition    | value                                        |
| ------------ | -------------------------------------------- |
| model        | `freepi/deepseek-v4.1-flash` (temperature 0) |
| harness      | dsh-headless                                 |
| bb           | `0.2.2`                                      |
| **embedder** | `local-word-vectors-v3:50`                   |
| machine      | 8 cores · 15 GB · linux                      |
| date         | 2026-11-26                                   |
| runs         | 17 valid, 13 invalid/excluded                |

## Pooled centered success

<svg xmlns="http://www.w3.org/2000/svg" width="494" height="294" role="img" aria-label="Centered success (pooled across project sets)">
<title>Centered success (pooled across project sets)</title>
<text x="8" y="24" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="#111">Centered success (pooled across project sets)</text>
<text x="8" y="42" font-family="ui-monospace,monospace" font-size="10" fill="#666">unit: centered score (-1..+1) · axis at zero</text>
<line x1="64" y1="52" x2="64" y2="272" stroke="#888" stroke-width="1"/>
<g><text x="8" y="78" font-family="ui-monospace,monospace" font-size="12" fill="#222">arm A</text>
<rect x="64" y="58" width="1" height="30" fill="#8a8a8a" rx="2"/>
<text x="372" y="78" font-family="ui-monospace,monospace" font-size="11" fill="#222">0 (n=4)</text></g>
<g><text x="8" y="120" font-family="ui-monospace,monospace" font-size="12" fill="#222">arm B</text>
<rect x="64" y="100" width="120" height="30" fill="#c08a3e" rx="2"/>
<text x="372" y="120" font-family="ui-monospace,monospace" font-size="11" fill="#222">+0.400 (n=5)</text></g>
<g><text x="8" y="162" font-family="ui-monospace,monospace" font-size="12" fill="#222">arm C</text>
<rect x="64" y="142" width="200" height="30" fill="#1f6feb" rx="2"/>
<text x="372" y="162" font-family="ui-monospace,monospace" font-size="11" fill="#222">+0.667 (n=3)</text></g>
<g><text x="8" y="204" font-family="ui-monospace,monospace" font-size="12" fill="#222">arm D</text>
<rect x="64" y="184" width="100" height="30" fill="#2da44e" rx="2"/>
<text x="372" y="204" font-family="ui-monospace,monospace" font-size="11" fill="#222">+0.333 (n=3)</text></g>
<g><text x="8" y="246" font-family="ui-monospace,monospace" font-size="12" fill="#222">arm E</text>
<rect x="64" y="226" width="150" height="30" fill="#a371f7" rx="2"/>
<text x="372" y="246" font-family="ui-monospace,monospace" font-size="11" fill="#222">+0.500 (n=2)</text></g>
<text x="64" y="286" font-family="ui-monospace,monospace" font-size="9" fill="#888" text-anchor="middle">0</text>
</svg>

Sign test over paired tasks: wins=0 losses=0 ties=1 — not enough pairs to test

## Contributing project sets

| project     | valid runs | arms present  |
| ----------- | ---------- | ------------- |
| ts-project1 | 17         | A, B, C, D, E |

> No cross-language average appears here on purpose: a mean over a project mix would be
> an artefact of our selection, not a property of bb.
