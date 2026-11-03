import assert from "node:assert/strict";
import { createServer } from "node:net";
import fs from "node:fs";
import { localProbeHost, inspectConfiguredListener } from "../../apps/server/src/core/server-network-local-diagnostics.ts";

let checks = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const mockInterfaces = {
  Ethernet: [{ address: "192.168.50.22" }, { address: "fd00::123" }],
  Loopback: [{ address: "127.0.0.1" }],
};
eq(localProbeHost("127.0.0.1", mockInterfaces), "127.0.0.1", "loopback");
eq(localProbeHost("localhost", mockInterfaces), "127.0.0.1", "localhost");
eq(localProbeHost("0.0.0.0", mockInterfaces), "127.0.0.1", "wildcard probe stays local");
eq(localProbeHost("::", mockInterfaces), "::1", "IPv6 wildcard stays local");
eq(localProbeHost("192.168.50.22", mockInterfaces), "192.168.50.22", "assigned LAN interface");
eq(localProbeHost("fd00::123", mockInterfaces), "fd00::123", "assigned ULA interface");
eq(localProbeHost("192.168.50.23", mockInterfaces), null, "unassigned LAN interface cannot be scanned");
eq(localProbeHost("8.8.8.8", mockInterfaces), null, "public remote IP cannot be scanned");
eq(localProbeHost("example.com", mockInterfaces), null, "untrusted hostname is not resolved");
eq(localProbeHost("http://127.0.0.1", mockInterfaces), null, "URLs cannot be used as a bind address");
eq((await inspectConfiguredListener("8.8.8.8", 443, mockInterfaces)).status, "not_local", "never probe remote endpoint");
eq((await inspectConfiguredListener("127.0.0.1", 70000, mockInterfaces)).status, "invalid", "invalid port cannot be probed");
const server = createServer((_socket) => {});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
try {
  eq((await inspectConfiguredListener("127.0.0.1", port, mockInterfaces)).status, "tcp_open", "live local TCP listener detected");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
eq((await inspectConfiguredListener("127.0.0.1", port, mockInterfaces)).status, "tcp_closed", "closed TCP listener detected");
const routes = fs.readFileSync("apps/server/src/app/server-routes-configuration-integrations.ts", "utf8");
assert.ok(routes.includes('app.get("/api/server-config/network/local-diagnostics"'), "admin-only on demand diagnostics must be routed"); checks++;
assert.ok(routes.includes("SERVER_CONFIG_MANAGE_REQUIRED"), "permission guard must remain"); checks++;
const ui = fs.readFileSync("packages/renderer/src/features/settings/ServerConfigPage.tsx", "utf8");
assert.ok(ui.includes("Check listeners") && ui.includes("/api/server-config/network/local-diagnostics"), "button must invoke live endpoint"); checks++;
assert.ok(ui.includes("Public DNS, TLS, remote access and Cloudflare/Tailscale are not tested."), "avoid fabricated remote validation"); checks++;
console.log(`Cluster local network diagnostics: ${checks}/${checks} passed`);
