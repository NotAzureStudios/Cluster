# Cluster Desktop private source-control runtime

Release packages stage the pinned Git and Git LFS runtimes here before the Qt Desktop package step. Runtime binaries are intentionally not committed to the reconstructed source archive.

Expected Windows x64 layout:

```text
bin/runtime/
  git/
    cmd/git.exe
    ...Git for Windows private runtime...
  git-lfs/
    git-lfs.exe
```

The Workstation service prefers this private runtime and reports `gitRuntime: "bundled"`. System Git remains a development/recovery fallback only.

Pinned versions are authoritative in `config/toolchain-versions.json`. The release packaging path must run `npm run desktop:runtime:verify` before installing the runtime into the Desktop package.
