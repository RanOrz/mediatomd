"""
Claude API 封装：将转录文本整理为结构化 Markdown。
支持长文本分段处理。
"""

from datetime import date
from pathlib import Path
import anthropic

from config import config
from modules.splitter import split, MAX_CHARS
from modules.transcriber import TranscriptResult

_PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "structure.txt"

# 多段处理时，单段只提取"详细内容"
_PART_PROMPT = """你是内容整理助手。这是一段较长音频转录的第 {part}/{total} 部分，视频标题为「{title}」。

请将以下转录内容整理成清晰的段落，去除口语化重复，保留所有关键信息。
直接输出整理后的正文（Markdown 段落），不需要标题、摘要或要点。

## 转录内容

{transcript}
"""

# 多段合并后，生成摘要和要点
_SUMMARY_PROMPT = """你是内容整理助手。以下是视频「{title}」的完整整理内容（已按段落整理好）。

请基于以下内容生成：

## 摘要

（用 3-5 句话概括核心内容）

## 核心要点

- 要点一
- 要点二
（列出 3-8 个最重要的观点）

## 详细内容

{detailed}
"""


def structure(transcript: TranscriptResult, metadata: dict) -> str:
    """
    将转录结果整理为带 frontmatter 的完整 Markdown 文档。

    Returns:
        完整 Markdown 字符串（含 frontmatter + 正文 + 原始转录）
    """
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    title  = metadata.get("title", "未知标题")

    segments = split(transcript.text)

    if len(segments) == 1:
        body = _call_claude(client, _build_full_prompt(transcript.text, title))
    else:
        # 逐段整理详细内容
        parts = []
        for i, seg in enumerate(segments):
            prompt = _PART_PROMPT.format(
                part=i + 1, total=len(segments),
                title=title, transcript=seg,
            )
            parts.append(_call_claude(client, prompt))

        # 合并 → 再生成摘要 + 要点
        detailed = "\n\n".join(
            f"### 第 {i+1} 部分\n\n{p}" for i, p in enumerate(parts)
        )
        body = _call_claude(
            client,
            _SUMMARY_PROMPT.format(title=title, detailed=detailed),
        )

    return _wrap(body, metadata, transcript)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_full_prompt(transcript_text: str, title: str) -> str:
    template = _PROMPT_FILE.read_text(encoding="utf-8")
    return template.format(title=title, transcript=transcript_text)


def _call_claude(client: anthropic.Anthropic, prompt: str) -> str:
    try:
        message = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        raise RuntimeError("Anthropic API Key 无效或已过期，请检查 .env 配置")
    except anthropic.RateLimitError:
        raise RuntimeError("Claude API 请求过于频繁，请稍后重试")
    except anthropic.APIError as e:
        raise RuntimeError(f"Claude API 错误：{e}")
    return message.content[0].text.strip()


def _fmt_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _wrap(body: str, metadata: dict, transcript: TranscriptResult) -> str:
    title    = metadata.get("title", "未知标题")
    url      = metadata.get("url", "")
    duration = _fmt_duration(transcript.duration)
    today    = date.today().isoformat()

    frontmatter = (
        f'---\n'
        f'title: "{title}"\n'
        f'source: "{url}"\n'
        f'date: {today}\n'
        f'duration: "{duration}"\n'
        f'language: "{transcript.language}"\n'
        f'---\n\n'
    )

    raw = f"\n\n## 原始转录\n\n{transcript.text}\n"

    return frontmatter + body + raw
