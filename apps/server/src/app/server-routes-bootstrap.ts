import { type FastifyInstance } from "fastify";

import { buildClusterAuthConfig } from "../core/auth-config.js";
import { parseStudioJson } from "../domains/access/studio-audience.js";
import type { ServerRouteRegistrationDeps } from "./server-composition-types.js";

/**
 * Everything the client needs to draw its first useful frame, in one response.
 *
 * Boot used to be three round trips in series: `/api/setup/status`, then
 * `/api/me` once that returned, then `/api/settings` once the user object
 * existed. Nothing could paint until the third landed, and a signed-out
 * visitor paid the same price for `/api/auth/config` instead. Over a LAN that
 * is tens of milliseconds; to a self-hosted server across the internet it is
 * most of a second spent waiting on latency rather than work.
 *
 * This answers all of it at once, and shapes the payload by who is asking:
 *
 * - **Signed out** gets the sign-in configuration and whether the studio has
 *   open applications. It does not get studio settings — those are behind
 *   authentication and publishing them here would be a privacy regression,
 *   not an optimisation.
 * - **Signed in** gets the user and studio settings. It does not get the
 *   sign-in configuration, which it has no use for.
 *
 * Projects deliberately stay on their own request. That handler carries real
 * permission filtering, access rules and kiosk scoping, and the shell paints
 * without it — folding it in would mean either duplicating that logic or
 * making every boot wait on the heaviest query in it.
 */
export function registerBootstrapRoute(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    decorateUserForClient,
    getCurrentUser,
    getSetupStatus,
    inspectInstanceSetup,
    isDiscordConfigured,
    prisma,
    readSettings,
    studioSettingsForClient,
  } = deps;

  app.get("/api/bootstrap", async (request, reply) => {
    // Never cached: it reports who you are.
    reply.header("Cache-Control", "no-store");

    const setup = await getSetupStatus();
    // Before an owner exists there is nobody to be signed in as, and the
    // client renders the setup flow, so stop here rather than doing the work.
    if (!setup.setupComplete) return { ok: true, setup, user: null, settings: null, auth: null, applicationsOpen: false };

    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;

    if (!decorated) {
      const [auth, openApplications] = await Promise.all([
        buildClusterAuthConfig({
          prisma,
          inspectInstanceSetup,
          isDiscordConfigured,
          requireDiscordLink: deps.requireDiscordLink,
          devLoginEnabled: deps.devLoginEnabled,
          passwordMinimumLength: deps.passwordMinLength,
          passwordMaximumLength: deps.passwordMaxLength,
        }),
        // Only whether the Apply link should appear. The forms themselves are
        // fetched when somebody actually opens the application screen, so a
        // sign-in never pays for the full serialisation it will not use.
        // The predicate has to match the cover route exactly, and "publicly
        // accepting" lives in the version's settings JSON, so the published
        // versions' settings are read and evaluated the same way — otherwise
        // an Apply link could appear over an empty application screen.
        prisma.studioForm.findMany({
          where: { purpose: "application", status: "active" },
          select: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1, select: { settingsJson: true } } },
        }),
      ]);
      const applicationsOpen = openApplications.some((form: { versions: { settingsJson: unknown }[] }) => {
        const version = form.versions?.[0];
        if (!version) return false;
        const settings = parseStudioJson(version.settingsJson, {});
        return settings.publicApplication === true && settings.acceptingResponses !== false;
      });
      return { ok: true, setup, user: null, settings: null, auth, applicationsOpen };
    }

    const settings = await readSettings();
    return { ok: true, setup, user: decorated, settings: studioSettingsForClient(settings), auth: null, applicationsOpen: false };
  });
}
