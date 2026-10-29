# 开发笔记（踩过的坑）

> 从 README 搬出来的：对改代码的人有用，对只想装插件的人是噪音。
> 每条都是真踩出来的，不是抄的清单。

## 宿主 / 插件机制

1. **`shell.overlay` 是点击穿透的**，卡片必须显式 `pointerEvents: 'auto'`，否则按钮点不动。
2. 宿主 0.2.x 的兼容闸门按 peer 范围比对；本地包走 `link:`，改完代码要
   `set_plugin enabled:false` → `true`（或 `remove_bundle` + `install_bundle`）才会加载新的 Host 模块。
3. `remove_bundle` 偶尔返回 `not-removable`（`changed:false`），但实际已经移除了 ——
   以 `list_bundles` 里还在不在为准。
4. **Windows 上 PowerShell 5.1 发中文 JSON 会把字符变成 `????`**，测接口一律用 node 的 `fetch`。
5. 用 `--app` 起的独立浏览器窗口在 Windows 上没有原生圆角/阴影，和这套玻璃拟态不搭，已放弃该方案。

## 前端

6. 配色只用一个色相（蓝）+ 中性 + 一个琥珀警示，避免杂色。
7. **槽位占位 `active: false` = 组件渲染抛错了**。用 Node 桩（模拟 `h` / hooks）直接跑组件、
   遍历元素树定位，比反复重载插件快一个数量级 —— 见 `tools/render-probe.cjs`。
8. **返回元素的辅助函数不能再用 `h()` 包**：`h(SomeComponent, props)` 是组件引用，
   `h(numField(...))` 是把「元素」当标签类型丢给 React，直接白屏。grep
   `h\(\s*[a-z][A-Za-z0-9_]*\(` 能一次扫出这一整类写法。
9. 受控输入别用「onChange → 存盘 → 把服务端 state 灌回来」，会吃字/重复字。
   正确姿势：本地 `edits` 缓冲 + 存盘**不**回写整份 state + 只把刚改的字段乐观合并。

## 状态与并发

10. **单文件 JSON 状态必须原子写**：非原子写 + 读失败回落默认值 = 并发下静默清空数据。
    正确姿势：tmp → rename，只有 `ENOENT` 才回落默认值，失败时**先删 tmp 再重试**
    （Windows 上目标被占用时 rename 会失败，不删就会留一堆含明文 cookie 的临时文件）。
11. 进程内互斥锁（内存变量）比文件锁靠谱；文件锁在崩溃后没人清。
12. 连播的「间隔」要能自己恢复：任何一轮结束时都要在 `finally` 里落盘 `nextRunAt`，
    否则一次异常就永久卡死。

## B站 接口

13. `accept-language` 头会让写接口稳定返回 `-111 CSRF 校验失败` —— 手写 headers 时**不要带它**。
14. cookie 值必须原样存（别 `decodeURIComponent`，`SESSDATA` 里的 `%2C` 是它的一部分）。
15. 未登录/匿名时字幕列表基本是空的（`x/player/wbi/v2`），弹幕（`x/v1/dm/list.so`）一直可用。
16. `space/wbi/arc/search` 常被 `-799 / -352` 限频；`fav/folder/created/list` 返 `-400`；
    `dynamic/feed/space` 返 `412`。这几条都别硬依赖。
17. 弹幕接口**封顶 1200 条**：判断「多久没新弹幕」时不能用「最后一条弹幕的时间戳」当参照，
    长视频会被误判成静默几百秒。要用已看进度（`watchPosition`）当参照。
