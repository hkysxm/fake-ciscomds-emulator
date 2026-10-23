import type { SwitchState } from "./model";
export const demoPorts = ["fc1/3", "fc1/4", "fc1/5", "fc1/6"];
export function sanDemoCommands(state: SwitchState): string[] {
  if (
    state.vsans[30] ||
    state.san.hosts.DEMO_HOST ||
    state.san.storages.DEMO_STORAGE ||
    demoPorts.some(
      (id) =>
        state.ports[id].connected ||
        state.ports[id].description ||
        state.ports[id].vsan !== 1 ||
        state.ports[id].portChannel,
    )
  )
    throw new Error(
      "演示需要空闲的 fc1/3-6、未使用的 VSAN 30 和 DEMO_HOST / DEMO_STORAGE 名称。现有配置未修改。",
    );
  const wwns = [
    "21:00:00:00:00:00:30:01",
    "21:00:00:00:00:00:30:02",
    "50:00:00:00:00:00:30:01",
    "50:00:00:00:00:00:30:02",
  ];
  return [
    "configure terminal",
    "vsan database",
    "vsan 30 name SAN_DEMO",
    "exit",
    ...demoPorts.flatMap((id, i) => [
      `interface ${id}`,
      `description SAN_DEMO_${i + 1}`,
      "switchport mode F",
      "switchport vsan 30",
      "no shutdown",
      `lab endpoint connect ${i < 2 ? "Initiator" : "Target"} pwwn ${wwns[i]}`,
      "exit",
    ]),
    "zone name SAN_DEMO vsan 30",
    ...wwns.map((w) => `member pwwn ${w}`),
    "exit",
    "zoneset name SAN_DEMO vsan 30",
    "member SAN_DEMO",
    "exit",
    "zoneset activate name SAN_DEMO vsan 30",
    "end",
    `lab san host add DEMO_HOST ${wwns.slice(0, 2).join(",")}`,
    `lab san storage add DEMO_STORAGE ${wwns.slice(2).join(",")}`,
    "lab san lun create DEMO_STORAGE 0 1024",
    "lab san map DEMO_STORAGE 0 DEMO_HOST rw",
  ];
}
