# 技术设计文档 · MediaToMD

> **版本：** v0.2　**日期：** 2026-04　**关联 PRD：** MediaToMD_PRD.md  
> **开发方式：** Claude Code　**部署：** Docker 本地，后续迁移云服务器

---

## 1. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 插件框架 | Chrome Extension Manifest V3 | 当前 Chrome 标准 |
| 网页提取 | Readability.js | Mozilla 开源，正文提取准确率高 |
| 后端框架 | FastAPI | Python，异步支持，自动生成 API 文档 |
| 音频下载 | yt-dlp | 后端运行，支持 1000+ 平台 |
| 语音转录 | Deepgram API | 云端转录，支持中英文 |
| AI 整理 | Anthropic Claude API | 结构化 Markdown 输出 |
| 历史记录 | Chrome Storage API | 本地存储，不需要数据库 |
| 安全 | 固定私钥验证 | 插件请求时携带，后端校验 |
| 容器化 | Docker + Docker Compose | 本地开发，后续一键迁移 |

---

## 2. 项目结构

```
mediatomd/
│
├── backend/                        # FastAPI 后端
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                     # 入口，注册路由
│   ├── config.py                   # 配置管理（读取 .env）
│   ├── auth.py                     # 私钥验证中间件
│   │
│   ├── api/
│   │   ├── convert.py              # 视频转录接口
│   │   └── health.py               # 健康检查接口
│   │
│   ├── modules/
│   │   ├── downloader.py           # yt-dlp 封装
│   │   ├── transcriber.py          # Deepgram API 封装
│   │   ├── structurer.py           # Claude API 封装
│   │   └── splitter.py             # 长文本分段工具
│   │
│   └── prompts/
│       └── structure.txt           # Claude Prompt 模板
│
├── extension/                      # Chrome 插件
│   ├── manifest.json               # 插件配置
│   ├── popup.html                  # 弹窗页面
│   ├── popup.js                    # 弹窗逻辑
│   ├── settings.html               # 设置页面（配置后端地址）
│   ├── settings.js                 # 设置页逻辑
│   ├── service_worker.js           # 后台任务处理
│   ├── content_script.js           # 注入网页，提取正文
│   ├── readability.js              # Readability.js 库
│   └── icons/                      # 插件图标
│
├── docker-compose.yml
└── .env
```

---

## 3. Chrome 插件设计

### 3.1 manifest.json 关键配置

```json
{
  "manifest_version": 3,
  "name": "MediaToMD",
  "version": "0.1.0",
  "permissions": [
    "activeTab",
    "downloads",
    "storage"
  ],
  "background": {
    "service_worker": "service_worker.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["readability.js", "content_script.js"]
    }
  ],
  "options_page": "settings.html"
}
```

### 3.2 页面构成

**popup.html · 主弹窗（两个 Tab）**

```
┌─────────────────────────────┐
│  MediaToMD                  │
│  [ 网页 ]  [ 视频/音频 ]    │  ← Tab 切换
├─────────────────────────────┤
│                             │
│  Tab 1：网页                │
│  [ 保存当前网页 ]           │
│                             │
│  Tab 2：视频/音频           │
│  [ 粘贴链接...           ]  │
│  [ 转换 ]                   │
│                             │
├─────────────────────────────┤
│  历史记录                   │
│  ✅ 2026-04-08_标题一       │
│  ⏳ 2026-04-08_标题二       │
│  ❌ 2026-04-07_标题三       │
└─────────────────────────────┘
```

**settings.html · 设置页**

```
┌─────────────────────────────┐
│  设置                       │
│                             │
│  后端地址                   │
│  [ http://localhost:8000  ] │
│                             │
│  私钥                       │
│  [ ****************       ] │
│                             │
│  [ 保存 ]  [ 测试连接 ]     │
└─────────────────────────────┘
```

### 3.3 各文件职责

**content_script.js**

注入到当前网页，负责提取正文内容。

```javascript
// 接收 popup 的提取指令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "extract") {
    const article = new Readability(document.cloneNode(true)).parse();
    sendResponse({
      title: article.title,
      content: article.content,   // HTML 格式正文
      url: window.location.href
    });
  }
});
```

**popup.js**

处理用户交互，协调 content_script 和 service_worker。

```
网页转换流程：
  用户点击「保存当前网页」
      ↓
  发消息给 content_script，获取网页内容
      ↓
  HTML 转 Markdown（本地处理，无需后端）
      ↓
  Chrome Downloads API 保存到桌面
      ↓
  写入历史记录（Chrome Storage）

视频转换流程：
  用户粘贴链接，点击「转换」
      ↓
  发消息给 service_worker，传入链接
      ↓
  显示「处理中 ⏳」写入历史记录
      ↓
  （等待 service_worker 完成）
```

**service_worker.js**

后台异步处理视频转录任务。

```
收到链接
    ↓
POST /api/convert → 后端
    ↓
轮询任务状态（每 5 秒一次）
    ↓
收到结果
    ↓
Chrome Downloads API 保存到桌面
    ↓
更新历史记录状态为 ✅ 或 ❌
```

---

## 4. 后端设计

### 4.1 API 接口

**GET /health · 健康检查**

```json
响应：{ "status": "ok" }
```

用于设置页「测试连接」功能。

**POST /api/convert · 提交转换任务**

```json
请求头：
X-API-Key: your-private-key

请求体：
{ "url": "https://youtube.com/watch?v=xxx" }

响应：
{ "job_id": "abc123", "status": "processing" }
```

**GET /api/convert/{job_id} · 查询任务状态**

```json
请求头：
X-API-Key: your-private-key

响应（处理中）：
{ "job_id": "abc123", "status": "processing", "step": "transcribing" }

响应（完成）：
{ "job_id": "abc123", "status": "done", "content": "# 标题\n...", "title": "视频标题" }

响应（失败）：
{ "job_id": "abc123", "status": "failed", "error": "不支持的链接" }
```

### 4.2 处理流程

```
POST /api/convert 收到链接
        ↓
生成 job_id，状态设为 processing
        ↓ step = "downloading"
downloader.download()        # yt-dlp 提取音频
        ↓ step = "transcribing"
transcriber.transcribe()     # Deepgram API 转录
        ↓ step = "structuring"
structurer.structure()       # Claude API 整理
        ↓
job 状态设为 done，存储结果
        ↓
插件轮询拿到结果，保存到桌面
```

任务状态和结果存在**内存字典**里，不需要数据库：

```python
jobs: dict[str, JobResult] = {}
```

### 4.3 安全验证

所有接口（除 /health）都需要验证私钥：

```python
# auth.py
def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
```

### 4.4 模块设计

**downloader.py**

```python
def download(url: str, tmp_dir: str) -> tuple[str, dict]:
    """
    Returns:
        audio_path: 本地音频文件路径（.mp3）
        metadata: { title, url, duration }
    """
```

**transcriber.py**

```python
def transcribe(audio_path: str) -> TranscriptResult:
    """
    Returns:
        TranscriptResult:
            .text: str          完整转录文本
            .language: str      检测到的语言
            .duration: float    时长（秒）
    """
```

**structurer.py**

```python
def structure(transcript: TranscriptResult, title: str) -> str:
    """
    Returns:
        Markdown 正文字符串（含 frontmatter）
    """
```

- 短文本：单次调用 Claude API
- 长文本：splitter 分段 → 逐段整理 → 合并

**splitter.py**

```python
MAX_CHARS = 15000  # 约 6000 tokens，留 buffer 给 prompt

def split(text: str) -> list[str]:
    """在句子边界处切分，优先级：段落 > 句号 > 逗号"""
```

---

## 5. 数据流转

```
用户点击「保存当前网页」
        ↓
content_script 提取 HTML 正文
        ↓
popup.js 本地转换为 Markdown
        ↓
Chrome Downloads API → 桌面 .md 文件
        ↓
Chrome Storage 写入历史记录 ✅


用户粘贴链接，点击「转换」
        ↓
service_worker 发送 POST /api/convert
        ↓
Chrome Storage 写入历史记录 ⏳
        ↓
后端异步处理（下载 → 转录 → 整理）
        ↓
service_worker 轮询 GET /api/convert/{job_id}
        ↓
收到结果 → Chrome Downloads API → 桌面 .md 文件
        ↓
Chrome Storage 更新历史记录 ✅ 或 ❌
```

---

## 6. 文件命名

```python
# 格式：YYYY-MM-DD_标题.md
def make_filename(title: str) -> str:
    date = datetime.today().strftime('%Y-%m-%d')
    safe_title = re.sub(r'[/\\:*?"<>|]', '-', title)[:50]
    return f"{date}_{safe_title}.md"
```

---

## 7. 历史记录结构（Chrome Storage）

```javascript
// Chrome Storage 存储格式
{
  "history": [
    {
      "id": "abc123",
      "title": "如何学习产品思维",
      "type": "webpage",        // webpage / video
      "status": "done",         // processing / done / failed
      "error": null,
      "created_at": "2026-04-08T10:00:00"
    }
  ]
}
```

---

## 8. 环境变量

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-xxx
DEEPGRAM_API_KEY=xxx
API_KEY=your-private-key        # 插件和后端之间的私钥
```

---

## 9. Docker 配置

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env
    volumes:
      - ./tmp:/tmp/mediatomd    # 临时音频文件目录
```

**启动命令：**

```bash
docker-compose up --build
# 后端运行在：http://localhost:8000
# API 文档：http://localhost:8000/docs
```

---

## 10. 开发里程碑

| 阶段 | 内容 |
|------|------|
| M1 · 插件框架 | manifest.json、popup UI、settings 页面跑通，测试连接功能可用 |
| M2 · 网页转 Markdown | content_script 提取正文，本地转 Markdown，保存到桌面 |
| M3 · 后端核心链路 | FastAPI + yt-dlp + Deepgram + Claude 串联，单个 URL 跑通 |
| M4 · 插件接后端 | service_worker 异步调用后端，轮询状态，结果保存到桌面 |
| M5 · 历史记录 | Chrome Storage 存储，✅ / ⏳ / ❌ 状态显示正确 |
| M6 · Docker 化 | docker-compose 一键启动，本地稳定运行 |
