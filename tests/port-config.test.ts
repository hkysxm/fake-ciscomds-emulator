import { describe, it, expect } from "vitest";
import { applyPortCommands } from "../src/PortEditor";
import { createSwitch, freshSession, migrateSwitch } from "../src/lib/model";
import { execute } from "../src/lib/engine";

describe.each(["9710", "9396"] as const)("%s port changes", (model) => {
  it("persists batch configuration through save/reload and reports settings", () => {
    let state = createSwitch(model),
      session = freshSession();
    const run = (cmd: string) => {
      const r = execute(state, session, cmd);
      expect(r.error, r.output).toBe(false);
      state = r.state;
      session = r.session;
      return r.output;
    };
    [
      "conf t",
      "interface fc1/3-5",
      "description Backup SAN",
      "switchport vsan 20",
      "switchport speed auto",
      "switchport fcrxbbcredit 64",
      "beacon",
      "no snmp trap link-status",
      "switchport trunk mode on",
      "switchport trunk allowed vsan 10,20",
      "end",
      "copy running-config startup-config",
      "conf t",
      "default interface fc1/3-5",
      "end",
      "reload",
    ].forEach(run);
    for (const id of ["fc1/3", "fc1/4", "fc1/5"])
      expect(state.ports[id]).toMatchObject({
        description: "Backup SAN",
        vsan: 20,
        speedAuto: true,
        bbCredit: 64,
        beacon: true,
        linkTraps: false,
        allowedVsans: [10, 20],
      });
    expect(run("show interface fc1/3")).toContain("Receive B2B Credit is 64");
    expect(run("show interface fc1/3")).toContain("Beacon is turned on");
    expect(run("show running-config")).toContain("switchport speed auto");
    expect(run("show startup-config")).toContain("switchport fcrxbbcredit 64");
  });
  it("connects simulated endpoints and rejects duplicate WWNs atomically", () => {
    const initial = createSwitch(model);
    const connected = applyPortCommands(initial, [
      "conf t",
      "int fc1/3",
      "switchport vsan 10",
      "lab endpoint connect Target pwwn 50:00:00:00:00:00:00:03",
      "end",
    ]);
    expect(connected.error).toBe("");
    expect(
      execute(connected.state, freshSession(), "show flogi database").output,
    ).toContain("50:00:00:00:00:00:00:03");
    const invalid = applyPortCommands(connected.state, [
      "conf t",
      "int fc1/4",
      "description SHOULD_ROLL_BACK",
      "lab endpoint connect Target pwwn 50:00:00:00:00:00:00:03",
    ]);
    expect(invalid.error).toContain("already connected");
    expect(invalid.state).toEqual(connected.state);
    const disconnected = applyPortCommands(connected.state, [
      "conf t",
      "int fc1/3",
      "lab endpoint disconnect",
    ]);
    expect(
      execute(disconnected.state, freshSession(), "show flogi database").output,
    ).not.toContain("50:00:00:00:00:00:00:03");
  });
  it("rejects invalid ranges and credit values without partial changes", () => {
    const state = createSwitch(model);
    for (const cmds of [
      ["int fc1/3-999", "shutdown"],
      ["int fc1/3-5", "description Changed", "switchport fcrxbbcredit 501"],
      ["int fc1/3-5", "switchport vsan 999"],
    ]) {
      const result = applyPortCommands(state, ["conf t", ...cmds]);
      expect(result.error).not.toBe("");
      expect(result.state).toEqual(state);
    }
  });
  it("clones inactive zoning configuration without altering the active fabric", () => {
    const state = createSwitch(model);
    const r = applyPortCommands(state, [
      "conf t",
      "zone clone ESXI01_STORAGE01 COPY_ZONE vsan 10",
      "zoneset clone PROD_FABRIC COPY_SET vsan 10",
    ]);
    expect(r.error).toBe("");
    expect(r.state.zones["10:COPY_ZONE"].members).toEqual(
      state.zones["10:ESXI01_STORAGE01"].members,
    );
    expect(r.state.activeZoneSets).toEqual(state.activeZoneSets);
    expect(
      applyPortCommands(r.state, [
        "conf t",
        "zoneset clone PROD_FABRIC COPY_SET vsan 10",
      ]).error,
    ).toContain("already exists");
  });
});
it("migrates old browser running and startup state without losing custom configuration", () => {
  const old = createSwitch("9710");
  old.ports["fc1/3"].description = "Keep me";
  for (const ports of [old.ports, old.saved!.ports])
    for (const port of Object.values(ports)) {
      for (const key of [
        "speedAuto",
        "bbCredit",
        "beacon",
        "linkTraps",
      ] as const)
        delete (port as Partial<typeof port>)[key];
    }
  const migrated = migrateSwitch(old);
  expect(migrated.ports["fc1/3"].description).toBe("Keep me");
  expect(migrated.ports["fc1/3"].bbCredit).toBe(16);
  expect(migrated.saved!.ports["fc1/3"].linkTraps).toBe(true);
});
