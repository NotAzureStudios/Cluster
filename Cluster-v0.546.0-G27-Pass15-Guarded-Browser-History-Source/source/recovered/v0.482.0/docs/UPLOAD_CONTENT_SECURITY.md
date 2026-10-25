# Upload and untrusted-content security

Cluster treats every user-supplied file as untrusted bytes, including files uploaded by administrators. A filename, extension, browser MIME declaration, desktop-transfer metadata, or database MIME value is never sufficient evidence that content is safe to render or execute.

## Server-derived file identity

Base64 upload payloads are decoded with canonical validation and a decoded-byte ceiling before storage. Cluster derives a stored MIME type from file signatures and conservative text inspection. The client-declared MIME type is a hint only and is accepted for a limited set of passive formats where the filename extension and requested type agree. ZIP-based Office/OpenDocument containers retain their declared document MIME only when the extension and requested container type agree.

Profile icons, studio branding, and model thumbnails are stricter: the declared image MIME must match a recognized raster-image signature. Executable and script-like extensions plus PE, ELF, Mach-O, and shell-script signatures remain blocked unless the explicit server executable-upload policy is enabled.

Storage filenames are normalized, bounded, stripped of traversal prefixes/control characters, and protected against Windows device basenames. Final destinations are resolved under the Cluster data root before a write can occur.

## Same-origin content containment

Files stored by Cluster share an authenticated application origin, so active content is never treated like an ordinary inline preview. HTML, XHTML, SVG, XML, JavaScript, CSS, MHTML, HTA, and similar active formats are attachment-only. Responses for untrusted files use `X-Content-Type-Options: nosniff`; active formats also receive a restrictive sandbox Content Security Policy.

Only a small passive set can be served inline: verified raster images, PDF, plain text, JSON, audio, and video. A legacy or user-supplied filename that indicates active content forces attachment disposition even when its stored MIME claims otherwise. Project files are always download attachments. Generated GLB previews are server-produced conversion output rather than raw uploaded content.

## Desktop transfer staging

Native desktop transfers use resumable binary chunks rather than giant JSON/base64 requests. The server enforces:

- a 20 GiB ceiling per transfer;
- at most eight retained upload sessions per user;
- a 40 GiB per-user staging reservation ceiling;
- a 512 MiB filesystem free-space reserve;
- exact sequential `Content-Range` offsets and exact staged-file length;
- SHA-256 verification at completion and again before project attachment;
- server-derived MIME/executable policy when the staged file becomes a project file;
- atomic temporary-copy/rename into project storage; and
- deletion of the staging session after a successful project-file attachment.

Staging sessions expire after seven days. The reservation checks are a server availability control, not a storage entitlement; administrators should still monitor the filesystem and set external volume quotas appropriate to the deployment.

## Model-preview conversion

Blender conversion is optional and handles hostile parser input. The built-in converter serializes conversion work, sanitizes companion paths, and applies hard runtime ceilings of 512 MiB each to source input, companion input, and generated GLB output. Temporary output is removed on failed writes.

The converter is still an in-process third-party parser. These limits reduce resource-exhaustion risk but are not equivalent to an OS process sandbox. Deployments that accept arbitrary files from untrusted external users should disable Blender previews or isolate the Cluster server at the operating-system/container boundary.

## Malware scanning

Cluster does not claim to provide antivirus or content-disarm scanning. Signature/MIME checks, executable policy, safe disposition, and storage containment prevent common application-layer attacks; they do not prove that a downloaded document or archive is benign. Organizations that require malware scanning should place an approved scanner or storage-security workflow around accepted artifacts rather than treating Cluster's type checks as antivirus.

## Regression requirements

A release must fail its source/release contract if it removes canonical base64 limits, server-derived MIME handling, active-content attachment containment, `nosniff`, desktop-transfer capacity/integrity checks, or model-preview runtime ceilings without an explicit replacement control.
