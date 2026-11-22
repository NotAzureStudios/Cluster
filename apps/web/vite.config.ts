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

/**
 * The application shell is a lazy chunk, so the browser only learns about it
 * after the entry script has downloaded, parsed and run. Declare it (and the
 * chunks and stylesheets it statically needs) in index.html so they download
 * alongside the entry instead of after it. The hints add no code to the page:
 * the import the entry performs later is served from these requests.
 */
function clusterApplicationShellPreload() {
  const shellModule = "/packages/renderer/src/features/application/ClusterApplication.tsx";
  let base = "/";
  return {
    name: "cluster-application-shell-preload",
    apply: "build" as const,
    configResolved(config: { base: string }) { base = config.base; },
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string, context: { bundle?: Record<string, any> }) {
        const bundle = context.bundle;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((item: any) => item.type === "chunk");
        // Match on the modules a chunk contains: Rollup only sets facadeModuleId
        // when the module is the chunk's sole entry point.
        const shell = chunks.find((chunk: any) => Object.keys(chunk.modules || {}).some((id) => id.replaceAll("\\", "/").endsWith(shellModule)));
        if (!shell) throw new Error("cluster-application-shell-preload: the application shell chunk was not found; update shellModule.");
        const scripts = new Set<string>();
        const styles = new Set<string>();
        const visit = (fileName: string) => {
          if (scripts.has(fileName)) return;
          const chunk = bundle[fileName];
          if (!chunk || chunk.type !== "chunk") return;
          scripts.add(fileName);
          for (const style of chunk.viteMetadata?.importedCss || []) styles.add(style);
          for (const imported of chunk.imports || []) visit(imported);
        };
        visit(shell.fileName);
        // Skip anything index.html already references (the entry's own imports).
        const fresh = (fileName: string) => !html.includes(`${base}${fileName}"`);
        return [
          ...[...scripts].filter(fresh).map((fileName) => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `${base}${fileName}` }, injectTo: "head" as const })),
          ...[...styles].filter(fresh).map((fileName) => ({ tag: "link", attrs: { rel: "preload", as: "style", crossorigin: true, href: `${base}${fileName}` }, injectTo: "head" as const })),
        ];
      },
    },
  };
}

export default defineConfig({
  // @cluster/shared resolves to its TypeScript source, so shared edits need no rebuild.
  resolve: { conditions: ["source", "module", "browser", "development|production"] },
  plugins: [react({
    babel: {
      generatorOpts: { compact: true }
    }
  }), clusterServiceWorkerBuildIdentity(), clusterApplicationShellPreload()],
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
