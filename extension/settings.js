const STORAGE_KEY = 'mediatomd_settings';

// ── Load saved settings ────────────────────────────────────────────────────────
chrome.storage.local.get(STORAGE_KEY, (data) => {
  const settings = data[STORAGE_KEY] || {};
  document.getElementById('backendUrl').value = settings.backendUrl || 'http://localhost:8000';
  document.getElementById('apiKey').value     = settings.apiKey    || '';
});

// ── Save ───────────────────────────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', () => {
  const settings = {
    backendUrl: trimSlash(document.getElementById('backendUrl').value.trim()),
    apiKey:     document.getElementById('apiKey').value.trim(),
  };
  chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
    setStatus('已保存 ✓', 'success');
  });
});

// ── Test connection ────────────────────────────────────────────────────────────
document.getElementById('testBtn').addEventListener('click', async () => {
  const url = trimSlash(document.getElementById('backendUrl').value.trim());
  if (!url) {
    setStatus('请先填写后端地址', 'error');
    return;
  }

  const btn = document.getElementById('testBtn');
  btn.disabled = true;
  setStatus('连接中…', '');

  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      setStatus(`后端返回 HTTP ${res.status}`, 'error');
      return;
    }
    const data = await res.json();
    if (data.status === 'ok') {
      setStatus('连接成功 ✓', 'success');
    } else {
      setStatus(`后端返回异常：${JSON.stringify(data)}`, 'error');
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      setStatus('连接超时（6s），请检查后端是否运行', 'error');
    } else {
      setStatus(`连接失败：${err.message}`, 'error');
    }
  } finally {
    btn.disabled = false;
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function trimSlash(s) {
  return s.replace(/\/+$/, '');
}

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}
