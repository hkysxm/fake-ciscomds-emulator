import type { SwitchState } from "./model";
import { fcid, zoneKey } from "./model";
export function memberWwn(
  s: SwitchState,
  member: string,
  vsan: number,
): string[] {
  const [type, name] = member.split(" ");
  if (type === "pwwn") return [name.toLowerCase()];
  if (type === "device-alias")
    return s.deviceAliases[name] ? [s.deviceAliases[name]] : [];
  if (type === "fcalias")
    return (
      s.aliases[zoneKey(name, vsan)]?.members.flatMap((m) =>
        memberWwn(s, m, vsan),
      ) ?? []
    );
  if (type === "fcid")
    return Object.values(s.ports)
      .filter((p) => p.vsan === vsan && fcid(s, p) === name.toLowerCase())
      .map((p) => p.wwn);
  if (type === "interface") return s.ports[name] ? [s.ports[name].wwn] : [];
  return [];
}
export function canCommunicate(
  s: SwitchState,
  a: string,
  b: string,
  vsan: number,
) {
  if (a === b) return true;
  if (s.vsans[vsan]?.defaultZone === "permit") {
    const all =
      s.activeZoneSets[vsan]?.zones.flatMap((z) =>
        z.members.flatMap((m) => memberWwn(s, m, vsan)),
      ) ?? [];
    if (!all.includes(a) && !all.includes(b)) return true;
  }
  return (
    s.activeZoneSets[vsan]?.zones.some((z) => {
      const w = z.members.flatMap((m) => memberWwn(s, m, vsan));
      return w.includes(a) && w.includes(b);
    }) ?? false
  );
}
