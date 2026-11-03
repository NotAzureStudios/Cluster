import { connect, isIP } from "node:net";
import { networkInterfaces } from "node:os";

type InterfaceAddress = { address: string } | undefined;
type Interfaces = Record<string, InterfaceAddress[] | undefined>;
export type LocalListenerResult = {
  configuredHost: string;
  port: number;
  probeHost: string | null;
  status: "tcp_open" | "tcp_closed" | "not_local" | "invalid";
};
export type LocalNetworkDiagnostics = {
  checkedAt: string;
  web: LocalListenerResult;
  api: LocalListenerResult;
  external: "not_checked";
  note: string;
};

/**
 * Restrict diagnostics to a loopback address or an address assigned to this
 * machine. Never DNS-resolve a user configured hostname or probe a remote IP.
 * The candidate port comes only from the saved server configuration.
 */
export function localProbeHost(
  rawBind: unknown,
  interfaces: Interfaces = networkInterfaces() as Interfaces,
): string | null {
  if (typeof rawBind !== "string") return null;
  const bind = rawBind.trim();
  if (!bind || bind.toLowerCase() === "localhost" || bind === "0.0.0.0") return "127.0.0.1";
  if (bind === "::") return "::1";
  if (isIP(bind) === 0) return null;
  if (bind === "::1" || /^127\./.test(bind)) return bind;
  const active = Object.values(interfaces).flatMap((list) => list ?? []);
  return active.some((item) => item?.address?.toLowerCase().split("%")[0] === bind.toLowerCase())
    ? bind : null;
}

export async function inspectConfiguredListener(
  bind: unknown,
  port: unknown,
  interfaces: Interfaces = networkInterfaces() as Interfaces,
  timeoutMs = 650,
): Promise<LocalListenerResult> {
  const configuredHost = typeof bind === "string" ? bind : "";
  const normalizedPort = typeof port === "number" ? port : NaN;
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    return { configuredHost, port: 0, probeHost: null, status: "invalid" };
  }
  const probeHost = localProbeHost(bind, interfaces);
  if (!probeHost) return { configuredHost, port: normalizedPort, probeHost: null, status: "not_local" };
  const status = await new Promise<"tcp_open" | "tcp_closed">((resolve) => {
    let settled = false;
    const finish = (value: "tcp_open" | "tcp_closed") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = connect({ host: probeHost, port: normalizedPort });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("tcp_open"));
    socket.once("error", () => finish("tcp_closed"));
    socket.once("timeout", () => finish("tcp_closed"));
  });
  return { configuredHost, port: normalizedPort, probeHost, status };
}

export async function diagnoseLocalNetworkPorts(settings: Record<string, unknown>): Promise<LocalNetworkDiagnostics> {
  const interfaces = networkInterfaces() as Interfaces;
  const [web, api] = await Promise.all([
    inspectConfiguredListener(settings.webHost ?? "127.0.0.1", settings.webPort ?? 3000, interfaces),
    inspectConfiguredListener(settings.serverHost ?? "127.0.0.1", settings.serverPort ?? 4000, interfaces),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    web, api, external: "not_checked",
    note: "Read-only TCP listener check on this machine. A responsive port is not proof of Cluster identity, login readiness, TLS, firewall policy, DNS, or tunnel/VPN reachability.",
  };
}
