"""
Deepgram API 封装（适配 deepgram-sdk v6+）。
将本地音频文件转录为文本。
"""

from dataclasses import dataclass
from deepgram import DeepgramClient
from config import config


@dataclass
class TranscriptResult:
    text:     str
    language: str
    duration: float   # 秒


def transcribe(audio_path: str) -> TranscriptResult:
    """
    读取本地 mp3，调用 Deepgram nova-2 转录。

    v6 API：client.listen.v1.media.transcribe_file(request=bytes, **options)

    Returns:
        TranscriptResult 含完整转录文本、检测语言、时长
    """
    client = DeepgramClient(api_key=config.DEEPGRAM_API_KEY)

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    try:
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-2",
            smart_format=True,
            punctuate=True,
            paragraphs=True,
            detect_language=True,
        )
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg or "unauthorized" in msg.lower():
            raise RuntimeError("Deepgram API Key 无效或已过期，请检查 .env 配置")
        if "429" in msg:
            raise RuntimeError("Deepgram 请求过于频繁，请稍后重试")
        raise RuntimeError(f"转录失败：{msg}")

    channel = response.results.channels[0]
    alt     = channel.alternatives[0]

    # paragraphs.transcript 排版更整洁；回退到 alt.transcript
    text = (
        alt.paragraphs.transcript
        if alt.paragraphs and alt.paragraphs.transcript
        else alt.transcript
    ) or ""

    return TranscriptResult(
        text=text.strip(),
        language=getattr(channel, "detected_language", None) or "unknown",
        duration=float(getattr(response.metadata, "duration", 0) or 0),
    )
