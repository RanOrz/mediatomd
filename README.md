# MediaToMD

Chrome 浏览器插件 + FastAPI 后端，将网页和音视频内容一键转换为 Markdown 文件保存到本地。

---

## 功能

### 网页 → Markdown
- 基于 Mozilla Readability 提取正文，去除广告、导航、页脚
- 支持保留标题层级、链接、代码块、表格、列表
- **选区保存**：选中网页任意文字后打开插件，可单独保存选中内容
- 本地完成转换，无需服务器

### 音视频 → Markdown
- 支持 YouTube、B 站、抖音、爱优腾芒、Twitch、Vimeo、SoundCloud 等主流平台
- 流程：yt-dlp 下载音频 → Deepgram 语音转录 → Claude AI 整理为结构化笔记
- 异步处理，提交后可关闭弹窗，完成后自动下载到本地

---

## 项目结构

```
mediatomd/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 环境变量
│   ├── auth.py              # API Key 验证
│   ├── api/
│   │   ├── health.py        # GET /health
│   │   └── convert.py       # POST/GET /api/convert
│   ├── modules/
│   │   ├── downloader.py    # yt-dlp 封装
│   │   ├── transcriber.py   # Deepgram SDK v6
│   │   ├── structurer.py    # Claude API，含长文本分段
│   │   └── splitter.py      # 文本分段工具
│   └── prompts/
│       └── structure.txt    # Claude prompt 模板
├── extension/
│   ├── manifest.json        # MV3
│   ├── popup.html / popup.js
│   ├── settings.html / settings.js
│   ├── service_worker.js    # 异步任务 + 轮询
│   ├── content_script.js    # 注入网页，提取正文 / 选区
│   └── readability.js       # Mozilla Readability
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 部署

### 前置条件

- Docker + Docker Compose
- [Anthropic API Key](https://console.anthropic.com/)
- [Deepgram API Key](https://console.deepgram.com/)

### 启动后端

```bash
# 1. 克隆项目
git clone https://github.com/RanOrz/mediatomd.git
cd mediatomd

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入真实密钥：
#   ANTHROPIC_API_KEY=sk-ant-xxx
#   DEEPGRAM_API_KEY=xxx
#   API_KEY=自定义私钥（插件连接时需要填写相同的值）

# 3. 启动
docker compose up -d

# 4. 验证
curl http://localhost:8765/health
# → {"status":"ok"}
```

### 安装插件

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序**，选择项目中的 `extension/` 目录
4. 点击插件图标 → 右上角 ⚙ 设置：
   - 后端地址：`http://localhost:8765`
   - 私钥：填写 `.env` 中 `API_KEY` 的值
   - 点击**测试连接**，显示绿色即可

---

## 使用

### 保存网页

打开任意文章页面 → 点击插件图标 → 选择**网页** → 点击「保存当前网页」

### 保存选中内容

在网页上选中文字 → 点击插件图标 → 插件自动检测到选区并显示预览 → 点击「保存选中内容」

### 转换音视频

在视频页面点击插件图标 → 选择**视频 / 音频** → 点击「当前页面」自动填入链接 → 点击「转换」

转换结果自动下载为 `.md` 文件，历史记录中可查看处理进度。

---

## 技术说明

| 组件 | 技术 |
|------|------|
| 浏览器插件 | Chrome Extension Manifest V3 |
| 网页提取 | Mozilla Readability.js |
| HTML 转 Markdown | 本地 DOMParser 递归遍历（无第三方依赖） |
| 音频下载 | yt-dlp + ffmpeg |
| 语音转录 | Deepgram nova-2 模型 |
| 内容整理 | Anthropic Claude API |
| 后端框架 | FastAPI + uvicorn |
| 部署 | Docker + docker-compose |

### MV3 轮询方案

Chrome MV3 的 `chrome.alarms` 最短间隔为 30 秒。插件采用双轨策略：弹窗打开时用 `setInterval`（5 秒）触发即时轮询，弹窗关闭后由 `chrome.alarms`（30 秒）兜底，确保任务状态持续更新。

---

## 已知限制

- 需要登录才能访问的视频（B 站大会员、YouTube 会员等）暂不支持
- 后端任务状态存内存，重启后进行中的任务丢失
- 暂不支持 Safari / Firefox

---

## License

MIT
