FROM python:3.12-slim

WORKDIR /app

# ffmpeg 供 yt-dlp 转换音频格式
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 确保临时音频目录存在
RUN mkdir -p /tmp/mediatomd

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
