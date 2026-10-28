// ==UserScript==
// @name         ANI-RSS Poster Right Click Edit
// @namespace    local.ani.rss.poster
// @version      1.0.0
// @description  右键海报直接编辑订阅；保留左键操作，Shift+右键显示浏览器菜单。
// @homepageURL  https://github.com/paolino16/ani-rss-mpchc-bridge
// @supportURL   https://github.com/paolino16/ani-rss-mpchc-bridge/issues
// @updateURL    https://raw.githubusercontent.com/paolino16/ani-rss-mpchc-bridge/main/ani-rss-poster-right-click-edit.meta.js
// @downloadURL  https://raw.githubusercontent.com/paolino16/ani-rss-mpchc-bridge/main/ani-rss-poster-right-click-edit.user.js
// @match        http://127.0.0.1:7789/*
// @match        https://127.0.0.1:7789/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  let opening = false;

  // Element Plus teleports menus outside the poster; use its own ARIA link.
  function findEditItem(trigger) {
    const ids = [
      trigger.getAttribute('aria-controls'),
      trigger.getAttribute('aria-describedby')
    ].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);

    for (const id of ids) {
      const menu = document.getElementById(id);
      if (!menu) continue;
      for (const item of menu.querySelectorAll('[role="menuitem"], .el-dropdown-menu__item')) {
        const label = (item.textContent || '').replace(/\s+/g, '');
        if ((label === '编辑' || label === 'Edit') &&
            item.getAttribute('aria-disabled') !== 'true' &&
            !item.classList.contains('is-disabled')) {
          return item;
        }
      }
    }
    return null;
  }

  function waitForEditItem(trigger) {
    return new Promise((resolve, reject) => {
      let timer;
      const observer = new MutationObserver(check);

      function finish(item, error) {
        observer.disconnect();
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(item);
      }

      function check() {
        if (!trigger.isConnected) {
          finish(null, new Error('海报已离开页面，请重新右键。'));
          return;
        }
        const item = findEditItem(trigger);
        if (item) finish(item);
      }

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-controls', 'aria-describedby']
      });
      timer = setTimeout(() => {
        finish(null, new Error('未找到该海报的编辑菜单，请从已展开的菜单手动编辑。'));
      }, 1500);
      check();
    });
  }

  document.addEventListener('contextmenu', async event => {
    if (event.shiftKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const poster = target?.closest('.cover-image-container');
    if (!poster || target.closest('.cover-actions, .cover-score, a, input, textarea')) return;

    const trigger = poster.querySelector('.cover-action-button');
    if (!trigger || trigger.disabled ||
        !(trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-describedby'))) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (opening) return;

    opening = true;
    try {
      const ready = waitForEditItem(trigger);
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      const editItem = await ready;
      if (editItem.isConnected) editItem.click();
    } catch (error) {
      console.warn('[ANI-RSS Poster Edit]', error.message);
    } finally {
      opening = false;
    }
  }, true);
})();
