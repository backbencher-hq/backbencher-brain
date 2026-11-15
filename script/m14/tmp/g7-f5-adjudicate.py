import json, subprocess

cur = json.load(open('validation/m14/results/M14.0.F5.json'))
base = json.loads(subprocess.check_output(['git', 'show', '0c49a67b:validation/m14/results/M14.0.F5.json']))

print('data keys:', list(cur['data']))

curRep = dict(cur['data']['report']); curRep.update(cur['data']['secondCorpus']['report'])
baseRep = dict(base['data']['report']); baseRep.update(base['data']['secondCorpus']['report'])
bc = cur['data']['baselineComparison']
unpinned = set(bc['unpinnedLanes'])

flagged = [c['id'].replace('differential-', '') for c in cur['checks'] if c.get('status') != 'pass']
repo_of = {c['id'].replace('differential-', ''): str(c.get('description', '')).split(': tree-truth')[0]
           for c in cur['checks']}
print('pinnedLanes', bc['pinnedLanes'], 'unpinned', len(bc['unpinnedLanes']), 'flagged', len(flagged))

def g(r, f):
    return (r or {}).get(f)

rows = []
for l in flagged:
    c = curRep.get(l) or curRep.get(l.split(':')[-1])
    b = baseRep.get(l) or baseRep.get(l.split(':')[-1])
    parity = (g(b, 'missingInAnalyzer'), g(c, 'missingInAnalyzer'),
              g(b, 'unexplainedInAnalyzer'), g(c, 'unexplainedInAnalyzer'),
              g(b, 'heuristicUnexplained'), g(c, 'heuristicUnexplained'))
    grown = (g(c, 'missingInAnalyzer') or 0) > (g(b, 'missingInAnalyzer') or 0) \
        or (g(c, 'unexplainedInAnalyzer') or 0) > (g(b, 'unexplainedInAnalyzer') or 0)
    full = repo_of.get(l, l)
    lane_key = l if l in unpinned else f"{full}:{l}"
    rows.append((l, parity, grown, full, lane_key in unpinned))

print(f"{'lane':22} {'repo:lang':28} {'miss b->c':10} {'unexp b->c':10} {'heur b->c':12} {'growth':7} unpinned")
for l, p, grown, full, unp in rows:
    print(f"{l:22} {full:28} {str(p[0])+'->'+str(p[1]):10} {str(p[2])+'->'+str(p[3]):10} {str(p[4])+'->'+str(p[5]):12} {str(grown):7} {unp}")
print()
print('all flagged lanes are unpinned:', all(r[4] for r in rows))
