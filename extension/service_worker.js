// service_worker.js · M4
// 后台异步处理视频转录任务，用 chrome.alarms 轮询（MV3 service worker 可能随时休眠，
// setInterval 不可靠，alarms 会在 service worker 唤醒时触发）

const POLL_ALARM   = 'mediatomd-poll';
const SETTINGS_KEY = 'mediatomd_settings';

// ── 接收 popup 消息 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'convert_video') {
    submitJob(message.url, message.historyId).then(sendResponse);
    return true;
  }
  if (message.action === 'poll_now') {
    // popup 每 5s 触发一次，让 step 更新更及时
    pollPendingJobs().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── 定时轮询 ───────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollPendingJobs();
  }
});

// ── 提交任务 ───────────────────────────────────────────────────────────────────
async function submitJob(url, historyId) {
  const settings = await getSettings();

  if (!settings.backendUrl || !settings.apiKey) {
    return { error: '请先在设置中配置后端地址和私钥' };
  }

  try {
    const res = await fetch(`${settings.backendUrl}/api/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }

    const { job_id } = await res.json();

    // 记录待处理任务
    await addPendingJob(job_id, { historyId, url });

    // 启动轮询 alarm（每 30s；Chrome unpacked 扩展允许更短，packed 最小 1min）
    chrome.alarms.create(POLL_ALARM, {
      delayInMinutes:  0.1,   // 约 6s 后第一次检查
      periodInMinutes: 0.5,   // 之后每 30s
    });

    return { ok: true, job_id };

  } catch (e) {
    return { error: e.message };
  }
}

// ── 轮询所有待处理任务 ──────────────────────────────────────────────────────────
async function pollPendingJobs() {
  const { pendingJobs = {} } = await chrome.storage.local.get('pendingJobs');

  if (!Object.keys(pendingJobs).length) {
    chrome.alarms.clear(POLL_ALARM);
    return;
  }

  const settings = await getSettings();
  const updated  = { ...pendingJobs };

  for (const [jobId, jobInfo] of Object.entries(pendingJobs)) {
    try {
      const res = await fetch(
        `${settings.backendUrl}/api/convert/${jobId}`,
        { headers: { 'x-api-key': settings.apiKey } }
      );
      const data = await res.json();

      if (data.status === 'done') {
        const title    = data.title || _hostnameOf(jobInfo.url);
        const filename = makeFilename(title);
        downloadMarkdown(data.content, filename);
        await updateHistoryItem(jobInfo.historyId, { status: 'done', title, step: null });
        delete updated[jobId];

      } else if (data.status === 'failed') {
        await updateHistoryItem(jobInfo.historyId, {
          status: 'failed',
          error:  data.error || '未知错误',
          step:   null,
        });
        delete updated[jobId];

      } else if (data.status === 'processing' && data.step) {
        // 实时更新当前步骤，供 popup 显示
        await updateHistoryItem(jobInfo.historyId, { step: data.step });
      }

    } catch (e) {
      console.error('[mediatomd] 轮询出错', jobId, e.message);
    }
  }

  await chrome.storage.local.set({ pendingJobs: updated });

  if (!Object.keys(updated).length) {
    chrome.alarms.clear(POLL_ALARM);
  }
}

// ── Storage helpers ────────────────────────────────────────────────────────────
async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function addPendingJob(jobId, info) {
  const { pendingJobs = {} } = await chrome.storage.local.get('pendingJobs');
  pendingJobs[jobId] = info;
  await chrome.storage.local.set({ pendingJobs });
}

async function updateHistoryItem(id, changes) {
  const { history = [] } = await chrome.storage.local.get('history');
  const idx = history.findIndex(h => h.id === id);
  if (idx !== -1) {
    history[idx] = { ...history[idx], ...changes };
    await chrome.storage.local.set({ history });
  }
}

// ── File helpers ───────────────────────────────────────────────────────────────
function makeFilename(title) {
  const date      = new Date().toISOString().split('T')[0];
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 50);
  return `${date}_${safeTitle}.md`;
}

function downloadMarkdown(content, filename) {
  const b64 = btoa(unescape(encodeURIComponent(content)));
  chrome.downloads.download({
    url:     `data:text/markdown;charset=utf-8;base64,${b64}`,
    filename,
    saveAs:  false,
  });
}

function _hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 30); }
}
