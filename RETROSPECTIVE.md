# MediaToMD 项目复盘

> 开发周期：2026-04　开发方式：Claude Code AI 辅助开发

---

## 一、项目概述

MediaToMD 是一个 Chrome 浏览器插件，将网页和音视频内容一键转换为 Markdown 文件保存到本地。核心功能两个：

1. **网页转 Markdown**：提取正文、去除广告导航、保留标题层级和链接，本地完成无需服务器
2. **视频/音频转 Markdown**：yt-dlp 下载音频 → Deepgram 转录 → Claude 整理成结构化文档

技术栈：Chrome Extension MV3 + FastAPI 后端 + Docker 部署。

---

## 二、里程碑完成情况

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 插件框架：manifest、popup UI、settings 页面、测试连接 | ✅ |
| M2 | 网页转 Markdown：Readability.js 提取、本地 HTML→MD 转换、下载 | ✅ |
| M3 | 后端核心链路：yt-dlp + Deepgram + Claude 串联，单 URL 跑通 | ✅ |
| M4 | 插件接后端：service_worker 异步提交、alarms 轮询、结果下载 | ✅ |
| M5 | 历史记录打磨：步骤状态显示、清空、settings 预检、错误分类 | ✅ |
| M6 | Docker 化：docker-compose 一键启动，healthcheck 验证 | ✅ |

---

## 三、技术决策记录

### 3.1 Deepgram SDK v6 适配

**问题**：TDD 写的是 v3 API（`PrerecordedOptions`、`client.listen.rest.v("1")`），但本地安装的是 v6.1.1，导致 `ImportError`。

**解决**：探测 v6 的实际 API 路径，改为 `client.listen.v1.media.transcribe_file(request=bytes, **options)`，所有选项直接作为 kwargs 传入，无需 Options 对象。

**教训**：第三方 SDK 大版本升级 API 变化大，`requirements.txt` 应锁定版本下限（已改为 `deepgram-sdk>=6.0.0`）。

---

### 3.2 MV3 Service Worker 轮询方案

**问题**：MV3 的 service_worker 可被浏览器随时休眠，`setInterval` 不可靠；`chrome.alarms` 最短间隔 30 秒，达不到 TDD 要求的 5 秒。

**解决**：双轨制——
- `chrome.alarms`（30s）作为 service_worker 的兜底，popup 关闭后继续轮询
- popup 打开时用 `setInterval`（5s）向 service_worker 发 `poll_now` 消息触发即时轮询

**效果**：popup 打开时步骤更新约 5 秒延迟，关闭后最长 30 秒更新一次。

---

### 3.3 网页保存的"重复内容"bug

**问题**：在 SPA 页面（YouTube、B 站等）内切换路由时，页面不完整刷新，旧 content_script 仍存活，`window.location.href` 还是旧页面 URL，导致保存了上一个页面的内容。

**根因**：SPA 路由切换不触发 content_script 重新注入，旧实例响应了新请求。

**修复**：popup 拿到 response 后比对 `response.url`（来自 content_script 的 `window.location.href`）和 `tab.url`，不一致时拦截并提示"页面正在跳转"。同时加入系统页面类型检测（`chrome://`、`about:` 等），提前过滤不可保存的页面。

---

### 3.4 HTML → Markdown 本地转换

**选择**：不引入第三方转换库（如 Turndown），直接用 DOMParser + 递归遍历 DOM 实现。

**原因**：Chrome 扩展打包限制，引入第三方库需要 webpack 等构建工具，增加项目复杂度；转换规则本身不复杂，自实现可精确控制行为（如按 PRD 要求过滤图片、保留链接）。

**覆盖范围**：h1-h6、p、a、strong/em、ul/ol/li（嵌套）、code/pre、blockquote、table、hr，过滤 script/style/nav/header/footer。

---

### 3.5 长文本分段处理

**问题**：视频转录文本可能超过 Claude 单次输入的合理长度（15000 字符 ≈ 6000 tokens）。

**方案**：splitter.py 按段落 → 句号 → 逗号优先级在边界切分。多段时：逐段生成详细内容 → 合并后二次调用 Claude 生成摘要和要点。

---

## 四、遇到的坑

| 坑 | 原因 | 解决 |
|----|------|------|
| ffmpeg 未安装导致 yt-dlp 无法转码 | 本地开发环境缺依赖 | `brew install ffmpeg`；Dockerfile 已含 apt install |
| `.env` 里 API_KEY 非默认值 | 用户已提前配置，代码用默认值 `changeme` 测试失败 | 读取实际 `.env` 文件确认真实值 |
| `btoa` 编码中文内容乱码 | 直接 `btoa(content)` 不支持多字节字符 | 改为 `btoa(unescape(encodeURIComponent(content)))` |
| content_script 的 `return true` | 同步 sendResponse 不需要 return true，虚挂消息通道 | 移除 return true |
| Docker build 首次 pip install 报错 | 缓存层问题，`--no-cache` 重建解决 | 无需改代码 |

---

## 五、最终项目结构

```
mediatomd/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py              # FastAPI 入口，CORS 中间件
│   ├── config.py            # 环境变量读取
│   ├── auth.py              # x-api-key 验证
│   ├── api/
│   │   ├── health.py        # GET /health
│   │   └── convert.py       # POST/GET /api/convert，内存 jobs 字典
│   ├── modules/
│   │   ├── downloader.py    # yt-dlp 封装
│   │   ├── transcriber.py   # Deepgram SDK v6
│   │   ├── structurer.py    # Claude API，含长文本分段
│   │   └── splitter.py      # 文本分段工具
│   └── prompts/
│       └── structure.txt    # Claude prompt 模板
├── extension/
│   ├── manifest.json        # MV3，permissions: activeTab/tabs/downloads/storage/alarms
│   ├── popup.html/js        # 主弹窗：双 Tab + 历史记录
│   ├── settings.html/js     # 设置页：后端地址 + 私钥 + 测试连接
│   ├── service_worker.js    # 异步任务：提交 → alarms 轮询 → 下载
│   ├── content_script.js    # 注入网页，Readability 提取正文
│   ├── readability.js       # Mozilla Readability（2812 行，官方版本）
│   └── icons/               # 16/48/128px
├── docker-compose.yml       # restart + healthcheck
├── .env                     # 实际密钥（不入库）
├── .env.example             # 模板
└── tmp/                     # Docker volume 挂载，临时音频文件
```

---

## 六、数据流总览

```
【网页转换】
用户点击「保存当前网页」
  → popup.js 校验 URL 类型
  → chrome.tabs.sendMessage → content_script.js
  → Readability.parse() 提取 HTML 正文
  → popup.js htmlToMarkdown() 本地转换
  → chrome.downloads.download() 保存 .md
  → chrome.storage.local 写入历史 ✅

【视频转换】
用户粘贴链接，点「转换」
  → popup.js 检查 settings → 写历史 ⏳
  → chrome.runtime.sendMessage → service_worker.js
  → POST /api/convert → 后端返回 job_id
  → chrome.alarms 每 30s + popup setInterval 每 5s 轮询
  → GET /api/convert/{job_id} 返回 step 更新历史显示
  → status=done → chrome.downloads.download() 保存 .md
  → chrome.storage.local 更新历史 ✅ 或 ❌
```

---

## 七、未完成 / 后续方向

### 本期未做（PRD 范围外）
- B 站 cookie 注入（需要登录的视频）
- 系统通知（视频完成时推送）
- Safari / Firefox 支持

### 技术债
- **jobs 字典存内存**：后端重启后所有进行中任务丢失，客户端轮询会拿到 404。生产环境应改用 Redis 或 SQLite 持久化。
- **无并发限制**：同时提交多个视频任务时，yt-dlp 进程会并发运行，可能撑爆内存。应加任务队列（Celery 或 asyncio.Queue）。
- **临时文件清理**：下载/转录完成后 `shutil.rmtree` 已执行，但异常中断时可能残留。可加定时清理。

### 可扩展方向
- 替换 Deepgram → 本地 Whisper（私有化部署）
- 替换 Claude → 其他模型
- 直接写入 Obsidian Vault（通过本地文件 API）
- 多标签页批量保存
