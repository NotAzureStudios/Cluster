import type { ReactNode } from "react";

/** Shared public/authentication layout. Presentation only: session and MFA
 * authorities continue to live exclusively in existing Server routes. */
export function AuthEntryLayout({
  children,
  studioName,
  mode = "signin",
}: {
  children: ReactNode;
  studioName?: string | null;
  mode?: "signin" | "setup" | "recovery";
}) {
  return <main className="login-shell managed-auth-shell managed-auth-v473 cluster-auth-entry-v11">
    <div className="cluster-auth-entry-grid-v11">
      <aside className="cluster-auth-entry-intro-v11" aria-label="Cluster workspace">
        <div className="cluster-auth-entry-brand-v11">
          <img src="/cluster-logo.png" alt="" aria-hidden="true" />
          <div><strong>Cluster</strong><span>Studio workspace</span></div>
        </div>
        <div className="cluster-auth-entry-intro-copy-v11">
          <span className="cluster-auth-entry-eyebrow-v11">WORK, CONNECTED</span>
          <h2>One place for everything your studio creates.</h2>
          <p>Projects, people, and progress. Without the clutter.</p>
        </div>
        <div className="cluster-auth-entry-intro-footer-v11">
          <span>{studioName || "Private studio workspace"}</span>
          <span>{mode === "setup" ? "Account setup" : mode === "recovery" ? "Account recovery" : "Authorized access"}</span>
        </div>
      </aside>
      <section className="login-card panel managed-auth-card cluster-auth-entry-card-v11">
        {children}
      </section>
    </div>
  </main>;
}
