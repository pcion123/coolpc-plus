/**
 * Main World Interceptor
 * 以 manifest content_script + world:"MAIN" 方式載入，以 file 形式注入，
 * 不受頁面 CSP 的 inline-script 限制。
 * 攔截頁面的 Clear()/FReset()，完成後透過 CustomEvent 通知 isolated world 的 content script。
 */
(function () {
  if (window.__aiAdvisorInjected) return;
  window.__aiAdvisorInjected = true;

  const _origClear = window.Clear;
  window.Clear = function (...args) {
    document.dispatchEvent(new CustomEvent('ai-advisor-clear'));
    return _origClear?.apply(this, args);
  };

  const _origFReset = window.FReset;
  window.FReset = function (...args) {
    document.dispatchEvent(new CustomEvent('ai-advisor-clear'));
    return _origFReset?.apply(this, args);
  };
})();
