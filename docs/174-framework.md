# 174.0.0 框架接入与发布审计

此版本在现有网站接入 Vue 3、Quasar CLI/Vite、Vue Router、Pinia；以同一正式更新交付。源码在 main，正式站点应使用构建后的 dist/spa，不能直接发布仓库根目录。

## 模块边界

| 区域 | 实现 | 业务依据 |
| --- | --- | --- |
| 外层布局、五个底部入口、更多抽屉 | Vue / Quasar | 原有页面入口保持可达 |
| 三栏任务概览 | Vue / Quasar | memoWorkspace.taskItems、memoFinance.column |
| 弹窗容器、焦点限制、通知 | Quasar | 原表单 DOM 与同步返回 API 保留；取消、提交和失败保留遵循原业务处理 |
| 时长图表 | Chart.js | 仍使用原统计模块传入的时长，不新增学习时间算法；附可读数据表 |
| 月历 | FullCalendar Standard | 只读任务投影，点日期调用原页面；不依赖 Premium |
| CSV 序列化 | PapaParse | 仍由原数据层选择字段，所有单元格加引号 |
| 任务输入 | Zod | 表单边界校验，不变更历史备份格式 |
| 任务、笔记、积分、计时、备份、专用页面 | 现有领域模块与界面片段 | 使用原数据 v1；继续由原模块承担写入、撤销、保存与失败恢复 |
| 显示状态 | Pinia | 仅导航、加载、弹窗和保存状态；不复制第二套业务数据 |

专用表单与复杂页面目前保留旧界面片段，通过隔离容器接入；本次没有把整个应用改写为 Vue。后续可以逐页替换，避免一次重写领域规则。

## 数据与故障保护

- 继续使用 focusPlanData.v1 及原 IndexedDB 名称、版本、图片数据，不进行结构迁移。
- 保持北京时间 04:00 分日、事件关联、任务完成与精确撤销、片段去重与跨日规则。
- 继续使用原计时核心；显示刷新不能证明后台计时正确，不以 requestAnimationFrame 代替持久时间依据。
- 新框架弹窗、更多抽屉计入更新忙碌检查；保存与更新阻塞由原更新器处理。
- 生产 worker 对构建、恢复页及 173.9.1 兼容界面逐项 SHA-256 校验。兼容界面使用同一来源存储，但不注册第二个 worker。
- recovery.html 不依赖应用主包，可导出原始主记录；原始导出不含独立图片。完整备份仍在设置页或兼容界面中生成。
- 使用兼容界面前保存并关闭其他本站页面。兼容入口用于界面故障恢复；服务器整体回退时，应从已核验的历史提交重新发布完整文件。
- 浏览器数据仅在本机、当前来源保存；更换域名、浏览器或设备不等于数据迁移。

## 构建与验证

```sh
npm ci
node scripts/prepare-release.mjs 174.0.0
npm run check
npm run build
npm run typecheck
npm test
```

开发使用 `npm run develop`；构建结果 `dist/spa` 使用 HTTP 静态服务。根目录 index.html 是 Quasar 构建入口；legacy/index.html 是兼容 DOM 模板，均不作为正式部署文件直接上传。

GitHub Actions 对同一个构建产物执行现行发布门禁中的 browser-smoke、173.2–173.9.1 浏览器回归、points-account 与 framework.browser.cjs（task-workspace 为较早归档测试，依赖已被后续版本替换的行内计时标记，未纳入门禁），覆盖三栏、两行按钮、不同宽度、保存失败、计时与积分、导航、离线恢复及兼容界面读取。自动化结果以对应提交的 Actions 为准；浏览器模拟不替代实体手机、软键盘及系统画中画的人工验收。

新增 fast-check 性质测试独立验证完成/撤销序列及计时区间并集，并逐项验证生产 manifest 的实际内容。axe 对新增框架区域进行 WCAG 2 A/AA 扫描；这不代表遗留专用页面全部满足无障碍标准。

## 许可证与维护

依赖版本由 package-lock.json 固定。生产资源包含第三方许可证清单 THIRD-PARTY-NOTICES.txt。后续升级依赖必须重新构建并执行相同回归，不直接修改已生成的 dist 文件。
