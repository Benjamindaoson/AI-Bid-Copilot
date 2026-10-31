// Opt-in local startup timing. Never logs document text, URLs, keys or renderer console content.
function attachStartupProbe(window, { enabled = process.env.YIBIAO_STARTUP_PROBE === '1', log = console.log, onReady, onTimeout, label = '' } = {}) {
  if (!enabled && !onReady && !onTimeout) return { stop() {}, mark() {} };
  const started = process.hrtime.bigint();
  let timer = null, stopped = false, pending = false;
  const mark = (event, extra = {}) => {
    if (!enabled) return;
    // A GUI process may outlive the terminal that launched it. A closed stdout pipe
    // must never crash the desktop application during startup diagnostics.
    try {
      log(`STARTUP_PROBE ${JSON.stringify({ event: `${label}${event}`, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6), ...extra })}`);
    } catch {}
  };
  const stop = () => { stopped = true; if (timer) clearInterval(timer); };
  window.webContents.on('dom-ready', () => mark('dom-ready'));
  window.webContents.on('did-finish-load', () => mark('did-finish-load'));
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => mark('did-fail-load', { code, mainFrame }));
  window.webContents.on('render-process-gone', (_event, details) => mark('render-process-gone', { reason: details.reason }));
  window.on('closed', stop);
  timer = setInterval(async () => {
    if (stopped || pending || window.isDestroyed()) return;
    pending = true;
    try {
      const ready = await window.webContents.executeJavaScript('Boolean(document.querySelector("#root")?.innerText?.trim())', true);
      if (ready) { mark('ui-ready'); stop(); onReady?.(); }
    } catch {} finally { pending = false; }
  }, 100);
  timer.unref?.();
  setTimeout(() => { if (!stopped) { mark('ui-timeout'); stop(); onTimeout?.(); } }, 30000).unref?.();
  mark('window-created');
  return { stop, mark };
}

module.exports = { attachStartupProbe };
