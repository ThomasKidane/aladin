(function () {
  // ── State ──────────────────────────────────────────────────────────────
  let glowBorder = null;
  let stopContainer = null;
  let staticIndicator = null;
  let isAnimating = false;
  let isStaticVisible = false;
  let wasAnimatingBeforeToolUse = false;
  let wasStaticBeforeToolUse = false;
  let activeChatId = null;
  let autoHideTimer = null;
  let heartbeatInterval = null;

  const AUTO_HIDE_MS = 20000;
  const HEARTBEAT_MS = 5000;
  const GEODO_BLUE = '59, 130, 246';

  // ── Animation styles ───────────────────────────────────────────────────

  function ensureAnimationStyles() {
    if (document.getElementById('aladin-agent-animation-styles')) return;
    const style = document.createElement('style');
    style.id = 'aladin-agent-animation-styles';
    style.textContent = `
      @keyframes aladin-pulse {
        0%, 100% {
          box-shadow:
            inset 0 0 30px rgba(${GEODO_BLUE}, 0.25),
            inset 0 0 60px rgba(${GEODO_BLUE}, 0.12),
            inset 0 0 110px rgba(${GEODO_BLUE}, 0.06),
            inset 0 0 160px rgba(${GEODO_BLUE}, 0.02);
        }
        50% {
          box-shadow:
            inset 0 0 40px rgba(${GEODO_BLUE}, 0.35),
            inset 0 0 80px rgba(${GEODO_BLUE}, 0.18),
            inset 0 0 140px rgba(${GEODO_BLUE}, 0.09),
            inset 0 0 200px rgba(${GEODO_BLUE}, 0.03);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Auto-hide timer (20s safety net for pulsing indicator) ─────────────

  function resetAutoHideTimer() {
    if (autoHideTimer) clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(function () {
      autoHideTimer = null;
      hideAgentIndicators();
    }, AUTO_HIDE_MS);
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  // ── Glow border ────────────────────────────────────────────────────────

  function createGlowBorder() {
    const el = document.createElement('div');
    el.id = 'aladin-agent-glow-border';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'pointer-events:none;z-index:2147483646;' +
      'opacity:0;transition:opacity 0.5s ease-in-out;' +
      'animation:aladin-pulse 4s cubic-bezier(0.4,0,0.6,1) infinite;' +
      'box-shadow:inset 0 0 30px rgba(' +
      GEODO_BLUE +
      ',0.25),' +
      'inset 0 0 60px rgba(' +
      GEODO_BLUE +
      ',0.12),' +
      'inset 0 0 110px rgba(' +
      GEODO_BLUE +
      ',0.06),' +
      'inset 0 0 160px rgba(' +
      GEODO_BLUE +
      ',0.02);';
    return el;
  }

  // ── Stop button ────────────────────────────────────────────────────────

  function createStopButton() {
    const container = document.createElement('div');
    container.id = 'aladin-agent-stop-container';
    container.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'display:flex;justify-content:center;align-items:center;' +
      'pointer-events:none;z-index:2147483647;';

    const btn = document.createElement('button');
    btn.id = 'aladin-agent-stop-button';
    btn.textContent = 'Stop Aladin';
    btn.style.cssText =
      'position:relative;transform:translateY(100px);' +
      'padding:10px 20px;background:#FAF9F5;color:#141413;' +
      'border:0.5px solid rgba(31,30,29,0.4);border-radius:12px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
      'font-size:14px;font-weight:600;letter-spacing:0.01em;' +
      'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;' +
      'box-shadow:0 40px 80px rgba(' +
      GEODO_BLUE +
      ',0.18),0 4px 14px rgba(' +
      GEODO_BLUE +
      ',0.18);' +
      'transition:all 0.3s cubic-bezier(0.4,0,0.2,1);' +
      'opacity:0;user-select:none;pointer-events:auto;white-space:nowrap;';

    btn.addEventListener('mouseenter', function () {
      if (isAnimating) {
        btn.style.background = '#F0EEE6';
        btn.style.boxShadow =
          '0 40px 80px rgba(' +
          GEODO_BLUE +
          ',0.24),0 4px 14px rgba(' +
          GEODO_BLUE +
          ',0.24)';
      }
    });
    btn.addEventListener('mouseleave', function () {
      if (isAnimating) {
        btn.style.background = '#FAF9F5';
        btn.style.boxShadow =
          '0 40px 80px rgba(' +
          GEODO_BLUE +
          ',0.18),0 4px 14px rgba(' +
          GEODO_BLUE +
          ',0.18)';
      }
    });
    btn.addEventListener('click', function () {
      chrome.runtime.sendMessage({
        type: 'STOP_AGENT',
        chatId: activeChatId,
      });
    });

    container.appendChild(btn);
    return container;
  }

  // ── Static indicator ───────────────────────────────────────────────────

  function createStaticIndicator() {
    const el = document.createElement('div');
    el.id = 'aladin-static-indicator-container';
    el.innerHTML =
      '<span style="vertical-align:middle;color:#141413;font-size:14px;display:inline-block;">Aladin is active</span>' +
      '<div style="display:inline-block;width:0.5px;height:32px;background:rgba(31,30,29,0.15);margin:0 8px;vertical-align:middle;"></div>' +
      '<button id="aladin-static-chat-button" style="position:relative;display:inline-flex;align-items:center;justify-content:center;padding:6px;background:transparent;border:none;cursor:pointer;pointer-events:auto;vertical-align:middle;width:32px;height:32px;border-radius:8px;transition:background 0.2s;">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="#141413" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;display:block;">' +
      '<path d="M10 2.5C14.1421 2.5 17.5 5.85786 17.5 10C17.5 14.1421 14.1421 17.5 10 17.5H3C2.79779 17.5 2.61549 17.3782 2.53809 17.1914C2.4607 17.0046 2.50349 16.7895 2.64648 16.6465L4.35547 14.9365C3.20124 13.6175 2.5 11.8906 2.5 10C2.5 5.85786 5.85786 2.5 10 2.5ZM10 3.5C6.41015 3.5 3.5 6.41015 3.5 10C3.5 11.7952 4.22659 13.4199 5.40332 14.5967L5.46582 14.6729C5.52017 14.7544 5.5498 14.8508 5.5498 14.9502C5.5498 15.0828 5.49709 15.2099 5.40332 15.3037L4.20703 16.5H10C13.5899 16.5 16.5 13.5899 16.5 10C16.5 6.41015 13.5899 3.5 10 3.5Z"/>' +
      '</svg>' +
      '<span id="aladin-static-chat-tooltip" style="position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);padding:6px 12px;background:#30302E;color:#FAF9F5;border-radius:6px;font-size:12px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;">Open chat</span>' +
      '</button>' +
      '<button id="aladin-static-close-button" style="position:relative;display:inline-flex;align-items:center;justify-content:center;padding:6px;background:transparent;border:none;cursor:pointer;pointer-events:auto;vertical-align:middle;width:32px;height:32px;margin-left:4px;border-radius:8px;transition:background 0.2s;">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;display:block;">' +
      '<path d="M15.1464 4.14642C15.3417 3.95121 15.6582 3.95118 15.8534 4.14642C16.0486 4.34168 16.0486 4.65822 15.8534 4.85346L10.7069 9.99997L15.8534 15.1465C16.0486 15.3417 16.0486 15.6583 15.8534 15.8535C15.6826 16.0244 15.4186 16.0461 15.2245 15.918L15.1464 15.8535L9.99989 10.707L4.85338 15.8535C4.65813 16.0486 4.34155 16.0486 4.14634 15.8535C3.95115 15.6583 3.95129 15.3418 4.14634 15.1465L9.29286 9.99997L4.14634 4.85346C3.95129 4.65818 3.95115 4.34162 4.14634 4.14642C4.34154 3.95128 4.65812 3.95138 4.85338 4.14642L9.99989 9.29294L15.1464 4.14642Z" fill="#141413"/>' +
      '</svg>' +
      '<span id="aladin-static-close-tooltip" style="position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);padding:6px 12px;background:#30302E;color:#FAF9F5;border-radius:6px;font-size:12px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;">Dismiss</span>' +
      '</button>';
    el.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'padding:6px 6px 6px 16px;background:#FAF9F5;' +
      'border:0.5px solid rgba(31,30,29,0.30);border-radius:14px;' +
      'box-shadow:0 40px 80px 0 rgba(0,0,0,0.15);' +
      'z-index:2147483647;pointer-events:none;white-space:nowrap;user-select:none;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;';

    // Chat button
    var chatBtn = el.querySelector('#aladin-static-chat-button');
    var chatTip = el.querySelector('#aladin-static-chat-tooltip');
    if (chatBtn) {
      chatBtn.addEventListener('mouseenter', function () {
        chatBtn.style.background = '#F0EEE6';
        if (chatTip) chatTip.style.opacity = '1';
      });
      chatBtn.addEventListener('mouseleave', function () {
        chatBtn.style.background = 'transparent';
        if (chatTip) chatTip.style.opacity = '0';
      });
      chatBtn.addEventListener('click', function () {
        try {
          chrome.runtime.sendMessage({ type: 'SWITCH_TO_MAIN_TAB' });
        } catch (_) {}
      });
    }

    // Close button
    var closeBtn = el.querySelector('#aladin-static-close-button');
    var closeTip = el.querySelector('#aladin-static-close-tooltip');
    if (closeBtn) {
      closeBtn.addEventListener('mouseenter', function () {
        closeBtn.style.background = '#F0EEE6';
        if (closeTip) closeTip.style.opacity = '1';
      });
      closeBtn.addEventListener('mouseleave', function () {
        closeBtn.style.background = 'transparent';
        if (closeTip) closeTip.style.opacity = '0';
      });
      closeBtn.addEventListener('click', function () {
        try {
          chrome.runtime.sendMessage({
            type: 'DISMISS_STATIC_INDICATOR_FOR_GROUP',
          });
        } catch (_) {}
      });
    }

    return el;
  }

  // ── Show/hide: pulsing agent indicators ────────────────────────────────

  function showAgentIndicators(chatId) {
    if (chatId) activeChatId = chatId;
    isAnimating = true;

    ensureAnimationStyles();

    if (glowBorder) {
      glowBorder.style.display = '';
    } else {
      glowBorder = createGlowBorder();
      document.body.appendChild(glowBorder);
    }

    if (stopContainer) {
      stopContainer.style.display = '';
    } else {
      stopContainer = createStopButton();
      document.body.appendChild(stopContainer);
    }

    requestAnimationFrame(function () {
      if (glowBorder) glowBorder.style.opacity = '1';
      if (stopContainer) {
        var btn = stopContainer.querySelector('#aladin-agent-stop-button');
        if (btn) {
          btn.style.transform = 'translateY(0)';
          btn.style.opacity = '1';
        }
      }
    });

    resetAutoHideTimer();
  }

  function hideAgentIndicators() {
    if (!isAnimating) return;
    isAnimating = false;
    clearAutoHideTimer();

    if (glowBorder) glowBorder.style.opacity = '0';
    if (stopContainer) {
      var btn = stopContainer.querySelector('#aladin-agent-stop-button');
      if (btn) {
        btn.style.transform = 'translateY(100px)';
        btn.style.opacity = '0';
      }
    }

    setTimeout(function () {
      if (isAnimating) return; // re-shown during fade
      if (glowBorder && glowBorder.parentNode) {
        glowBorder.parentNode.removeChild(glowBorder);
        glowBorder = null;
      }
      if (stopContainer && stopContainer.parentNode) {
        stopContainer.parentNode.removeChild(stopContainer);
        stopContainer = null;
      }
    }, 300);
  }

  // ── Show/hide: static indicator ────────────────────────────────────────

  function showStaticIndicator() {
    isStaticVisible = true;

    if (staticIndicator) {
      staticIndicator.style.display = '';
    } else {
      staticIndicator = createStaticIndicator();
      document.body.appendChild(staticIndicator);
    }

    // Start heartbeat (5s poll to check session liveness)
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(function () {
      try {
        chrome.runtime.sendMessage(
          { type: 'STATIC_INDICATOR_HEARTBEAT' },
          function (response) {
            if (chrome.runtime.lastError || !response || !response.success) {
              hideStaticIndicator();
            }
          }
        );
      } catch (_) {
        hideStaticIndicator();
      }
    }, HEARTBEAT_MS);
  }

  function hideStaticIndicator() {
    if (!isStaticVisible) return;
    isStaticVisible = false;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (staticIndicator && staticIndicator.parentNode) {
      staticIndicator.parentNode.removeChild(staticIndicator);
      staticIndicator = null;
    }
  }

  // ── Hide/show for tool use (temporary, preserves state) ────────────────

  function hideForToolUse() {
    wasAnimatingBeforeToolUse = isAnimating;
    wasStaticBeforeToolUse = isStaticVisible;

    if (glowBorder) glowBorder.style.display = 'none';
    if (stopContainer) stopContainer.style.display = 'none';
    if (staticIndicator && isStaticVisible)
      staticIndicator.style.display = 'none';
  }

  function showAfterToolUse() {
    if (wasAnimatingBeforeToolUse) {
      if (glowBorder) glowBorder.style.display = '';
      if (stopContainer) stopContainer.style.display = '';
      resetAutoHideTimer();
    }
    if (wasStaticBeforeToolUse && staticIndicator) {
      staticIndicator.style.display = '';
    }
    wasAnimatingBeforeToolUse = false;
    wasStaticBeforeToolUse = false;
  }

  // ── Message listener ───────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    function (message, _sender, sendResponse) {
      switch (message.type) {
        case 'SHOW_AGENT_INDICATORS':
          showAgentIndicators(message.chatId);
          sendResponse({ success: true });
          break;
        case 'HIDE_AGENT_INDICATORS':
          hideAgentIndicators();
          sendResponse({ success: true });
          break;
        case 'HIDE_FOR_TOOL_USE':
          hideForToolUse();
          sendResponse({ success: true });
          break;
        case 'SHOW_AFTER_TOOL_USE':
          showAfterToolUse();
          sendResponse({ success: true });
          break;
        case 'SHOW_STATIC_INDICATOR':
          showStaticIndicator();
          sendResponse({ success: true });
          break;
        case 'HIDE_STATIC_INDICATOR':
          hideStaticIndicator();
          sendResponse({ success: true });
          break;
      }
    }
  );

  // ── Cleanup on page unload ─────────────────────────────────────────────

  window.addEventListener('beforeunload', function () {
    hideAgentIndicators();
    hideStaticIndicator();
  });
})();
