from fastapi import Header, HTTPException
from config import config


def verify_api_key(x_api_key: str = Header(...)) -> None:
    if x_api_key != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
