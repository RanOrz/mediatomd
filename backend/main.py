from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import health, convert

app = FastAPI(title="MediaToMD API", version="0.1.0")

# Chrome Extension 需要跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(convert.router, prefix="/api")
