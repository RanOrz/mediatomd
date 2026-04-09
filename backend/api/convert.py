"""
视频转录接口。
POST /api/convert  → 提交任务，立即返回 job_id
GET  /api/convert/{job_id} → 查询进度/结果
"""

import asyncio
import os
import shutil
import tempfile
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from auth import verify_api_key
from config import config
from modules import downloader, transcriber, structurer

router = APIRouter(dependencies=[Depends(verify_api_key)])

# 内存任务字典，重启后清空（TDD 4.2：不需要数据库）
jobs: dict[str, dict] = {}


# ── Request / Response models ──────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    url: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/convert")
async def submit_convert(body: ConvertRequest, background_tasks: BackgroundTasks):
    """提交转换任务，立即返回 job_id；后台异步处理。"""
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "processing", "step": "queued"}
    background_tasks.add_task(_process_job, job_id, body.url)
    return {"job_id": job_id, "status": "processing"}


@router.get("/convert/{job_id}")
async def get_job_status(job_id: str):
    """
    查询任务状态。

    处理中：{"job_id": "…", "status": "processing", "step": "transcribing"}
    完成：  {"job_id": "…", "status": "done", "content": "…", "title": "…"}
    失败：  {"job_id": "…", "status": "failed", "error": "…"}
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **jobs[job_id]}


# ── Background task ────────────────────────────────────────────────────────────

async def _process_job(job_id: str, url: str) -> None:
    """完整处理流程：下载 → 转录 → 整理。所有阻塞操作放到线程池执行。"""
    os.makedirs(config.TMP_DIR, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(dir=config.TMP_DIR)

    try:
        # ── Step 1: 下载音频 ──────────────────────────────────────────────────
        _set_step(job_id, "downloading")
        audio_path, metadata = await asyncio.to_thread(
            downloader.download, url, tmp_dir
        )

        # ── Step 2: Deepgram 转录 ─────────────────────────────────────────────
        _set_step(job_id, "transcribing")
        result = await asyncio.to_thread(
            transcriber.transcribe, audio_path
        )

        # ── Step 3: Claude 整理 ───────────────────────────────────────────────
        _set_step(job_id, "structuring")
        content = await asyncio.to_thread(
            structurer.structure, result, metadata
        )

        jobs[job_id] = {
            "status":  "done",
            "content": content,
            "title":   metadata.get("title", "未知标题"),
        }

    except Exception as exc:
        jobs[job_id] = {
            "status": "failed",
            "error":  str(exc),
        }

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _set_step(job_id: str, step: str) -> None:
    jobs[job_id] = {"status": "processing", "step": step}
