// ── Mode selector ──────────────────────────────────────────────────────────────
document.getElementById('modeSelect').addEventListener('change', (e) => {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${e.target.value}`).classList.add('active');
});

// ── Settings button ────────────────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Check & save selection ─────────────────────────────────────────────────────
let _selectionHtml = null; // 缓存选区 HTML，供保存按钮使用

async function checkSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || /^(chrome|chrome-extension|edge|about|data|blob):/.test(tab.url)) return;

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'get_selection' });
    if (resp?.hasSelection) {
      _selectionHtml = resp.html;
      const charCount = resp.text.replace(/\s+/g, '').length;
      document.getElementById('selectionCount').textContent = `已选中 ${charCount} 字`;
      document.getElementById('selectionBanner').style.display = 'flex';
      // 预览：截取前 300 字符，超出显示省略号
      const preview = document.getElementById('selectionPreview');
      const previewText = resp.text.trim();
      preview.textContent = previewText.length > 300 ? previewText.slice(0, 300) + '…' : previewText;
      preview.style.display = 'block';
      // 降级"保存当前网页"按钮
      document.getElementById('saveWebpageBtn').className = 'btn btn-ghost';
    }
  } catch {
    // content_script 未就绪（系统页等），静默忽略
  }
}

document.getElementById('saveSelectionBtn').addEventListener('click', async () => {
  if (!_selectionHtml) return;

  const btn = document.getElementById('saveSelectionBtn');
  btn.disabled = true;
  setStatus('webpageStatus', '保存中…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageTitle = tab.title || '未知页面';
    const markdown  = buildMarkdown(`[选段] ${pageTitle}`, tab.url, _selectionHtml);
    const filename  = makeFilename(`选段_${pageTitle}`);

    downloadAsMarkdown(markdown, filename, (ok, errMsg) => {
      if (ok) {
        setStatus('webpageStatus', `✓ 已保存：${filename}`, 'success');
        saveHistory({ title: `[选段] ${pageTitle}`, type: 'webpage', status: 'done',   error: null   }).then(loadHistory);
      } else {
        setStatus('webpageStatus', `保存失败：${errMsg}`, 'error');
        saveHistory({ title: `[选段] ${pageTitle}`, type: 'webpage', status: 'failed', error: errMsg }).then(loadHistory);
      }
    });
  } catch (e) {
    setStatus('webpageStatus', `错误：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Save webpage (M2) ──────────────────────────────────────────────────────────
document.getElementById('saveWebpageBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveWebpageBtn');
  btn.disabled = true;
  setStatus('webpageStatus', '提取中…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 不支持 chrome://、扩展页、about: 等系统页面
    if (!tab?.url || /^(chrome|chrome-extension|edge|about|data|blob):/.test(tab.url)) {
      setStatus('webpageStatus', '当前页面不支持保存', 'error');
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    } catch {
      setStatus('webpageStatus', '无法连接页面，请刷新后重试', 'error');
      return;
    }

    // response 为空（无 content_script 响应）
    if (!response) {
      setStatus('webpageStatus', '页面未就绪，请刷新后重试', 'error');
      return;
    }

    if (response.error) {
      setStatus('webpageStatus', `提取失败：${response.error}`, 'error');
      await saveHistory({ title: tab.title || '未知标题', type: 'webpage', status: 'failed', error: response.error });
      loadHistory();
      return;
    }

    // SPA 路由切换时旧 content_script 可能响应前一页内容，比对 URL 防止误存
    if (response.url && tab.url) {
      const normalize = u => { try { const p = new URL(u); return p.origin + p.pathname; } catch { return u; } };
      if (normalize(response.url) !== normalize(tab.url)) {
        setStatus('webpageStatus', '页面正在跳转，请等待加载完成后重试', 'error');
        return;
      }
    }

    const title    = response.title || tab.title || '未知标题';
    const markdown = buildMarkdown(title, response.url, response.content);
    const filename = makeFilename(title);

    downloadAsMarkdown(markdown, filename, (ok, errMsg) => {
      if (ok) {
        setStatus('webpageStatus', `✓ 已保存：${filename}`, 'success');
        saveHistory({ title, type: 'webpage', status: 'done',   error: null   }).then(loadHistory);
      } else {
        setStatus('webpageStatus', `保存失败：${errMsg}`, 'error');
        saveHistory({ title, type: 'webpage', status: 'failed', error: errMsg }).then(loadHistory);
      }
    });

  } catch (e) {
    setStatus('webpageStatus', `错误：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Clear history ──────────────────────────────────────────────────────────────
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('确定清空所有历史记录？')) return;
  chrome.storage.local.remove(['history', 'pendingJobs'], () => {
    _stopPolling();
    loadHistory();
  });
});

// ── Use current page URL ───────────────────────────────────────────────────────
document.getElementById('useCurrentPageBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    document.getElementById('videoUrl').value = tab.url;
    document.getElementById('videoUrl').focus();
  }
});

// ── URL type detection ─────────────────────────────────────────────────────────
const VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
  'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com',
  'tiktok.com', 'www.tiktok.com', 'm.tiktok.com',
  'douyin.com', 'www.douyin.com', 'v.douyin.com',
  'twitch.tv', 'www.twitch.tv', 'clips.twitch.tv',
  'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com',
  'v.qq.com', 'kuaishou.com', 'www.kuaishou.com',
  'youku.com', 'v.youku.com',
  'iqiyi.com', 'www.iqiyi.com', 'iq.com',
  'mgtv.com', 'www.mgtv.com',
  'ted.com', 'www.ted.com',
  'dailymotion.com', 'www.dailymotion.com',
  'rumble.com', 'rumble.com',
  'nicovideo.jp', 'www.nicovideo.jp',
  'weibo.com', 'video.weibo.com',
  'ixigua.com', 'www.ixigua.com',
  'xvideos.com', 'pornhub.com',        // yt-dlp 支持成人站
  'spotify.com', 'open.spotify.com',   // podcast
  'podbean.com', 'anchor.fm',
]);
const VIDEO_EXT_RE = /\.(mp4|webm|mkv|avi|mov|flv|mp3|m4a|wav|ogg|flac|aac|opus|m3u8)(\?|#|$)/i;

function detectUrlType(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return 'invalid'; }
  const host = parsed.hostname.toLowerCase();
  if (VIDEO_HOSTS.has(host)) return 'video';
  if (VIDEO_EXT_RE.test(parsed.pathname)) return 'media_file';
  return 'unknown';
}

// ── Convert video (M4) ────────────────────────────────────────────────────────
document.getElementById('convertBtn').addEventListener('click', async () => {
  const url = document.getElementById('videoUrl').value.trim();
  if (!url) {
    setStatus('videoStatus', '请先粘贴链接', 'error');
    return;
  }

  // URL 类型预检
  const urlType = detectUrlType(url);
  if (urlType === 'invalid') {
    setStatus('videoStatus', '链接格式无效，请检查后重试', 'error');
    return;
  }
  if (urlType === 'unknown') {
    setStatus('videoStatus', '不支持该链接，请粘贴视频 / 音频平台的地址', 'error');
    return;
  }

  const btn = document.getElementById('convertBtn');
  btn.disabled = true;
  setStatus('videoStatus', '提交中…');

  try {
    // 提交前检查 settings
    const { mediatomd_settings: s = {} } = await chrome.storage.local.get('mediatomd_settings');
    if (!s.backendUrl || !s.apiKey) {
      setStatus('videoStatus', '请先在 ⚙ 设置中填写后端地址和私钥', 'error');
      return;
    }

    // 先写入历史（⏳ 状态），拿到 id 传给 service_worker
    const historyId = Date.now().toString();
    await addHistoryEntry({
      id:         historyId,
      title:      _hostnameOf(url) + ' (处理中)',
      type:       'video',
      status:     'processing',
      error:      null,
      created_at: new Date().toISOString(),
    });
    loadHistory();

    // 发给 service_worker 处理
    const resp = await chrome.runtime.sendMessage({
      action:    'convert_video',
      url,
      historyId,
    });

    if (resp.error) {
      setStatus('videoStatus', `提交失败：${resp.error}`, 'error');
      await updateHistoryEntry(historyId, { status: 'failed', error: resp.error });
      loadHistory();
    } else {
      setStatus('videoStatus', '⏳ 已提交，完成后自动保存到下载目录', '');
      document.getElementById('videoUrl').value = '';
    }

  } catch (e) {
    setStatus('videoStatus', `错误：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Build Markdown ─────────────────────────────────────────────────────────────
function buildMarkdown(title, url, html) {
  const body = htmlToMarkdown(html).trim();
  return `# ${title}\n\n> 来源：${url}\n\n${body}\n`;
}

// ── HTML → Markdown ────────────────────────────────────────────────────────────
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const md  = nodeToMd(doc.body, 0);
  // 折叠多余空行（最多保留一个空行）
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

function nodeToMd(node, listDepth) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag      = node.tagName.toLowerCase();
  const children = () => childrenToMd(node, listDepth);

  switch (tag) {
    case 'h1': return `\n\n# ${inline(node)}\n\n`;
    case 'h2': return `\n\n## ${inline(node)}\n\n`;
    case 'h3': return `\n\n### ${inline(node)}\n\n`;
    case 'h4': return `\n\n#### ${inline(node)}\n\n`;
    case 'h5': return `\n\n##### ${inline(node)}\n\n`;
    case 'h6': return `\n\n###### ${inline(node)}\n\n`;
    case 'p':  return `\n\n${inline(node)}\n\n`;
    case 'br': return '\n';
    case 'hr': return '\n\n---\n\n';

    case 'strong':
    case 'b':  return `**${inline(node)}**`;
    case 'em':
    case 'i':  return `*${inline(node)}*`;

    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = inline(node).trim();
      return (href && href !== '#') ? `[${text}](${href})` : text;
    }

    case 'img': return ''; // PRD: 不保留图片

    case 'code': {
      if (node.closest('pre')) return node.textContent;
      return `\`${node.textContent}\``;
    }
    case 'pre': {
      const lang = (node.querySelector('code')?.className || '').replace(/language-/, '');
      return `\n\n\`\`\`${lang}\n${node.textContent.trimEnd()}\n\`\`\`\n\n`;
    }

    case 'blockquote':
      return '\n\n' + children().trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';

    case 'ul': return `\n\n${childrenToMd(node, listDepth)}\n`;
    case 'ol': return `\n\n${childrenToMd(node, listDepth)}\n`;
    case 'li': {
      const prefix = '  '.repeat(listDepth) + '- ';
      // 子列表进一层
      const text = childrenToMd(node, listDepth + 1).trim();
      return `${prefix}${text}\n`;
    }

    case 'table': return tableToMd(node) + '\n\n';

    // 丢弃与正文无关的元素
    case 'script':
    case 'style':
    case 'nav':
    case 'header':
    case 'footer':
    case 'aside':
    case 'form':
    case 'button':
    case 'input':
    case 'select': return '';

    default: return children();
  }
}

// 行内渲染（不包含块元素换行）
function inline(node) {
  return childrenToMd(node, 0).replace(/\n+/g, ' ').trim();
}

function childrenToMd(node, listDepth) {
  return Array.from(node.childNodes).map(n => nodeToMd(n, listDepth)).join('');
}

function tableToMd(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';

  const toRow = tr => '| ' + Array.from(tr.querySelectorAll('th, td'))
    .map(cell => cell.textContent.trim().replace(/\|/g, '\\|'))
    .join(' | ') + ' |';

  const header    = toRow(rows[0]);
  const separator = header.replace(/[^|]/g, '-').replace(/--/g, '--');
  const body      = rows.slice(1).map(toRow).join('\n');

  return `\n\n${header}\n${separator}\n${body}`;
}

// ── File helpers ───────────────────────────────────────────────────────────────
function makeFilename(title) {
  const date      = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 50);
  return `${date}_${safeTitle}.md`;
}

function downloadAsMarkdown(content, filename, callback) {
  // 使用 data URL 避免 blob URL 的生命周期问题
  const b64 = btoa(unescape(encodeURIComponent(content)));
  const url  = `data:text/markdown;charset=utf-8;base64,${b64}`;

  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      callback(false, chrome.runtime.lastError?.message || '下载失败');
    } else {
      callback(true, null);
    }
  });
}

// ── Step label map ─────────────────────────────────────────────────────────────
const STEP_LABELS = {
  queued:       '排队中...',
  downloading:  '下载音频...',
  transcribing: '语音转录...',
  structuring:  'AI 整理中...',
};

// ── History ────────────────────────────────────────────────────────────────────
function loadHistory() {
  chrome.storage.local.get('history', ({ history }) => {
    const list = document.getElementById('historyList');
    if (!history || history.length === 0) {
      list.innerHTML = '<div class="history-empty">暂无记录</div>';
      return;
    }
    list.innerHTML = [...history].reverse().map(item => {
      const icon =
        item.status === 'done'   ? '✅' :
        item.status === 'failed' ? '❌' : '⏳';
      const time = new Date(item.created_at).toLocaleDateString('zh-CN');

      // subtitle：处理中显示步骤，失败显示错误原因，完成/其他显示类型
      const typeLabel = item.type === 'video' ? '视频' : '网页';
      let sub = '';
      if (item.status === 'processing') {
        sub = `<span class="h-sub">${STEP_LABELS[item.step] || '处理中...'}</span>`;
      } else if (item.status === 'failed' && item.error) {
        sub = `<span class="h-sub error" title="${escapeHtml(item.error)}">${escapeHtml(item.error)}</span>`;
      } else {
        sub = `<span class="h-sub">${typeLabel}</span>`;
      }

      return `
        <div class="history-item">
          <span class="h-icon">${icon}</span>
          <div class="h-body">
            <span class="h-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
            ${sub}
          </div>
          <span class="h-time">${time}</span>
        </div>`;
    }).join('');
  });
}

// saveHistory：自动生成 id，供网页转换使用
async function saveHistory(entry) {
  return new Promise(resolve => {
    chrome.storage.local.get('history', ({ history }) => {
      const list = history || [];
      list.push({
        id:         Date.now().toString(),
        title:      entry.title,
        type:       entry.type,
        status:     entry.status,
        error:      entry.error,
        created_at: new Date().toISOString(),
      });
      if (list.length > 100) list.splice(0, list.length - 100);
      chrome.storage.local.set({ history: list }, resolve);
    });
  });
}

// addHistoryEntry：使用预生成的 id，供视频转换使用（service_worker 需要 id 来更新状态）
async function addHistoryEntry(entry) {
  return new Promise(resolve => {
    chrome.storage.local.get('history', ({ history }) => {
      const list = history || [];
      list.push(entry);
      if (list.length > 100) list.splice(0, list.length - 100);
      chrome.storage.local.set({ history: list }, resolve);
    });
  });
}

// updateHistoryEntry：按 id 更新字段（service_worker 完成后会写 storage，popup 通过 onChanged 刷新）
async function updateHistoryEntry(id, changes) {
  return new Promise(resolve => {
    chrome.storage.local.get('history', ({ history }) => {
      const list = history || [];
      const idx  = list.findIndex(h => h.id === id);
      if (idx !== -1) list[idx] = { ...list[idx], ...changes };
      chrome.storage.local.set({ history: list }, resolve);
    });
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function setStatus(id, msg, type = '') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className   = 'status ' + type;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 30); }
}

// ── 5s 轮询（popup 打开时）─────────────────────────────────────────────────────
// Chrome alarms 最短 30s，用 popup 的 setInterval 触发 service_worker 更频繁地轮询
let _pollTimer = null;

function _startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(_triggerPoll, 5000);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function _triggerPoll() {
  const { pendingJobs = {} } = await chrome.storage.local.get('pendingJobs');
  if (!Object.keys(pendingJobs).length) { _stopPolling(); return; }
  chrome.runtime.sendMessage({ action: 'poll_now' }).catch(() => {});
}

function _syncPollingState() {
  chrome.storage.local.get('pendingJobs', ({ pendingJobs = {} }) => {
    Object.keys(pendingJobs).length ? _startPolling() : _stopPolling();
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
loadHistory();
_syncPollingState();
checkSelection();

// 当 service_worker 更新历史记录时，自动刷新（弹窗打开中的情况）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.history)     loadHistory();
  if (changes.pendingJobs) _syncPollingState();
});
