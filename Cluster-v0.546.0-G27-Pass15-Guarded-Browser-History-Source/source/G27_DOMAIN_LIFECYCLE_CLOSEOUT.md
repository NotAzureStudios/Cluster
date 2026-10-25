# G27 Domain Lifecycle / Local Server Identity | Implementation notes

This pass materially closes the original `register domain → verify control → attach domain to a Cluster server` workflow for **the currently running installation**, with deliberate manual DNS/TLS provisioning.

### Decisions
1. The server ID comes from Cluster setup's authoritative `serverInstanceId`, never a user-entered field.
2. DNS desired state is stored per hostname as exactly one A/AAAA/CNAME record and compared on demand. A DNS match proves only an observed record, not TLS, reachability, or identity of a remote server.
3. DNS ownership is checked immediately before binding; proof rotation clears all previous binding and DNS metadata atomically.
4. An administrator can record registrar and expiry with the explicit qualifier `operator-reported`; no false renewal status is inferred from an empty field.
5. Registry searches use bounded, cursor-like domain-name pages, plus direct record reads; only administrators can enumerate them.
6. No change is allowed to defeat audit persistence. Existing revision compare-and-swap is retained on writes.

### Manual example
- Register `azurestudios.dev`.
- Publish `_cluster-verify.azurestudios.dev` TXT with the generated challenge.
- Verify control.
- Enter hostname `cluster.azurestudios.dev`, choose DNS record type, and provide the record target.
- Bind it to **this installed Cluster server ID**.
- Publish the corresponding DNS record outside Cluster; configure TLS and reverse proxy/VPN independently.
- Run the on-demand DNS check. `matching` never means `secure` or `publicly reachable`.

### Not included
Automatic Cloudflare/registrar manipulation, domain purchasing or transfer, ACME certificates, external server claiming, and remote process health probes. No internet-facing listener was opened by this change.
