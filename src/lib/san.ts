import type { SwitchState } from "./model";
import { hasFault, isUp, operationalMode, portStatus } from "./model";
import type { IoStats } from "./san-model";
import { canCommunicate } from "./connectivity";
const validName = /^[a-zA-Z][\w.-]{0,31}$/;
const validWwn = /^(?:[0-9a-f]{2}:){7}[0-9a-f]{2}$/;
export type SanPath = {
  id: string;
  hostPort: string;
  targetPort: string;
  available: boolean;
  reason: string;
  degraded: boolean;
};
export function sanPaths(
  s: SwitchState,
  hostName: string,
  storageName: string,
  lunId: number,
): SanPath[] {
  const host = s.san.hosts[hostName],
    storage = s.san.storages[storageName],
    lun = storage?.luns[lunId];
  if (!host || !storage || !lun) return [];
  return host.pwwns.flatMap((h) =>
    storage.pwwns.map((t) => {
      const ports = Object.values(s.ports);
      const hp =
        ports.find(
          (p) => p.wwn === h && p.role === "Initiator" && p.connected,
        ) ?? ports.find((p) => p.wwn === h && p.role === "Initiator");
      const tp =
        ports.find((p) => p.wwn === t && p.role === "Target" && p.connected) ??
        ports.find((p) => p.wwn === t && p.role === "Target");
      let reason = "ready";
      if (!storage.online) reason = "storage offline";
      else if (!lun.online) reason = "LUN offline";
      else if (!lun.mappings[hostName]) reason = "LUN not mapped";
      else if (!hp || !tp) reason = "endpoint not attached";
      else if (!isUp(s, hp)) reason = `host ${portStatus(s, hp)}`;
      else if (!isUp(s, tp)) reason = `target ${portStatus(s, tp)}`;
      else if (operationalMode(hp) !== "F" || operationalMode(tp) !== "F")
        reason = "requires F ports";
      else if (hp.vsan !== tp.vsan) reason = "VSAN mismatch";
      else if (
        [hp, tp].some((p) => hasFault(s, "zoning-block", p.id)) ||
        !canCommunicate(s, h, t, hp.vsan)
      )
        reason = "zoning denied";
      else if ([hp, tp].some((p) => hasFault(s, "credit-starvation", p.id)))
        reason = "BB Credit timeout";
      const degraded =
        !!hp && !!tp && [hp, tp].some((p) => hasFault(s, "crc-errors", p.id));
      return {
        id: `${h}>${t}`,
        hostPort: hp?.id ?? h,
        targetPort: tp?.id ?? t,
        available: reason === "ready",
        reason: reason === "ready" && degraded ? "ready (CRC retries)" : reason,
        degraded,
      };
    }),
  );
}
export const statsKey = (host: string, storage: string, lun: number) =>
  `${host}/${storage}/${lun}`;
export function executeSan(
  s: SwitchState,
  raw: string,
): { output: string; error: boolean } {
  const ok = (output: string) => ({ output, error: false });
  const fail = (output: string) => ({ output: `% ${output}`, error: true });
  const a = raw.split(/\s+/);
  // Reject inherited property names in identifiers, while permitting them in I/O data.
  const identifiers = raw.startsWith("lab san io ")
    ? a.slice(4, 6)
    : a.slice(2);
  if (identifiers.some((token) => Object.hasOwn(Object.prototype, token)))
    return fail("Reserved device name.");
  if (raw === "show san" || raw === "show san hosts")
    return ok(
      Object.values(s.san.hosts)
        .map((h) => `${h.name}  ${h.policy}  ${h.pwwns.join(",")}`)
        .join("\n") || "No simulated hosts.",
    );
  if (raw === "show san storage")
    return ok(
      Object.values(s.san.storages)
        .map(
          (t) =>
            `${t.name}  ${t.online ? "online" : "offline"}  ${t.pwwns.join(",")}\n${Object.values(
              t.luns,
            )
              .map(
                (l) =>
                  `  LUN ${l.id}  ${l.blocks} blocks (4 KiB)  ${l.online ? "online" : "offline"}  mappings: ${
                    Object.entries(l.mappings)
                      .map(([h, m]) => `${h}:${m}`)
                      .join(",") || "none"
                  }`,
              )
              .join("\n")}`,
        )
        .join("\n") || "No simulated storage.",
    );
  if (a[0] === "show" && ["paths", "io"].includes(a[2]) && a.length === 6) {
    const [, , kind, host, storage, id] = a;
    if (
      !/^\d+$/.test(id) ||
      !s.san.hosts[host] ||
      !s.san.storages[storage]?.luns[Number(id)]
    )
      return fail("Unknown host, storage or LUN.");
    if (kind === "paths")
      return ok(
        sanPaths(s, host, storage, Number(id))
          .map(
            (p) =>
              `${p.hostPort} -> ${p.targetPort}  ${p.available ? "UP" : "DOWN"}  ${p.reason}`,
          )
          .join("\n"),
      );
    return ok(
      JSON.stringify(
        s.san.stats[statsKey(host, storage, Number(id))] ?? {
          reads: 0,
          writes: 0,
          failed: 0,
          failovers: 0,
        },
        null,
        2,
      ),
    );
  }
  if (a[0] !== "lab" || a[1] !== "san")
    return fail(
      "Use show san hosts | storage | paths <host> <storage> <lun> | io <host> <storage> <lun>.",
    );
  const [, , kind, action, ...args] = a;
  if (
    ["host", "storage"].includes(kind) &&
    action === "add" &&
    args.length === 2
  ) {
    const [name, list] = args,
      pwwns = list.toLowerCase().split(",");
    if (
      !validName.test(name) ||
      pwwns.length > 8 ||
      !pwwns.length ||
      pwwns.some((w) => !validWwn.test(w)) ||
      new Set(pwwns).size !== pwwns.length
    )
      return fail("Use a valid name and 1-8 unique comma-separated PWWNs.");
    if (s.san.hosts[name] || s.san.storages[name])
      return fail("Name already exists.");
    const used = [
      ...Object.values(s.san.hosts),
      ...Object.values(s.san.storages),
    ].flatMap((x) => x.pwwns);
    if (pwwns.some((w) => used.includes(w)))
      return fail("PWWN already belongs to a simulated device.");
    if (kind === "host")
      s.san.hosts[name] = { name, pwwns, policy: "round-robin" };
    else s.san.storages[name] = { name, pwwns, online: true, luns: {} };
    return ok(`${kind} ${name} created.`);
  }
  if (kind === "host" && action === "policy" && args.length === 2) {
    const [name, policy] = args;
    if (!s.san.hosts[name] || !["round-robin", "failover"].includes(policy))
      return fail("Unknown host or invalid policy (round-robin / failover).");
    s.san.hosts[name].policy = policy as "round-robin" | "failover";
    return ok(`Multipath policy: ${policy}`);
  }
  if (
    kind === "storage" &&
    ["online", "offline"].includes(action) &&
    args.length === 1
  ) {
    if (!s.san.storages[args[0]]) return fail("Unknown storage.");
    s.san.storages[args[0]].online = action === "online";
    return ok(`Storage ${args[0]} ${action}.`);
  }
  if (kind === "lun" && ["create", "online", "offline"].includes(action)) {
    const [storage, id, blocks] = args,
      t = s.san.storages[storage];
    if (!t || !/^\d+$/.test(id ?? "") || Number(id) > 16383)
      return fail("Unknown storage or invalid LUN ID (0-16383).");
    if (action === "create") {
      if (
        args.length !== 3 ||
        !/^\d+$/.test(blocks) ||
        Number(blocks) < 1 ||
        Number(blocks) > 1048576
      )
        return fail("LUN size must be 1-1048576 blocks (4 KiB each).");
      if (t.luns[Number(id)]) return fail("LUN already exists.");
      t.luns[Number(id)] = {
        id: Number(id),
        blocks: Number(blocks),
        online: true,
        mappings: {},
        data: {},
      };
    } else {
      if (args.length !== 2 || !t.luns[Number(id)]) return fail("Unknown LUN.");
      t.luns[Number(id)].online = action === "online";
    }
    return ok(`LUN ${id} ${action}.`);
  }
  if (kind === "map" || kind === "unmap") {
    // map <storage> <lun> <host> <rw|ro>; unmap <storage> <lun> <host>
    const [id, host, access] = args,
      lun = s.san.storages[action]?.luns[Number(id)];
    if (!/^\d+$/.test(id ?? "") || !lun || !s.san.hosts[host])
      return fail("Unknown storage, LUN or host.");
    if (kind === "map") {
      if (args.length !== 3 || !["rw", "ro"].includes(access))
        return fail("Mapping access must be rw or ro.");
      lun.mappings[host] = access as "rw" | "ro";
    } else {
      if (args.length !== 2)
        return fail("Use lab san unmap <storage> <lun> <host>.");
      delete lun.mappings[host];
    }
    return ok(`LUN ${id} ${kind} completed.`);
  }
  if (kind === "io" && ["read", "write"].includes(action)) {
    const [host, storage, id, block, ...payload] = args;
    const lun = s.san.storages[storage]?.luns[Number(id)];
    if (!s.san.hosts[host] || !/^\d+$/.test(id ?? "") || !lun)
      return fail("Unknown host, storage or LUN.");
    if (
      !/^\d+$/.test(block ?? "") ||
      Number(block) >= lun.blocks ||
      (action === "read" ? args.length !== 4 : !payload.length)
    )
      return fail("Invalid block address or I/O syntax.");
    const data =
      raw.match(/^lab san io write \S+ \S+ \d+ \d+ (.*)$/)?.[1] ??
      payload.join(" ");
    if (new TextEncoder().encode(data).length > 4096)
      return fail("Write payload exceeds 4 KiB.");
    if (
      action === "write" &&
      !(String(Number(block)) in lun.data) &&
      Object.keys(lun.data).length >= 128
    )
      return fail("Lab sparse-data limit: 128 written blocks per LUN.");
    const key = statsKey(host, storage, Number(id));
    const stats: IoStats = (s.san.stats[key] ??= {
      reads: 0,
      writes: 0,
      failed: 0,
      failovers: 0,
      lastPath: "",
      cursor: 0,
      lastResult: "",
    });
    const paths = sanPaths(s, host, storage, Number(id)),
      available = paths.filter((p) => p.available);
    if (
      !available.length ||
      (action === "write" && lun.mappings[host] === "ro")
    ) {
      stats.failed++;
      stats.lastResult = !available.length
        ? "I/O failed: no usable path."
        : "I/O failed: LUN is read-only.";
      return fail(stats.lastResult);
    }
    const previous = available.find((p) => p.id === stats.lastPath);
    if (stats.lastPath && !previous) stats.failovers++;
    const path =
      s.san.hosts[host].policy === "failover"
        ? (previous ?? available[0])
        : available[stats.cursor++ % available.length];
    stats.lastPath = path.id;
    if (action === "write") {
      lun.data[String(Number(block))] = data;
      stats.writes++;
    } else stats.reads++;
    for (const port of [path.hostPort, path.targetPort]) {
      s.ports[port].rx += 4096;
      s.ports[port].tx += 4096;
    }
    stats.lastResult = `${action.toUpperCase()} OK block ${Number(block)} via ${path.hostPort} -> ${path.targetPort}${path.degraded ? " (CRC retries)" : ""}${action === "read" ? ` data: ${JSON.stringify(lun.data[String(Number(block))] ?? "")}` : ""}`;
    return ok(stats.lastResult);
  }
  return fail("Unsupported SAN command. Type lab san ? for syntax.");
}
