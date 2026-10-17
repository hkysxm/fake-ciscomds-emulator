# MDS Lab

私有、本地运行的 Cisco MDS 9710 / 9396 命令实验台。以终端为主，提供独立的设备状态、常用 NX-OS 配置流程和可切换的光纤故障。应用无后端、无遥测，不发送输入的命令或配置；刷新后从当前浏览器的本地存储恢复配置。

## 运行

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run dev
```

```sh
npm run build       # TypeScript 检查 + 生产构建，输出 dist/
npm run preview     # 预览生产构建
npm test            # 命令引擎与状态一致性测试
npm run test:e2e    # 浏览器核心交互测试
```

浏览器测试默认使用 `/usr/bin/chromium`；可以用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已安装的 Chromium 路径。也可安装 Playwright 的 Chromium 后，调整配置使用该浏览器。云环境中 npm 缓存目录不可写时，使用 `npm ci --cache /tmp/mds-npm-cache`。

## 命令与交互

- 设备：`show version`、`show module`、`show inventory`、`show environment`、`show processes cpu`、`show system resources`。
- 接口：`show interface brief`、`show interface fc1/1`、`counters detailed`、`transceiver details`、端口范围、描述、速率、F/E/auto 模式、shutdown、trunk VSAN 和 channel-group。
- Fabric：VSAN 创建、命名、成员分配、挂起/恢复/删除；FLOGI、FCNS、FCDomain、FSPF、路由与 port-channel 查询。
- Zoning：pWWN/FCID/fcalias/device-alias 成员、Zone/ZoneSet 创建与删除、ZoneSet 激活/停用、default-zone 策略。编辑全量库不会改变已激活 ZoneSet，重新激活后生效。
- 别名：FC alias 与 device-alias 的待提交数据库、commit/abort、查询。
- 管理：hostname/switchname、功能开关、管理 IP、网关、NTP、SNMP 位置/联系人、日志、配置查询/保存/恢复。
- 排障：`fcping pwwn 50:00:09:73:00:01:00:01 vsan 10` 根据端口、注册和 zoning 状态返回结果；`ping`/`traceroute` 只测试模拟管理地址和网关，不发送真实报文。
- CLI：`?` 上下文帮助、Tab 补全、常用唯一缩写、↑/↓ 历史、多行粘贴、Ctrl+C 取消、Ctrl+Z 返回 EXEC、Ctrl+L 清屏、`| include / exclude / begin / count` 过滤。命令参考面板可搜索并填入命令。

```text
configure terminal
vsan database
  vsan 30 name LAB
  vsan 30 interface fc1/3-4
exit
interface fc1/3-4
  description Lab hosts
  switchport mode F
  no shutdown
end
show vsan 30
copy running-config startup-config
```

运行配置与启动配置独立；`copy running-config startup-config` 或 `write memory` 保存启动配置，`reload` 从启动配置恢复。浏览器自动保存包含当前运行配置和故障；重置设备会恢复该设备的初始实验状态。MDS 9710 预装两张 48 口模块（fc1/1–48、fc2/1–48）；9396 提供 fc1/1–96。初始 fc1/1、fc1/2 分别连接主机和存储，位于 VSAN 10 并已完成 zoning。两台模拟设备各自独立，不同步配置或邻居状态。

## 故障

侧栏选择目标端口后切换故障，也可使用命令：

```text
lab fault link-down interface fc1/1
show interface fc1/1
show flogi database
show logging last 20
clear lab faults
```

| 故障 ID             | 观察结果                                                  |
| ------------------- | --------------------------------------------------------- |
| `link-down`         | 链路 down，移除 FLOGI/FCNS 注册，端点测试失败             |
| `sfp-missing`       | sfpAbsent，transceiver 不存在，注册丢失                   |
| `crc-errors`        | CRC / 错误字增加，接收光功率下降                          |
| `credit-starvation` | TxWait、丢弃和 credit recovery 增加，剩余 B2B credit 为 0 |
| `vsan-mismatch`     | 端口 isolated，注册丢失                                   |
| `zoning-block`      | FLOGI 保留，端点访问被拒绝                                |

恢复故障后保留历史 CRC 计数；`clear counters interface fc1/1` 清除历史计数。`no shutdown` 不会清除物理故障。

## 模拟范围

这是浏览器内的行为模拟器，覆盖上述常见管理和排障流程，并非完整 Cisco NX-OS 或硬件仿真。环境传感器、系统资源、路由/邻居、流量和计时采用实验数据；不执行真实 SSH、FC 数据转发、HA 切换、固件操作、远程账户认证或增强 zoning 事务。未知/未实现的命令明确返回错误。完整可用命令可在终端中用 `?` 查看，不会将不支持的命令伪装成执行成功。

## 结构

- `src/lib/model.ts`：设备、端口、VSAN、故障和快照。
- `src/lib/engine.ts`：配置层级、命令执行、校验和端点连通性。
- `src/lib/show.ts`：从同一设备状态生成查询结果。
- `src/lib/catalog.ts`：命令参考、缩写和补全。
- `src/App.tsx`：终端、设备切换、故障控制、本地存储。
- `tests/`：命令行为测试与 Playwright 浏览器测试。
