import { useEffect, useRef, useState } from "react";
import type { SwitchState } from "./lib/model";
import { sanPaths, statsKey } from "./lib/san";
import { sanDemoCommands } from "./lib/san-demo";

export default function SanPanel({
  state,
  onClose,
  onCommands,
}: {
  state: SwitchState;
  onClose: () => void;
  onCommands: (commands: string[]) => { error: string; output: string };
}) {
  const [host, setHost] = useState(Object.keys(state.san.hosts)[0] ?? "");
  const [storage, setStorage] = useState(
    Object.keys(state.san.storages)[0] ?? "",
  );
  const [lunId, setLunId] = useState("0");
  const [block, setBlock] = useState("0");
  const [data, setData] = useState("SAN test data");
  const [result, setResult] = useState("");
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [wwns, setWwns] = useState("");
  const [kind, setKind] = useState("host");
  const [blocks, setBlocks] = useState("1024");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.querySelector("button")?.focus();
    return () => prev?.focus();
  }, []);
  const t = state.san.storages[storage],
    lun = t?.luns[Number(lunId)];
  const paths = sanPaths(state, host, storage, Number(lunId));
  const stats = state.san.stats[statsKey(host, storage, Number(lunId))];
  const run = (commands: string[]) => {
    const r = onCommands(commands);
    setError(!!r.error);
    setResult(r.error || r.output || "配置已应用");
    return !r.error;
  };
  const io = (action: "read" | "write") =>
    run([
      `lab san io ${action} ${host} ${storage} ${lunId} ${block}${action === "write" ? ` ${data}` : ""}`,
    ]);
  return (
    <div className="port-editor-overlay">
      <div
        className="port-editor san-panel"
        role="dialog"
        aria-modal="true"
        aria-label="服务器与存储"
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const items = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                "input:not(:disabled), select:not(:disabled), button:not(:disabled), summary",
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
        <h2>服务器与存储</h2>
        <p>
          本地模拟 LUN
          与块读写，不连接真实设备。多路径限当前交换机内，未模拟跨交换机双
          Fabric。
        </p>
        <div className="port-editor-actions">
          <button
            onClick={() => {
              try {
                if (run(sanDemoCommands(state))) {
                  setHost("DEMO_HOST");
                  setStorage("DEMO_STORAGE");
                  setLunId("0");
                }
              } catch (e) {
                setError(true);
                setResult((e as Error).message);
              }
            }}
          >
            创建双 HBA / 双控制器演示
          </button>
          <button onClick={onClose}>关闭</button>
        </div>
        <p>演示使用 fc1/3-6、VSAN 30、LUN 0，自动配置 Zoning 和读写映射。</p>
        <details>
          <summary>添加服务器或存储</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (run([`lab san ${kind} add ${name} ${wwns}`])) {
                if (kind === "host") setHost(name);
                else setStorage(name);
              }
            }}
          >
            <div className="port-editor-grid">
              <label>
                类型
                <select
                  aria-label="设备类型"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="host">服务器</option>
                  <option value="storage">存储</option>
                </select>
              </label>
              <label>
                名称
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  pattern="[a-zA-Z][a-zA-Z0-9_.-]{0,31}"
                />
              </label>
              <label>
                PWWN 列表
                <input
                  required
                  value={wwns}
                  onChange={(e) => setWwns(e.target.value)}
                  placeholder="多个 PWWN 用逗号分隔"
                />
              </label>
            </div>
            <button type="submit">添加设备</button>
            <p>
              此处定义设备身份；在“配置端口”中接入对应 PWWN，并配置 VSAN /
              Zoning。
            </p>
          </form>
        </details>
        <div className="port-editor-grid">
          <label>
            服务器
            <select
              aria-label="服务器"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            >
              <option value="">选择服务器</option>
              {Object.keys(state.san.hosts).map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
          <label>
            存储
            <select
              aria-label="存储"
              value={storage}
              onChange={(e) => setStorage(e.target.value)}
            >
              <option value="">选择存储</option>
              {Object.keys(state.san.storages).map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
          <label>
            LUN ID
            <input
              aria-label="LUN ID"
              type="number"
              min="0"
              max="16383"
              value={lunId}
              onChange={(e) => setLunId(e.target.value)}
            />
          </label>
          <label>
            新 LUN 容量（4 KiB 块）
            <input
              type="number"
              min="1"
              max="1048576"
              value={blocks}
              onChange={(e) => setBlocks(e.target.value)}
            />
          </label>
        </div>
        <div className="san-actions">
          <button
            disabled={!t}
            onClick={() =>
              run([`lab san lun create ${storage} ${lunId} ${blocks}`])
            }
          >
            创建 LUN
          </button>
          <button
            disabled={!t}
            onClick={() =>
              run([
                `lab san storage ${t?.online ? "offline" : "online"} ${storage}`,
              ])
            }
          >
            {t?.online ? "存储离线" : "存储上线"}
          </button>
          <button
            disabled={!lun}
            onClick={() =>
              run([
                `lab san lun ${lun?.online ? "offline" : "online"} ${storage} ${lunId}`,
              ])
            }
          >
            {lun?.online ? "LUN 离线" : "LUN 上线"}
          </button>
        </div>
        <div className="port-editor-grid">
          <label>
            LUN 映射
            <select
              aria-label="LUN 映射"
              disabled={!lun || !host}
              value={lun?.mappings[host] ?? "none"}
              onChange={(e) =>
                run([
                  e.target.value === "none"
                    ? `lab san unmap ${storage} ${lunId} ${host}`
                    : `lab san map ${storage} ${lunId} ${host} ${e.target.value}`,
                ])
              }
            >
              <option value="none">未映射</option>
              <option value="rw">读写</option>
              <option value="ro">只读</option>
            </select>
          </label>
          <label>
            多路径策略
            <select
              aria-label="多路径策略"
              disabled={!host}
              value={state.san.hosts[host]?.policy ?? "round-robin"}
              onChange={(e) =>
                run([`lab san host policy ${host} ${e.target.value}`])
              }
            >
              <option value="round-robin">轮询</option>
              <option value="failover">故障切换</option>
            </select>
          </label>
        </div>
        <p>
          {lun
            ? `LUN ${lun.id} · ${lun.blocks} 块 · ${lun.online ? "在线" : "离线"}`
            : "尚未创建该 LUN"}{" "}
          · 可用路径 {paths.filter((p) => p.available).length} / {paths.length}
        </p>
        <div className="san-paths">
          {paths.map((p) => (
            <div key={p.id}>
              <code>
                {p.hostPort} → {p.targetPort}
              </code>
              <span>
                {p.available ? "UP" : "DOWN"} · {p.reason}
              </span>
            </div>
          ))}
        </div>
        <div className="san-actions">
          {[...new Set(paths.flatMap((p) => [p.hostPort, p.targetPort]))]
            .filter((id) => !!state.ports[id])
            .map((id) => (
              <button
                key={id}
                onClick={() =>
                  run([
                    "configure terminal",
                    `interface ${id}`,
                    state.ports[id].connected
                      ? "lab endpoint disconnect"
                      : `lab endpoint connect ${state.ports[id].role} pwwn ${state.ports[id].wwn}`,
                    "end",
                  ])
                }
              >
                {state.ports[id].connected ? "断开" : "接入"} {id}
              </button>
            ))}
        </div>
        <div className="port-editor-grid">
          <label>
            块地址
            <input
              type="number"
              min="0"
              value={block}
              onChange={(e) => setBlock(e.target.value)}
            />
          </label>
          <label>
            写入内容
            <input
              value={data}
              onChange={(e) => setData(e.target.value)}
              maxLength={1024}
            />
          </label>
        </div>
        <div className="san-actions">
          <button disabled={!lun || !host} onClick={() => io("write")}>
            写入块
          </button>
          <button disabled={!lun || !host} onClick={() => io("read")}>
            读取块
          </button>
        </div>
        <p>
          读 {stats?.reads ?? 0} · 写 {stats?.writes ?? 0} · 失败{" "}
          {stats?.failed ?? 0} · 故障切换 {stats?.failovers ?? 0}
        </p>
        <pre role={error ? "alert" : "status"}>{result}</pre>
      </div>
    </div>
  );
}
