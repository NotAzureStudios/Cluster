import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

function releaseBuildId() {
  const candidates = [
    path.resolve(here, "../../CLUSTER_RELEASE.json"),
    path.resolve(here, "../../../../CLUSTER_RELEASE.json"),
  ];
  for (const candidate of candidates) {
    try {
      const release = JSON.parse(fs.readFileSync(candidate, "utf8")) as { label?: unknown; releaseCandidate?: unknown; clusterVersion?: unknown };
      const value = String(release.label || [release.clusterVersion, release.releaseCandidate].filter(Boolean).join("-") || "dev");
      return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "dev";
    } catch {
      // Try the next source/package layout.
    }
  }
  return String(process.env.CLUSTER_BUILD_ID || "dev").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 96) || "dev";
}

function clusterServiceWorkerBuildIdentity() {
  const buildId = releaseBuildId();
  return {
    name: "cluster-service-worker-build-identity",
    closeBundle() {
      const serviceWorkerPath = path.resolve(here, "dist/cluster-sw.js");
      if (!fs.existsSync(serviceWorkerPath)) return;
      const source = fs.readFileSync(serviceWorkerPath, "utf8");
      fs.writeFileSync(serviceWorkerPath, source.replaceAll("__CLUSTER_BUILD_ID__", buildId));
    },
  };
}

export default defineConfig({
  plugins: [react({
    babel: {
      generatorOpts: { compact: true }
    }
  }), clusterServiceWorkerBuildIdentity()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/health": "http://127.0.0.1:4000",
      "/.well-known/security.txt": "http://127.0.0.1:4000",
      "/security.txt": "http://127.0.0.1:4000"
    }
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/health": "http://127.0.0.1:4000",
      "/.well-known/security.txt": "http://127.0.0.1:4000",
      "/security.txt": "http://127.0.0.1:4000"
    }
  },
  build: {
    // Production source maps stay private; crash-symbol workflows retain their own artifacts.
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@dnd-kit")) return "vendor-dnd";
          if (id.includes("three")) return "vendor-three";
          if (id.includes("pdfjs-dist")) return "vendor-pdf";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          return "vendor";
        }
      }
    }
  }
});
