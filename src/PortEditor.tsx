import { useEffect, useRef, useState } from "react";
import type { SwitchState } from "./lib/model";
import { freshSession } from "./lib/model";
import { execute, resolvePorts } from "./lib/engine";

export function applyPortCommands(state: SwitchState, commands: string[]) {
  let next = state;
  let session = freshSession();
  for (const command of commands) {
    const result = execute(next, session, command);
    if (result.error) return { state, error: `${command}: ${result.output}` };
    next = result.state;
    session = result.session;
  }
  return { state: next, error: "" };
}

export default function PortEditor({
  state,
  port,
  onClose,
  onApply,
}: {
  state: SwitchState;
  port: string;
  onClose: () => void;
  onApply: (state: SwitchState, commands: string[]) => void;
}) {
  const p = state.ports[port];
  const [range, setRange] = useState(port);
  const [description, setDescription] = useState(p.description);
  const [mode, setMode] = useState(p.mode);
  const [speed, setSpeed] = useState(
    p.speedAuto ? "auto" : String(p.speed * 1000),
  );
  const [vsan, setVsan] = useState(String(p.vsan));
  const [credit, setCredit] = useState(String(p.bbCredit));
  const [trunk, setTrunk] = useState(p.trunk);
  const [allowed, setAllowed] = useState(p.allowedVsans.join(",") || "none");
  const [beacon, setBeacon] = useState(p.beacon);
  const [traps, setTraps] = useState(p.linkTraps);
  const [shutdown, setShutdown] = useState(p.adminDown);
  const [endpoint, setEndpoint] = useState("keep");
  const [role, setRole] = useState(
    p.role === "Target" || p.role === "Switch" ? p.role : "Initiator",
  );
  const [wwn, setWwn] = useState(p.wwn);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.querySelector("input")?.focus();
    return () => prev?.focus();
  }, []);
  const commands = [
    "configure terminal",
    `interface ${range}`,
    description.trim() ? `description ${description.trim()}` : "no description",
    `switchport mode ${mode}`,
    `switchport speed ${speed}`,
    `switchport vsan ${vsan}`,
    `switchport fcrxbbcredit ${credit}`,
    `switchport trunk mode ${trunk ? "on" : "off"}`,
    `switchport trunk allowed vsan ${allowed}`,
    `${beacon ? "" : "no "}beacon`,
    `${traps ? "" : "no "}snmp trap link-status`,
    `${shutdown ? "" : "no "}shutdown`,
    ...(endpoint === "keep"
      ? []
      : [
          endpoint === "disconnect"
            ? "lab endpoint disconnect"
            : `lab endpoint connect ${role} pwwn ${wwn}`,
        ]),
    "end",
  ];
  return (
    <div className="port-editor-overlay">
      <div
        className="port-editor"
        role="dialog"
        aria-modal="true"
        aria-label="端口配置"
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const items = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                "input, select, button, summary",
              ),
            );
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!resolvePorts(state, range)) {
              setError("端口范围无效，例如 fc1/3-6 或 fc1/3,fc2/4");
              return;
            }
            const result = applyPortCommands(state, commands);
            if (result.error) setError(result.error);
            else {
              onApply(result.state, commands);
              onClose();
            }
          }}
        >
          <h2>端口配置</h2>
          <p>将下列设置应用到指定端口；范围支持 fc1/3-6、fc1/3,fc2/4。</p>
          <div className="port-editor-grid">
            <label>
              端口 / 范围
              <input
                value={range}
                onChange={(e) => setRange(e.target.value)}
                required
              />
            </label>
            <label>
              描述
              <input
                maxLength={160}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              端口模式
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                {["F", "E", "auto"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              速率
              <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
                {["auto", "2000", "4000", "8000", "16000", "32000"].map((x) => (
                  <option key={x} value={x}>
                    {x === "auto" ? "自动" : `${Number(x) / 1000} Gbps`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              VSAN
              <select aria-label="VSAN" value={vsan} onChange={(e) => setVsan(e.target.value)}>
                {Object.values(state.vsans).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              接收 BB Credit
              <input
                type="number"
                min="1"
                max="500"
                required
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
              />
            </label>
            <label>
              Trunk 允许 VSAN
              <input
                required
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
              />
            </label>
            <label>
              模拟设备接入
              <select
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              >
                <option value="keep">保持现状</option>
                <option value="connect">连接（单端口）</option>
                <option value="disconnect">断开</option>
              </select>
            </label>
            {endpoint === "connect" && (
              <>
                <label>
                  设备角色
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    {["Initiator", "Target", "Switch"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  设备 PWWN
                  <input
                    required
                    value={wwn}
                    onChange={(e) => setWwn(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <div className="port-editor-flags">
            {[
              ["Trunk", trunk, setTrunk],
              ["Beacon", beacon, setBeacon],
              ["链路 SNMP Trap", traps, setTraps],
              ["Shutdown", shutdown, setShutdown],
            ].map(([label, value, setter]) => (
              <label key={String(label)}>
                <input
                  type="checkbox"
                  checked={value as boolean}
                  onChange={(e) =>
                    (setter as (v: boolean) => void)(e.target.checked)
                  }
                />
                {String(label)}
              </label>
            ))}
          </div>
          <details>
            <summary>查看配置命令</summary>
            <pre>{commands.join("\n")}</pre>
          </details>
          {error && <p role="alert">{error}</p>}
          <div className="port-editor-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="submit">应用配置</button>
          </div>
        </form>
      </div>
    </div>
  );
}
