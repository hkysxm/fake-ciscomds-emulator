import type { ConfigSnapshot, SwitchState, Zone } from "./model";
import {
  fcid,
  hasFault,
  isUp,
  operationalMode,
  portStatus,
  zoneKey,
} from "./model";
const pad = (v: string | number, n: number) => String(v).padEnd(n);
export const table = (
  headers: string[],
  rows: (string | number)[][],
  widths: number[],
) =>
  [
    headers.map((h, i) => pad(h, widths[i])).join(" "),
    widths.map((w) => "-".repeat(w)).join(" "),
    ...rows.map((r) => r.map((v, i) => pad(v, widths[i])).join(" ")),
  ].join("\n");
export function runningConfig(s: ConfigSnapshot) {
  const lines = [
    "!Command: show running-config",
    "!Time: configuration snapshot",
    "version 9.4(2)",
    `hostname ${s.hostname}`,
    "",
    ...s.features.map((f) => `feature ${f}`),
    "",
    `ip default-gateway ${s.gateway}`,
    "interface mgmt0",
    `  ip address ${s.mgmtIp}`,
    "  no shutdown",
    "",
    "vsan database",
  ];
  for (const v of Object.values(s.vsans)) {
    lines.push(`  vsan ${v.id} name ${v.name}`);
    if (v.suspended) lines.push(`  vsan ${v.id} suspend`);
  }
  for (const p of Object.values(s.ports)) {
    if (
      !p.description &&
      p.mode === "F" &&
      p.speed === 32 &&
      !p.adminDown &&
      p.vsan === 1 &&
      !p.trunk &&
      !p.portChannel
    )
      continue;
    lines.push("", `interface ${p.id}`);
    if (p.description) lines.push(`  description ${p.description}`);
    lines.push(
      `  switchport mode ${p.mode}`,
      `  switchport speed ${p.speed * 1000}`,
    );
    if (p.trunk)
      lines.push(
        "  switchport trunk mode on",
        `  switchport trunk allowed vsan ${p.allowedVsans.join(",")}`,
      );
    if (p.portChannel) lines.push(`  channel-group ${p.portChannel} force`);
    lines.push(`  ${p.adminDown ? "" : "no "}shutdown`);
  }
  lines.push("", "vsan database");
  Object.values(s.ports)
    .filter((p) => p.vsan !== 1)
    .forEach((p) => lines.push(`  vsan ${p.vsan} interface ${p.id}`));
  lines.push("", "device-alias database");
  Object.entries(s.deviceAliases).forEach(([name, wwn]) =>
    lines.push(`  device-alias name ${name} pwwn ${wwn}`),
  );
  lines.push("device-alias commit");
  Object.values(s.aliases).forEach((a) => {
    lines.push("", `fcalias name ${a.name} vsan ${a.vsan}`);
    a.members.forEach((m) => lines.push(`  member ${m}`));
  });
  Object.values(s.zones).forEach((z) => {
    lines.push("", `zone name ${z.name} vsan ${z.vsan}`);
    z.members.forEach((m) => lines.push(`  member ${m}`));
  });
  Object.values(s.zoneSets).forEach((z) => {
    lines.push("", `zoneset name ${z.name} vsan ${z.vsan}`);
    z.members.forEach((m) => lines.push(`  member ${m}`));
  });
  Object.entries(s.activeZoneSets).forEach(([v, z]) =>
    lines.push(`zoneset activate name ${z.name} vsan ${v}`),
  );
  Object.values(s.vsans).forEach((v) => {
    lines.push(`fcdomain domain ${v.domain} static vsan ${v.id}`);
    if (v.priority !== 128)
      lines.push(`fcdomain priority ${v.priority} vsan ${v.id}`);
    if (v.defaultZone === "permit")
      lines.push(`zone default-zone permit vsan ${v.id}`);
  });
  s.ntpServers.forEach((n) => lines.push(`ntp server ${n}`));
  if (s.snmpLocation) lines.push(`snmp-server location ${s.snmpLocation}`);
  if (s.snmpContact) lines.push(`snmp-server contact ${s.snmpContact}`);
  return lines.join("\n");
}
function formatZone(z: Zone) {
  return [
    `zone name ${z.name} vsan ${z.vsan}`,
    ...z.members.map((m) => `    ${m}`),
  ].join("\n");
}
export function show(s: SwitchState, cmd: string): string | null {
  const raw = cmd.slice(5).trim();
  const vsanMatch = raw.match(/\bvsan (\d+)\b/);
  const vsan = vsanMatch ? Number(vsanMatch[1]) : undefined;
  const q = raw.replace(/\s+vsan \d+\b/g, "").trim();
  const ports = Object.values(s.ports);
  const selected = ports.filter((p) => vsan === undefined || p.vsan === vsan);
  const vsans = Object.values(s.vsans).filter(
    (v) => vsan === undefined || v.id === vsan,
  );
  if (
    vsan !== undefined &&
    !s.vsans[vsan] &&
    !["zone", "zone active", "zoneset", "zoneset active"].includes(q)
  )
    return `% VSAN ${vsan} does not exist`;
  if (q === "switchname") return s.hostname;
  if (q === "version")
    return `Cisco Nexus Operating System (NX-OS) Software\nTAC support: http://www.cisco.com/tac\nCopyright (c) 2002-2025, Cisco Systems, Inc. All rights reserved.\n\nSoftware\n  BIOS:      version 3.5.0\n  system:    version 9.4(2)\n  system image file is: bootflash:///m9700-sf4ek9-mz.9.4.2.bin\n\nHardware\n  cisco MDS ${s.model} (${s.model === "9710" ? "10 Slot Chassis" : "96-port 32G Fibre Channel"})\n  Intel(R) CPU with 16384 MB of memory\n  Processor Board ID ${s.serial}\n  Device name: ${s.hostname}\n  bootflash: 4000000 kB\n\nKernel uptime is 0 day(s), 4 hour(s), 12 minute(s)\nLast reset reason: Supervisor reset\n\n  [MDS Lab: local simulation · no physical hardware]`;
  if (q === "module")
    return table(
      ["Mod", "Ports", "Module-Type", "Model", "Status"],
      s.model === "9710"
        ? [
            [1, 48, "48-port 32 Gbps Fibre Channel", "DS-X9648-1536K9", "ok"],
            [2, 48, "48-port 32 Gbps Fibre Channel", "DS-X9648-1536K9", "ok"],
            [5, 0, "Supervisor Module-4", "DS-X97-SF4-K9", "active *"],
            [6, 0, "Supervisor Module-4", "DS-X97-SF4-K9", "ha-standby"],
          ]
        : [
            [
              1,
              96,
              "96-port 32 Gbps Fibre Channel",
              "DS-C9396T-K9",
              "active *",
            ],
          ],
      [4, 6, 36, 22, 12],
    );
  if (q === "inventory" || q === "hardware")
    return `NAME: "Chassis", DESCR: "MDS ${s.model} chassis"\nPID: ${s.model === "9710" ? "DS-C9710" : "DS-C9396T-K9"}, VID: V01, SN: ${s.serial}\n\n${s.model === "9710" ? 'NAME: "Slot 1", DESCR: "48-port 32G Fibre Channel Module"\nPID: DS-X9648-1536K9, VID: V01, SN: JAE21490101' : 'NAME: "Slot 1", DESCR: "96-port 32G Fibre Channel Switch"\nPID: DS-C9396T-K9, VID: V01, SN: JAE22510B02'}`;
  if (q === "clock")
    return new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  if (q === "system uptime")
    return "System start time: 00:00:00 UTC\nSystem uptime: 0 days, 4 hours, 12 minutes (simulated)";
  if (q.startsWith("environment")) {
    if (
      ![
        "environment",
        "environment temperature",
        "environment power",
        "environment fan",
      ].includes(q)
    )
      return null;
    const temp = table(
      ["Module", "Sensor", "MajorThresh", "MinorThres", "CurTemp", "Status"],
      [
        [1, "Intake", "75 C", "60 C", "28 C", "Ok"],
        [1, "Outlet", "85 C", "70 C", "37 C", "Ok"],
      ],
      [7, 15, 12, 12, 10, 8],
    );
    const power = table(
      ["PS", "Model", "Power (Watts)", "Status"],
      [
        [1, "DS-CAC-3000W", 3000, "Ok"],
        [2, "DS-CAC-3000W", 3000, "Ok"],
      ],
      [4, 22, 16, 10],
    );
    const fan = table(
      ["Fan", "Model", "Direction", "Status"],
      [
        [1, "DS-C9710-FAN", "Front-to-Back", "Ok"],
        [2, "DS-C9710-FAN", "Front-to-Back", "Ok"],
      ],
      [4, 22, 18, 10],
    );
    return q.endsWith("temperature")
      ? temp
      : q.endsWith("power")
        ? power
        : q.endsWith("fan")
          ? fan
          : `${temp}\n\n${power}\n\n${fan}`;
  }
  if (q === "interface brief" || q === "interface status")
    return (
      table(
        [
          "Interface",
          "Vsan",
          "Admin",
          "Admin",
          "Status",
          "SFP",
          "Oper",
          "Oper",
          "Port",
        ],
        selected.map((p) => [
          p.id,
          p.vsan,
          p.mode,
          p.trunk ? "on" : "off",
          portStatus(s, p),
          hasFault(s, "sfp-missing", p.id) ? "absent" : "sfp",
          isUp(s, p) ? operationalMode(p) : "--",
          isUp(s, p) ? `${p.speed}G` : "--",
          p.portChannel ?? "--",
        ]),
        [10, 5, 6, 6, 23, 7, 5, 7, 5],
      ) + "\n\nAdmin: mode / trunk   Oper: mode / speed"
    );
  if (q === "interface description")
    return table(
      ["Interface", "Description"],
      selected.map((p) => [p.id, p.description || "--"]),
      [14, 50],
    );
  if (q === "interface counters")
    return table(
      ["Interface", "Rx bytes", "Tx bytes", "CRC errors"],
      selected.map((p) => [
        p.id,
        p.rx,
        p.tx,
        p.crc + (hasFault(s, "crc-errors", p.id) ? 427 : 0),
      ]),
      [12, 17, 17, 12],
    );
  if (q === "interface trunk")
    return table(
      ["Interface", "Mode", "Status", "Allowed VSANs", "Active VSANs"],
      ports
        .filter((p) => p.trunk)
        .map((p) => [
          p.id,
          "on",
          isUp(s, p) ? "trunking" : portStatus(s, p),
          p.allowedVsans.join(","),
          p.allowedVsans
            .filter((v) => s.vsans[v] && !s.vsans[v].suspended)
            .join(","),
        ]),
      [12, 8, 24, 20, 20],
    );
  if (q === "interface mgmt0")
    return `mgmt0 is up\n  Hardware: Ethernet, address: 000d.ec97.1000\n  Internet Address is ${s.mgmtIp}\n  MTU 1500 bytes, BW 1000000 Kbit\n  Full-duplex, 1000 Mb/s`;
  const int = q.match(
    /^interface (fc\d+\/\d+)(?: (counters(?: detailed)?|transceiver(?: details)?|brief))?$/i,
  );
  if (int) {
    const p = s.ports[int[1].toLowerCase()];
    if (!p) return `% Interface ${int[1]} does not exist`;
    const status = portStatus(s, p),
      crc = p.crc + (hasFault(s, "crc-errors", p.id) ? 427 : 0);
    if (int[2]?.startsWith("transceiver"))
      return hasFault(s, "sfp-missing", p.id)
        ? `${p.id}\n  sfp is not present`
        : `${p.id}\n  sfp is present\n  Name is CISCO-AVAGO\n  Part Number is AFBR-57G5MZ-CS1\n  Type is 32G FC Shortwave\n  Wavelength is 850 nm\n  Cisco pid is DS-SFP-FC32G-SW\n  Temperature: 35.20 C\n  Voltage: 3.30 V\n  Current: 6.10 mA\n  Tx Power: -2.30 dBm\n  Rx Power: ${hasFault(s, "link-down", p.id) ? "-40.00" : hasFault(s, "crc-errors", p.id) ? "-13.50" : "-3.10"} dBm`;
    if (int[2]?.startsWith("counters"))
      return `${p.id}\n  ${p.rx} bytes input, ${Math.floor(p.rx / 2048)} frames input\n  ${p.tx} bytes output, ${Math.floor(p.tx / 2048)} frames output\n  ${crc} CRC errors, ${crc ? 12 : 0} invalid transmission words\n  ${hasFault(s, "link-down", p.id) ? 1 : 0} link failures, 0 loss of sync, 0 loss of signal\n  ${hasFault(s, "credit-starvation", p.id) ? 18204 : 0} TxWait (2.5us ticks)\n  ${hasFault(s, "credit-starvation", p.id) ? 342 : 0} credit loss recoveries\n  ${hasFault(s, "credit-starvation", p.id) ? 0 : 16} transmit B2B credits remaining\n  ${hasFault(s, "credit-starvation", p.id) ? 9832 : 0} transmit discards\n  0 input OLS, 0 output OLS\n  ${crc} input errors, 0 output errors`;
    return `${p.id} is ${isUp(s, p) ? "up" : "down"} (${status})\n  ${p.description ? `Description: ${p.description}\n  ` : ""}Hardware is Fibre Channel, SFP is ${hasFault(s, "sfp-missing", p.id) ? "absent" : "short wave laser"}\n  Port WWN is 20:${(parseInt(fcid(s, p).slice(4, 6), 16) + 1).toString(16).padStart(2, "0")}:${s.wwn.slice(6)}\n  Admin port mode is ${p.mode}, trunk mode is ${p.trunk ? "on" : "off"}\n  snmp link state traps are enabled\n  Port mode is ${isUp(s, p) ? operationalMode(p) : "--"}, FCID is ${fcid(s, p)}\n  Port vsan is ${p.vsan}\n  Speed is ${isUp(s, p) ? `${p.speed} Gbps` : "auto"}\n  Beacon is turned off\n  Transmit B2B Credit is ${hasFault(s, "credit-starvation", p.id) ? 0 : 16}\n  Receive B2B Credit is 16\n  MTU 2112 bytes\n  5 minutes input rate ${isUp(s, p) ? "124928" : "0"} bits/sec\n  5 minutes output rate ${isUp(s, p) ? "248832" : "0"} bits/sec\n  ${p.rx} bytes input, ${p.tx} bytes output\n  ${crc} CRC errors`;
  }
  if (q === "vsan" || /^vsan \d+$/.test(q)) {
    const id = q.match(/^vsan (\d+)$/)?.[1];
    const list = id ? vsans.filter((v) => v.id === Number(id)) : vsans;
    return list.length
      ? list
          .map(
            (v) =>
              `vsan ${v.id} information\n  name: ${v.name}\n  state: ${v.suspended ? "suspended" : "active"}\n  interoperability mode: default\n  loadbalancing: src-id/dst-id/oxid\n  operational state: ${v.suspended ? "down" : "up"}`,
          )
          .join("\n\n")
      : `% VSAN ${id} does not exist`;
  }
  if (q === "vsan membership")
    return vsans
      .map(
        (v) =>
          `vsan ${v.id} interfaces:\n  ${
            ports
              .filter((p) => p.vsan === v.id)
              .map((p) => p.id)
              .join("  ") || "(none)"
          }`,
      )
      .join("\n\n");
  if (/^flogi database(?: interface fc\d+\/\d+)?$/.test(q)) {
    const filter = q.match(/interface (fc\d+\/\d+)/)?.[1];
    const p = selected.filter(
      (p) =>
        isUp(s, p) &&
        operationalMode(p) === "F" &&
        (!filter || p.id === filter),
    );
    return (
      table(
        ["INTERFACE", "VSAN", "FCID", "PORT NAME", "NODE NAME"],
        p.map((p) => [
          p.id,
          p.vsan,
          fcid(s, p),
          p.wwn,
          p.wwn.replace(/^21:/, "20:"),
        ]),
        [12, 6, 10, 25, 25],
      ) + `\n\nTotal number of flogi = ${p.length}.`
    );
  }
  if (q === "fcns database" || q === "fcns database detail") {
    const p = selected.filter((p) => isUp(s, p) && operationalMode(p) === "F");
    return q.endsWith("detail")
      ? p
          .map(
            (p) =>
              `VSAN: ${p.vsan}, FCID: ${fcid(s, p)}\n  port-wwn: ${p.wwn}\n  node-wwn: ${p.wwn.replace(/^21:/, "20:")}\n  FC4-types: scsi-fcp\n  FC4-features: ${p.role.toLowerCase()}\n  symbolic-port-name: ${p.description}`,
          )
          .join("\n\n") || "No entries found."
      : table(
          ["FCID", "TYPE", "PWWN", "FC4-TYPE:FEATURE", "VSAN"],
          p.map((p) => [
            fcid(s, p),
            "N",
            p.wwn,
            `scsi-fcp:${p.role.toLowerCase()}`,
            p.vsan,
          ]),
          [10, 6, 25, 24, 6],
        ) + `\n\nTotal number of entries = ${p.length}`;
  }
  if (q === "fcdomain" || q === "fcdomain domain-list")
    return vsans
      .map((v) =>
        q.endsWith("domain-list")
          ? `VSAN ${v.id}\n${table(
              ["Domain ID", "WWN", "Role"],
              [
                [v.domain, s.wwn, "Local, Principal"],
                [
                  s.model === "9710" ? v.domain + 1 : Math.max(1, v.domain - 1),
                  s.model === "9710"
                    ? "20:00:00:0d:ec:93:96:00"
                    : "20:00:00:0d:ec:97:10:00",
                  "Remote",
                ],
              ],
              [12, 26, 18],
            )}`
          : `The local switch is the Principal Switch.\nVSAN ${v.id}:\n  Local switch WWN: ${s.wwn}\n  Running fabric name: ${s.wwn}\n  Running priority: ${v.priority ?? s.fcdomainPriority}\n  Current domain ID: ${v.domain}\n  State: ${v.suspended ? "Suspended" : "Stable"}`,
      )
      .join("\n\n");
  if (
    q === "topology" ||
    q === "fspf" ||
    q === "fspf database" ||
    q === "fcroute"
  )
    return vsans
      .map(
        (v) =>
          `VSAN ${v.id}\n${table(
            ["Interface", "Peer domain", "State", "Cost"],
            ports
              .filter(
                (p) =>
                  operationalMode(p) === "E" &&
                  p.trunk &&
                  p.allowedVsans.includes(v.id),
              )
              .map((p) => [
                p.id,
                s.model === "9710" ? v.domain + 1 : Math.max(1, v.domain - 1),
                isUp(s, p) && !v.suspended ? "FULL" : "DOWN",
                500,
              ]),
            [14, 14, 12, 8],
          )}`,
      )
      .join("\n\n");
  if (q === "zone" || q === "zone active" || q.startsWith("zone name ")) {
    let z =
      q === "zone active"
        ? Object.values(s.activeZoneSets).flatMap((z) => z.zones)
        : Object.values(s.zones);
    z = z.filter(
      (z) =>
        (vsan === undefined || z.vsan === vsan) &&
        (!q.startsWith("zone name ") || z.name === q.slice(10)),
    );
    return z.map(formatZone).join("\n\n") || "No zones found.";
  }
  if (q === "zone member")
    return (
      Object.values(s.zones)
        .filter((z) => vsan === undefined || z.vsan === vsan)
        .map(formatZone)
        .join("\n\n") || "No zones found."
    );
  if (q === "zone status")
    return vsans
      .map(
        (v) =>
          `VSAN: ${v.id}\n  default-zone: ${v.defaultZone}\n  distribute: active only\n  mode: basic\n  session: none\n  hard-zoning: enabled\n  Full Zoning Database:\n    Zonesets: ${Object.values(s.zoneSets).filter((z) => z.vsan === v.id).length}  Zones: ${Object.values(s.zones).filter((z) => z.vsan === v.id).length}\n  Active Zoning Database:\n    Zoneset: ${s.activeZoneSets[v.id]?.name ?? "none"}  Zones: ${s.activeZoneSets[v.id]?.zones.length ?? 0}\n  Access simulation: ${s.faults.some((f) => f.id === "zoning-block" && s.ports[f.port]?.vsan === v.id) ? "DENIED (injected zoning fault)" : "normal"}`,
      )
      .join("\n\n");
  if (
    q === "zoneset" ||
    q === "zoneset active" ||
    q.startsWith("zoneset name ")
  ) {
    if (q === "zoneset active")
      return (
        Object.entries(s.activeZoneSets)
          .filter(([v]) => vsan === undefined || Number(v) === vsan)
          .map(
            ([v, z]) =>
              `zoneset name ${z.name} vsan ${v}\n${z.zones
                .map((z) =>
                  formatZone(z)
                    .split("\n")
                    .map((l) => `  ${l}`)
                    .join("\n"),
                )
                .join("\n")}`,
          )
          .join("\n\n") || "No active zoneset."
      );
    return (
      Object.values(s.zoneSets)
        .filter(
          (z) =>
            (vsan === undefined || z.vsan === vsan) &&
            (!q.startsWith("zoneset name ") || z.name === q.slice(13)),
        )
        .map(
          (z) =>
            `zoneset name ${z.name} vsan ${z.vsan}\n${z.members.map((m) => `  member ${m}${s.zones[zoneKey(m, z.vsan)] ? "" : " (not defined)"}`).join("\n")}`,
        )
        .join("\n\n") || "No zonesets found."
    );
  }
  if (q === "fcalias" || q.startsWith("fcalias name "))
    return (
      Object.values(s.aliases)
        .filter(
          (a) =>
            (vsan === undefined || a.vsan === vsan) &&
            (!q.startsWith("fcalias name ") || a.name === q.slice(13)),
        )
        .map(
          (a) =>
            `fcalias name ${a.name} vsan ${a.vsan}\n${a.members.map((m) => `  member ${m}`).join("\n")}`,
        )
        .join("\n\n") || "No fcalias configured."
    );
  if (q === "device-alias database")
    return (
      Object.entries(s.deviceAliases)
        .map(([name, wwn]) => `device-alias name ${name} pwwn ${wwn}`)
        .join("\n") +
      `\n\nTotal number of entries: ${Object.keys(s.deviceAliases).length}`
    );
  if (q === "device-alias pending")
    return (
      Object.entries(s.pendingAliases)
        .map(([name, wwn]) =>
          wwn
            ? `device-alias name ${name} pwwn ${wwn}`
            : `no device-alias name ${name}`,
        )
        .join("\n") || "No pending changes."
    );
  if (q === "device-alias status")
    return `Device-alias mode: basic\nDevice-alias distribution: enabled\nDatabase entries: ${Object.keys(s.deviceAliases).length}\nPending changes: ${Object.keys(s.pendingAliases).length}`;
  if (q === "running-config") return runningConfig(s);
  if (q === "startup-config")
    return s.saved
      ? runningConfig(s.saved).replace(
          "show running-config",
          "show startup-config",
        )
      : "Startup configuration is empty.";
  if (q.startsWith("running-config ")) {
    const section = q.slice(15);
    if (section.startsWith("interface ")) {
      const name = section.slice(10);
      const lines = runningConfig(s).split("\n");
      const start = lines.findIndex((l) => l === `interface ${name}`);
      if (start < 0) return `! No non-default configuration for ${name}`;
      const end = lines.findIndex(
        (l, i) => i > start && l && !l.startsWith(" "),
      );
      return lines.slice(start, end < 0 ? undefined : end).join("\n");
    }
    if (
      ["zone", "zoneset", "vsan", "device-alias", "fcalias"].includes(section)
    )
      return runningConfig(s)
        .split("\n")
        .filter((l) => l.startsWith(section) || l.startsWith("  "))
        .join("\n");
    return null;
  }
  if (q === "feature")
    return table(
      ["Feature Name", "Instance", "State"],
      [
        "npiv",
        "npv",
        "fport-channel-trunk",
        "telnet",
        "ssh",
        "analytics",
        "fabric-binding",
      ].map((f) => [
        f,
        1,
        s.features.includes(f) || f === "ssh" ? "enabled" : "disabled",
      ]),
      [26, 12, 12],
    );
  if (
    q === "logging logfile" ||
    q === "logging" ||
    /^logging last \d+$/.test(q)
  )
    return (
      s.logs.slice(-Number(q.match(/last (\d+)/)?.[1] ?? 100)).join("\n") ||
      "Log is empty."
    );
  if (q === "port-channel summary" || q === "port-channel database") {
    const ids = [
      ...new Set(
        ports.map((p) => p.portChannel).filter((x): x is number => x !== null),
      ),
    ];
    return `Flags: U - Up, D - Down, P - Up in port-channel\n\n${table(
      ["Group", "Port-channel", "Protocol", "Ports"],
      ids.map((id) => [
        id,
        `port-channel${id}(${ports.some((p) => p.portChannel === id && isUp(s, p)) ? "SU" : "SD"})`,
        "NONE",
        ports
          .filter((p) => p.portChannel === id)
          .map((p) => `${p.id}(${isUp(s, p) ? "P" : "D"})`)
          .join(" "),
      ]),
      [8, 23, 12, 40],
    )}`;
  }
  if (q === "processes cpu" || q === "system resources")
    return "Load average: 1 minute: 0.08   5 minutes: 0.05   15 minutes: 0.03\nProcesses: 326 total, 1 running\nCPU states: 2.1% user, 1.3% kernel, 96.6% idle\nMemory usage: 16384000K total, 4259840K used, 12124160K free\n\n PID  Runtime(ms)  Invoked  uSecs  1Sec   Process\n 321       10524     2048   5138  0.0%   fcdomain\n 482        8242     1642   5019  0.1%   zone";
  if (q === "processes memory")
    return "Memory usage: 16384000K total, 4259840K used, 12124160K free\n\nPID    MemAlloc    MemUsed    Process\n321    10485760    8388608    fcdomain\n482     8388608    6291456    zone";
  if (q === "users" || q === "user-account")
    return s.users
      .map(
        (u) =>
          `user: ${u}\n  roles: network-admin\n  account status: active (local simulator)`,
      )
      .join("\n\n");
  if (q === "ntp peers" || q === "ntp peer-status")
    return table(
      ["Peer", "Type", "Status"],
      s.ntpServers.map((n) => [n, "configured", "simulated"]),
      [28, 16, 14],
    );
  if (q === "ip interface brief")
    return table(
      ["Interface", "IP Address", "Status"],
      [["mgmt0", s.mgmtIp, "up"]],
      [16, 24, 12],
    );
  if (q === "ip route")
    return `IP Route Table for VRF "management"\n0.0.0.0/0, ubest/mbest: 1/0\n  *via ${s.gateway}, mgmt0, [1/0], static\n${s.mgmtIp}, directly connected, mgmt0`;
  if (q === "snmp")
    return `Location: ${s.snmpLocation}\nContact: ${s.snmpContact || "(not configured)"}\nSNMP agent: enabled (simulated)`;
  if (q === "license usage")
    return table(
      ["Feature", "Ins", "Lic", "Status", "Expiry Date"],
      [
        ["ENTERPRISE_PKG", "Yes", "-", "In use", "Never"],
        ["PORT_ACTIVATION_PKG", "Yes", "-", "In use", "Never"],
      ],
      [26, 5, 5, 16, 16],
    );
  if (q === "cores") return "No cores found.";
  if (q === "tech-support")
    return [
      show(s, "show version"),
      show(s, "show module"),
      show(s, "show interface brief"),
      show(s, "show zone status"),
      show(s, "show logging last 20"),
    ].join("\n\n");
  if (q === "lab")
    return `MDS Lab · ${s.model} · local simulation\nPhysical network I/O: disabled\nActive faults: ${s.faults.length}\n${s.faults.map((f) => `  ${f.port.padEnd(10)} ${f.id}`).join("\n") || "  none"}\n\nFaults: link-down | sfp-missing | crc-errors | credit-starvation | vsan-mismatch | zoning-block\nInject: lab fault <id> interface <fcX/Y>\nRecover: clear lab faults\n\nSupported workflows: interface, VSAN, basic zoning, device-alias,\nFLOGI / FCNS, FSPF, port-channel, configuration persistence.\nHardware, traffic, HA and remote connectivity are simulated.`;
  return null;
}
