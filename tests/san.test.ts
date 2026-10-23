import { describe, it, expect } from "vitest";
import { execute } from "../src/lib/engine";
import {
  createSwitch,
  freshSession,
  migrateSwitch,
  toggleFault,
} from "../src/lib/model";
import { sanDemoCommands } from "../src/lib/san-demo";
import { sanPaths, statsKey } from "../src/lib/san";
import type { Model } from "../src/lib/model";
function lab(model: Model = "9710") {
  let state = createSwitch(model),
    session = freshSession();
  const run = (cmd: string) => {
    const r = execute(state, session, cmd);
    state = r.state;
    session = r.session;
    return r;
  };
  for (const command of sanDemoCommands(state)) {
    const r = run(command);
    expect(r.error, r.output).toBe(false);
  }
  return {
    run,
    get state() {
      return state;
    },
    fault(id: Parameters<typeof toggleFault>[1], port: string) {
      state = toggleFault(state, id, port);
    },
    paths: () => sanPaths(state, "DEMO_HOST", "DEMO_STORAGE", 0),
    stats: () => state.san.stats[statsKey("DEMO_HOST", "DEMO_STORAGE", 0)],
  };
}
const io = (action: string, extra = "") =>
  `lab san io ${action} DEMO_HOST DEMO_STORAGE 0 0${extra}`;
describe.each(["9710", "9396"] as const)("%s SAN", (model) => {
  it("round-robins four paths and preserves data across paths", () => {
    const l = lab(model);
    expect(l.paths().filter((p) => p.available)).toHaveLength(4);
    expect(l.run(io("write", " hello SAN")).error).toBe(false);
    const paths = new Set([l.stats().lastPath]);
    for (let i = 0; i < 3; i++) {
      expect(l.run(io("read")).output).toContain('data: "hello SAN"');
      paths.add(l.stats().lastPath);
    }
    expect(paths.size).toBe(4);
    expect(l.state.ports["fc1/3"].rx).toBeGreaterThan(0);
  });
  it("fails over when an HBA is disconnected, fails on total loss and recovers data", () => {
    const l = lab(model);
    l.run("lab san host policy DEMO_HOST failover");
    l.run(io("write", " durable"));
    l.run("conf t");
    l.run("int fc1/3");
    l.run("lab endpoint disconnect");
    expect(l.run(io("read")).output).toContain("fc1/4 ->");
    expect(l.stats().failovers).toBe(1);
    l.run("int fc1/4");
    l.run("lab endpoint disconnect");
    expect(l.run(io("read")).error).toBe(true);
    expect(l.stats().failed).toBe(1);
    l.run("lab endpoint connect Initiator pwwn 21:00:00:00:00:00:30:02");
    expect(l.run(io("read")).output).toContain('data: "durable"');
  });
  it("enforces masking, read-only mappings, storage and LUN outages", () => {
    const l = lab(model);
    l.run(io("write", " original"));
    l.run("lab san map DEMO_STORAGE 0 DEMO_HOST ro");
    expect(l.run(io("write", " changed")).output).toContain("read-only");
    expect(l.run(io("read")).output).toContain('"original"');
    for (const [down, up] of [
      ["unmap DEMO_STORAGE 0 DEMO_HOST", "map DEMO_STORAGE 0 DEMO_HOST rw"],
      ["storage offline DEMO_STORAGE", "storage online DEMO_STORAGE"],
      ["lun offline DEMO_STORAGE 0", "lun online DEMO_STORAGE 0"],
    ]) {
      l.run(`lab san ${down}`);
      expect(l.run(io("read")).error).toBe(true);
      l.run(`lab san ${up}`);
      expect(l.run(io("read")).output).toContain('"original"');
    }
  });
  it("respects zoning, VSAN, shutdown, SFP and BB Credit faults", () => {
    const l = lab(model);
    l.run("conf t");
    l.run("no zoneset activate name SAN_DEMO vsan 30");
    expect(l.paths().every((p) => !p.available)).toBe(true);
    l.run("zoneset activate name SAN_DEMO vsan 30");
    for (const cmd of ["shutdown", "switchport vsan 10"]) {
      l.run("int fc1/3-4");
      l.run(cmd);
      expect(l.run(io("read")).error).toBe(true);
      l.run("no shutdown");
      l.run("switchport vsan 30");
    }
    for (const fault of [
      "sfp-missing",
      "credit-starvation",
      "link-down",
      "zoning-block",
    ] as const) {
      l.fault(fault, "fc1/3");
      l.fault(fault, "fc1/4");
      expect(l.run(io("read")).error).toBe(true);
      l.fault(fault, "fc1/3");
      l.fault(fault, "fc1/4");
      expect(l.run(io("read")).error).toBe(false);
    }
  });
  it("rejects malformed commands, duplicate ownership, invalid size and out-of-bounds I/O", () => {
    const l = lab(model);
    for (const cmd of [
      "lab san host add Other 21:00:00:00:00:00:30:01",
      "lab san lun create DEMO_STORAGE 1 -1",
      "lab san map DEMO_STORAGE 0 DEMO_HOST invalid",
      "lab san io write DEMO_HOST DEMO_STORAGE 0 1024 data",
      "lab san io write DEMO_HOST DEMO_STORAGE 0 0",
      "lab san io read DEMO_HOST DEMO_STORAGE 0 -1",
      "lab san host policy DEMO_HOST random",
    ]) {
      const before = structuredClone(l.state.san);
      expect(l.run(cmd).error, cmd).toBe(true);
      expect(l.state.san).toEqual(before);
    }
    expect(() => sanDemoCommands(l.state)).toThrow();
  });
  it("retains external storage data through switch reload and JSON persistence", () => {
    const l = lab(model);
    l.run("copy running-config startup-config");
    l.run(io("write", " persistent"));
    l.run("reload");
    expect(l.run(io("read")).output).toContain('"persistent"');
    const state = migrateSwitch(JSON.parse(JSON.stringify(l.state)));
    expect(execute(state, freshSession(), io("read")).output).toContain(
      '"persistent"',
    );
  });
});
it("migrates older workspaces without replacing existing ports", () => {
  const state = createSwitch("9710");
  delete (state as Partial<typeof state>).san;
  const migrated = migrateSwitch(state);
  expect(migrated.san).toEqual({ hosts: {}, storages: {}, stats: {} });
  expect(migrated.ports).toEqual(state.ports);
});

it("preserves text payloads, handles abbreviated SAN queries and bounds sparse writes", () => {
  const l = lab();
  expect(l.run(io("write", " a  b | constructor")).error).toBe(false);
  expect(l.run(io("read")).output).toContain('"a  b | constructor"');
  expect(
    l.run("sh san paths DEMO_HOST DEMO_STORAGE 0 | include UP | count").output,
  ).toBe("Count: 4 lines");
  expect(l.run("show san paths constructor DEMO_STORAGE 0").error).toBe(true);
  for (let i = 1; i < 128; i++)
    expect(
      l.run(`lab san io write DEMO_HOST DEMO_STORAGE 0 ${i} block`).error,
    ).toBe(false);
  expect(
    l.run("lab san io write DEMO_HOST DEMO_STORAGE 0 128 extra").output,
  ).toContain("128 written blocks");
  expect(l.run(io("write", " replacement")).error).toBe(false);
});
it("follows an endpoint moved to another physical port and reports CRC retries", () => {
  const l = lab();
  l.run("conf t");
  l.run("int fc1/3");
  l.run("lab endpoint disconnect");
  l.run("int fc1/7");
  l.run("switchport vsan 30");
  expect(
    l.run("lab endpoint connect Initiator pwwn 21:00:00:00:00:00:30:01").error,
  ).toBe(false);
  expect(l.paths().filter((p) => p.available)).toHaveLength(4);
  l.fault("crc-errors", "fc1/7");
  expect(l.run(io("read")).output).toContain("CRC retries");
});
