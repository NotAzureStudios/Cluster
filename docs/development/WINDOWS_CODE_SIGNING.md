# Windows executable signing for Cluster

Cluster Windows Server and Qt Desktop packages are built as ordinary Windows PE executables. **A SHA-256 checksum is not a publisher signature.** To display a verified publisher, sign the PE files with an Authenticode code-signing certificate. The certificate must chain to a root trusted by the receiving Windows machines. Signing does not replace installer startup, authorization or recovery testing.

## Which approach should Azure Studios use?

| Approach | Approximate cost | Trust model | Best fit |
| --- | --- | --- | --- |
| **Private self-signed code-signing certificate** | Free | Studio administrators install the public certificate into appropriate trust stores on every **managed** workstation. Other Windows machines won't automatically trust it. | Cluster kept completely inside the studio |
| **Microsoft Azure Artifact Signing (formerly Trusted Signing)** | Basic: **$9.99/month** including 5,000 signatures | Microsoft validates an individual or organization and manages public-trust code-signing certificates. No private-key file on GitHub. | Studio deployments outside your managed machines, easier repeatable release signing |
| **Traditional publicly trusted OV code-signing certificate** | Commonly **$150–300/year** | Certificate authority verifies the publisher, with a hardware token or HSM-backed key. | If Azure Artifact Signing isn't suitable |

**Recommendation:** For a private self-hosted studio tool, use a managed self-signed certificate only if you control the Windows devices and can centrally maintain their trust. If you want an externally verifiable publisher identity for anyone downloading Cluster, use **Azure Artifact Signing Basic**.

A signed release can **still show a Microsoft Defender SmartScreen warning** until reputation is established. Authenticode verifies publisher identity and integrity, not malware-free behavior or Microsoft approval.

Sources: [Microsoft's code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [Artifact Signing account setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [Artifact Signing pricing tiers](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku), [SignTool and certificates](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).

## Option A: Internal signing, no paid subscription

1. Install the Windows SDK SignTool on a **dedicated trusted signing workstation**, not an untrusted PR runner.
2. Create a Code Signing certificate in the **Current User** personal certificate store. For example, in PowerShell:

   ```powershell
   $cert = New-SelfSignedCertificate `
     -Type CodeSigningCert `
     -Subject 'CN=Azure Studios Cluster Internal' `
     -CertStoreLocation 'Cert:\CurrentUser\My' `
     -HashAlgorithm SHA256 `
     -KeyAlgorithm RSA -KeyLength 3072 `
     -KeyExportPolicy NonExportable
   $cert.Thumbprint
   ```

3. Export **only the public certificate** for studio-managed machines:

   ```powershell
   Export-Certificate -Cert $cert -FilePath '.\Cluster-Internal-Publisher.cer'
   ```

   Distribute it through an authorized administrative process to the machines you manage and explicitly trust it for code signing (Trusted Root Certification Authorities and Trusted Publishers as applicable). Importing any certificate into Trusted Root grants broad trust, so never ask arbitrary users to do this or distribute the private key. Use a managed policy/certificate-management process where available.

4. Run the helper on compiled EXEs on the signing workstation. It signs copies, timestamps them, verifies the resulting trust chain, and prints **new** SHA-256 values:

   ```powershell
   .\tools\windows\Sign-Cluster-Executables.ps1 `
     -Files '.\bin\Cluster-Installer.exe', '.\bin\Cluster Server.exe' `
     -CertificateThumbprint '<your certificate thumbprint>' `
     -OutputDirectory '.\artifacts\signed-executables'
   ```

   For local self-signed signing to pass trust-chain verification, you must also deliberately trust your own public certificate on the signing workstation. Do not disable signature verification merely to pass the command.

This is **private trust**, not a publicly trusted Windows publisher, and it does not automatically eliminate SmartScreen warnings.

## Option B: Publicly trusted Microsoft Azure Artifact Signing

1. In the [Azure portal](https://portal.azure.com/), register `Microsoft.CodeSigning` if needed and create an Artifact Signing **Basic** account.
2. Complete the required **individual or organization identity validation**. Use Azure Studios' verified publisher identity; the display name is derived from the verified identity, not an arbitrary text field.
3. Create a **Public Trust** certificate profile and grant the build/signing identity the **Artifact Signing Certificate Profile Signer** role.
4. Sign on a dedicated Windows signing job using the supported [Artifact Signing SignTool integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations) or its [GitHub Actions integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations). Authenticate through a narrowly scoped Azure identity, preferably GitHub OIDC federation, not a hardcoded password or private key.
5. Verify the completed signature, its publisher, and its timestamp. Retain signed-binary SHA-256 hashes and provenance in the release receipt.

Azure Artifact Signing currently requires identity approval and account configuration before a first signature. It cannot sign existing published files on our behalf merely because a pipeline exists. Microsoft's public-trust certificates are short-lived; **RFC 3161 timestamping is mandatory for durable validity**.

## Release signing order: critical

The prebuilt Server installer contains **embedded native Windows executables**. If you sign only the outer `Cluster-Installer.exe`, the inner `Cluster Server.exe` and helpers remain unsigned.

The correct full-release flow is:

1. Compile the native binaries, Server and Web assets from a reviewed source commit.
2. Sign each native EXE/DLL that should show a publisher, including the Server Manager and Desktop/native helpers.
3. Reassemble the Server runtime package and build the **outer** installer from the signed inner files.
4. Sign the outer Server installer, Desktop installer and any separately distributed executable.
5. Verify Authenticode signatures, issuer, timestamp, SHA-256 hashes, manifest receipts and final installer integrity **after signing**.
6. Attach the newly signed files with their **new hashes** to a **new** release. Never silently replace assets in an existing immutable release.

This order matters because **Authenticode changes the file bytes**. A signed EXE will **not** match the unsigned 1.0.1 SHA-256 value in the historical release notes. Signatures also do not retroactively make previously published files signed.

### SignTool reference

For an already configured certificate in the Windows personal certificate store:

```powershell
signtool sign /sha1 '<THUMBPRINT>' /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 .\Cluster-Installer.exe
signtool verify /pa /v .\Cluster-Installer.exe
```

Microsoft recommends SHA-256 signatures and **RFC 3161 timestamps**. See [timestamping guidance](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures).

**Status:** Signing support and instructions are prepared, but **no signing certificate or Azure profile has been connected to this repository**. Do not label the currently published 1.0.1 executables as signed.
