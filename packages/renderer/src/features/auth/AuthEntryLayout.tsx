import type { ReactNode } from "react";

/** Shared public/authentication layout: one centred card on the canvas.
 * Presentation only: session and MFA authorities live in Server routes. */
export function AuthEntryLayout({
  children,
  cardClassName = "",
}: {
  children: ReactNode;
  cardClassName?: string;
}) {
  return <main className="login-shell managed-auth-shell managed-auth-v473 cluster-auth-entry-v11 cluster-auth-entry-v2">
    <section className={`login-card panel managed-auth-card cluster-auth-entry-card-v11 ${cardClassName}`.trim()}>
      {children}
    </section>
  </main>;
}
