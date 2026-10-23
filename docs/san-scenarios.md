# 服务器、存储与多路径实验

左侧点击 **服务器与存储 → 创建双 HBA / 双控制器演示**。需要空闲的 `fc1/3-6`、未使用的 VSAN 30 和 DEMO_HOST / DEMO_STORAGE 名称；初始化失败时不会留下部分配置。

演示创建一台双 HBA 服务器、一台双目标端口存储和 LUN 0（1024 个 4 KiB 块），配置 VSAN、Zoning 与读写映射，形成四条可用路径。

1. 输入内容并点击“写入块”，再“读取块”核对数据。
2. 将策略设为“故障切换”，断开刚才使用的 HBA 端口；再次读取会切换到另一 HBA，数据保持不变。
3. 断开两个 HBA，I/O 报无可用路径；接回任一 HBA 后恢复。目标端口也可独立断开/接入。
4. 将映射改为“只读”，读取成功、写入失败；移除映射后无法访问 LUN。
5. 切换“LUN 离线”或“存储离线”，观察路径失效和 I/O 失败；上线后数据仍保留。
6. 关闭面板，注入光模块缺失、链路中断、BB Credit 耗尽，或变更 Zoning / VSAN，再返回观察路径。CRC 故障模拟重试，保留可用路径并在 I/O 结果中标注。

轮询策略逐次轮换可用路径；故障切换策略保持当前可用路径，失效后自动选另一条，不主动回切。故障切换计数只在发起 I/O、发现上次路径不可用且存在替代路径时增加。所有路径不可用时立即报错，不模拟排队。

## 自定义设备与 LUN

先通过“配置端口”接入对应 PWWN，服务器使用 Initiator，存储使用 Target。配置正确的 VSAN 与活动 Zoning 后，在面板或 CLI 定义设备身份、创建 LUN 并映射：

```text
lab san host add SERVER01 21:00:00:00:00:00:00:03
lab san storage add ARRAY01 50:00:00:00:00:00:00:04
lab san lun create ARRAY01 0 1024
lab san map ARRAY01 0 SERVER01 rw
lab san host policy SERVER01 failover
show san paths SERVER01 ARRAY01 0
lab san io write SERVER01 ARRAY01 0 0 hello SAN
lab san io read SERVER01 ARRAY01 0 0
show san io SERVER01 ARRAY01 0
```

多端口设备用逗号分隔 PWWN，每个设备最多 8 个，同一 PWWN 不可归属多个设备。LUN ID 范围 0–16383，每个 LUN 1–1048576 块，地址从 0 开始。

```text
lab san map ARRAY01 0 SERVER01 ro
lab san unmap ARRAY01 0 SERVER01
lab san lun offline ARRAY01 0
lab san lun online ARRAY01 0
lab san storage offline ARRAY01
lab san storage online ARRAY01
show san hosts
show san storage
```

## 模拟边界与保存

- `lab san` 是实验台命令，不是真实 Cisco、Linux 或存储厂商 CLI。
- 使用浏览器内的稀疏数据块；每个 LUN 最多保存 128 个写入块，每块最多 4 KiB UTF-8 文本。空块读出空字符串。未模拟 SCSI 协议、文件系统、真实吞吐量或持续后台负载。
- 路径限当前交换机内；9710、9396 仍是独立实验台，未建立跨交换机 ISL 或双 Fabric 多路径。
- 设备身份、LUN 映射、数据及 I/O 计数随浏览器工作区自动保存。交换机 `reload` 仅恢复交换机启动配置，不回滚外部服务器/存储数据；交换机端口和 Zoning 配置需 `copy running-config startup-config` 保存。
- 重置当前交换机会同时清空该工作区中的模拟 SAN 设备与数据。
