import { presenceContextUpdateSchema, userPresenceUpdateSchema } from "@cluster/shared";
import { apiError } from "../../core/api-response.js";
import { createPresenceService } from "./presence-service.js";

function presencePayload(profile: any) {
  const status = profile?.status || {};
  return {
    availability: status.availability || "available",
    availabilityMessage: status.availabilityMessage || null,
    connectionVisibility: status.connectionVisibility || "visible",
    focusState: status.focusState || null,
    declaredStatus: status.declaredStatus || null,
    presenceDisclosure: status.presenceDisclosure || "work_state",
    clockState: profile?.activeTime ? (profile.activeTime.breaks?.length ? "break" : "in") : "out",
    activeTime: profile?.activeTime || null,
    workContext: profile?.context || null,
  };
}

export function registerPresenceRoutes(deps: any) {
  const service = createPresenceService(deps);

  deps.app.get("/api/me/presence", async (request: any, reply: any) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    return { ok: true, presence: presencePayload(await service.read(user)) };
  });

  deps.app.post("/api/me/heartbeat", async (request: any, reply: any) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    return service.heartbeat(user);
  });

  deps.app.patch("/api/me/presence", async (request: any, reply: any) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    const body = userPresenceUpdateSchema.parse(request.body);
    const updated = await service.update(user, body);
    return { ok: true, user: await deps.decorateUserForClient(updated), presence: presencePayload(await service.read(user)) };
  });

  deps.app.put("/api/me/presence/context", async (request: any, reply: any) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    const body = presenceContextUpdateSchema.parse(request.body || {});
    try {
      return { ok: true, presence: presencePayload(await service.updateContext(user, body)) };
    } catch (error: any) {
      return apiError(request, reply, 400, "PRESENCE_CONTEXT_INVALID", String(error?.message || "Work context could not be updated."));
    }
  });

  deps.app.delete("/api/me/presence/context", async (request: any, reply: any) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    return { ok: true, presence: presencePayload(await service.clearContext(user)) };
  });
}
