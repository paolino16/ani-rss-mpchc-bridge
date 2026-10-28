// ==UserScript==
// @name         ANI-RSS -> MPC-HC Bridge (Silent Ultra)
// @namespace    local.ani.rss.mpchc
// @version      1.5.2
// @homepageURL  https://github.com/paolino16/ani-rss-mpchc-bridge
// @supportURL   https://github.com/paolino16/ani-rss-mpchc-bridge/issues
// @updateURL    https://raw.githubusercontent.com/paolino16/ani-rss-mpchc-bridge/main/ani-rss-mpchc-bridge.meta.js
// @downloadURL  https://raw.githubusercontent.com/paolino16/ani-rss-mpchc-bridge/main/ani-rss-mpchc-bridge.user.js
// @description  兼容新版 ANI-RSS 的本地播放器桥接脚本
// @match        http://127.0.0.1:7789/*
// @match        https://127.0.0.1:7789/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const LOCAL_BRIDGE_URL = 'http://127.0.0.1:58000/play';
  const TOKEN = 'replace-with-your-strong-token';
  const DEBUG = true;
  const OPENED_RECENTLY_MS = 5000;
  const RECENT_OPEN_CACHE_LIMIT = 32;
  const RECENT_OPEN_STORAGE_KEY = '__ani_bridge_recent_opened__';

  const recentOpened = new Map();

  const log = (...args) => {
    if (DEBUG) {
      console.log('%c[ANI-Bridge]', 'color: #67c23a; font-weight: bold;', ...args);
    }
  };

  log('脚本已启动 (新版兼容模式)');

  // --- 1. 屏蔽 UI 逻辑 (防止弹窗闪烁) ---
  const injectCSS = () => {
    if (!document.head) {
      setTimeout(injectCSS, 10);
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
      /* 强制隐藏包含播放器容器的对话框遮罩 */
      .el-overlay:has(.art-app),
      .el-overlay:has(movi-player),
      .el-overlay:has(.movi-app),
      .el-overlay:has(.flex-center.content) {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  };
  injectCSS();

  // --- 2. 核心拦截逻辑 ---
  function utf8FromBase64(b64) {
    try {
      if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 10) return null;
      const bin = atob(b64);
      if (!bin.includes(':') && !bin.includes('/') && !bin.includes('\\')) return null;
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return null; }
  }

  function isLikelyFilePath(value) {
    if (typeof value !== 'string') return false;
    if (!value || value.length < 3) return false;
    return /^[A-Za-z]:[\\/]/.test(value) ||
      value.startsWith('/') ||
      value.startsWith('\\\\');
  }

  function normalizeFilePath(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isLikelyFilePath(trimmed)) return trimmed;
    const decoded = utf8FromBase64(trimmed);
    if (decoded && isLikelyFilePath(decoded)) return decoded;
    return null;
  }

  function extractFilePathFromApiUrl(input) {
    try {
      const url = new URL(input, location.href);
      if (!url.pathname.endsWith('/api/file') && !url.pathname.endsWith('api/file')) {
        return null;
      }
      const encoded = url.searchParams.get('filename');
      if (!encoded) return null;
      return normalizeFilePath(encoded);
    } catch (e) {
      return null;
    }
  }

  function toDedupKey(filePath) {
    if (typeof filePath !== 'string') return '';
    const trimmed = filePath.trim();
    if (!trimmed) return '';

    const hasUncPrefix = /^[\\/]{2}[^\\/]/.test(trimmed);
    let normalized = trimmed.replace(/\\/g, '/');
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (hasUncPrefix) {
      normalized = `//${normalized.replace(/^\/+/, '')}`;
    }
    normalized = normalized.replace(/\/$/, '');

    if (/^[A-Za-z]:\//.test(normalized)) {
      normalized = normalized[0].toUpperCase() + normalized.slice(1);
    }

    return normalized;
  }

  function cleanupRecentOpened(now = Date.now()) {
    for (const [dedupKey, time] of recentOpened) {
      if (now - time >= OPENED_RECENTLY_MS) {
        recentOpened.delete(dedupKey);
      }
    }

    while (recentOpened.size > RECENT_OPEN_CACHE_LIMIT) {
      const oldestKey = recentOpened.keys().next().value;
      if (!oldestKey) break;
      recentOpened.delete(oldestKey);
    }
  }

  function readPersistentRecentOpened() {
    try {
      const raw = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (!raw) return {};

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writePersistentRecentOpened(entries) {
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
    }
  }

  function cleanupPersistentRecentOpened(now = Date.now()) {
    const entries = readPersistentRecentOpened();
    const cleaned = {};

    for (const [dedupKey, time] of Object.entries(entries)) {
      if (typeof time === 'number' && now - time < OPENED_RECENTLY_MS) {
        cleaned[dedupKey] = time;
      }
    }

    const sortedKeys = Object.keys(cleaned).sort((a, b) => cleaned[b] - cleaned[a]);
    const limited = {};
    for (const dedupKey of sortedKeys.slice(0, RECENT_OPEN_CACHE_LIMIT)) {
      limited[dedupKey] = cleaned[dedupKey];
    }

    writePersistentRecentOpened(limited);
    return limited;
  }

  function hasOpenedRecently(filePath) {
    const dedupKey = toDedupKey(filePath);
    if (!dedupKey) return false;

    const now = Date.now();
    cleanupRecentOpened(now);
    const lastOpenedAt = recentOpened.get(dedupKey);
    if (typeof lastOpenedAt === 'number' && now - lastOpenedAt < OPENED_RECENTLY_MS) {
      return true;
    }

    const persistentEntries = cleanupPersistentRecentOpened(now);
    const persistedOpenedAt = persistentEntries[dedupKey];
    if (typeof persistedOpenedAt === 'number' && now - persistedOpenedAt < OPENED_RECENTLY_MS) {
      recentOpened.set(dedupKey, persistedOpenedAt);
      cleanupRecentOpened(now);
      log(`命中持久化去重 [${dedupKey}]`);
      return true;
    }

    return false;
  }

  function markOpened(filePath) {
    const dedupKey = toDedupKey(filePath);
    if (!dedupKey) return;
    const now = Date.now();
    recentOpened.set(dedupKey, now);
    cleanupRecentOpened(now);

    const persistentEntries = cleanupPersistentRecentOpened(now);
    persistentEntries[dedupKey] = now;
    writePersistentRecentOpened(persistentEntries);
  }

  function sendToLocal(filePath, source) {
    if (!filePath) {
      return;
    }
    if (hasOpenedRecently(filePath)) {
      return;
    }

    markOpened(filePath);
    log(`调起本地播放 [${source}]: ${filePath}`);
    GM_xmlhttpRequest({
      method: 'POST',
      url: LOCAL_BRIDGE_URL,
      headers: { 'Content-Type': 'application/json', 'X-ANI-TOKEN': TOKEN },
      data: JSON.stringify({ file: filePath }),
      onload: () => {
        if (window.ElMessage) window.ElMessage.success({ message: '已调起 MPC-HC', duration: 1500 });
      },
      onerror: () => {
        if (window.ElMessage) window.ElMessage.error({ message: '本地播放器桥接失败', duration: 2000 });
      }
    });
  }

  function handleCandidate(candidate, source) {
    const filePath = normalizeFilePath(candidate);
    if (filePath) {
      sendToLocal(filePath, source);
      return filePath;
    }
    return null;
  }

  // A. 劫持 JSON.stringify (兼容旧版和当前列表克隆逻辑)
  const nativeStringify = JSON.stringify;
  JSON.stringify = function (obj) {
    if (obj && typeof obj === 'object') {
      const possibleValues = [obj.file, obj.filename, obj.url];
      for (const candidate of possibleValues) {
        if (handleCandidate(candidate, 'JSON.stringify')) {
          break;
        }
      }
    }
    return nativeStringify.apply(this, arguments);
  };

  // B. 劫持 fetch，拦截字幕请求并兜底提取 api/file 中的 filename。
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    const filePath = url ? extractFilePathFromApiUrl(url) : null;
    if (filePath) {
      sendToLocal(filePath, 'fetch api/file');
    }
    if (url && url.includes('api/getSubtitles')) {
      return new Response(nativeStringify({ code: 200, data: [], message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return nativeFetch.apply(this, args);
  };

  // C. 劫持 XHR，兼容未来改回 XMLHttpRequest 的情况。
  const nativeXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_method, url) {
    this.__aniBridgeUrl = url;
    return nativeXHROpen.apply(this, arguments);
  };

  const nativeXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (_body) {
    if (this.__aniBridgeUrl) {
      const filePath = extractFilePathFromApiUrl(this.__aniBridgeUrl);
      if (filePath) {
        sendToLocal(filePath, 'xhr api/file');
      }
      if (String(this.__aniBridgeUrl).includes('api/getSubtitles')) {
        setTimeout(() => {
          try {
            Object.defineProperty(this, 'readyState', { configurable: true, value: 4 });
            Object.defineProperty(this, 'status', { configurable: true, value: 200 });
            Object.defineProperty(this, 'responseText', {
              configurable: true,
              value: nativeStringify({ code: 200, data: [], message: 'OK' })
            });
            Object.defineProperty(this, 'response', {
              configurable: true,
              value: nativeStringify({ code: 200, data: [], message: 'OK' })
            });
            this.onreadystatechange && this.onreadystatechange();
            this.onload && this.onload();
          } catch (e) {
          }
        }, 0);
        return;
      }
    }
    return nativeXHRSend.apply(this, arguments);
  };

  // D. 劫持媒体 src，兼容新版 Artplayer 直接给 <video> 设置 api/file 地址。
  const mediaProto = HTMLMediaElement && HTMLMediaElement.prototype;
  if (false) {
    const srcDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'src');
    if (srcDescriptor && srcDescriptor.set && srcDescriptor.get) {
      Object.defineProperty(mediaProto, 'src', {
        configurable: true,
        enumerable: srcDescriptor.enumerable,
        get: srcDescriptor.get,
        set(value) {
          const filePath = extractFilePathFromApiUrl(value);
          if (filePath) {
            sendToLocal(filePath, 'media.src');
          }
          return srcDescriptor.set.call(this, value);
        }
      });
    }

    const nativeSetAttribute = mediaProto.setAttribute;
    mediaProto.setAttribute = function (name, value) {
      if (name === 'src') {
        const filePath = extractFilePathFromApiUrl(value);
        if (filePath) {
          sendToLocal(filePath, 'media.setAttribute');
        }
      }
      return nativeSetAttribute.apply(this, arguments);
    };
  }
})();
