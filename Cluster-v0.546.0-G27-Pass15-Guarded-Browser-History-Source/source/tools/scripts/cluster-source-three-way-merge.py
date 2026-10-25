#!/usr/bin/env python3
"""Conservative, reproducible Cluster source reconciliation.

Usage:
  python tools/scripts/cluster-source-three-way-merge.py \
      --ancestor Pass13.zip --authoritative Pass15.zip \
      --candidate Cluster-v0.512.2.zip --out merge-output

This tool never overwrites its inputs, never silently resolves a two-sided
binary/delete conflict, and does not certify a merged source for production.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile

PASS15_SHA256 = 'c758d4edfa38e8bde538b89c1c200a7cf7fbd2fbe08295bc43d5d1e1b0616c1f'
MAX_FILES = 15000
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
REVIEW_PATHS = (
    'packages/renderer/src/features/admin/',
    'packages/renderer/src/features/projects/',
    'packages/renderer/src/features/library/',
    'packages/shared/src/',
    'apps/server/prisma/',
)

def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def archive_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def read_tree(path: Path) -> dict[str, bytes]:
    if not path.is_file():
        raise ValueError(f'Input archive missing: {path}')
    with zipfile.ZipFile(path) as zipf:
        files = [i for i in zipf.infolist() if not i.is_dir()]
        if len(files) > MAX_FILES or sum(i.file_size for i in files) > MAX_TOTAL_BYTES:
            raise ValueError(f'Input archive exceeds safety limits: {path}')
        names = [i.filename.replace('\\', '/') for i in files]
        if 'source/package.json' in names:
            root = 'source/'
        elif 'package.json' in names:
            root = ''
        else:
            matches = [n[:-len('package.json')] for n in names if n.endswith('/package.json') and n.count('/') == 1]
            if len(matches) != 1:
                raise ValueError(f'Cannot identify unambiguous source root: {path}')
            root = matches[0]
        out: dict[str, bytes] = {}
        for info, name in zip(files, names):
            if not name.startswith(root):
                continue
            relative = name[len(root):]
            p = PurePosixPath(relative)
            if not relative or p.is_absolute() or '..' in p.parts or any(x in ('', '.') for x in p.parts):
                raise ValueError(f'Unsafe path in archive {path}: {name}')
            # Do not allow symlink entries into a Windows release tree.
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f'Symlink in source archive: {name}')
            normalized = p.as_posix()
            if normalized in out:
                raise ValueError(f'Duplicate source member: {normalized}')
            out[normalized] = zipf.read(info)
        if 'package.json' not in out:
            raise ValueError(f'Missing source package.json: {path}')
        return out

def is_text(value: bytes) -> bool:
    if b'\x00' in value:
        return False
    try:
        value.decode('utf-8')
        return True
    except UnicodeDecodeError:
        return False

def merge_text(candidate: bytes, ancestor: bytes, authoritative: bytes) -> tuple[bytes | None, str]:
    with tempfile.TemporaryDirectory(prefix='cluster-merge-file-') as d:
        directory = Path(d)
        for key, data in [('candidate', candidate), ('ancestor', ancestor), ('authoritative', authoritative)]:
            (directory / key).write_bytes(data)
        res = subprocess.run([
            'git', 'merge-file', '--diff3', '--stdout',
            '-L', 'CANDIDATE_0.512', '-L', 'COMMON_PASS13', '-L', 'AUTHORITATIVE_PASS15',
            str(directory / 'candidate'), str(directory / 'ancestor'), str(directory / 'authoritative'),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if res.returncode == 0:
            return res.stdout, 'merged'
        if res.returncode > 0 and b'<<<<<<< ' in res.stdout and b'>>>>>>> ' in res.stdout:
            # git merge-file reports the number of conflicts, which can exceed one.
            return None, 'overlap_conflict'
        raise RuntimeError(f'git merge-file failed: {res.stderr.decode(errors="replace")}')

def reconcile(base: dict[str, bytes], authoritative: dict[str, bytes], candidate: dict[str, bytes]):
    result: dict[str, bytes] = {}
    decisions: list[dict[str, str]] = []
    conflicts: list[str] = []
    review: list[str] = []
    for p in sorted(set(base) | set(authoritative) | set(candidate)):
        a, b, c = base.get(p), authoritative.get(p), candidate.get(p)
        if c == a:
            chosen, state = b, 'authoritative_only' if b != a else 'unchanged'
        elif b == a:
            chosen, state = c, 'candidate_only'
        elif b == c:
            chosen, state = c, 'both_identical'
        elif a is None or b is None or c is None:
            chosen, state = None, 'add_delete_conflict'
        elif not all(is_text(v) for v in (a, b, c)):
            chosen, state = None, 'binary_conflict'
        else:
            chosen, state = merge_text(c, a, b)
        decisions.append({'path': p, 'decision': state})
        if state.endswith('_conflict'):
            conflicts.append(p)
            continue
        if chosen is not None:
            result[p] = chosen
        if (b != a and c != a) and p.startswith(REVIEW_PATHS):
            review.append(p)
    return result, decisions, conflicts, review

def write_zip(path: Path, tree: dict[str, bytes]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=8) as zipf:
        for p in sorted(tree):
            zipf.writestr('source/' + p, tree[p])
    with zipfile.ZipFile(path) as zipf:
        if zipf.testzip() is not None:
            raise RuntimeError('Output ZIP integrity test failed')

def run(args):
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'status': 'blocked', 'certified': False, 'inputs': {}, 'conflicts': [], 'review_required': []}
    try:
        for key in ('ancestor','authoritative','candidate'):
            p = Path(getattr(args, key))
            report['inputs'][key] = {'path': p.name, 'present': p.is_file(), 'sha256': archive_hash(p) if p.is_file() else None}
        if not all(x['present'] for x in report['inputs'].values()):
            raise ValueError('All three real archives are required; no synthetic P15 source is permitted.')
        if not args.fixture and report['inputs']['authoritative']['sha256'] != PASS15_SHA256:
            raise ValueError('Pass15 SHA-256 mismatch. Refusing to merge an untrusted baseline.')
        ancestor, authoritative, candidate = (read_tree(Path(getattr(args, key))) for key in ('ancestor','authoritative','candidate'))
        merged, decisions, conflicts, review = reconcile(ancestor, authoritative, candidate)
        report['file_decisions'] = decisions
        report['counts'] = {state: sum(d['decision']==state for d in decisions) for state in sorted({d['decision'] for d in decisions})}
        report['conflicts'] = conflicts
        report['review_required'] = review
        if conflicts:
            report['status'] = 'manual_conflicts'
            # No partial merged ZIP is produced. Conflicts must be resolved explicitly.
            for name in conflicts:
                artifact = out / 'conflicts' / name
                artifact.parent.mkdir(parents=True, exist_ok=True)
                for label, tree in [('pass13',ancestor),('pass15',authoritative),('candidate',candidate)]:
                    if name in tree:
                        artifact.with_name(artifact.name + '.' + label).write_bytes(tree[name])
        else:
            report['status'] = 'merged_review_required' if review else 'merged_unverified'
            report['merged_file_count'] = len(merged)
            write_zip(out / 'Cluster-source-merged-UNVERIFIED.zip', merged)
        return 3 if conflicts else 0
    except (ValueError, RuntimeError, OSError, zipfile.BadZipFile) as exc:
        report['error'] = str(exc)
        return 2
    finally:
        (out / 'MERGE_REPORT.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ancestor', required=True, help='Common Pass13 source ZIP')
    parser.add_argument('--authoritative', required=True, help='Pass15 authoritative source ZIP')
    parser.add_argument('--candidate', required=True, help='Latest development source ZIP')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--fixture', action='store_true', help='ONLY for synthetic tests; bypass pinned Pass15 hash')
    args = parser.parse_args()
    code = run(args)
    print((args.out / 'MERGE_REPORT.json').read_text()[:7000])
    sys.exit(code)

if __name__ == '__main__':
    main()
