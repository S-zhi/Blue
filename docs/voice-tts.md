# 双向流式语音合成

本项目通过同源 BFF 接入豆包双向流式 TTS。API Key 与音色配置只保存在服务端 `.env`，浏览器连接 `/api/tts`，接收 16-bit little-endian 单声道 PCM 并通过 Web Audio 排队播放。

## 配置

复制 `.env.example` 为 `.env`，至少设置：

```dotenv
DOUBAO_API_KEY=your-api-key
DOUBAO_TTS_SPEAKER=your-speaker-id
```

默认使用 `seed-tts-2.0`、24 kHz PCM。声音复刻可将 `DOUBAO_TTS_RESOURCE_ID` 改为 `seed-icl-2.0`。生产环境应设置精确的 `TTS_ALLOWED_ORIGINS`，并在反向代理层增加登录鉴权和限流。

## 当前接入面

页面已移除左下角语音合成测试面板。Agent 回答自动进入 TTS，声音与字幕共用同一轮播放。TTS 开始时释放麦克风，结束后保持关闭；点击圆环可以打断播放并开始下一轮输入。

服务端把句子开始/结束事件与累计 PCM 字节位置一并转发，前端等到句子的音频边界就绪后排队播放。字幕按 Web Audio 的实际播放时钟切换句子，网络停顿不推进字幕；若服务返回兼容的词级时间戳，则按词推进。未返回任何可用分句或时间信息时，整段文字在音频开始时显示。回答结束后完整文本保留在本次会话历史中，刷新清空。

点击圆环或发送文字时提前解锁 AudioContext，后续识别和 Agent 网络请求共用这次已解锁的播放上下文。取消、页面离开和音频异常会清理播放及字幕定时器。

页面启动后同时暴露一个很小的编程调用面：

```js
await window.blueTts.speak('你好，这是一条流式语音合成测试。');
window.blueTts.stop();
```

`speak` 会中止上一轮播放，建立独立会话，发送一段文本并在服务端返回 `SessionFinished` 后等待本地音频播放完毕。服务端协议已经支持多个 `TaskRequest`，后续接入大模型 token 流时可以扩展浏览器调用层，逐段发送文本，而无需重写上游协议适配。

浏览器自动播放策略要求 `speak` 最好由点击等用户手势触发。真实音色、资源授权、余额和公网 WSS 仍需在部署环境联调验证。

## 无声音排查与验证

修改服务端代码后需要重启 `npm start`，再刷新页面；`npm run build` 本身不会更新已运行的 Node 进程。健康接口包含 `protocolVersion: "bidirectional-v3.3"`，新版页面遇到旧服务会明确提示重启。

```bash
npm test
npm run build
# 关闭旧服务后启动
npm start
# 另一个终端：检查本地 BFF、真实云端请求和 PCM 内容
npm run test:tts:live -- --url http://127.0.0.1:3000
```

也可以单独运行 `npm run test:tts:live`，直接使用项目 `.env` 测试同一套 BFF 状态机和云端连接，无需启动本地端口。此命令会合成固定短句，产生少量正常 TTS 用量；不输出密钥、音色 ID 或云端原始响应。成功会输出音频帧数、字节数、首包耗时、音频时长和非零 PCM 幅度。它验证音频回包，不能替代浏览器扬声器试听。

**终端试听（macOS）：** `npm run test:tts:play`，也可使用 `npm run test:tts:live -- --play`。这个选项会将收到的 PCM 封装为临时 WAV，用系统自带 `afplay` 经当前默认输出设备播放，结束后删除本次临时文件，无需额外依赖。使用 `npm run test:tts:play -- --url http://127.0.0.1:3000` 可以同时检查已启动的 BFF。普通 `test:tts:live` 仍只检查数据，并会明确打印“不会播放”的提示。此终端试听独立于网页：终端能听到但网页无声时，再排查浏览器音频权限、标签页静音和运行中的前后端版本。

对话区状态显示思考、准备语音及回答中。音频权限在点击时立即申请；停止会取消尚在进行的健康检查、连接或播放。音频结束以 Web Audio 实际 `onended` 为准。无音频、全静音、残缺样本、云端失败或音频被浏览器暂停都显示明确错误码，不会伪报播放完成。

协议回归覆盖：文本在 `req_params.text` 中；`SessionCanceled=151`、`SessionFinished=152`、`SessionFailed=153`；`TTSResponse=352`；无事件的错误帧先解析错误码；`AudioOnlyServer` 始终作为二进制音频解码。默认不压缩请求，同时保留 Gzip 编解码能力。此前的本地测试复用了实现中的错误常量；新增测试使用独立的字面量事件编号和字节帧，避免相同错误相互验证。
