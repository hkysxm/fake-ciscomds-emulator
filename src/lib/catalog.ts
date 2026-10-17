import type { Session } from "./model";
import { context } from "./model";
export const SHOW_COMMANDS = [
  "show version",
  "show switchname",
  "show module",
  "show inventory",
  "show hardware",
  "show clock",
  "show system uptime",
  "show environment",
  "show environment temperature",
  "show environment power",
  "show environment fan",
  "show interface brief",
  "show interface status",
  "show interface description",
  "show interface counters",
  "show interface fc1/1",
  "show interface fc1/1 counters",
  "show interface fc1/1 counters detailed",
  "show interface fc1/1 transceiver details",
  "show interface trunk",
  "show interface mgmt0",
  "show port-channel summary",
  "show port-channel database",
  "show vsan",
  "show vsan membership",
  "show vsan 10",
  "show flogi database",
  "show fcns database",
  "show fcns database detail",
  "show fcdomain",
  "show fcdomain domain-list",
  "show topology",
  "show fspf",
  "show fspf database",
  "show fcroute",
  "show zone",
  "show zone active",
  "show zone status",
  "show zone member",
  "show zoneset",
  "show zoneset active",
  "show fcalias",
  "show device-alias database",
  "show device-alias pending",
  "show device-alias status",
  "show running-config",
  "show startup-config",
  "show feature",
  "show logging logfile",
  "show logging last 20",
  "show processes cpu",
  "show processes memory",
  "show system resources",
  "show users",
  "show user-account",
  "show ntp peers",
  "show ntp peer-status",
  "show ip interface brief",
  "show ip route",
  "show snmp",
  "show license usage",
  "show cores",
  "show tech-support",
  "show lab",
];
export const CONFIG_COMMANDS = [
  "configure terminal",
  "interface fc1/1",
  "interface fc1/1-4",
  "interface port-channel 1",
  "interface mgmt0",
  "vsan database",
  "zone name <name> vsan <id>",
  "zoneset name <name> vsan <id>",
  "zoneset activate name <name> vsan <id>",
  "no zoneset activate name <name> vsan <id>",
  "zoneset distribute full vsan <id>",
  "zone default-zone permit vsan <id>",
  "fcalias name <name> vsan <id>",
  "device-alias database",
  "device-alias commit",
  "hostname <name>",
  "switchname <name>",
  "feature npiv",
  "feature fport-channel-trunk",
  "no feature npiv",
  "fcdomain domain <id> static vsan <id>",
  "fcdomain priority <priority> vsan <id>",
  "ntp server <address>",
  "ip default-gateway <address>",
  "snmp-server location <text>",
  "snmp-server contact <text>",
  "exit",
  "end",
  "copy running-config startup-config",
  "write memory",
];
const modeCommands: Record<string, string[]> = {
  interface: [
    "description <text>",
    "switchport mode F",
    "switchport mode E",
    "switchport mode auto",
    "switchport speed 32000",
    "switchport trunk mode on",
    "switchport trunk allowed vsan <list>",
    "switchport trunk allowed vsan add <list>",
    "switchport trunk allowed vsan remove <list>",
    "channel-group <id> force",
    "shutdown",
    "no shutdown",
    "no description",
    "no channel-group <id>",
    "ip address <address/prefix>",
    "exit",
    "end",
  ],
  vsan: [
    "vsan <id>",
    "vsan <id> name <name>",
    "vsan <id> interface fc1/1",
    "vsan <id> suspend",
    "no vsan <id>",
    "no vsan <id> suspend",
    "exit",
    "end",
  ],
  zone: [
    "member pwwn <wwn>",
    "member fcalias <name>",
    "member device-alias <name>",
    "member fcid <fcid>",
    "no member pwwn <wwn>",
    "exit",
    "end",
  ],
  fcalias: ["member pwwn <wwn>", "no member pwwn <wwn>", "exit", "end"],
  zoneset: ["member <zone-name>", "no member <zone-name>", "exit", "end"],
  "device-alias": [
    "device-alias name <name> pwwn <wwn>",
    "no device-alias name <name>",
    "exit",
    "end",
  ],
};
export const commandGroups = [
  {
    name: "设备与接口",
    commands: [
      "show version",
      "show module",
      "show interface brief",
      "show interface fc1/1",
      "show interface fc1/1 counters detailed",
      "show interface fc1/1 transceiver details",
      "show environment",
    ],
  },
  {
    name: "Fabric 与 VSAN",
    commands: [
      "show vsan",
      "show vsan membership",
      "show flogi database",
      "show fcns database",
      "show fcdomain domain-list",
      "show topology",
      "show fspf",
      "show port-channel summary",
    ],
  },
  {
    name: "Zoning",
    commands: [
      "show zone",
      "show zone active vsan 10",
      "show zoneset active",
      "show device-alias database",
      "show zone status",
    ],
  },
  {
    name: "配置与排障",
    commands: [
      "configure terminal",
      "show running-config",
      "show startup-config",
      "copy running-config startup-config",
      "show logging last 20",
      "show lab",
    ],
  },
];
export function suggestions(session: Session): string[] {
  const mode = context(session).mode;
  if (mode === "exec")
    return [
      ...SHOW_COMMANDS,
      "configure terminal",
      "copy running-config startup-config",
      "write memory",
      "clear counters interface fc1/1",
      "clear interface fc1/1 counters",
      "terminal length 0",
      "terminal width 120",
      "ping <address>",
      "fcping pwwn <wwn> vsan <id>",
      "traceroute <address>",
      "clear logging logfile",
      "clear zone database vsan <id>",
      "clear lab faults",
      "lab fault <id> interface fc1/1",
      "reload",
      "exit",
      "help",
    ];
  return [...(modeCommands[mode] ?? CONFIG_COMMANDS), ...SHOW_COMMANDS];
}
const dictionary: Record<string, string[]> = {
  root: [
    "show",
    "configure",
    "interface",
    "vsan",
    "zone",
    "zoneset",
    "fcalias",
    "device-alias",
    "fcdomain",
    "hostname",
    "switchname",
    "feature",
    "no",
    "end",
    "exit",
    "shutdown",
    "switchport",
    "description",
    "member",
    "copy",
    "write",
    "clear",
    "terminal",
    "ping",
    "fcping",
    "traceroute",
    "reload",
    "help",
    "ntp",
    "ip",
    "snmp-server",
    "channel-group",
    "lab",
  ],
  show: [
    "version",
    "switchname",
    "module",
    "inventory",
    "hardware",
    "clock",
    "system",
    "environment",
    "interface",
    "port-channel",
    "vsan",
    "flogi",
    "fcns",
    "fcdomain",
    "topology",
    "fspf",
    "fcroute",
    "zone",
    "zoneset",
    "fcalias",
    "device-alias",
    "running-config",
    "startup-config",
    "feature",
    "logging",
    "processes",
    "users",
    "user-account",
    "ntp",
    "ip",
    "snmp",
    "license",
    "cores",
    "tech-support",
    "lab",
  ],
  no: [
    "shutdown",
    "description",
    "feature",
    "member",
    "zone",
    "zoneset",
    "fcalias",
    "vsan",
    "channel-group",
    "device-alias",
    "ntp",
  ],
  zone: ["name", "default-zone"],
  zoneset: ["name", "activate", "distribute"],
  fcalias: ["name"],
  member: ["pwwn", "fcid", "fcalias", "device-alias", "interface"],
  "no member": ["pwwn", "fcid", "fcalias", "device-alias", "interface"],
  configure: ["terminal"],
  switchport: ["mode", "speed", "trunk"],
  "switchport trunk": ["mode", "allowed"],
  "switchport trunk allowed": ["vsan"],
  "show interface": [
    "brief",
    "status",
    "description",
    "counters",
    "trunk",
    "mgmt0",
  ],
  "show zone": ["active", "status", "member", "name"],
  "show zoneset": ["active", "name"],
  "show device-alias": ["database", "pending", "status"],
  "show flogi": ["database"],
  "show fcns": ["database"],
  "show fcdomain": ["domain-list"],
  "show logging": ["logfile", "last"],
  "show environment": ["temperature", "power", "fan"],
  "show processes": ["cpu", "memory"],
  "show system": ["resources", "uptime"],
  "show ntp": ["peers", "peer-status"],
  "show ip": ["interface", "route"],
  copy: ["running-config"],
  "copy running-config": ["startup-config"],
  write: ["memory"],
};
export function expandCommand(input: string): {
  command: string;
  error?: string;
} {
  const words = input.trim().split(/\s+/);
  if (words[0]?.toLowerCase() === "sh") words[0] = "show";
  const expanded: string[] = [];
  for (const word of words) {
    const prefix = expanded.join(" ");
    const options =
      dictionary[prefix || "root"] ??
      (/^show interface fc\d+\/\d+$/i.test(prefix)
        ? ["counters", "transceiver", "brief"]
        : /^show interface fc\d+\/\d+ counters$/i.test(prefix)
          ? ["detailed"]
          : /^show interface fc\d+\/\d+ transceiver$/i.test(prefix)
            ? ["details"]
            : undefined);
    if (!options || options.includes(word.toLowerCase())) {
      expanded.push(options ? word.toLowerCase() : word);
      continue;
    }
    const matches = options.filter((v) => v.startsWith(word.toLowerCase()));
    if (matches.length > 1)
      return { command: input, error: `% Ambiguous command: "${input}"` };
    expanded.push(matches[0] ?? word);
  }
  return { command: expanded.join(" ") };
}
export function complete(
  input: string,
  session: Session,
): { value: string; options: string[] } {
  const expanded = expandCommand(input).command;
  const matches = suggestions(session).filter((c) =>
    c.toLowerCase().startsWith(expanded.toLowerCase()),
  );
  if (matches.length === 1 && !matches[0].includes("<"))
    return { value: matches[0], options: [] };
  if (!matches.length) return { value: input, options: [] };
  let common = matches[0];
  for (const c of matches) {
    while (!c.startsWith(common)) common = common.slice(0, -1);
  }
  return {
    value:
      common.length > expanded.length && !common.includes("<") ? common : input,
    options: matches,
  };
}
