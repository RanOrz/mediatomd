"""
长文本分段工具。
在句子边界处切分，优先级：段落 > 句号/。 > 逗号/，
"""

MAX_CHARS = 15000  # 约 6000 tokens，留 buffer 给 prompt


def split(text: str) -> list[str]:
    """将文本切分为不超过 MAX_CHARS 的段落列表。"""
    if len(text) <= MAX_CHARS:
        return [text]

    segments: list[str] = []
    remaining = text.strip()

    while len(remaining) > MAX_CHARS:
        chunk = remaining[:MAX_CHARS]

        # 优先：段落边界
        cut = chunk.rfind("\n\n")
        if cut < MAX_CHARS * 0.5:
            # 次选：中文句号 / 英文句号
            cut = max(chunk.rfind("。"), chunk.rfind(". "))
        if cut < MAX_CHARS * 0.5:
            # 末选：逗号
            cut = max(chunk.rfind("，"), chunk.rfind(", "))
        if cut < MAX_CHARS * 0.5:
            cut = MAX_CHARS - 1  # 强制截断

        segments.append(remaining[: cut + 1].strip())
        remaining = remaining[cut + 1 :].strip()

    if remaining:
        segments.append(remaining)

    return segments
