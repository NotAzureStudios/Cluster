import https from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";

/** Prevent admin-controlled domain names from turning a health check into a
 * loopback/LAN/metadata-server probe. The selected public IP is pinned for TLS
 * and HTTPS so DNS cannot change between validation and connection. */
export function isPublicIpv4(input: string): boolean {
  if (isIP(input) !== 4) return false;
  const octets = input.split(".").map(Number);
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** A server-side diagnostic only. Successful TLS+HTTP does not certify browser
 * auth, WebSocket, large transfers, Desktop login, or public reachability from
 * other networks. Never log a DNS provider token or client cookie here. */
export async function publicHttpsReadiness(host: string, dependencies: { resolveAddresses?: typeof resolve4; request?: typeof https.request } = {}) {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.length > 253 || host.includes("..")) throw new Error("Invalid public hostname");
  let answers: string[];
  try { answers = await (dependencies.resolveAddresses || resolve4)(host); }
  catch { return { dns: "unavailable", tls: "not_checked", http: "not_checked", vantage: "cluster_server" }; }
  const address = answers.find(isPublicIpv4);
  if (!address) return { dns: "no_public_ipv4", tls: "not_checked", http: "not_checked", vantage: "cluster_server" };
  const request = dependencies.request || https.request;
  return new Promise(resolve => {
    let completed = false;
    const done = (value: { tls: string; http: string; status?: number }) => {
      if (completed) return;
      completed = true;
      req.destroy();
      resolve({ dns: "public_ipv4", tls: value.tls, http: value.http, ...(value.status ? { status: value.status } : {}), vantage: "cluster_server" });
    };
    const req = request({ protocol: "https:", hostname: host, port: 443, path: "/health", method: "GET", servername: host, agent: false, rejectUnauthorized: true,
      timeout: 3500, maxHeaderSize: 8192, lookup: (_host: string, _options: any, callback: any) => callback(null, address, 4),
      headers: { Host: host, Accept: "application/json", "User-Agent": "Cluster-Domain-Readiness/1" },
    }, response => {
      const status = response.statusCode || 0;
      response.destroy();
      done({ tls: "trusted", http: status >= 200 && status < 300 ? "healthy" : "non_success", status });
    });
    req.once("timeout", () => done({ tls: "failed", http: "not_checked" }));
    req.once("error", () => done({ tls: "failed", http: "not_checked" }));
    req.end();
  });
}
