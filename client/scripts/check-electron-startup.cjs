// Runs the built Electron app against fresh, isolated local profiles.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const clientDir = path.resolve(__dirname, '..');
const packagedExe = process.argv[3] ? path.resolve(process.argv[3]) : '';
const electron = packagedExe || path.join(clientDir, 'node_modules/electron/dist/electron.exe');
const outDir = path.resolve(process.argv[2] || '');
if (process.platform !== 'win32' || !fs.existsSync(electron) || !fs.existsSync(path.join(clientDir, 'dist/index.html')) || !process.argv[2]) {
  throw new Error('Usage on Windows after npm run build: node scripts/check-electron-startup.cjs <fresh-local-output-dir>');
}
if (fs.existsSync(outDir)) throw new Error(`Refusing to overwrite previous startup evidence: ${outDir}`);
fs.mkdirSync(outDir, { recursive: true });

async function runScenario(name, flags, required) {
  const profile = path.join(outDir, name);
  fs.mkdirSync(profile);
  const env = { ...process.env, YIBIAO_STARTUP_PROBE: '1', YIBIAO_STARTUP_TEST_USER_DATA: profile, ...flags };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, packagedExe ? [] : ['.'], { cwd: packagedExe ? path.dirname(packagedExe) : clientDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  let stdout = '';
  let stderr = '';
  let completed = false;
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => finish('timeout'), 30000);
    const finish = (status) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      resolve(status);
    };
    const inspect = () => {
      let boundary;
      while ((boundary = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, boundary).trim();
        stdout = stdout.slice(boundary + 1);
        if (!line.startsWith('STARTUP_PROBE ')) continue;
        try { events.push(JSON.parse(line.slice(14))); } catch {}
      }
      if (required.every((event) => events.some((item) => item.event === event))) finish('pass');
    };
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); inspect(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 500); });
    child.on('error', () => finish('spawn-error'));
    child.on('exit', () => finish('early-exit'));
  });
  if (child.pid) {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  return { name, outcome, events, stderrPresent: Boolean(stderr), required };
}

(async () => {
  const scenarios = [];
  for (let index = 1; index <= 3; index += 1) scenarios.push(await runScenario(`cold-${index}`, {}, ['ui-ready', 'main-shown']));
  scenarios.push(await runScenario('refresh', { YIBIAO_STARTUP_TEST_RELOAD: '1' }, ['ui-ready', 'main-shown', 'refresh-ui-ready']));
  scenarios.push(await runScenario('recover-failed-load', { YIBIAO_STARTUP_TEST_FAIL_ONCE: '1' }, ['did-fail-load', 'load-retry', 'ui-ready', 'main-shown']));
  const result = { scenarios, passed: scenarios.every((item) => item.outcome === 'pass') };
  const report = path.join(outDir, 'results.json');
  fs.writeFileSync(report, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ passed: result.passed, report, summary: scenarios.map((item) => ({ name: item.name, outcome: item.outcome, uiReadyMs: item.events.find((event) => event.event === 'ui-ready')?.ms, mainShownMs: item.events.find((event) => event.event === 'main-shown')?.ms })) }, null, 2));
  if (!result.passed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
