// content_script.js · M2 + 选区保存
// readability.js 先于此文件加载（见 manifest.json），Readability 类已在作用域内可用

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── 提取整页正文（M2）──────────────────────────────────────────────────────
  if (message.action === 'extract') {
    try {
      const article = new Readability(document.cloneNode(true)).parse();
      if (!article) {
        sendResponse({ error: 'Readability 无法提取正文，可能是非文章页面' });
        return;
      }
      sendResponse({
        title:   article.title || document.title,
        url:     window.location.href,
        content: article.content,
      });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  // ── 获取当前选中内容 ───────────────────────────────────────────────────────
  if (message.action === 'get_selection') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
      // 将选区克隆为 HTML 字符串
      const range = sel.getRangeAt(0);
      const fragment = range.cloneContents();
      const wrapper = document.createElement('div');
      wrapper.appendChild(fragment);
      sendResponse({
        hasSelection: true,
        html:  wrapper.innerHTML,
        text:  sel.toString(),          // 纯文本，用于统计字数
        title: document.title,
        url:   window.location.href,
      });
    } else {
      sendResponse({ hasSelection: false });
    }
  }

  // 注意：sendResponse 均为同步调用，无需 return true
});
