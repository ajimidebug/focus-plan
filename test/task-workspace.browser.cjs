/* Synthetic local data only. npm install playwright; optional FOCUS_BROWSER_EXECUTABLE. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', process.cwd()] }));
const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
async function run() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const fonts = process.env.FOCUS_TEST_FONT_DIR;
    const base = fonts && url.pathname.startsWith('/__test-font/') ? fonts : root;
    const name = base === fonts ? url.pathname.slice('/__test-font/'.length) : url.pathname === '/' ? 'index.html' : url.pathname;
    const file = path.resolve(base, '.' + (name.startsWith('/') ? name : '/' + name));
    if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404).end(); return; } res.setHeader('Content-Type', mime[path.extname(file)] || 'text/html'); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const launch = () => chromium.launch({ headless: true, executablePath: process.env.FOCUS_BROWSER_EXECUTABLE || undefined, args: JSON.parse(process.env.FOCUS_BROWSER_ARGS || '["--no-sandbox","--disable-dev-shm-usage"]') });
  try {
    for (const [width, height] of [[770, 490], [550, 350], [350, 550]]) {
      browser = await launch();
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.waitForFunction(() => window.App?.memoWorkspace && document.querySelector('#mw-today'));
      if (process.env.FOCUS_TEST_FONT_DIR) { await page.addStyleTag({ content: '@import url("/__test-font/400.css"); @import url("/__test-font/600.css"); body,button,input,select,textarea { font-family:"Noto Sans SC",sans-serif!important; }' }); await page.evaluate(() => document.fonts.ready); }
      await page.evaluate(async () => {
        const S = App.store, d = S.data(), day = App.memoCore.naturalDay();
        S.getDay(day).tasks.required = [{ id: 'short', text: '完成五道线性代数错题' }, { id: 'long', text: '这是一条四十字左右的任务名称，用来检查手机上长标题能否读清楚并且不会覆盖编辑按钮', note: '较长备注。'.repeat(20) }];
        S.getDay(day).tasks.ideal = [{ id: 'ideal', text: '复习英语单词', points: 10 }];
        d.queue = ['a', 'b', 'c', 'd'].map(id => ({ id, text: '队列任务 ' + id, points: 3 }));
        d.memoProjects = [{ id: 'project', text: '持续推进的项目', points: 2, days: {} }];
        d.checkins = [{ id: 'optional', text: '额外刷牙', target: 0, points: 3, rewardLimit: 1, days: {} }, { id: 'goal', text: '每日目标习惯', target: 2, points: 2, rewardLimit: 2, days: {} }];
        App.memoCurrency.enableFixedCore(); await S.save(); App.app.switchView('tasks'); App.tasks.renderAll();
      });
      const task = page.locator('[data-mw-card]').filter({ hasText: '完成五道线性代数错题' });
      const noOverflow = async label => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + ' ' + label + ' has no page overflow');
      await noOverflow('today');
      if (process.env.FOCUS_SCREENSHOT_DIR) { fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR, { recursive: true }); await page.addStyleTag({ content: '.toast {visibility:hidden!important}' }); await page.screenshot({ path: path.join(process.env.FOCUS_SCREENSHOT_DIR, 'initial-' + width + 'x' + height + '.png') }); if (width === 770) await page.screenshot({ path: path.resolve(root, '..', 'task-preview-770x490.png') }); }
      check(await task.getByRole('button', { name: '编辑：完成五道线性代数错题' }).isVisible(), 'explicit edit visible');
      const geometry = await task.evaluate(el => { const title = el.querySelector('.mw-task-title').getBoundingClientRect(), edit = el.querySelector('[data-mw="edit"]').getBoundingClientRect(), complete = el.querySelector('[data-mw="complete"]').getBoundingClientRect(); return { titleRight: title.right, editLeft: edit.left, touch: Math.min(complete.width, complete.height) }; });
      check(geometry.titleRight <= geometry.editLeft && geometry.touch >= 44, 'title separate from 44px completion target');
      await task.locator('.mw-task-title').click(); await page.locator('#mw-title').waitFor();
      check(await page.locator('#mw-title').inputValue() === '完成五道线性代数错题', 'title opens editor');
      await page.locator('#modal-root [data-act="cancel"]').click();
      await task.locator('[data-schedule-command="start"]').click(); await task.locator('[data-inline-session]').waitFor();
      check((await task.innerText()).includes('计时中'), 'timer immediately visible');
      await page.reload(); await page.waitForFunction(() => window.App?.memoWorkspace && document.querySelector('#mw-today'));
      if (process.env.FOCUS_TEST_FONT_DIR) { await page.addStyleTag({ content: '@import url("/__test-font/400.css");@import url("/__test-font/600.css");body,button,input,select,textarea{font-family:"Noto Sans SC",sans-serif!important}' }); }
      await page.evaluate(() => App.app.switchView('tasks'));
      await task.locator('[data-inline-session]').waitFor(); check((await task.innerText()).includes('计时中'), 'timer restored after refresh');
      await task.locator('[data-schedule-command="pause"]').click(); await page.waitForFunction(() => document.querySelector('[data-inline-session]')?.textContent.includes('已暂停'));
      const paused = await task.locator('[data-inline-session]').textContent(); await page.waitForTimeout(1100); check(await task.locator('[data-inline-session]').textContent() === paused, 'pause excludes waiting time');
      check(await page.locator('#modal-root .modal').count() === 0, 'timer click does not open editor');
      await page.locator('[data-mw-pane="queue"]').click(); await noOverflow('queue');
      const cols = await page.locator('.mw-queue-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      check(cols === (width >= 770 ? 2 : 1), 'responsive queue columns');
      const queueC = page.locator('#mw-queue [data-mw-card]').filter({ hasText: '队列任务 c' });
      await queueC.locator('summary').click(); await queueC.getByRole('button', { name: '置顶', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#mw-queue [data-mw-card]')?.textContent.includes('队列任务 c'));
      check((await page.locator('#mw-queue [data-mw-card]').first().innerText()).includes('队列任务 c'), 'one-click pin orders queue');
      await page.locator('[data-mw-pane="today"]').click();
      await task.locator('[data-mw="complete"]').click(); await page.locator('#modal-root [data-act="commit"]').click();
      await page.waitForFunction(() => document.querySelector('#mw-today .mw-completed'));
      check(!await page.locator('#mw-today .mw-completed').first().evaluate(el => el.open), 'completed task starts collapsed');
      await page.evaluate(async () => { const day = App.memoCore.naturalDay(), start = Date.parse(day + 'T12:00:00+08:00'); App.memoSchedule.savePlan({ ref: { kind: 'task', id: 'short', day, list: 'required' }, title: '完成五道线性代数错题', day, type: 'point', start, end: null }); await App.store.save(); });
      await page.locator('[data-mw-pane="timeline"]').click(); await noOverflow('timeline');
      check(await page.locator('[data-schedule-done]').count() === 1 && !await page.locator('[data-schedule-done]').evaluate(el => el.open), 'timeline completion starts folded');
      check(await page.locator('.schedule-cards > :last-child').getAttribute('data-schedule-done') !== null, 'completed details after unfinished details');
      check(await page.locator('.schedule-waiting').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('[data-schedule-done]')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'unscheduled unfinished tasks remain before completed details');
      check(await page.locator('[data-schedule-done] [id^="schedule-card-p-"]').count() === 1 && await page.locator('[data-schedule-done] [id^="schedule-card-s-"]').count() === 1, 'all task details folded together');
      await page.locator('#schedule-range').selectOption('24');
      check(await page.locator('.schedule-completed').count() > 0, 'completion still exists at real chart time');
      await page.locator('[data-schedule-done] > summary').click();
      await page.locator('[data-schedule-done] [data-sc="complete"]').click(); await page.locator('#modal-root [data-act="commit"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-schedule-done]').length === 0);
      check(await page.locator('.schedule-cards [id^="schedule-card-s-"]').count() > 0, 'undo keeps execution history');
      await page.locator('[data-mw-pane="today"]').click();
      await page.locator('.mw-toolbar [data-mw="add-required"]').click();
      await page.locator('#mw-list').selectOption('ideal'); await page.locator('#mw-title').fill('新建带时间点的理想任务'); await page.locator('#mw-start').fill('21:40');
      await page.locator('#modal-root [data-act="save"]').click(); await page.locator('#modal-root .modal').waitFor({ state: 'detached' });
      check(await page.evaluate(() => { const day = App.memoCore.naturalDay(), task = App.store.getDay(day).tasks.ideal.find(t => t.text === '新建带时间点的理想任务'); return !!task && App.memoSchedule.state().items.some(p => p.ref.id === task.id && p.type === 'point' && p.end == null); }), 'ideal task creation saves task and point plan together');
      // A selected title must not trigger whole-card editing.
      await page.locator('[data-mw-pane="today"]').click();
      await task.locator('.mw-task-title').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      await task.locator('.mw-task-title').click(); check(await page.locator('#modal-root .modal').count() === 0, 'selected text does not open edit'); await page.evaluate(() => window.getSelection().removeAllRanges());
      // Optional target form, award preview and failed-save retry use actual UI controls.
      await page.evaluate(() => { App.app.switchView('checkin'); App.checkin.render(); });
      await noOverflow('checkin');
      check((await page.locator('#checkin-view').innerText()).includes('选做 · 今日已做 0 次'), 'optional text displayed without 0/0');
      const optional = page.locator('.ck-row[data-id="optional"]');
      await optional.locator('[data-act="ck-edit"]').click(); check(await page.locator('#ck-target').inputValue() === '0', 'editor retains zero');
      check(await page.locator('#modal-root .modal-actions').evaluate(el => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }), 'short-window modal confirmation reachable');
      await page.locator('#modal-root [data-act="cancel"]').click();
      await page.locator('[data-act="ck-add"]').click(); await page.locator('#ck-text').fill('只记录的选做习惯'); await page.locator('#ck-target').fill('0');
      check(await page.locator('#ck-reward-limit').inputValue() === '1', 'new optional defaults to one paid punch');
      await page.locator('#ck-reward-limit').fill('0'); await page.locator('#modal-root [data-act="ok"]').click(); await page.locator('#modal-root .modal').waitFor({ state: 'detached' });
      check(await page.evaluate(() => App.store.data().checkins.some(it => it.text === '只记录的选做习惯' && it.target === 0 && it.rewardLimit === 0)), 'optional form persists zero target and zero reward limit');
      await page.locator('[data-act="ck-add"]').click(); await page.locator('#ck-text').fill('保存失败重试的选做习惯'); await page.locator('#ck-target').fill('0');
      await page.evaluate(() => { window.__habitRealSave = App.store.save; App.store.save = async () => false; });
      await page.locator('#modal-root [data-act="ok"]').click(); await page.locator('#ck-save-error').filter({ hasText: '尚未保存' }).waitFor();
      await page.locator('#modal-root .modal-mask').dispatchEvent('mousedown');
      check(await page.locator('#ck-save-error').count() === 1, 'habit persistence failure cannot lose retry to backdrop');
      await page.keyboard.press('Escape'); await page.locator('#modal-root [data-act="cancel"]').click();
      check(await page.locator('#ck-save-error').count() === 1, 'habit persistence failure cannot lose retry to Escape or cancel');
      await page.evaluate(() => { App.store.save = window.__habitRealSave; }); await page.locator('#modal-root [data-act="ok"]').click(); await page.locator('#modal-root .modal').waitFor({ state: 'detached' });
      check(await page.evaluate(() => App.store.data().checkins.filter(it => it.text === '保存失败重试的选做习惯').length === 1), 'habit retry persists once without duplicate creation');
      await optional.locator('[data-act="ck-punch"]').click(); await page.locator('#modal-root [data-act="commit"]').click();
      await page.waitForFunction(() => document.querySelector('.ck-row[data-id="optional"] [data-act="ck-punch"]')?.textContent.includes('+0'));
      check((await optional.innerText()).includes('今日已做 1 次'), 'optional punch and cap displayed');
      check((await page.locator('.ck-goal-status').innerText()).includes('0/1'), 'optional does not enter target denominator');
      await page.evaluate(() => { App.app.switchView('settings'); App.settings.render(); }); await noOverflow('settings');
      check((await page.locator('#memo-currency-panel').innerText()).includes('当前习惯规则：固定基础分'), 'current rule is explicit');
      await page.evaluate(() => { App.memoCurrency.enableCore(); App.memoCurrency.panel(); });
      await page.locator('#currency-fixed').click(); await page.waitForFunction(() => document.querySelector('#memo-currency-panel')?.textContent.includes('当前习惯规则：固定基础分'));
      check(await page.evaluate(() => App.store.data().memoCurrency.version === 3), 'explicit rule switch uses saved fixed mode');

      await page.evaluate(() => App.app.switchView('tasks'));
      await page.locator('[data-mw-pane="today"]').click(); await page.evaluate(() => { window.__realSave = App.store.save; App.store.save = async () => false; });
      await task.locator('[data-schedule-command="start"]').click();
      await task.locator('.mw-timing-error').waitFor(); check((await task.innerText()).includes('重试保存'), 'timer failure has local retry');
      await page.evaluate(() => { App.store.save = window.__realSave; }); await task.locator('[data-schedule-command="retry"]').click();
      await task.locator('[data-inline-session]').waitFor();
      check(await page.evaluate(() => App.memoSchedule.state().sessions.filter(s => s.status === 'running').length) === 1, 'retry saves once without duplicate running session');
      if (process.env.FOCUS_SCREENSHOT_DIR) { fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR, { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(process.env.FOCUS_SCREENSHOT_DIR, 'tasks-' + width + 'x' + height + '.png') }); }
      check(errors.length === 0, 'no browser runtime errors: ' + errors.join('; '));
      await context.close(); await browser.close(); console.log('PASS viewport ' + width + 'x' + height);
    }
    console.log(checks + ' browser assertions passed');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
