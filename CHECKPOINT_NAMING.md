# Cluster version naming

Use one product version per packaged update: **0.506**, then **0.507**, **0.508**, etc.

- Public name and artifact: `Cluster-v0.506.zip`.
- Node/npm/internal semantic compatibility: `0.506.0` (patch zero is mandatory for semver tooling).
- Do not put RC/WIP/Pass/Phase tokens in new filenames.
- Existing historical artifacts retain original filenames and checksums.
- A version is only complete after verification and packaging. Native/Windows runtime certification is tracked separately.
