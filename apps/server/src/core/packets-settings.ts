import { z } from "zod";

export interface PacketsSettingsPayload {
  packetsEnabled?: boolean;
  packetsRootName?: string;
  packetsDefaultView?: string;
  packetsShowDescriptions?: boolean;
  packetsAllowYoutube?: boolean;
  packetsAllowPdf?: boolean;
  packetsAllowExternalLinks?: boolean;
  packetsFeaturedLimit?: number;
}

export const packetsSettingsSchemaShape = {
  packetsEnabled: z.boolean().optional(),
  packetsRootName: z.string().min(1).max(100).optional(),
  packetsDefaultView: z.enum(["grid", "list"]).optional(),
  packetsShowDescriptions: z.boolean().optional(),
  packetsAllowYoutube: z.boolean().optional(),
  packetsAllowPdf: z.boolean().optional(),
  packetsAllowExternalLinks: z.boolean().optional(),
  packetsFeaturedLimit: z.number().int().min(1).max(100).optional()
};
