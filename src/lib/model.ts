export type Model = "9710" | "9396";
export type FaultId =
  | "link-down"
  | "sfp-missing"
  | "crc-errors"
  | "credit-starvation"
  | "vsan-mismatch"
  | "zoning-block";
export type Port = {
  id: string;
  description: string;
  mode: "auto" | "F" | "E";
  speed: number;
  adminDown: boolean;
  vsan: number;
  trunk: boolean;
  allowedVsans: number[];
  connected: boolean;
  wwn: string;
  role: string;
  rx: number;
  tx: number;
  crc: number;
  portChannel: number | null;
};
export type Zone = { name: string; vsan: number; members: string[] };
export type ZoneSet = { name: string; vsan: number; members: string[] };
export type Vsan = {
  id: number;
  name: string;
  suspended: boolean;
  domain: number;
  priority: number;
  defaultZone: "deny" | "permit";
};
export type Context = {
  mode:
    | "exec"
    | "config"
    | "interface"
    | "vsan"
    | "zone"
    | "zoneset"
    | "fcalias"
    | "device-alias"
    | "fcdomain"
    | "line"
    | "port-channel";
  key?: string;
  vsan?: number;
};
export type Session = { stack: Context[]; history: string[] };
export type Fault = { id: FaultId; port: string };
export type ConfigSnapshot = Pick<
  SwitchState,
  | "hostname"
  | "ports"
  | "vsans"
  | "zones"
  | "zoneSets"
  | "activeZoneSets"
  | "aliases"
  | "deviceAliases"
  | "features"
  | "ntpServers"
  | "snmpLocation"
  | "snmpContact"
  | "mgmtIp"
  | "gateway"
  | "users"
  | "fcdomainPriority"
>;
export type SwitchState = {
  model: Model;
  hostname: string;
  serial: string;
  wwn: string;
  ports: Record<string, Port>;
  vsans: Record<number, Vsan>;
  zones: Record<string, Zone>;
  zoneSets: Record<string, ZoneSet>;
  activeZoneSets: Record<number, { name: string; zones: Zone[] }>;
  aliases: Record<string, Zone>;
  deviceAliases: Record<string, string>;
  pendingAliases: Record<string, string>;
  features: string[];
  ntpServers: string[];
  snmpLocation: string;
  snmpContact: string;
  mgmtIp: string;
  gateway: string;
  users: string[];
  fcdomainPriority: number;
  faults: Fault[];
  logs: string[];
  saved: ConfigSnapshot | null;
  revision: number;
};
export const FAULTS: {
  id: FaultId;
  name: string;
  detail: string;
  command: string;
}[] = [
  {
    id: "link-down",
    name: "链路中断",
    detail: "模拟物理链路断开",
    command: "show interface {port}",
  },
  {
    id: "sfp-missing",
    name: "光模块缺失",
    detail: "模拟 SFP 被拔出",
    command: "show interface {port} transceiver details",
  },
  {
    id: "crc-errors",
    name: "CRC 错误",
    detail: "模拟光路质量下降",
    command: "show interface {port} counters detailed",
  },
  {
    id: "credit-starvation",
    name: "BB Credit 耗尽",
    detail: "模拟缓冲区信用不足",
    command: "show interface {port} counters detailed",
  },
  {
    id: "vsan-mismatch",
    name: "VSAN 不匹配",
    detail: "模拟 VSAN 隔离",
    command: "show interface {port}",
  },
  {
    id: "zoning-block",
    name: "Zoning 阻断",
    detail: "模拟设备间访问被拒绝",
    command: "show zone status",
  },
];
export const zoneKey = (name: string, vsan: number) => `${vsan}:${name}`;
export const freshSession = (): Session => ({
  stack: [{ mode: "exec" }],
  history: [],
});
export const context = (session: Session) =>
  session.stack[session.stack.length - 1];
export function prompt(state: SwitchState, session: Session) {
  const mode = context(session).mode;
  const suffix: Record<Context["mode"], string> = {
    exec: "",
    config: "(config)",
    interface: "(config-if)",
    vsan: "(config-vsan-db)",
    zone: "(config-zone)",
    zoneset: "(config-zoneset)",
    fcalias: "(config-fcalias)",
    "device-alias": "(config-da-db)",
    fcdomain: "(config)",
    line: "(config-line)",
    "port-channel": "(config-if)",
  };
  return `${state.hostname}${suffix[mode]}#`;
}
export function hasFault(s: SwitchState, id: FaultId, port?: string) {
  return s.faults.some((f) => f.id === id && (!port || f.port === port));
}
export function portStatus(s: SwitchState, p: Port) {
  if (p.adminDown) return "administratively down";
  if (hasFault(s, "sfp-missing", p.id)) return "sfpAbsent";
  if (hasFault(s, "link-down", p.id)) return "linkFailure";
  if (s.vsans[p.vsan]?.suspended) return "vsanSuspended";
  if (!s.vsans[p.vsan]) return "vsanInactive";
  if (hasFault(s, "vsan-mismatch", p.id)) return "isolated";
  if (
    p.connected &&
    ((p.mode === "F" && p.role === "Switch") ||
      (p.mode === "E" && ["Initiator", "Target"].includes(p.role)))
  )
    return "incompatibleMode";
  return p.connected ? "up" : "notConnected";
}
export const operationalMode = (p: Port): "F" | "E" =>
  p.mode === "auto" ? (p.role === "Switch" ? "E" : "F") : p.mode;
export const isUp = (s: SwitchState, p: Port) => portStatus(s, p) === "up";
export const snapshot = (s: SwitchState): ConfigSnapshot =>
  structuredClone({
    hostname: s.hostname,
    ports: s.ports,
    vsans: s.vsans,
    zones: s.zones,
    zoneSets: s.zoneSets,
    activeZoneSets: s.activeZoneSets,
    aliases: s.aliases,
    deviceAliases: s.deviceAliases,
    features: s.features,
    ntpServers: s.ntpServers,
    snmpLocation: s.snmpLocation,
    snmpContact: s.snmpContact,
    mgmtIp: s.mgmtIp,
    gateway: s.gateway,
    users: s.users,
    fcdomainPriority: s.fcdomainPriority,
  });
export function createSwitch(model: Model): SwitchState {
  const a = model === "9710";
  const ports: Record<string, Port> = {};
  for (let i = 1; i <= 96; i++) {
    const slot = a ? Math.ceil(i / 48) : 1;
    const index = a ? ((i - 1) % 48) + 1 : i;
    const id = `fc${slot}/${index}`;
    const isl = a ? [47, 48].includes(i) : [95, 96].includes(i);
    ports[id] = {
      id,
      description:
        i === 1
          ? "ESXi-01 / HBA-A"
          : i === 2
            ? "Storage-01 / CTL-A"
            : isl
              ? `ISL to MDS-${a ? "9396" : "9710"}`
              : "",
      mode: isl ? "E" : "F",
      speed: 32,
      adminDown: false,
      vsan: [1, 2].includes(i) ? 10 : 1,
      trunk: isl,
      allowedVsans: [1, 10, 20],
      connected: [1, 2].includes(i) || isl,
      wwn:
        i === 1
          ? "21:00:00:24:ff:01:00:01"
          : i === 2
            ? "50:00:09:73:00:01:00:01"
            : `20:00:00:0d:ec:${a ? "97" : "93"}:00:${i.toString(16).padStart(2, "0")}`,
      role: i === 1 ? "Initiator" : i === 2 ? "Target" : isl ? "Switch" : "—",
      rx: [1, 2].includes(i) ? 1488294612 : isl ? 2564120352 : 0,
      tx: [1, 2].includes(i) ? 2981567088 : isl ? 3820140296 : 0,
      crc: 0,
      portChannel: null,
    };
  }
  const z: Zone = {
    name: "ESXI01_STORAGE01",
    vsan: 10,
    members: ["pwwn 21:00:00:24:ff:01:00:01", "pwwn 50:00:09:73:00:01:00:01"],
  };
  const s: SwitchState = {
    model,
    hostname: `MDS-${model}`,
    serial: a ? "JAE21490A01" : "JAE22510B02",
    wwn: `20:00:00:0d:ec:${a ? "97:10" : "93:96"}:00`,
    ports,
    vsans: {
      1: {
        id: 1,
        name: "default",
        suspended: false,
        domain: a ? 1 : 2,
        priority: 128,
        defaultZone: "deny",
      },
      10: {
        id: 10,
        name: "PRODUCTION",
        suspended: false,
        domain: a ? 10 : 11,
        priority: 128,
        defaultZone: "deny",
      },
      20: {
        id: 20,
        name: "BACKUP",
        suspended: false,
        domain: a ? 20 : 21,
        priority: 128,
        defaultZone: "deny",
      },
    },
    zones: { [zoneKey(z.name, 10)]: z },
    zoneSets: {
      [zoneKey("PROD_FABRIC", 10)]: {
        name: "PROD_FABRIC",
        vsan: 10,
        members: [z.name],
      },
    },
    activeZoneSets: {
      10: { name: "PROD_FABRIC", zones: [structuredClone(z)] },
    },
    aliases: {},
    deviceAliases: {
      ESXI01_HBA_A: "21:00:00:24:ff:01:00:01",
      STORAGE01_CTL_A: "50:00:09:73:00:01:00:01",
    },
    pendingAliases: {},
    features: ["npiv", "fport-channel-trunk"],
    ntpServers: [],
    snmpLocation: "Lab",
    snmpContact: "",
    mgmtIp: a ? "192.168.1.10/24" : "192.168.1.20/24",
    gateway: "192.168.1.1",
    users: ["admin"],
    fcdomainPriority: 128,
    faults: [],
    logs: [
      "%SYSTEM-5-SYSTEM_MSG: System initialization complete",
      "%PORT-5-IF_UP: Interface fc1/1 is up in mode F",
      "%ZONE-5-ACTIVATION: Zoneset PROD_FABRIC activated in VSAN 10",
    ],
    saved: null,
    revision: 0,
  };
  s.saved = snapshot(s);
  return s;
}
export function toggleFault(
  s: SwitchState,
  id: FaultId,
  port: string,
): SwitchState {
  const n = structuredClone(s);
  if (!n.ports[port]) return n;
  const present = hasFault(n, id, port);
  if (present && id === "crc-errors") n.ports[port].crc += 427;
  n.faults = n.faults.filter((f) => !(f.id === id && f.port === port));
  if (!present) n.faults.push({ id, port });
  n.logs.push(
    `%LAB-4-FAULT_${present ? "CLEARED" : "INJECTED"}: ${id} on ${port}`,
  );
  n.revision++;
  return n;
}
export function fcid(s: SwitchState, p: Port) {
  const [slot, port] = p.id.slice(2).split("/").map(Number);
  const area = (s.model === "9710" ? (slot - 1) * 48 : 0) + port - 1;
  return `0x${(s.vsans[p.vsan]?.domain ?? 1).toString(16).padStart(2, "0")}${area.toString(16).padStart(2, "0")}00`;
}
