"""
yt-dlp 封装：下载音频并返回本地路径和元数据。
"""

import os
import yt_dlp


def download(url: str, tmp_dir: str) -> tuple[str, dict]:
    """
    用 yt-dlp 提取音频，转为 mp3 保存到 tmp_dir。

    Returns:
        audio_path : 本地 .mp3 文件的绝对路径
        metadata   : { title, url, duration(秒) }
    """
    out_template = os.path.join(tmp_dir, "audio")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,       # 只下载单个视频
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "Sign in" in msg or "login" in msg.lower():
            raise RuntimeError("该视频需要登录才能下载（可能是会员内容）")
        if "Private video" in msg:
            raise RuntimeError("该视频是私密视频，无法下载")
        if "not available" in msg.lower():
            raise RuntimeError("该视频在当前地区不可用或已下架")
        raise RuntimeError(f"下载失败：{msg.splitlines()[-1]}")

    # yt-dlp 在文件名后附加 .mp3
    audio_path = f"{out_template}.mp3"
    if not os.path.exists(audio_path):
        raise RuntimeError("音频提取失败，请确认链接指向视频/音频内容")

    metadata = {
        "title":    info.get("title", "未知标题"),
        "url":      url,
        "duration": info.get("duration") or 0,  # 秒
    }
    return audio_path, metadata
