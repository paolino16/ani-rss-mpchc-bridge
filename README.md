# ANI-RSS → MPC-HC Bridge

[安装或更新油猴脚本](https://raw.githubusercontent.com/paolino16/ani-rss-mpchc-bridge/main/ani-rss-mpchc-bridge.user.js)

当前版本：1.5.2。支持新版 Movi/WASM 播放器界面隐藏，保留旧版 Artplayer 兼容规则。

## 使用

1. 安装 Tampermonkey 后点击上方安装链接；已有同名脚本会更新。
2. 本地播放桥接服务需运行在 http://127.0.0.1:58000/play。
3. 脚本默认匹配 http://127.0.0.1:7789/，HTTPS 同端口也匹配。
4. 如果本地桥接使用了自定义 TOKEN，请在安装后确认与服务配置一致；仓库仅包含占位值。
5. 安装此版本一次后，油猴可通过 metadata 地址检查更新。后续发布必须同步提升 .user.js 和 .meta.js 的 @version。

本次改动已通过 JavaScript 语法检查；尚未执行完整的本地播放测试。
