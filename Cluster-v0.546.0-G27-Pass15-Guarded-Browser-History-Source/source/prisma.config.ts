import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "apps/server/prisma/schema.prisma",
  migrations: { path: "apps/server/prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "",
  },
});
