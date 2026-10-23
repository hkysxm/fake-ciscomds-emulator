import { canCommunicate, memberWwn } from "./connectivity";
import { executeSan } from "./san";
import type { Context, Session, SwitchState, Zone } from "./model";
import {
  FAULTS,
  context,
  fcid,
  hasFault,
  isUp,
  operationalMode,
  snapshot,
  toggleFault,
  zoneKey,
} from "./model";
import { expandCommand, suggestions } from "./catalog";
import { show } from "./show";
export type Result = {
  state: SwitchState;
  session: Session;
  output: string;
  error: boolean;
  clear?: boolean;
};
const wwnPattern = /^(?:[0-9a-f]{2}:){7}[0-9a-f]{2}$/i;
const validName = (s: string) => /^[a-zA-Z][\w.-]{0,63}$/.test(s);
const ipPattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const validIp = (s: string) =>
  ipPattern.test(s) && s.split(".").every((n) => Number(n) <= 255);
const validVsan = (v: number) =>
  Number.isInteger(v) && v >= 1 && v <= 4093 && v !== 4079;
export function resolvePorts(s: SwitchState, text: string): string[] | null {
  const ids: string[] = [];
  for (const part of text.replace(/\s/g, "").split(",")) {
    const m = part.match(/^(fc\d+\/)(\d+)(?:-(?:fc\d+\/)?(\d+))?$/i);
    if (!m) return null;
    const endSlot = part.match(/-(fc\d+\/)/i)?.[1];
    if (endSlot && endSlot.toLowerCase() !== m[1].toLowerCase()) return null;
    const start = Number(m[2]),
      end = Number(m[3] ?? m[2]);
    if (end < start || end - start > 96) return null;
    for (let i = start; i <= end; i++) {
      const id = `${m[1].toLowerCase()}${i}`;
      if (!s.ports[id]) return null;
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}
function resolveVsanList(text: string): number[] | null {
  const ids: number[] = [];
  if (text === "all")
    return Array.from({ length: 4093 }, (_, i) => i + 1).filter(
      (v) => v !== 4079,
    );
  if (text === "none") return [];
  for (const part of text.split(",")) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const start = Number(m[1]),
      end = Number(m[2] ?? m[1]);
    if (
      !validVsan(start) ||
      !validVsan(end) ||
      end < start ||
      end - start > 4093
    )
      return null;
    for (let i = start; i <= end; i++) if (validVsan(i)) ids.push(i);
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}
export function execute(
  original: SwitchState,
  originalSession: Session,
  input: string,
): Result {
  let s = structuredClone(original);
  const session = structuredClone(originalSession);
  const done = (output = "", error = false): Result => ({
    state: s,
    session,
    output,
    error,
  });
  const fail = (message: string) => done(`% ${message}`, true);
  const push = (ctx: Context) => {
    session.stack = [{ mode: "exec" }, { mode: "config" }, ctx];
  };
  let raw = input.trim();
  if (!raw) return done();
  session.history = [...session.history, raw].slice(-200);
  if (raw.endsWith("?")) {
    const base = raw.slice(0, -1).trim();
    const expanded = expandCommand(base).command;
    const matches = suggestions(session).filter((c) =>
      c.toLowerCase().startsWith(expanded.toLowerCase()),
    );
    return done(
      matches.length
        ? matches.map((c) => `  ${c}`).join("\n")
        : "% No matching command in this mode.",
    );
  }
  if (raw === "clear" || raw === "cls") return { ...done(), clear: true };
  if (raw.startsWith("lab san ")) {
    const result = executeSan(s, raw);
    return done(result.output, result.error);
  }
  const pipeIndex = raw.indexOf("|");
  if (pipeIndex >= 0) {
    const command = raw.slice(0, pipeIndex).trim();
    if (!/^sh(?:ow)?\b/i.test(command))
      return fail("Output filters are only available for show commands.");
    const result = execute(s, originalSession, command);
    result.session.history = session.history;
    if (result.error) return result;
    const pipes = raw
      .slice(pipeIndex + 1)
      .split("|")
      .map((p) => p.trim());
    for (const pipe of pipes) {
      const m = pipe.match(
        /^(include|inc|exclude|exc|begin|beg|count|section)(?:\s+(.+))?$/,
      );
      if (!m)
        return fail(
          "Invalid output filter. Use include, exclude, begin, count or section.",
        );
      try {
        const regex = new RegExp(m[2] ?? ".*", "i");
        const lines = result.output.split("\n");
        if (["include", "inc", "section"].includes(m[1]))
          result.output = lines.filter((l) => regex.test(l)).join("\n");
        if (["exclude", "exc"].includes(m[1]))
          result.output = lines.filter((l) => !regex.test(l)).join("\n");
        if (["begin", "beg"].includes(m[1])) {
          const i = lines.findIndex((l) => regex.test(l));
          result.output = i < 0 ? "" : lines.slice(i).join("\n");
        }
        if (m[1] === "count")
          result.output = `Count: ${lines.filter((l) => regex.test(l)).length} lines`;
      } catch {
        return fail("Invalid regular expression.");
      }
    }
    return result;
  }
  const expanded = expandCommand(raw);
  if (expanded.error) return done(expanded.error, true);
  raw = expanded.command;
  if (/^show san(?: |$)/.test(raw)) {
    const result = executeSan(s, raw);
    return done(result.output, result.error);
  }
  const current = context(session);
  if (raw === "help")
    return done(
      "Use ? for available commands. Use <command> ? for context help.\nTab: complete  ↑/↓: history  Ctrl+C: cancel  Ctrl+L: clear  Ctrl+Z: end\n\n" +
        suggestions(session)
          .map((c) => `  ${c}`)
          .join("\n"),
    );
  if (raw.startsWith("show ")) {
    const result = show(s, raw);
    return result === null
      ? fail(
          `Invalid or unsupported command: ${raw}. Type ? for available commands.`,
        )
      : done(result, result.startsWith("% "));
  }
  if (raw === "exit") {
    if (session.stack.length > 1) session.stack.pop();
    return done();
  }
  if (raw === "end") {
    session.stack = [{ mode: "exec" }];
    return done();
  }
  if (raw === "configure terminal") {
    session.stack = [{ mode: "exec" }, { mode: "config" }];
    return done("Enter configuration commands, one per line. End with CNTL/Z.");
  }
  if (
    raw === "copy running-config startup-config" ||
    raw === "write memory" ||
    raw === "wr"
  ) {
    s.saved = snapshot(s);
    return done(
      "[########################################] 100%\nCopy complete, now saving to disk (please wait)...\nCopy complete.",
    );
  }
  if (/^terminal (?:length|width) \d+$/.test(raw)) return done();
  if (raw === "reload") {
    if (!s.saved)
      return fail(
        "No startup configuration. Save configuration before reloading.",
      );
    Object.assign(s, structuredClone(s.saved));
    session.stack = [{ mode: "exec" }];
    s.pendingAliases = {};
    s.logs.push("%SYSTEM-5-RELOAD: Configuration restored from startup-config");
    return done(
      "Reloading simulated switch...\nStartup configuration restored. Physical faults remain injected.",
    );
  }
  if (raw === "clear logging logfile" || raw === "clear logging") {
    s.logs = [];
    return done("Log cleared.");
  }
  if (raw === "clear lab faults") {
    s.faults
      .filter((f) => f.id === "crc-errors")
      .forEach((f) => {
        s.ports[f.port].crc += 427;
      });
    s.faults = [];
    s.logs.push("%LAB-5-RECOVERY: All injected faults cleared");
    return done(
      "All injected faults cleared. Historical counters are retained.",
    );
  }
  const clearZones = raw.match(/^clear zone database vsan (\d+)$/);
  if (clearZones) {
    const vsan = Number(clearZones[1]);
    if (!s.vsans[vsan]) return fail("VSAN does not exist.");
    if (s.activeZoneSets[vsan])
      return fail(
        "Deactivate the active zoneset before clearing the zoning database.",
      );
    for (const db of [s.zones, s.zoneSets, s.aliases])
      Object.keys(db)
        .filter((k) => k.startsWith(`${vsan}:`))
        .forEach((k) => delete db[k]);
    return done(`Zoning database cleared for VSAN ${vsan}.`);
  }
  const fault = raw.match(/^lab fault (\S+) interface (fc\d+\/\d+)$/);
  if (fault) {
    const f = FAULTS.find((f) => f.id === fault[1]);
    if (!f) return fail("Unknown fault. Use show lab.");
    if (!s.ports[fault[2]]) return fail("Interface does not exist.");
    s = toggleFault(s, f.id, fault[2]);
    return done(
      `${f.id} ${hasFault(s, f.id, fault[2]) ? "injected on" : "cleared on"} ${fault[2]}.`,
    );
  }
  const clearCounters = raw.match(
    /^clear (?:counters(?: interface (.+))?|interface (.+) counters)$/,
  );
  if (clearCounters) {
    const list = clearCounters[1] || clearCounters[2];
    const ids = list ? resolvePorts(s, list) : Object.keys(s.ports);
    if (!ids) return fail("Invalid interface range.");
    ids.forEach((id) => {
      s.ports[id].rx = 0;
      s.ports[id].tx = 0;
      s.ports[id].crc = 0;
    });
    return done(
      `Interface counters cleared.${s.faults.some((f) => f.id === "crc-errors") ? "\nActive physical faults continue to generate errors." : ""}`,
    );
  }
  if (/^(?:ping|traceroute) /.test(raw)) {
    const target = raw.split(" ")[1];
    if (!validIp(target)) return fail("Enter a valid IPv4 address.");
    const reachable = [s.mgmtIp.split("/")[0], s.gateway, "127.0.0.1"].includes(
      target,
    );
    return done(
      raw.startsWith("ping")
        ? `PING ${target} (simulated)\n${reachable ? Array.from({ length: 5 }, (_, i) => `64 bytes from ${target}: icmp_seq=${i} ttl=64 time=0.4 ms`).join("\n") : "Request timed out. No route to the simulated destination."}\n\n--- ${target} ping statistics ---\n5 packets transmitted, ${reachable ? 5 : 0} received, ${reachable ? 0 : 100}% packet loss`
        : `traceroute to ${target} (simulated)\n 1  ${s.gateway}  0.4 ms\n${reachable ? ` 2  ${target}  0.6 ms` : " 2  * * * (outside simulated topology)"}`,
    );
  }
  const ping = raw.match(
    /^fcping (?:pwwn (\S+)|fcid (0x[\da-f]+)) vsan (\d+)(?: count (\d+))?$/i,
  );
  if (ping) {
    const v = Number(ping[3]),
      count = Number(ping[4] ?? 5);
    if (!s.vsans[v]) return fail(`VSAN ${v} does not exist.`);
    if (count < 1 || count > 100) return fail("Count must be 1-100.");
    if (ping[1] && !wwnPattern.test(ping[1])) return fail("Invalid pWWN.");
    const dest = Object.values(s.ports).find(
      (p) =>
        p.vsan === v &&
        (ping[1]
          ? p.wwn === ping[1].toLowerCase()
          : fcid(s, p) === ping[2].toLowerCase()),
    );
    const source = Object.values(s.ports).find(
      (p) => p.vsan === v && p.role === "Initiator",
    );
    const up =
      !!dest &&
      !!source &&
      operationalMode(dest) === "F" &&
      operationalMode(source) === "F" &&
      isUp(s, dest) &&
      isUp(s, source);
    const blocked =
      !!dest &&
      !!source &&
      (hasFault(s, "zoning-block", dest.id) ||
        hasFault(s, "zoning-block", source.id) ||
        !canCommunicate(s, source.wwn, dest.wwn, v));
    const success = up && !blocked;
    return done(
      `FCPING ${ping[1] ?? ping[2]} VSAN ${v} (simulated endpoint test)\n${success ? "!".repeat(count) : ".".repeat(count)}\n${count} frames sent, ${success ? count : 0} frames received\n${success ? "Round-trip min/avg/max = 0.1/0.2/0.3 ms" : !up ? "Destination unreachable: no active FLOGI / link down." : "Destination unreachable: zoning access denied."}`,
    );
  }
  if (current.mode === "exec")
    return fail(
      `Invalid command in EXEC mode: ${raw}. Type ? for available commands.`,
    );
  const configChanged = (output = "") => {
    s.revision++;
    return done(output);
  };
  const defaults = raw.match(/^default interface (.+)$/i);
  if (defaults) {
    const ids = resolvePorts(s, defaults[1]);
    if (!ids) return fail("Invalid interface or range.");
    for (const id of ids)
      Object.assign(s.ports[id], {
        description: "",
        mode: "F",
        speed: 32,
        speedAuto: false,
        bbCredit: 16,
        beacon: false,
        linkTraps: true,
        adminDown: false,
        vsan: 1,
        trunk: false,
        allowedVsans: [1, 10, 20],
        portChannel: null,
      });
    return configChanged();
  }
  const clone = raw.match(/^(zone|zoneset) clone (\S+) (\S+) vsan (\d+)$/);
  if (clone) {
    const [, kind, from, to, v] = clone;
    if (!validName(to)) return fail("Invalid destination name.");
    const db = kind === "zone" ? s.zones : s.zoneSets;
    const source = db[zoneKey(from, Number(v))];
    if (!source) return fail("Source does not exist.");
    if (db[zoneKey(to, Number(v))]) return fail("Destination already exists.");
    db[zoneKey(to, Number(v))] = { ...structuredClone(source), name: to };
    return configChanged();
  }
  const int = raw.match(/^interface (?:range )?(.+)$/i);
  if (int) {
    if (int[1] === "mgmt0") {
      push({ mode: "interface", key: "mgmt0" });
      return done();
    }
    const pc = int[1].match(/^port-channel\s*(\d+)$/);
    if (pc) {
      if (Number(pc[1]) < 1 || Number(pc[1]) > 256)
        return fail("Port-channel ID must be 1-256.");
      push({ mode: "port-channel", key: pc[1] });
      return done();
    }
    const ids = resolvePorts(s, int[1]);
    if (!ids) return fail("Invalid interface or range.");
    push({ mode: "interface", key: ids.join(",") });
    return done();
  }
  if (raw === "vsan database") {
    push({ mode: "vsan" });
    return done();
  }
  if (raw === "device-alias database") {
    push({ mode: "device-alias" });
    return done();
  }
  if (raw === "device-alias commit") {
    for (const [name, wwn] of Object.entries(s.pendingAliases)) {
      if (wwn) s.deviceAliases[name] = wwn;
      else delete s.deviceAliases[name];
    }
    s.pendingAliases = {};
    return configChanged("Device-alias database commit completed.");
  }
  if (raw === "device-alias abort") {
    s.pendingAliases = {};
    return done("Pending changes discarded.");
  }
  const host = raw.match(/^(?:hostname|switchname) (\S+)$/);
  if (host) {
    if (!validName(host[1]))
      return fail("Invalid hostname (1-64 characters, start with a letter).");
    s.hostname = host[1];
    return configChanged();
  }
  const feature = raw.match(/^(no )?feature (\S+)$/);
  if (feature) {
    if (
      ![
        "npiv",
        "fport-channel-trunk",
        "ssh",
        "telnet",
        "npv",
        "analytics",
        "fabric-binding",
      ].includes(feature[2])
    )
      return fail("Unsupported feature.");
    s.features = s.features.filter((f) => f !== feature[2]);
    if (!feature[1]) s.features.push(feature[2]);
    return configChanged();
  }
  const zoneDef = raw.match(
    /^(no )?(zone|zoneset|fcalias) name (\S+) vsan (\d+)$/,
  );
  if (zoneDef) {
    const [, no, kind, name, v] = zoneDef,
      vsan = Number(v),
      key = zoneKey(name, vsan);
    if (!validName(name))
      return fail(
        "Invalid name. Use letters, digits, underscores, dots and hyphens.",
      );
    if (!s.vsans[vsan])
      return fail(
        `VSAN ${vsan} does not exist. Create it in vsan database first.`,
      );
    const target =
      kind === "zone" ? s.zones : kind === "zoneset" ? s.zoneSets : s.aliases;
    if (no) {
      if (!target[key]) return fail(`${kind} ${name} does not exist.`);
      if (kind === "zoneset" && s.activeZoneSets[vsan]?.name === name)
        return fail("Deactivate the zoneset before deleting it.");
      if (
        kind === "zone" &&
        Object.values(s.zoneSets).some(
          (z) => z.vsan === vsan && z.members.includes(name),
        )
      )
        return fail("Zone is a member of a zoneset. Remove membership first.");
      delete target[key];
      return configChanged();
    }
    target[key] ??= { name, vsan, members: [] };
    push({
      mode:
        kind === "zone" ? "zone" : kind === "zoneset" ? "zoneset" : "fcalias",
      key,
      vsan,
    });
    return configChanged();
  }
  const activate = raw.match(/^(no )?zoneset activate name (\S+) vsan (\d+)$/);
  if (activate) {
    const [, no, name, v] = activate,
      vsan = Number(v),
      zs = s.zoneSets[zoneKey(name, vsan)];
    if (no) {
      if (s.activeZoneSets[vsan]?.name !== name)
        return fail("Zoneset is not active.");
      delete s.activeZoneSets[vsan];
      return configChanged("Zoneset deactivated.");
    }
    if (!zs) return fail(`Zoneset ${name} does not exist in VSAN ${vsan}.`);
    if (!zs.members.length) return fail("Cannot activate an empty zoneset.");
    const zones: Zone[] = [];
    for (const member of zs.members) {
      const z = s.zones[zoneKey(member, vsan)];
      if (!z?.members.length)
        return fail(`Zone ${member} is undefined or empty.`);
      for (const m of z.members) {
        if (
          !memberWwn(s, m, vsan).length &&
          /^(?:device-alias|fcalias) /.test(m)
        )
          return fail(`Unresolved zone member: ${m}`);
      }
      zones.push(structuredClone(z));
    }
    s.activeZoneSets[vsan] = { name, zones };
    s.logs.push(
      `%ZONE-5-ACTIVATION: Zoneset ${name} activated in VSAN ${vsan}`,
    );
    return configChanged(`Zoneset ${name} activated in VSAN ${vsan}.`);
  }
  const defaultZone = raw.match(/^zone default-zone (permit|deny) vsan (\d+)$/);
  if (defaultZone) {
    const v = s.vsans[Number(defaultZone[2])];
    if (!v) return fail("VSAN does not exist.");
    v.defaultZone = defaultZone[1] as "permit" | "deny";
    return configChanged();
  }
  const distribute = raw.match(/^zoneset distribute full vsan (\d+)$/);
  if (distribute) {
    if (!s.vsans[Number(distribute[1])]) return fail("VSAN does not exist.");
    return done("Full zoneset distribution completed (local simulation).");
  }
  const domain = raw.match(
    /^fcdomain domain (\d+) (?:static|preferred) vsan (\d+)$/,
  );
  if (domain) {
    const v = s.vsans[Number(domain[2])];
    if (!v) return fail("VSAN does not exist.");
    const n = Number(domain[1]);
    if (n < 1 || n > 239) return fail("Domain ID must be 1-239.");
    v.domain = n;
    return configChanged();
  }
  const priority = raw.match(/^fcdomain priority (\d+)(?: vsan (\d+))?$/);
  if (priority) {
    const n = Number(priority[1]);
    if (n < 1 || n > 254) return fail("Priority must be 1-254.");
    if (priority[2] && !s.vsans[Number(priority[2])])
      return fail("VSAN does not exist.");
    if (priority[2]) s.vsans[Number(priority[2])].priority = n;
    else {
      s.fcdomainPriority = n;
      Object.values(s.vsans).forEach((v) => {
        v.priority = n;
      });
    }
    return configChanged();
  }
  const restart = raw.match(/^fcdomain restart(?: disruptive)? vsan (\d+)$/);
  if (restart) {
    if (!s.vsans[Number(restart[1])]) return fail("VSAN does not exist.");
    s.logs.push(`%FCDOMAIN-5-RESTART: Domain restarted in VSAN ${restart[1]}`);
    return done("Fcdomain restarted (simulated).");
  }
  const ntp = raw.match(/^(no )?ntp server (\S+)$/);
  if (ntp) {
    if (!validIp(ntp[2]) && !/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(ntp[2]))
      return fail("Invalid NTP server address.");
    s.ntpServers = s.ntpServers.filter((n) => n !== ntp[2]);
    if (!ntp[1]) s.ntpServers.push(ntp[2]);
    return configChanged();
  }
  const gateway = raw.match(/^ip default-gateway (\S+)$/);
  if (gateway) {
    if (!validIp(gateway[1])) return fail("Invalid IPv4 address.");
    s.gateway = gateway[1];
    return configChanged();
  }
  const snmp = raw.match(/^snmp-server (location|contact) (.+)$/);
  if (snmp) {
    if (snmp[1] === "location") s.snmpLocation = snmp[2];
    else s.snmpContact = snmp[2];
    return configChanged();
  }
  if (current.mode === "interface" || current.mode === "port-channel") {
    if (current.key === "mgmt0") {
      const ip = raw.match(/^ip address (\S+)$/);
      if (ip) {
        const [addr, prefix] = ip[1].split("/");
        if (!validIp(addr) || !/^\d+$/.test(prefix) || Number(prefix) > 32)
          return fail("Invalid IPv4 address/prefix.");
        s.mgmtIp = ip[1];
        return configChanged();
      }
      if (raw === "no shutdown") return done();
      return fail(
        "mgmt0 supports ip address <address/prefix> and no shutdown in this lab.",
      );
    }
    const ids =
      current.mode === "port-channel"
        ? Object.values(s.ports)
            .filter((p) => p.portChannel === Number(current.key))
            .map((p) => p.id)
        : (current.key ?? "").split(",");
    if (!ids.length)
      return fail(
        "Port-channel has no members. Assign interfaces using channel-group first.",
      );
    const apply = (fn: (id: string) => void) => {
      ids.forEach(fn);
      return configChanged();
    };
    const credit = raw.match(/^switchport fcrxbbcredit (\d+)$/);
    if (credit) {
      const n = Number(credit[1]);
      if (n < 1 || n > 500) return fail("Lab receive BB Credit range: 1-500.");
      return apply((id) => {
        s.ports[id].bbCredit = n;
      });
    }
    if (raw === "no switchport fcrxbbcredit")
      return apply((id) => {
        s.ports[id].bbCredit = 16;
      });
    if (raw === "beacon" || raw === "no beacon")
      return apply((id) => {
        s.ports[id].beacon = raw === "beacon";
      });
    if (raw === "snmp trap link-status" || raw === "no snmp trap link-status")
      return apply((id) => {
        s.ports[id].linkTraps = !raw.startsWith("no ");
      });
    const portVsan = raw.match(/^switchport vsan (\d+)$/);
    if (portVsan || raw === "no switchport vsan") {
      const v = portVsan ? Number(portVsan[1]) : 1;
      if (!s.vsans[v]) return fail("VSAN does not exist.");
      return apply((id) => {
        s.ports[id].vsan = v;
      });
    }
    const resetField: Record<string, () => Result> = {
      "no switchport speed": () =>
        apply((id) => {
          s.ports[id].speed = 32;
          s.ports[id].speedAuto = false;
        }),
      "no switchport mode": () =>
        apply((id) => {
          s.ports[id].mode = "F";
        }),
      "no switchport trunk mode": () =>
        apply((id) => {
          s.ports[id].trunk = false;
        }),
      "no switchport trunk allowed vsan": () =>
        apply((id) => {
          s.ports[id].allowedVsans = [1, 10, 20];
        }),
    };
    if (resetField[raw]) return resetField[raw]();
    const endpoint = raw.match(
      /^lab endpoint (disconnect|connect (Initiator|Target|Switch) pwwn (\S+))$/i,
    );
    if (endpoint) {
      if (endpoint[1].toLowerCase() === "disconnect")
        return apply((id) => {
          s.ports[id].connected = false;
        });
      if (ids.length !== 1)
        return fail("Connect one endpoint at a time (unique PWWN required).");
      const wwn = endpoint[3].toLowerCase();
      if (!wwnPattern.test(wwn)) return fail("Invalid PWWN.");
      if (
        Object.values(s.ports).some(
          (p) => p.id !== ids[0] && p.connected && p.wwn === wwn,
        )
      )
        return fail("PWWN already connected to another port.");
      return apply((id) => {
        s.ports[id].connected = true;
        s.ports[id].wwn = wwn;
        s.ports[id].role =
          endpoint[2][0].toUpperCase() + endpoint[2].slice(1).toLowerCase();
      });
    }
    if (raw === "shutdown" || raw === "no shutdown")
      return apply((id) => {
        s.ports[id].adminDown = raw === "shutdown";
        s.logs.push(
          `%PORT-5-IF_${raw === "shutdown" ? "DOWN" : "UP"}: ${id} administratively ${raw === "shutdown" ? "disabled" : "enabled"}`,
        );
      });
    if (raw === "no description")
      return apply((id) => {
        s.ports[id].description = "";
      });
    const desc = raw.match(/^description (.+)$/);
    if (desc)
      return apply((id) => {
        s.ports[id].description = desc[1].slice(0, 160);
      });
    const mode = raw.match(/^switchport mode (F|E|auto)$/i);
    if (mode)
      return apply((id) => {
        s.ports[id].mode =
          mode[1].toLowerCase() === "auto"
            ? "auto"
            : (mode[1].toUpperCase() as "E" | "F");
      });
    const speed = raw.match(/^switchport speed (\d+|auto)$/);
    if (speed) {
      const n = speed[1] === "auto" ? 32 : Number(speed[1]) / 1000;
      if (![2, 4, 8, 16, 32].includes(n))
        return fail("Supported speeds: auto, 2000, 4000, 8000, 16000, 32000.");
      return apply((id) => {
        s.ports[id].speed = n;
        s.ports[id].speedAuto = speed[1] === "auto";
      });
    }
    const trunk = raw.match(/^switchport trunk mode (on|off|auto)$/);
    if (trunk)
      return apply((id) => {
        s.ports[id].trunk = trunk[1] !== "off";
      });
    const allowed = raw.match(
      /^switchport trunk allowed vsan (?:(add|remove) )?(\S+)$/,
    );
    if (allowed) {
      const list = resolveVsanList(allowed[2]);
      if (!list)
        return fail(
          "Invalid VSAN list. Use IDs, ranges or comma-separated IDs.",
        );
      return apply((id) => {
        const p = s.ports[id];
        p.allowedVsans =
          allowed[1] === "add"
            ? [...new Set([...p.allowedVsans, ...list])].sort((a, b) => a - b)
            : allowed[1] === "remove"
              ? p.allowedVsans.filter((v) => !list.includes(v))
              : list;
      });
    }
    const channel = raw.match(/^(no )?channel-group (\d+)(?: force)?$/);
    if (channel) {
      const n = Number(channel[2]);
      if (n < 1 || n > 256) return fail("Port-channel ID must be 1-256.");
      return apply((id) => {
        s.ports[id].portChannel = channel[1] ? null : n;
      });
    }
  }
  if (current.mode === "vsan") {
    const v = raw.match(
      /^(no )?vsan (\d+)(?: (name) (\S+)| (interface) (.+)| (suspend))?$/,
    );
    if (v) {
      const [, no, id, , name, , portRange, suspended] = v,
        n = Number(id);
      if (!validVsan(n))
        return fail("VSAN ID must be 1-4093 (4079 is reserved).");
      if (no && !s.vsans[n]) return fail(`VSAN ${n} does not exist.`);
      if (no && !suspended && !portRange) {
        if (n === 1) return fail("Default VSAN 1 cannot be deleted.");
        delete s.vsans[n];
        Object.values(s.ports).forEach((p) => {
          if (p.vsan === n) p.vsan = 1;
        });
        Object.keys(s.zones)
          .filter((k) => k.startsWith(`${n}:`))
          .forEach((k) => delete s.zones[k]);
        Object.keys(s.zoneSets)
          .filter((k) => k.startsWith(`${n}:`))
          .forEach((k) => delete s.zoneSets[k]);
        Object.keys(s.aliases)
          .filter((k) => k.startsWith(`${n}:`))
          .forEach((k) => delete s.aliases[k]);
        delete s.activeZoneSets[n];
        return configChanged();
      }
      const ids = portRange ? resolvePorts(s, portRange) : [];
      if (!ids) return fail("Invalid interface range.");
      if (name && !validName(name)) return fail("Invalid VSAN name.");
      s.vsans[n] ??= {
        id: n,
        name: `VSAN${n.toString().padStart(4, "0")}`,
        suspended: false,
        domain: s.model === "9710" ? 1 : 2,
        priority: s.fcdomainPriority,
        defaultZone: "deny",
      };
      if (name) s.vsans[n].name = name;
      if (suspended) s.vsans[n].suspended = !no;
      ids.forEach((id) => {
        s.ports[id].vsan = no ? 1 : n;
      });
      return configChanged();
    }
  }
  if (current.mode === "zone" || current.mode === "fcalias") {
    const member = raw.match(
      /^(no )?member (pwwn|fcid|fcalias|device-alias|interface) (\S+)$/,
    );
    if (member) {
      const [, no, type, value] = member;
      if (current.mode === "fcalias" && type !== "pwwn")
        return fail("FC aliases support pwwn members in this lab.");
      if (type === "pwwn" && !wwnPattern.test(value))
        return fail("Invalid pWWN. Expected xx:xx:xx:xx:xx:xx:xx:xx.");
      if (type === "fcid" && !/^0x[\da-f]{6}$/i.test(value))
        return fail("Invalid FCID. Expected 0xXXXXXX.");
      if (type === "interface" && !s.ports[value])
        return fail("Interface does not exist.");
      if (["fcalias", "device-alias"].includes(type) && !validName(value))
        return fail("Invalid alias name.");
      const z = (current.mode === "zone" ? s.zones : s.aliases)[current.key!];
      const text = `${type} ${["pwwn", "fcid"].includes(type) ? value.toLowerCase() : value}`;
      z.members = z.members.filter((m) => m !== text);
      if (!no) z.members.push(text);
      return configChanged();
    }
  }
  if (current.mode === "zoneset") {
    const m = raw.match(/^(no )?member (\S+)$/);
    if (m) {
      const zs = s.zoneSets[current.key!];
      if (!s.zones[zoneKey(m[2], zs.vsan)] && !m[1])
        return fail("Zone does not exist in this VSAN.");
      zs.members = zs.members.filter((n) => n !== m[2]);
      if (!m[1]) zs.members.push(m[2]);
      return configChanged();
    }
  }
  if (current.mode === "device-alias") {
    const m = raw.match(/^(no )?device-alias name (\S+)(?: pwwn (\S+))?$/);
    if (m) {
      if (!validName(m[2])) return fail("Invalid alias name.");
      if (!m[1] && (!m[3] || !wwnPattern.test(m[3])))
        return fail("Invalid pWWN.");
      s.pendingAliases[m[2]] = m[1] ? "" : m[3].toLowerCase();
      return done();
    }
  }
  return fail(
    `Invalid or unsupported command: ${raw}. Type ? for commands in this mode.`,
  );
}
