# 端口变更实验

在左侧选择端口，然后点击“配置端口”。可修改单端口或同槽范围（例如 `fc1/3-6`），也可使用逗号选择不同槽端口。表单内全部设置会应用到目标端口；提交前可以展开配置命令。任一命令失败时，这次表单变更全部撤回。

支持描述、F/E/auto 模式、2/4/8/16/32 Gbps 或自动速率、VSAN、Trunk 和允许 VSAN 列表、接收 BB Credit、Beacon、链路 SNMP Trap、Shutdown。接收 Credit 在本实验台允许 1–500，不代表所有真实板卡的硬件范围；自动速率模拟协商为 32 Gbps。

## 常见变更

```text
configure terminal
interface fc1/3-6
 description BACKUP_SAN
 switchport mode F
 switchport speed auto
 switchport vsan 20
 switchport fcrxbbcredit 64
 beacon
 snmp trap link-status
 no shutdown
end
show interface fc1/3
show running-config interface fc1/3
copy running-config startup-config
```

`switchport vsan` 要求 VSAN 已存在，可先通过 `vsan database` 创建。支持 `no beacon`、`no snmp trap link-status`、`no switchport fcrxbbcredit`、`no switchport vsan`、`no switchport speed`、`no switchport mode`、`no switchport trunk mode`、`no switchport trunk allowed vsan`。

`default interface fc1/3-6` 恢复本实验台的接口基线：F 模式、32 Gbps、VSAN 1、接收 Credit 16、非 Shutdown、Trunk 关闭、允许列表 1,10,20、Trap 开启，无描述、Beacon 和通道组。已接入的模拟设备及计数器不变。

## 接入模拟设备

所有 96 个端口均可接入设备。选择“模拟设备接入 → 连接”，设置角色和唯一 PWWN；连接操作限单端口，断开支持批量。

```text
configure terminal
interface fc1/3
 switchport mode F
 switchport vsan 10
 lab endpoint connect Target pwwn 50:00:00:00:00:00:00:03
end
show flogi database
show fcns database
```

`lab endpoint` 是实验台专用命令。支持 Initiator、Target、Switch；`lab endpoint disconnect` 断开设备。FLOGI 仍受端口模式、Shutdown、VSAN 和故障影响。连接设备后仍需配置并激活 Zoning 才能通过对应的 FCPING 测试。

## 复制 Zoning 配置

```text
configure terminal
zone clone ESXI01_STORAGE01 COPY_ZONE vsan 10
zoneset clone PROD_FABRIC COPY_SET vsan 10
end
show zone name COPY_ZONE vsan 10
show zoneset name COPY_SET vsan 10
```

复制不会改变活动 Zoneset；Zoneset 复制保留原 Zone 名称引用，不会递归复制 Zone。目标名称已存在会拒绝。

配置自动保存在当前浏览器；`copy running-config startup-config` 保存独立启动快照，`reload` 恢复启动快照。旧浏览器配置会自动补充新增字段。
