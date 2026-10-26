#!/usr/bin/env python3
"""Executable fixtures for the conservative Cluster source merge tool."""
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile

MODULE = Path(__file__).with_name('cluster-source-three-way-merge.py')
spec = importlib.util.spec_from_file_location('cluster_three_way', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def package(path, files, prefix='source/'):
    with zipfile.ZipFile(path, 'w') as zipf:
        for name, data in files.items():
            zipf.writestr(prefix + name, data)


def call(paths, dest):
    class Args:pass
    args = Args()
    args.ancestor, args.authoritative, args.candidate = paths
    args.out = dest
    args.fixture = True
    return mod.run(args), json.loads((dest / 'MERGE_REPORT.json').read_text())

with tempfile.TemporaryDirectory() as work:
    p=Path(work)
    base={'package.json': b'{}\n', 'a.ts': b'one\ntwo\nthree\n', 'obsolete.ts':b'delete me\n', 'native.bin':b'\0old'}
    authoritative={**base,'a.ts': b'one changed by pass15\ntwo\nthree\n','native.bin':b'\0old', 'pass15.ts':b'pass15 only\n'}
    candidate={**base,'a.ts':b'one\ntwo\nthree changed by candidate\n','current.ts':b'candidate only\n'}
    paths=[p/f'{n}.zip' for n in ('ancestor','authoritative','candidate')]
    for z,f in zip(paths,(base,authoritative,candidate)):
        package(z,f)
    code, r=call(paths,p/'merged')
    assert code == 0, r
    assert r['status'].startswith('merged_'), r
    with zipfile.ZipFile(p/'merged'/'Cluster-source-merged-UNVERIFIED.zip') as z:
        assert z.read('source/a.ts')==b'one changed by pass15\ntwo\nthree changed by candidate\n'
        assert z.read('source/pass15.ts')==b'pass15 only\n'
        assert z.read('source/current.ts')==b'candidate only\n'
        assert z.read('source/native.bin')==b'\0old'
    print('PASS: nonoverlapping modifications, binary preservation, additions')

    conflicting={**candidate,'a.ts':b'one competing edit\ntwo\nthree\n'}
    package(paths[2], conflicting)
    code,r=call(paths,p/'conflicted')
    assert code == 3 and r['status']=='manual_conflicts' and r['conflicts']==['a.ts'],r
    assert not (p/'conflicted'/'Cluster-source-merged-UNVERIFIED.zip').exists()
    assert (p/'conflicted'/'conflicts'/'a.ts.pass15').exists()
    print('PASS: same-line conflicts stop publication and preserve both variants')

    multi_base={**base,'a.ts':b'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n'}
    multi_authoritative={**multi_base,'a.ts':b'pass15\ntwo\nthree\nfour\nfive\nsix\npass15 last\neight\n'}
    multi_candidate={**multi_base,'a.ts':b'candidate\ntwo\nthree\nfour\nfive\nsix\ncandidate last\neight\n'}
    for z,f in zip(paths,(multi_base,multi_authoritative,multi_candidate)): package(z,f)
    code,r=call(paths,p/'multi-overlap')
    assert code==3 and r['status']=='manual_conflicts' and 'a.ts' in r['conflicts'],r
    print('PASS: git merge-file multi-hunk conflict count still reports explicit overlap')
    for z,f in zip(paths,(base,authoritative,candidate)): package(z,f)

    deleted={**base}
    deleted.pop('a.ts')
    package(paths[2],deleted)
    code,r=call(paths,p/'deleted')
    assert code == 3 and 'a.ts' in r['conflicts'],r
    print('PASS: authoritative modification cannot be deleted silently')

    package(paths[2],candidate)
    args=[paths[0],p/'missing.zip',paths[2]]
    code,r=call(args,p/'missing')
    assert code == 2 and r['status']=='blocked' and 'error' in r,r
    print('PASS: missing authoritative baseline fails closed')

    with zipfile.ZipFile(p/'unsafe.zip','w') as z:
        z.writestr('source/package.json','{}')
        z.writestr('source/../outside.ts','evil')
    try:
        mod.read_tree(p/'unsafe.zip')
        raise AssertionError('unsafe archive path was accepted')
    except ValueError:
        print('PASS: unsafe ZIP paths rejected')

print('6/6 source-merge fixtures passed')
