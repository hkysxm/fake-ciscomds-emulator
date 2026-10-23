import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Terminal,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  BookOpen,
  RotateCcw,
  X,
  Search,
  ArrowUpRight,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  CircleHelp,
  FlaskConical,
  Network,
  ArrowDown,
  Copy,
  Download,
} from "lucide-react";
import type { FaultId, Model, Session, SwitchState } from "./lib/model";
import {
  createSwitch,
  migrateSwitch,
  FAULTS,
  freshSession,
  hasFault,
  isUp,
  portStatus,
  prompt,
  toggleFault,
} from "./lib/model";
import PortEditor from "./PortEditor";
import SanPanel from "./SanPanel";
import { execute } from "./lib/engine";
import {
  commandGroups,
  complete,
  SHOW_COMMANDS,
  CONFIG_COMMANDS,
  PORT_COMMANDS,
  SAN_COMMANDS,
} from "./lib/catalog";

type Entry = {
  id: string;
  prompt?: string;
  command?: string;
  output: string;
  error?: boolean;
  banner?: boolean;
};
type Device = { state: SwitchState; session: Session; entries: Entry[] };
const STORE = "mds-lab.workspace.v1";
const models: Model[] = ["9710", "9396"];
function initialEntry(s: SwitchState): Entry[] {
  const output = execute(
    s,
    freshSession(),
    "show interface brief | include up",
  ).output;
  return [
    {
      id: "banner",
      output: `Cisco MDS ${s.model}\nNX-OS Software, Version 9.4(2)\n${s.model === "9710" ? "Multilayer Director" : "Multilayer Fabric Switch"} · 96 × 32G Fibre Channel`,
      banner: true,
    },
    {
      id: "initial",
      prompt: `${s.hostname}#`,
      command: "show interface brief | include up",
      output,
    },
  ];
}
function load(): Record<Model, Device> {
  let saved: Partial<Record<Model, SwitchState>> = {};
  try {
    const data = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (data?.version === 1) saved = data.devices;
  } catch {
    /* An unavailable or invalid browser store starts a new local workspace. */
  }
  return Object.fromEntries(
    models.map((model) => {
      const candidate = saved?.[model];
      const state =
        candidate?.model === model &&
        candidate?.ports?.["fc1/1"] &&
        candidate.vsans &&
        candidate.activeZoneSets &&
        candidate.saved &&
        Array.isArray(candidate.faults)
          ? migrateSwitch(candidate)
          : createSwitch(model);
      return [
        model,
        { state, session: freshSession(), entries: initialEntry(state) },
      ];
    }),
  ) as Record<Model, Device>;
}
function SwitchGlyph({ model }: { model: Model }) {
  return (
    <div
      className={`switch-glyph ${model === "9710" ? "director" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: model === "9710" ? 3 : 2 }, (_, row) => (
        <div key={row}>
          <span className="glyph-led" />
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      ))}
    </div>
  );
}
export default function App() {
  const [devices, setDevices] = useState(load);
  const [active, setActive] = useState<Model>("9710");
  const [input, setInput] = useState("");
  const [faultPort, setFaultPort] = useState("fc1/1");
  const [sanPanel, setSanPanel] = useState(false);
  const [portEditor, setPortEditor] = useState(false);
  const [reference, setReference] = useState(false);
  const [search, setSearch] = useState("");
  const [reset, setReset] = useState(false);
  const [sidebar, setSidebar] = useState(
    () => window.matchMedia("(min-width: 601px)").matches,
  );
  const [expanded, setExpanded] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyIndex = useRef(-1);
  const draftInput = useRef("");
  const referenceRef = useRef<HTMLDivElement>(null);
  const d = devices[active],
    state = d.state;
  const upPorts = Object.values(state.ports).filter((p) =>
    isUp(state, p),
  ).length;
  const currentPrompt = prompt(state, d.session);
  const jump = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    setShowScroll(false);
  };
  const focus = () => inputRef.current?.focus({ preventScroll: true });
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          version: 1,
          devices: Object.fromEntries(models.map((m) => [m, devices[m].state])),
        }),
      );
      setStorageOk(true);
    } catch {
      setStorageOk(false);
    }
  }, [devices]);
  useEffect(() => {
    jump();
  }, [active, d.entries]);
  useEffect(() => {
    if (!reference && !reset && !portEditor && !sanPanel) focus();
  }, [active, reference, reset, portEditor, sanPanel]);
  useEffect(() => {
    if (!reference && !reset) return;
    const prev = document.activeElement as HTMLElement | null;
    const modal = reference
      ? referenceRef.current
      : document.querySelector<HTMLElement>(".reset-dialog");
    const first = modal?.querySelector<HTMLElement>("button, input");
    first?.focus();
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setReference(false);
        setReset(false);
      }
      if (e.key === "Tab" && modal) {
        const elements = Array.from(
          modal.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'),
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      prev?.focus({ preventScroll: true });
    };
  }, [reference, reset]);
  function select(model: Model) {
    setActive(model);
    setInput("");
    historyIndex.current = -1;
    setFaultPort("fc1/1");
  }
  function run(text: string, keepInput = false) {
    const lines = text.split(/\r?\n/).slice(0, 200);
    setDevices((prev) => {
      let device = prev[active];
      for (const line of lines) {
        const command = line.trim().slice(0, 2048);
        if (!command) continue;
        const result = execute(device.state, device.session, command);
        const entries = result.clear
          ? []
          : [
              ...device.entries,
              {
                id: crypto.randomUUID(),
                prompt: prompt(device.state, device.session),
                command,
                output: result.output,
                error: result.error,
              },
            ].slice(-800);
        device = { state: result.state, session: result.session, entries };
      }
      return { ...prev, [active]: device };
    });
    if (!keepInput) setInput("");
    historyIndex.current = -1;
    requestAnimationFrame(() => {
      focus();
      jump();
    });
  }
  function keyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      run(input);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const result = complete(input, d.session);
      setInput(result.value);
      if (result.options.length > 1)
        setDevices((prev) => ({
          ...prev,
          [active]: {
            ...prev[active],
            entries: [
              ...prev[active].entries,
              {
                id: crypto.randomUUID(),
                output: result.options.map((c) => `  ${c}`).join("\n"),
              },
            ],
          },
        }));
    }
    if (e.key === "?") {
      e.preventDefault();
      run(input + "?", true);
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex.current === -1) draftInput.current = input;
      historyIndex.current = Math.max(
        -1,
        Math.min(
          d.session.history.length - 1,
          historyIndex.current + (e.key === "ArrowUp" ? 1 : -1),
        ),
      );
      setInput(
        historyIndex.current === -1
          ? draftInput.current
          : d.session.history[
              d.session.history.length - 1 - historyIndex.current
            ],
      );
      requestAnimationFrame(() =>
        inputRef.current?.setSelectionRange(2048, 2048),
      );
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        setDevices((prev) => ({
          ...prev,
          [active]: { ...prev[active], entries: [] },
        }));
      }
      if (
        e.key.toLowerCase() === "c" &&
        !window.getSelection()?.toString() &&
        inputRef.current?.selectionStart === inputRef.current?.selectionEnd
      ) {
        e.preventDefault();
        setDevices((prev) => ({
          ...prev,
          [active]: {
            ...prev[active],
            entries: [
              ...prev[active].entries,
              {
                id: crypto.randomUUID(),
                prompt: currentPrompt,
                command: input + "^C",
                output: "",
              },
            ],
          },
        }));
        setInput("");
        historyIndex.current = -1;
      }
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        run("end");
      }
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        run("exit");
      }
      if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        setInput("");
      }
    }
  }
  function inject(id: FaultId) {
    setDevices((prev) => {
      const device = prev[active],
        next = toggleFault(device.state, id, faultPort);
      return {
        ...prev,
        [active]: {
          ...device,
          state: next,
          entries: [
            ...device.entries,
            {
              id: crypto.randomUUID(),
              output: `[lab] ${faultPort} · ${id} ${hasFault(next, id, faultPort) ? "injected" : "cleared"}`,
            },
          ],
        },
      };
    });
    focus();
  }
  function recover() {
    run("clear lab faults");
  }
  function resetDevice() {
    const fresh = createSwitch(active);
    setDevices((prev) => ({
      ...prev,
      [active]: {
        state: fresh,
        session: freshSession(),
        entries: initialEntry(fresh),
      },
    }));
    setReset(false);
    setInput("");
    historyIndex.current = -1;
  }
  function chooseCommand(command: string) {
    setInput(command);
    setReference(false);
    requestAnimationFrame(focus);
  }
  async function copyOutput() {
    const text = d.entries
      .map((e) =>
        [e.prompt ? `${e.prompt} ${e.command}` : "", e.output]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Export remains available without clipboard access. */
    }
  }
  function exportOutput() {
    const text = d.entries
      .map((e) =>
        [e.prompt ? `${e.prompt} ${e.command}` : "", e.output]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.hostname}-console.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const filteredGroups = search.trim()
    ? [
        {
          name: "搜索结果",
          commands: [
            ...new Set([
              ...SHOW_COMMANDS,
              ...CONFIG_COMMANDS,
              ...PORT_COMMANDS,
              ...SAN_COMMANDS,
            ]),
          ].filter((c) => c.toLowerCase().includes(search.toLowerCase())),
        },
      ]
    : commandGroups;
  return (
    <div
      className={`app ${expanded ? "expanded" : ""} ${!sidebar ? "sidebar-hidden" : ""}`}
    >
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            focus();
          }}
          aria-label="MDS Lab 首页"
        >
          <span className="brand-icon">
            <Terminal size={19} strokeWidth={2.2} />
          </span>
          <span>
            MDS<span className="brand-light"> LAB</span>
          </span>
          <span className="version">v1.0</span>
        </a>
        <div className="header-right">
          <span className="private-label">
            <ShieldCheck size={14} /> 私有实验台
          </span>
          <span className="header-divider" />
          <span className="local-status">
            <i /> 本地模拟
          </span>
        </div>
      </header>
      {sidebar && !expanded && (
        <aside className="sidebar" aria-label="实验台控制">
          <div className="sidebar-section device-section">
            <div className="section-label">
              <span>交换机</span>
              <span className="sub-count">02</span>
              <button
                className="icon-button mobile-sidebar-close"
                aria-label="收起侧栏"
                onClick={() => setSidebar(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="device-list">
              {models.map((model) => (
                <button
                  key={model}
                  className={`device-card ${active === model ? "selected" : ""}`}
                  onClick={() => select(model)}
                  aria-pressed={active === model}
                >
                  <SwitchGlyph model={model} />
                  <span className="device-info">
                    <strong>{devices[model].state.hostname}</strong>
                    <small>
                      {model === "9710"
                        ? "Director · 10-slot"
                        : "Fabric switch · 96-port"}
                    </small>
                  </span>
                  <span className="device-indicator" />
                </button>
              ))}
            </div>
          </div>
          <div className="sidebar-section port-section">
            <div className="section-label">
              <span>端口状态</span>
              <span className="port-count">
                <b>{upPorts}</b> / 96 UP
              </span>
            </div>
            <div className="port-map" aria-label="光纤端口状态">
              {Object.values(state.ports).map((p) => (
                <button
                  key={p.id}
                  className={`port-dot ${isUp(state, p) ? "up" : ""} ${state.faults.some((f) => f.port === p.id) ? "fault" : ""} ${faultPort === p.id ? "chosen" : ""}`}
                  title={`${p.id} · ${portStatus(state, p)}`}
                  aria-label={`${p.id} ${portStatus(state, p)}`}
                  onClick={() => {
                    setFaultPort(p.id);
                    focus();
                  }}
                />
              ))}
            </div>
            <div className="port-legend">
              <span>
                <i className="up" /> 在线
              </span>
              <span>
                <i /> 离线
              </span>
              <span>
                <i className="fault" /> 故障
              </span>
            </div>
          </div>
          <button
            className="port-config-button"
            onClick={() => setPortEditor(true)}
          >
            配置端口 · {faultPort}
          </button>
          <button
            className="port-config-button"
            onClick={() => setSanPanel(true)}
          >
            服务器与存储
          </button>
          <div className="sidebar-section fault-section">
            <div className="section-label">
              <span className="label-with-icon">
                <FlaskConical size={13} /> 故障注入
              </span>
              {state.faults.length > 0 && (
                <span className="fault-count">{state.faults.length}</span>
              )}
            </div>
            <div className="port-select">
              <label htmlFor="fault-port">目标接口</label>
              <select
                id="fault-port"
                value={faultPort}
                onChange={(e) => setFaultPort(e.target.value)}
              >
                {Object.keys(state.ports).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
            <div className="fault-list">
              {FAULTS.map((f) => (
                <button
                  className={`fault-toggle ${hasFault(state, f.id, faultPort) ? "active" : ""}`}
                  key={f.id}
                  onClick={() => inject(f.id)}
                  aria-pressed={hasFault(state, f.id, faultPort)}
                  aria-label={`${f.name} ${faultPort}`}
                  title={f.detail}
                >
                  <span>{f.name}</span>
                  <span className="toggle-track">
                    <span />
                  </span>
                </button>
              ))}
            </div>
            {state.faults.length > 0 && (
              <button className="recover-button" onClick={recover}>
                <RotateCcw size={12} /> 恢复全部故障
              </button>
            )}
          </div>
          <div className="sidebar-bottom">
            <span>
              <span className={storageOk ? "save-dot" : "save-dot warning"} />
              {storageOk ? "工作区已自动保存" : "浏览器存储不可用"}
            </span>
            <button
              className="reset-button"
              onClick={() => setReset(true)}
              aria-label="重置当前交换机"
              title="重置当前交换机"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </aside>
      )}
      <main className="workspace">
        <div className="workspace-heading">
          <div className="breadcrumb">
            {!expanded && (
              <button
                className="icon-button sidebar-control"
                onClick={() => setSidebar(!sidebar)}
                aria-label={sidebar ? "收起侧栏" : "展开侧栏"}
              >
                {sidebar ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <PanelLeftOpen size={16} />
                )}
              </button>
            )}
            <span>实验台</span>
            <ChevronRight size={12} />
            <strong>{state.hostname}</strong>
            <span className="model-badge">MDS {active}</span>
          </div>
          <button
            className={`reference-button ${reference ? "active" : ""}`}
            onClick={() => setReference(!reference)}
          >
            <BookOpen size={15} />
            <span>命令参考</span>
            <span className="reference-key">?</span>
          </button>
        </div>
        <div className="terminal-frame">
          <div className="terminal-toolbar">
            <div className="terminal-tab">
              <Terminal size={14} />
              <span>Console</span>
              <span className="tab-number">01</span>
            </div>
            <div className="terminal-actions">
              <span className="connection">
                <i /> 已连接
              </span>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                title="复制终端记录"
                aria-label="复制终端记录"
                onClick={copyOutput}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                className="icon-button"
                title="导出终端记录"
                aria-label="导出终端记录"
                onClick={exportOutput}
              >
                <Download size={14} />
              </button>
              <button
                className="icon-button"
                title={expanded ? "退出专注模式" : "专注模式"}
                aria-label={expanded ? "退出专注模式" : "专注模式"}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
          <div
            className="terminal-body"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setShowScroll(
                el.scrollHeight - el.scrollTop - el.clientHeight > 100,
              );
            }}
            onClick={(e) => {
              if (
                !window.getSelection()?.toString() &&
                !(e.target as HTMLElement).closest("button")
              )
                focus();
            }}
          >
            <div
              className="terminal-content"
              role="log"
              aria-label={`${state.hostname} 终端输出`}
              aria-live="polite"
              aria-relevant="additions"
            >
              {d.entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`terminal-entry ${entry.banner ? "banner-entry" : ""} ${entry.error ? "error-entry" : ""}`}
                >
                  {entry.prompt && (
                    <div className="command-line">
                      <span className="prompt-text">{entry.prompt}</span>
                      <span>{entry.command}</span>
                    </div>
                  )}
                  {entry.output && (
                    <pre
                      className={
                        !entry.prompt && !entry.banner ? "system-message" : ""
                      }
                    >
                      {entry.output}
                    </pre>
                  )}
                </div>
              ))}
            </div>
            <form
              className="terminal-input-line"
              onSubmit={(e) => {
                e.preventDefault();
                run(input);
              }}
            >
              <label className="prompt-text" htmlFor="terminal-input">
                {currentPrompt}
              </label>
              <input
                ref={inputRef}
                id="terminal-input"
                aria-label="MDS 命令输入"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={input}
                maxLength={2048}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={keyDown}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (/\r?\n/.test(text)) {
                    e.preventDefault();
                    run(input + text);
                  }
                }}
              />
              <span className="input-end" />
            </form>
            <div className="terminal-input-hint">
              输入 <kbd>?</kbd> 查看命令，<kbd>Tab</kbd> 自动补全
            </div>
          </div>
          {showScroll && (
            <button
              className="scroll-bottom"
              onClick={() => {
                jump();
                focus();
              }}
            >
              <ArrowDown size={14} /> 最新输出
            </button>
          )}
          <div className="quick-commands">
            <span className="quick-label">快速查询</span>
            {[
              "show interface brief",
              "show flogi database",
              "show zoneset active",
            ].map((c) => (
              <button key={c} onClick={() => run(c)}>
                <span>{c}</span>
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
          <div className="terminal-status">
            <div>
              <span className="status-indicator" />
              <span>network-admin</span>
              <span className="status-separator">/</span>
              <span>
                {d.session.stack[d.session.stack.length - 1].mode === "exec"
                  ? "EXEC"
                  : "CONFIG"}
              </span>
            </div>
            <div className="keyboard-hints">
              <span>
                <kbd>↑ ↓</kbd> 历史
              </span>
              <span>
                <kbd>Ctrl C</kbd> 取消
              </span>
              <span>
                <kbd>Ctrl L</kbd> 清屏
              </span>
              <span>UTF-8</span>
            </div>
          </div>
        </div>
        <footer className="workspace-footer">
          <span>
            <Network size={12} /> Fibre Channel Sandbox
          </span>
          <span>
            配置仅保存在此浏览器 <span className="footer-dot">·</span>{" "}
            不连接真实设备
          </span>
        </footer>
      </main>
      {sanPanel && (
        <SanPanel
          state={state}
          onClose={() => setSanPanel(false)}
          onCommands={(commands) => {
            let next = state,
              session = freshSession(),
              output = "",
              error = "";
            for (const command of commands) {
              const result = execute(next, session, command);
              output = result.output;
              if (result.error) {
                error = result.output;
                next = commands.length === 1 ? result.state : state;
                break;
              }
              next = result.state;
              session = result.session;
            }
            setDevices((prev) => ({
              ...prev,
              [active]: {
                ...prev[active],
                state: next,
                entries: [
                  ...prev[active].entries,
                  {
                    id: crypto.randomUUID(),
                    command: commands.join("\n"),
                    output,
                    error: !!error,
                    prompt: `${next.hostname}#`,
                  },
                ].slice(-800),
              },
            }));
            return { output, error };
          }}
        />
      )}
      {portEditor && (
        <PortEditor
          state={state}
          port={faultPort}
          onClose={() => setPortEditor(false)}
          onApply={(next, commands) => {
            setDevices((prev) => ({
              ...prev,
              [active]: {
                ...prev[active],
                state: next,
                entries: [
                  ...prev[active].entries,
                  {
                    id: crypto.randomUUID(),
                    command: commands.join("\n"),
                    output: "端口配置已应用。",
                    prompt: `${next.hostname}#`,
                  },
                ].slice(-800),
              },
            }));
          }}
        />
      )}
      {reference && (
        <div className="drawer-overlay" onClick={() => setReference(false)}>
          <div
            className="reference-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-title"
            ref={referenceRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <h2 id="reference-title">
                <BookOpen size={17} /> 命令参考
              </h2>
              <button
                className="icon-button"
                onClick={() => setReference(false)}
                aria-label="关闭命令参考"
              >
                <X size={18} />
              </button>
            </div>
            <div className="reference-search">
              <Search size={16} />
              <input
                aria-label="搜索命令"
                placeholder="搜索命令…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="reference-notice">
              <CircleHelp size={14} />
              <span>点击填入终端。支持缩写、? 帮助和 | 过滤。</span>
            </div>
            <div className="reference-groups">
              {filteredGroups.map((g) => (
                <section key={g.name}>
                  <h3>
                    {g.name}
                    <span>{g.commands.length}</span>
                  </h3>
                  {g.commands.map((c) => (
                    <button onClick={() => chooseCommand(c)} key={c}>
                      <code>{c}</code>
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                  {!g.commands.length && (
                    <p className="no-results">没有匹配的命令</p>
                  )}
                </section>
              ))}
              {!search && (
                <div className="config-example">
                  <h3>配置示例</h3>
                  <pre>
                    {
                      "configure terminal\nvsan database\n  vsan 30 name LAB\n  vsan 30 interface fc1/3\nexit\ninterface fc1/3\n  description Lab host\n  switchport mode F\n  no shutdown\nend\ncopy running-config startup-config"
                    }
                  </pre>
                  <button
                    onClick={() => {
                      run(
                        "configure terminal\nvsan database\nvsan 30 name LAB\nvsan 30 interface fc1/3\nexit\ninterface fc1/3\ndescription Lab host\nswitchport mode F\nno shutdown\nend\ncopy running-config startup-config",
                      );
                      setReference(false);
                    }}
                  >
                    <Terminal size={13} /> 执行示例
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )}
            </div>
            <div className="reference-bottom">
              本地行为模拟，涵盖常用命令；不替代真实 NX-OS。
            </div>
          </div>
        </div>
      )}
      {reset && (
        <div className="modal-overlay" onClick={() => setReset(false)}>
          <div
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reset-symbol">
              <RotateCcw size={22} />
            </div>
            <h2 id="reset-title">重置 {state.hostname}？</h2>
            <p>
              当前设备的运行配置、启动配置、故障与终端记录将恢复初始状态。另一台设备不受影响。
            </p>
            <div className="dialog-actions">
              <button onClick={() => setReset(false)}>取消</button>
              <button className="confirm-reset" onClick={resetDevice}>
                重置设备
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
