import type { AuthRouteDependencies } from "./auth-types.js";
import { registerAuthCoreRoutes } from "./auth-core-routes.js";
import { registerAccountInvitationRoutes } from "./account-invitation-routes.js";
import { registerDiscordAuthRoutes } from "./auth-discord-routes.js";
import { registerAuthAdminRoutes } from "./auth-admin-routes.js";
import { registerAuthMfaRoutes } from "./auth-mfa-routes.js";
import { registerServiceCredentialRoutes } from "./service-credential-routes.js";
import { registerStudioSecurityRoutes } from "./studio-security-routes.js";

export function registerAuthRoutes(deps: AuthRouteDependencies) {
  registerAuthCoreRoutes(deps);
  registerAccountInvitationRoutes(deps);
  registerDiscordAuthRoutes(deps);
  registerAuthAdminRoutes(deps);
  registerAuthMfaRoutes(deps);
  registerServiceCredentialRoutes(deps);
  registerStudioSecurityRoutes(deps);
}
