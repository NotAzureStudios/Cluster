import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";

export type AuthRouteDependencies = {
  app: FastifyInstance; prisma: any; authorization: AuthorizationService;
  inspectInstanceSetup: (prisma: any) => Promise<any>; isDiscordConfigured: () => boolean;
  requireDiscordLink: boolean; devLoginEnabled: boolean; passwordMinLength: number; passwordMaxLength: number;
  authRateLimitMax: number; apiRateLimitWindowMs: number; loginFailureLimit: number; loginLockMs: number; authSecret: string; genericAuthError: string;
  sessionCookie: string; sessionSecure: boolean; webOrigin: string; discordLinkStateLifetimeMs: number;
  normalizeAuthUsername: (value: string) => string; verifyPassword: (...args: any[]) => Promise<boolean>; verifyUserPin: (user: any, pin: string, purpose: string, request?: FastifyRequest | null) => Promise<boolean>; dummyPasswordHash: () => Promise<string>;
  rateLimitKey: (...args: any[]) => Promise<boolean>; clearRateLimitKey: (key: string) => void; logSecurityEvent: (input: any) => Promise<any>;
  createSession: (...args: any[]) => Promise<any>; clearCurrentSessionCache: (request: FastifyRequest) => void; clearSessionCookies: (reply: FastifyReply) => void; csrfTokenForSession: (sessionId: string) => string; decorateUserForClient: (user: any) => Promise<any>; accountNextStep: (...args: any[]) => any;
  onSessionRevoked: (sessionId: string, userId: string, reason: string) => void; onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void;
  validateNewPassword: (...args: any[]) => string; hashPassword: (value: string) => Promise<string>; generateTemporaryPassword: (length?: number) => string; nextAccountState: (...args: any[]) => any;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>; hashToken: (token: string) => string; randomOAuthState: () => string; oauthStateDigest: (...args: any[]) => string;
  fetchWithTimeout: (...args: any[]) => Promise<Response>; safeAuthenticationReason: (error: unknown) => string;
  requireConfirmation: (request: FastifyRequest, reply: FastifyReply, expected: string) => boolean; parseJsonObject: (value: any) => any;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
  saveSettings: (settings: Record<string, any>, options?: { changedFields: Record<string, any>; expectedSettings: Record<string, { exists: boolean; value?: unknown }> }) => Promise<void>;
  settingsForClient: (settings: Record<string, any>) => Record<string, unknown>;
  rewrapProtectedSettings: () => Promise<void>;
  notificationService?: { publishRecord: (record: any) => void; publishRecords: (records: any[]) => void };
};
