import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    DEEPGRAM_API_KEY: str  = os.getenv("DEEPGRAM_API_KEY", "")
    API_KEY: str            = os.getenv("API_KEY", "changeme")
    CLAUDE_MODEL: str       = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    TMP_DIR: str            = os.getenv("TMP_DIR", "/tmp/mediatomd")


config = Config()
