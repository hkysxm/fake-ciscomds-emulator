import { describe, expect, it } from "vitest";
import {
  createSwitch,
  freshSession,
  hasFault,
  isUp,
  portStatus,
  prompt,
  toggleFault,
  zoneKey,
} from "../src/lib/model";
import type { Model, Session, SwitchState } from "../src/lib/model";
import { execute, resolvePorts } from "../src/lib/engine";
import { complete, SHOW_COMMANDS } from "../src/lib/catalog";
function lab(model: Model = "9710") {
  let state: SwitchState = createSwitch(model),
    session: Session = freshSession();
  return {
    run(cmd: string) {
      const result = execute(state, session, cmd);
      state = result.state;
      session = result.session;
      return result;
    },
    batch(text: string) {
      return text
        .trim()
        .split("\n")
        .map((cmd) => this.run(cmd.trim()));
    },
    get state() {
      return state;
    },
    get session() {
      return session;
    },
  };
}
describe.each<Model>(["9710", "9396"])("MDS %s", (model) => {
  it("creates the correct port map and working seed fabric", () => {
    const l = lab(model);
    expect(Object.keys(l.state.ports)).toHaveLength(96);
    expect(l.state.ports[model === "9710" ? "fc2/48" : "fc1/96"]).toBeDefined();
    expect(l.run("show version").output).toContain(`MDS ${model}`);
    expect(l.run("show flogi database").output).toContain(
      "Total number of flogi = 2",
    );
    expect(
      l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output,
    ).toContain("5 frames received");
  });
  it.each(SHOW_COMMANDS)(
    "executes %s without fabricated success or unknown errors",
    (command) => {
      const l = lab(model),
        result = l.run(command);
      expect(result.error).toBe(false);
      expect(result.output.trim().length).toBeGreaterThan(0);
      expect(result.output).not.toMatch(/undefined|NaN/);
    },
  );
  it("transitions configuration modes and prompt correctly", () => {
    const l = lab(model);
    expect(l.run("conf t").error).toBe(false);
    expect(prompt(l.state, l.session)).toBe(`MDS-${model}(config)#`);
    expect(l.run("int fc1/1").error).toBe(false);
    expect(prompt(l.state, l.session)).toBe(`MDS-${model}(config-if)#`);
    l.run("exit");
    expect(prompt(l.state, l.session)).toBe(`MDS-${model}(config)#`);
    l.run("end");
    expect(prompt(l.state, l.session)).toBe(`MDS-${model}#`);
  });
  it("changes interface state, FLOGI and name server consistently", () => {
    const l = lab(model);
    l.batch(
      "conf t\nint fc1/1\ndescription Test server\nswitchport speed 16000\nshut\nend",
    );
    expect(l.state.ports["fc1/1"].speed).toBe(16);
    expect(l.run("show interface fc1/1").output).toContain(
      "administratively down",
    );
    expect(l.run("show flogi database").output).toContain(
      "Total number of flogi = 1",
    );
    expect(l.run("show fcns database").output).not.toContain(
      "21:00:00:24:ff:01:00:01",
    );
    l.batch("conf t\nint fc1/1\nno shut\nend");
    expect(l.run("show interface fc1/1").output).toContain("16 Gbps");
    expect(l.run("show flogi database").output).toContain(
      "Total number of flogi = 2",
    );
  });
  it("creates, assigns, suspends, resumes and removes VSANs", () => {
    const l = lab(model);
    expect(
      l
        .batch(
          "conf t\nvsan database\nvsan 30 name TEST\nvsan 30 interface fc1/1-2\nend",
        )
        .every((r) => !r.error),
    ).toBe(true);
    expect(l.run("show vsan 30").output).toContain("name: TEST");
    expect(l.run("show flogi database vsan 30").output).toContain(
      "Total number of flogi = 2",
    );
    l.batch("conf t\nvsan database\nvsan 30 suspend\nend");
    expect(l.run("show interface fc1/1").output).toContain("vsanSuspended");
    expect(l.run("show flogi database vsan 30").output).toContain(
      "Total number of flogi = 0",
    );
    l.batch("conf t\nvsan database\nno vsan 30 suspend\nend");
    expect(isUp(l.state, l.state.ports["fc1/1"])).toBe(true);
    l.batch("conf t\nvsan database\nno vsan 30\nend");
    expect(l.state.ports["fc1/1"].vsan).toBe(1);
    expect(l.run("show vsan 30").error).toBe(true);
  });
  it("builds zones, activates snapshots, and enforces zoning", () => {
    const l = lab(model);
    const results = l.batch(
      "conf t\nzone name ONLY_HOST vsan 10\nmember pwwn 21:00:00:24:ff:01:00:01\nexit\nzoneset name LAB_SET vsan 10\nmember ONLY_HOST\nexit\nzoneset activate name LAB_SET vsan 10\nend",
    );
    expect(results.every((r) => !r.error)).toBe(true);
    expect(
      l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output,
    ).toContain("zoning access denied");
    l.batch(
      "conf t\nzone name ONLY_HOST vsan 10\nmember pwwn 50:00:09:73:00:01:00:01\nend",
    );
    expect(l.run("show zone name ONLY_HOST vsan 10").output).toContain(
      "50:00:09:73:00:01:00:01",
    );
    expect(l.run("show zone active vsan 10").output).not.toContain(
      "50:00:09:73:00:01:00:01",
    );
    l.batch("conf t\nzoneset activate name LAB_SET vsan 10\nend");
    expect(
      l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output,
    ).toContain("5 frames received");
  });
  it("commits device aliases and resolves aliases for zoning", () => {
    const l = lab(model);
    const results = l.batch(
      "conf t\ndevice-alias database\ndevice-alias name HOST pwwn 21:00:00:24:ff:01:00:01\nexit",
    );
    expect(results.every((r) => !r.error)).toBe(true);
    expect(l.run("show device-alias database").output).not.toContain(
      "name HOST",
    );
    expect(l.run("show device-alias pending").output).toContain("name HOST");
    expect(l.run("device-alias commit").error).toBe(false);
    expect(l.run("show device-alias database").output).toContain("name HOST");
    expect(
      l
        .batch(
          "fcalias name DISK vsan 10\nmember pwwn 50:00:09:73:00:01:00:01\nexit\nzone name ALIAS_ZONE vsan 10\nmember device-alias HOST\nmember fcalias DISK\nexit\nzoneset name ALIAS_SET vsan 10\nmember ALIAS_ZONE\nexit\nzoneset activate name ALIAS_SET vsan 10\nend",
        )
        .every((r) => !r.error),
    ).toBe(true);
    expect(
      l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output,
    ).toContain("5 frames received");
  });
  it("keeps startup-config distinct and restores it on simulated reload", () => {
    const l = lab(model);
    l.batch("conf t\nhostname LAB-SAN\nend");
    expect(l.run("show startup-config").output).toContain(
      `hostname MDS-${model}`,
    );
    expect(l.run("copy run start").error).toBe(false);
    l.batch("conf t\nhostname TEMP\nend");
    expect(l.state.hostname).toBe("TEMP");
    l.run("reload");
    expect(l.state.hostname).toBe("LAB-SAN");
    expect(l.run("show running-config").output).toContain("hostname LAB-SAN");
  });
  it("configures port ranges, trunk VSANs and port channels", () => {
    const l = lab(model);
    expect(
      l
        .batch(
          "conf t\ninterface fc1/3-4\nswitchport mode E\nswitchport trunk mode on\nswitchport trunk allowed vsan 10,20\nswitchport trunk allowed vsan add 30-32\nswitchport trunk allowed vsan remove 31\nchannel-group 2 force\nend",
        )
        .every((r) => !r.error),
    ).toBe(true);
    expect(l.state.ports["fc1/3"].allowedVsans).toEqual([10, 20, 30, 32]);
    expect(l.state.ports["fc1/4"].portChannel).toBe(2);
    expect(l.run("show port-channel summary").output).toContain(
      "fc1/3(D) fc1/4(D)",
    );
    expect(l.run("show interface trunk").output).toContain("10,20,30,32");
  });
  it("supports management configuration without sending real packets", () => {
    const l = lab(model);
    expect(
      l
        .batch(
          "conf t\ninterface mgmt0\nip address 10.1.1.10/24\nexit\nip default-gateway 10.1.1.1\nntp server 10.1.1.2\nsnmp-server location DC-01\nend",
        )
        .every((r) => !r.error),
    ).toBe(true);
    expect(l.run("show ip interface brief").output).toContain("10.1.1.10/24");
    expect(l.run("ping 10.1.1.1").output).toContain("5 received");
    expect(l.run("ping 8.8.8.8").output).toContain("100% packet loss");
    expect(l.run("show ntp peers").output).toContain("10.1.1.2");
  });
});
describe("Fault diagnosis and recovery", () => {
  it.each(["link-down", "sfp-missing", "vsan-mismatch"] as const)(
    "%s changes port and registration state, and clears cleanly",
    (id) => {
      let s = createSwitch("9710");
      s = toggleFault(s, id, "fc1/1");
      expect(isUp(s, s.ports["fc1/1"])).toBe(false);
      expect(
        execute(s, freshSession(), "show flogi database").output,
      ).toContain("Total number of flogi = 1");
      expect(
        execute(s, freshSession(), "show logging last 20").output,
      ).toContain(id);
      s = execute(s, freshSession(), "clear lab faults").state;
      expect(isUp(s, s.ports["fc1/1"])).toBe(true);
      expect(
        execute(s, freshSession(), "show flogi database").output,
      ).toContain("Total number of flogi = 2");
    },
  );
  it("exposes CRC errors, optical degradation and credit starvation", () => {
    let s = toggleFault(createSwitch("9710"), "crc-errors", "fc1/1");
    let r = execute(
      s,
      freshSession(),
      "show interface fc1/1 counters detailed",
    );
    expect(r.output).toContain("427 CRC errors");
    expect(
      execute(s, freshSession(), "show interface fc1/1 transceiver details")
        .output,
    ).toContain("-13.50 dBm");
    s = toggleFault(s, "credit-starvation", "fc1/1");
    r = execute(s, freshSession(), "show interface fc1/1 counters detailed");
    expect(r.output).toContain("18204 TxWait");
    expect(r.output).toContain("0 transmit B2B credits remaining");
    expect(isUp(s, s.ports["fc1/1"])).toBe(true);
  });
  it("does not let no shutdown fix an injected physical fault", () => {
    const s = toggleFault(createSwitch("9710"), "link-down", "fc1/1");
    let r = execute(s, freshSession(), "conf t");
    r = execute(r.state, r.session, "int fc1/1");
    r = execute(r.state, r.session, "no shut");
    expect(portStatus(r.state, r.state.ports["fc1/1"])).toBe("linkFailure");
  });
  it("makes zoning faults block endpoint traffic without losing FLOGI", () => {
    const s = toggleFault(createSwitch("9710"), "zoning-block", "fc1/1");
    expect(execute(s, freshSession(), "show flogi database").output).toContain(
      "Total number of flogi = 2",
    );
    expect(
      execute(s, freshSession(), "fcping pwwn 50:00:09:73:00:01:00:01 vsan 10")
        .output,
    ).toContain("zoning access denied");
    expect(execute(s, freshSession(), "show zone status").output).toContain(
      "DENIED",
    );
  });
  it("handles fault commands, counters and log clearing", () => {
    const l = lab();
    expect(l.run("lab fault sfp-missing interface fc1/1").error).toBe(false);
    expect(hasFault(l.state, "sfp-missing", "fc1/1")).toBe(true);
    expect(l.run("show interface fc1/1 transceiver details").output).toContain(
      "not present",
    );
    l.run("lab fault sfp-missing interface fc1/1");
    expect(hasFault(l.state, "sfp-missing")).toBe(false);
    l.run("clear counters interface fc1/1");
    expect(l.state.ports["fc1/1"].rx).toBe(0);
    l.run("clear logging logfile");
    expect(l.state.logs).toEqual([]);
  });
});
describe("CLI correctness and invalid input", () => {
  it("supports filters, chained filters and abbreviation", () => {
    const l = lab();
    expect(l.run("sh int brief | include up").output.split("\n")).toHaveLength(
      4,
    );
    expect(l.run("show interface brief | include up | count").output).toBe(
      "Count: 4 lines",
    );
    expect(
      l.run("show interface brief | exclude notConnected").output,
    ).not.toContain("notConnected");
    expect(l.run("show running-config | begin zone name").output).toMatch(
      /^zone name/,
    );
    expect(l.run("show version | include [").error).toBe(true);
    expect(l.run("show version | arbitrary").error).toBe(true);
    expect(l.run("show i").output).toContain("Ambiguous");
  });
  it("completes unique prefixes and lists contextual help", () => {
    const l = lab();
    expect(complete("sh ver", l.session).value).toBe("show version");
    expect(l.run("show int ?").output).toContain("show interface brief");
    l.batch("conf t\nint fc1/1");
    expect(l.run("?").output).toContain("switchport mode F");
    expect(l.run("?").output).not.toContain("vsan <id> suspend");
  });
  it("rejects invalid VSANs, interfaces, pWWNs, speeds, modes and unresolved activation without corrupting state", () => {
    const l = lab();
    expect(l.run("interface fc1/1").error).toBe(true);
    l.run("conf t");
    expect(l.run("interface fc99/999").error).toBe(true);
    l.run("vsan database");
    for (const command of [
      "vsan 0",
      "vsan 4094",
      "vsan 4079",
      "no vsan 1",
      "vsan 30 interface fc99/1",
      "vsan 30 name <script>",
    ])
      expect(l.run(command).error).toBe(true);
    expect(l.state.vsans[30]).toBeUndefined();
    l.run("int fc1/1");
    expect(l.run("switchport speed 64000").error).toBe(true);
    expect(l.run("switchport mode X").error).toBe(true);
    expect(l.state.ports["fc1/1"].speed).toBe(32);
    l.run("zone name TEST vsan 10");
    expect(l.run("member pwwn invalid").error).toBe(true);
    expect(l.run("member device-alias MISSING").error).toBe(false);
    l.batch("exit\nzoneset name EMPTY vsan 10");
    expect(l.run("member DOES_NOT_EXIST").error).toBe(true);
    l.batch("member TEST\nexit");
    expect(l.run("zoneset activate name EMPTY vsan 10").error).toBe(true);
    expect(l.state.activeZoneSets[10].name).toBe("PROD_FABRIC");
    expect(l.state.zones[zoneKey("TEST", 10)].members).toEqual([
      "device-alias MISSING",
    ]);
  });
  it("does not mutate original input objects or share state between devices", () => {
    const state = createSwitch("9710"),
      session = freshSession(),
      before = JSON.stringify(state);
    execute(state, session, "lab fault link-down interface fc1/1");
    expect(JSON.stringify(state)).toBe(before);
    expect(session.history).toEqual([]);
    const a = lab("9710"),
      b = lab("9396");
    a.batch("conf t\nhostname A\nend");
    expect(b.state.hostname).toBe("MDS-9396");
  });
  it("validates range boundaries and rejects malformed addresses", () => {
    const s = createSwitch("9710");
    expect(resolvePorts(s, "fc1/1 - 4")).toEqual([
      "fc1/1",
      "fc1/2",
      "fc1/3",
      "fc1/4",
    ]);
    expect(resolvePorts(s, "fc1/1,fc2/48")).toEqual(["fc1/1", "fc2/48"]);
    expect(resolvePorts(s, "fc1/48-49")).toBeNull();
    expect(resolvePorts(s, "fc1/4-1")).toBeNull();
    const l = lab();
    expect(l.run("ping 999.0.0.1").error).toBe(true);
    l.batch("conf t\ninterface mgmt0");
    expect(l.run("ip address 10.0.0.1/33").error).toBe(true);
    expect(l.run("ip address 10.0.0.1/foo").error).toBe(true);
  });
});

describe("Fabric state integrity", () => {
  it("allocates unique FCIDs across both director line cards", () => {
    const l = lab();
    l.batch("conf t\nvsan database\nvsan 10 interface fc2/1\nend");
    const a = l.run("show interface fc1/1").output.match(/FCID is (\S+)/)?.[1];
    const b = l.run("show interface fc2/1").output.match(/FCID is (\S+)/)?.[1];
    expect(a).not.toBe(b);
  });
  it("retains historical CRC errors until counters are explicitly cleared", () => {
    const l = lab();
    l.run("lab fault crc-errors interface fc1/1");
    l.run("clear lab faults");
    expect(l.run("show interface fc1/1 counters detailed").output).toContain(
      "427 CRC errors",
    );
    l.run("clear counters interface fc1/1");
    expect(l.run("show interface fc1/1 counters detailed").output).toContain(
      "0 CRC errors",
    );
  });
  it("keeps fcdomain priorities scoped to VSANs", () => {
    const l = lab();
    l.batch("conf t\nfcdomain priority 100 vsan 10\nend");
    expect(l.run("show fcdomain vsan 10").output).toContain(
      "Running priority: 100",
    );
    expect(l.run("show fcdomain vsan 20").output).toContain(
      "Running priority: 128",
    );
    expect(l.run("show running-config").output).toContain(
      "fcdomain priority 100 vsan 10",
    );
  });
  it("rejects database clearing while a zoneset is active", () => {
    const l = lab();
    expect(l.run("clear zone database vsan 10").error).toBe(true);
    l.batch("conf t\nno zoneset activate name PROD_FABRIC vsan 10\nend");
    expect(l.run("clear zone database vsan 10").error).toBe(false);
    expect(l.run("show zone vsan 10").output).toBe("No zones found.");
    expect(l.run("show zoneset vsan 10").output).toBe("No zonesets found.");
  });
  it("enforces F-port registration for endpoint communication", () => {
    const l = lab();
    l.batch("conf t\nint fc1/1\nswitchport mode E\nend");
    expect(
      l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output,
    ).toContain("no active FLOGI");
  });
  it("supports the Cisco switchname spelling and dynamic command abbreviations", () => {
    const l = lab();
    l.batch("conf t\nswitchname SAN-CORE\nend");
    expect(l.run("show switchname").output).toBe("SAN-CORE");
    expect(l.run("sh int fc1/1 trans det").output).toContain("sfp is present");
    expect(l.run("sh int fc1/1 count det").output).toContain("CRC errors");
  });
});

it("negotiates auto mode from the attached endpoint and reports switch port WWNs separately", () => {
  const l = lab();
  l.batch("conf t\nint fc1/1\nswitchport mode auto\nend");
  expect(l.run("show flogi database").output).toContain(
    "Total number of flogi = 2",
  );
  expect(l.run("fcping pwwn 50:00:09:73:00:01:00:01 vsan 10").output).toContain(
    "5 frames received",
  );
  const output = l.run("show interface fc1/1").output;
  expect(output).toContain("Admin port mode is auto");
  expect(output).toContain("Port mode is F");
  expect(output).toContain("Port WWN is 20:01:00:0d:ec:97:10:00");
});

it("preserves non-default auto configuration and rejects ambiguous cross-slot ranges", () => {
  const l = lab();
  l.batch("conf t\ninterface fc1/3\nswitchport mode auto\nend");
  expect(l.run("show running-config interface fc1/3").output).toContain(
    "switchport mode auto",
  );
  expect(resolvePorts(l.state, "fc1/1-fc2/4")).toBeNull();
});
