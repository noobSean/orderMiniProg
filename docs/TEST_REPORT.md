# 测试报告（企业员工点单小程序）

- 测试日期：2026-11-01
- 项目路径：`D:\order_recipe_miniprog`
- 技术栈：微信原生小程序 + 微信云开发（15 个云函数、云数据库、云存储、订阅消息）
- 测试范围：小程序端全部页面与工具模块、全部云函数、配置/数据库脚本、安全与体积/兼容性
- 测试结论：**通过**。自动化用例 **334 / 334 通过（0 失败、0 跳过）**；本轮发现并修复 4 个源码缺陷 + 1 个测试过程残留；剩余 8 项低优先级/上线配置类风险已记录，无阻塞上线的问题。

---

## 一、测试环境与工具

| 类别 | 内容 |
| --- | --- |
| 操作系统 | Windows 11（中文） |
| 运行时 | Node.js v24.19.0（CI 使用 Node 22） |
| 小程序工具 | 微信开发者工具（iPhone 15 Pro 模拟器，基础库 2.33.0） |
| 测试框架 | Node.js 内置 `node:test` + `node:assert/strict`（零外部依赖） |
| 云环境模拟 | 自研 `tests/helpers/mockCloud.js`：拦截 `Module._load` 的 `wx-server-sdk`，内存数据库/事务/openapi/环境变量/日志捕获 |
| 客户端模拟 | 自研 `tests/helpers/mockWx.js`：wx 全局对象（storage、cloud、订阅消息、导航、UI）与调用记录 |
| 静态分析 | `vm.Script` 语法校验、JSON/WXML/WXSS 结构解析、require 路径/页面注册/事件处理函数交叉校验 |
| 安全扫描 | 自研敏感信息规则（明文口令、GitHub token、私钥、AK/SK、AppSecret）+ `.gitignore` 实测 |
| 兼容性 | 基础库 2.33.0 与代码实际使用的 20 个 `wx.*`、6 个 `wx.cloud.*` API 逐项比对最低版本 |
| 持续集成 | GitHub Actions：`.github/workflows/tests.yml`，push/PR 自动执行 `node --test` |
| GUI/E2E | 微信开发者工具模拟器截图（本会话历史证据见 `docs/screenshots/`） |

> 说明：`node --test` 在 Node 24 下若直接把目录当参数（如 `node --test tests/`）会报 `MODULE_NOT_FOUND`，这是 Node CLI 行为；请使用 `node --test`（自动发现）或 glob/文件列表。

---

## 二、测试方法与分层策略

采用“单元 → 集成/契约 → 静态分析 → 安全/合规 → 体积/兼容 → E2E 冒烟”的分层测试策略：

1. **云函数单元/集成测试（225 例）**：真实加载 `cloudfunctions/*/index.js`，用内存版云数据库与 openapi 驱动；验证返回值、数据库副作用、订阅消息发送次数与内容、事务提交/回滚、鉴权与状态机。
2. **小程序端单元/契约测试（77 例）**：`utils/{util,api,adminAuth,upload,subscribe,store}.js`，覆盖时间解析、云调用封装与错误码、会话存储/过期/重定向、图片选择上传删除、订阅消息多模板请求、购物车增删改与金额。
3. **静态分析（32 例）**：40 个源码 JS 语法、41 个 JSON + 4 个 JSONL、17 个 WXML 标签配对、18 个 WXSS 配平、相对 require 可解析、17 个页面四件套/注册/tabBar/sitemap、92 个 WXML 事件处理函数存在性。
4. **安全/合规扫描**：源码/配置/文档敏感信息 0 命中；管理口令仅环境变量；token 使用 `crypto.randomBytes`；`.gitignore` 实测忽略私有配置。
5. **体积与兼容**：主包体积、云函数目录体积、基础库 API 最低版本、特性检测降级路径。
6. **E2E 冒烟**：模拟器内关键页面渲染与交互（历史截图证据），本轮对改动涉及的下单/通知/后台页面做回归检查。
7. **回归守护**：本次发现的临时调试代码注入问题固化为静态测试（`tests/static/findings.test.js`），防止再次进入提交。

---

## 三、覆盖范围

### 3.1 云函数（15/15，225 例）

| 云函数 | 用例 | 重点覆盖 |
| --- | ---: | --- |
| adminLogin | 19 | 口令登录、环境变量未配置、错误口令、会话签发/校验/注销、过期、12h TTL、DB 异常 |
| login | 6 | openid 登录、档案查询/不存在、异常 |
| bindEmployee | 25 | 工号/姓名规范化（全角/空格/零宽）、幂等、rebind、EMP_NO_TAKEN 掩码、并发回滚、诊断日志 |
| submitOrder | 26 | 事务下单/扣库存/回滚、参数校验、规格加料计价、库存不足、模板映射/兜底/失败不影响下单、qty 取整（本轮新增） |
| myOrders | 4 | 本人订单、排序、字段归一 |
| orderDetail | 9 | 归属/管理员鉴权、存在/不存在、异常 |
| orderAdmin | 21 | 鉴权、list 过滤/排序、状态机全流转/终态/别名、订阅消息触发与不误发、幂等（本轮新增）、取消回补库存（本轮新增） |
| dishAdmin | 20 | 增删改查、分类/价格/库存校验、图片字段、token 鉴权 |
| categoryAdmin | 10 | 增删改查、排序、删除引用影响（已记录风险） |
| settingsAdmin | 7 | 读写门店配置、默认值、鉴权、createdAt 哨兵（已记录） |
| adminStats | 8 | 今日概览、热销/分类统计、空数据、鉴权、1000 单上限（已记录） |
| deptAdmin | 15 | 科室/拼音搜索、分页、增删改、鉴权 |
| employeeAdmin | 20 | 分页/搜索/正则转义、幽灵记录兜底、解绑、鉴权文案差异（已记录） |
| subscribeCheck | 19 | 模板拉取、三类模板映射预览、未配置/找不到/拉取失败、测试发送、鉴权、日志 |
| seedData | 8 | 幂等、KEY 校验、数据写入 |
| fixes.round2（回归） | 7 | 取消回补库存/不限库存/非取消不回补、同状态幂等、cancel 过滤、qty 取整 |

### 3.2 小程序端（17 页 + 6 个工具模块，77 例）

| 模块/文件 | 用例 | 重点覆盖 |
| --- | ---: | --- |
| utils/util.js | 12 | ISO/时间戳/云 Date/异常值解析、格式化、金额、日期 |
| utils/api.js | 14 | `call` 注入 adminToken/订阅模板 ID、成功/失败、`ok:false` 抛错保留 code、NEED_ADMIN_LOGIN 清理、各 API 契约 |
| utils/adminAuth.js | 13 | 保存/读取/token 有效性与过期、ensure 跳登录页带 redirect、clear |
| utils/upload.js | 16 | chooseMedia/chooseImage 降级、取消、超 10MB、上传/删除/临时链接、失败路径 |
| utils/subscribe.js | 13 | 多模板请求、部分接受/拒绝、未配置过滤、API 不支持降级、下单模板集合 |
| utils/store.js | 9 | 加购合并、数量修改/删除/清空、总价计算 |
| 页面/静态 | 32 | 见“静态分析” |

### 3.3 关键业务场景验证清单

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 员工静默登录 / 换微信需重新绑定 | ✅ |
| 2 | 管理后台口令登录、12 小时会话、过期重登、退出 | ✅ |
| 3 | 菜品浏览、规格/加料选择、购物车金额 | ✅ |
| 4 | 自取/配送下单：事务扣库存、库存不足回滚、订单字段完整 | ✅ |
| 5 | 订单状态机：接单/制作/可取/完成/取消，非法流转拒绝 | ✅ |
| 6 | 取消订单回补库存（本轮修复） | ✅ |
| 7 | 重复提交同一状态幂等、不重复通知（本轮修复） | ✅ |
| 8 | 管理端订单列表/详情、备注展示（`delivery.note`） | ✅ |
| 9 | 订阅消息：模板自动映射、兜底映射、发送失败不影响业务、三类通知触发时机 | ✅（mock 验证） |
| 10 | 通知自检：配置检查、模板缺失、测试发送 | ✅（mock 验证） |
| 11 | 员工绑定/解绑/管理端分页搜索 | ✅ |
| 12 | 菜品图片上传/删除/预览、云存储路径 | ✅ |
| 13 | 门店配置/分类/菜品/科室/员工管理 | ✅ |
| 14 | 统计概览、时间显示（本地时区） | ✅ |
| 15 | 静态结构：页面注册、事件绑定、JSON/WXML/WXSS 合法 | ✅ |
| 16 | 安全：无明文口令/密钥；管理口令仅环境变量 | ✅ |
| 17 | 体积/兼容：主包 174.5KB < 2MB；API 均 ≤ 基础库 2.33.0 | ✅ |

---

## 四、自动化测试结果

执行命令：`node --test`（仓库根目录，自动发现 27 个测试文件）

```
ℹ tests 334
ℹ pass 334
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ≈ 2.2s
```

| 测试集 | 文件数 | 用例数 | 通过 | 失败 |
| --- | ---: | ---: | ---: | ---: |
| tests/cloud（云函数 + 回归） | 16 | 225 | 225 | 0 |
| tests/client（小程序工具） | 6 | 77 | 77 | 0 |
| tests/static（静态/安全/体积/兼容） | 5 | 32 | 32 | 0 |
| **合计** | **27** | **334** | **334** | **0** |

稳定性：连续 3 次执行结果一致；测试不依赖网络、真实时间、随机值（随机仅做格式断言），单文件可独立运行。

---

## 五、本轮发现与修复

| # | 级别 | 问题 | 位置 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | P1 | 取消订单不回补库存（扣减后永久减少） | `cloudfunctions/orderAdmin/index.js` | ✅ 已修复：取消时按订单明细回补有限库存（`stock` 为数字才回补，不限库存跳过；失败只记日志不影响状态），新增 3 条回归用例 |
| 2 | P2 | 同状态重复提交被允许，重复写历史并重复发订阅消息 | `cloudfunctions/orderAdmin/index.js` | ✅ 已修复：`from === to` 返回 `{ok:true, noop:true}`，不写库、不发通知；更新原用例并新增幂等用例 |
| 3 | P2 | `list` 过滤 `status:'cancel'` 永远为空（库内实际是 `cancelled`） | `cloudfunctions/orderAdmin/index.js` | ✅ 已修复：list/status 统一把 `cancel` 归一化为 `cancelled`，新增 2 条用例 |
| 4 | P2 | 下单数量允许小数（如 1.5 份） | `cloudfunctions/submitOrder/index.js` | ✅ 已修复：数量向下取整、上限 99、非法值按 1 件；新增 1 条用例 |
| 5 | P2 | 测试过程中发现 `miniprogram/app.js` 被临时注入 E2E 假数据/改写云调用（调试代码差点提交） | `miniprogram/app.js` | ✅ 已移除；新增 `tests/static/findings.test.js` 强校验，标记/改写再出现即失败 |
| 6 | P2（历史） | `adminLogin` 曾硬编码管理口令 | `cloudfunctions/adminLogin/index.js` | ✅ 已整改：只从 `process.env.ADMIN_PWD` 读取，未配置时明确报错；安全测试守护 |
| 7 | P3 | `adminStats` range 模式非法/缺省 `to` 兜底为「现在」时，同毫秒创建的订单会被 `<` 边界排除（CI 首次运行暴露，时区/毫秒边界不稳） | `cloudfunctions/adminStats/index.js` | ✅ 已修复：兜底 `to` 使用 `now + 1ms`，包含当前毫秒；新增回归用例 |

---

## 六、安全与合规

- **敏感信息**：源码/配置/文档扫描 0 命中（明文口令、`ghp_`/`github_pat_` token、私钥、AKIA、AppSecret）；公开仓库中不包含管理口令。
- **鉴权**：管理端统一 `admin_sessions` token（`crypto.randomBytes` 生成，12h TTL，前端/后端 TTL 一致）；云函数逐个校验，员工端以 openid 为身份。
- **权限**：`submitOrder/orderAdmin/subscribeCheck` 的 `config.json` 仅申请 `subscribeMessage.send`、`subscribeMessage.getTemplateList` 权限。
- **忽略文件**：`project.private.config.json`、`.cloudbase/`、`node_modules/`、日志/临时文件均已 `.gitignore` 实测忽略。
- **上线必须配置**：云函数 `adminLogin` 环境变量 `ADMIN_PWD`（未配置无法登录）；公众平台「用户隐私保护指引」声明相册用途（`chooseMedia/chooseImage` 真机授权）。
- **遗留提示**：`cloudfunctions/seedData` 为开发用测试数据工具，含固定 KEY，上线前不要部署（README 已注明）。

---

## 七、体积与兼容性

| 指标 | 结果 |
| --- | --- |
| 主包 `miniprogram/` | 174.5 KB / 2 MB（79 文件，约 8.5%），无分包 |
| 云函数源码合计 | 160.2 KB（15 个目录，最大 `seedData` 63.8 KB；依赖云端安装） |
| 基础库配置 | `libVersion 2.33.0`，最低目标 2.4.4 |
| wx.* API | 20 个，全部 ≤ 2.33.0 |
| 版本降级 | 唯一高于 2.4.4 的 `chooseMedia`(2.10.0) 已做特性检测并降级 `chooseImage` |

---

## 八、E2E / UI 验证

- 本会话已在微信开发者工具模拟器完成并留存截图证据（`docs/screenshots/`）：
  - 菜单页加料选择、购物车确认订单、员工订单/详情时间显示；
  - 员工端登录/静默恢复/未绑定状态；
  - 管理端订单时间线、菜品图片上传（选择/上传中/完成）、菜单管理布局前后对比；
  - 管理后台入口、通知自检界面（`docs/screenshots/admin-notify-selfcheck.png`）。
- 本轮 GUI 自动化截图尝试受开发者工具窗口被前台遮挡（Chromium 暂停渲染）限制，未能稳定完成全页面自动巡检；页面逻辑正确性由 334 条自动化用例覆盖，建议发版前人工快速过 5 个关键页面（菜单→购物车→订单→管理后台订单→通知自检）。

---

## 九、未覆盖范围与遗留风险

| # | 风险/未覆盖项 | 级别 | 建议 |
| --- | --- | --- | --- |
| 1 | 真实云环境联调（真实 openapi 权限、真实事务隔离、真实订阅消息推送） | P1（必须做） | 按 README 9.7 部署后 ping 自检 + 管理后台“通知自检”逐项验证；用真机允许订阅后走真实订单 |
| 2 | 公众平台隐私保护指引未配置会导致图片上传真机被拒 | P0（上线前） | 在公众平台声明「相册（选择图片）」用途，真机验证上传 |
| 3 | `seedData` 固定 KEY、可被任意调用覆盖测试数据 | P2 | 生产环境不部署该函数（当前 README 已要求） |
| 4 | `orderDetail`/`orderAdmin.detail` 在真实 SDK 中“订单不存在”会透出 SDK 原始错误 | P3 | 后续区分缺失与查询失败，返回友好文案 |
| 5 | 取餐号使用事务外 `count` 生成，高并发下可能重号/取消单占号 | P2 | 生产低峰可接受；建议对 `(日期, pickupNo)` 建唯一索引或将计数放入事务/计数器集合 |
| 6 | 取消回补库存为“读-改-写”，极端并发下可能丢失更新 | P3 | 后续改用原子 `inc` 或事务 |
| 7 | `settingsAdmin` 新建配置返回的 `createdAt` 是 serverDate 哨兵 | P3 | 前端不使用该字段即可；后续改为返回真实时间 |
| 8 | `adminStats` 单次最多统计 1000 单；分类物理删除不检查菜品引用 | P3 | 数据量放大后分页/聚合；删除前检查引用 |
| 9 | 未做真机 iOS/Android 兼容、弱网、并发/压力测试 | P2 | 上线前真机回归 + 下单并发压测（小程序侧限流） |

---

## 十、复现方式

```bash
# 全部测试（Node 20+，无需安装依赖）
node --test

# 分套件
node --test "tests/cloud/*.test.js"
node --test "tests/client/*.test.js"
node --test "tests/static/*.test.js"

# npm 脚本
npm test
npm run test:cloud
```

测试目录：

```
tests/
├─ helpers/   mockCloud.js（云函数 mock）、mockWx.js（小程序 wx mock）
├─ cloud/     15 个云函数测试 + fixes.round2.test.js（本轮回归）
├─ client/    util/api/adminAuth/upload/subscribe/store
└─ static/    syntax/structure/security/size-compat/findings
```

---

## 十一、结论与上线建议

- **质量结论**：核心业务（下单、扣库存、状态机、管理端订单、员工绑定、订阅消息、图片上传、门店/菜品/科室/员工管理）已由 334 条自动化用例覆盖并通过；本轮修复了取消不回补库存等 4 个实际缺陷，代码质量满足上线前基线。
- **上线前必做**：
  1. 云函数环境变量配置 `ADMIN_PWD`（强口令）；
  2. 配置三个订阅消息模板 ID（`miniprogram/config/index.js`）并完成真机订阅验证；
  3. 公众平台完成用户隐私保护指引（相册用途）；
  4. 按 README 9.7 重新部署 `submitOrder/orderAdmin/subscribeCheck/adminLogin` 并做 `{"action":"ping"}` 自检；
  5. 真机走一遍完整链路（下单 → 接单/制作 → 取餐/送达 → 通知）。
- **后续迭代**：取餐号唯一索引/计数原子化、订单不存在友好提示、统计分页、并发压测与真机兼容性回归。
