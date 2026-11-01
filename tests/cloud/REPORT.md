# 云函数自动化测试套件报告（tests/cloud）

> 任务：task-5「cloud-tests：全部云函数单元/集成测试」
> 约定：仅新增测试文件，未修改任何源码（cloudfunctions/**、miniprogram/** 只读）。

## 一、结果总览

| 项目 | 结果 |
| --- | --- |
| 测试文件 | 15 个（按云函数拆分）+ 1 个共享 mock（tests/helpers/mockCloud.js） |
| 用例总数 | **217** |
| 通过 | **217** |
| 失败 | **0** |
| 单文件独立运行 | 15/15 全部通过（node --test tests/cloud/xxx.test.js） |
| 重复运行 | 连续 3 次全绿（无时间/网络/随机依赖） |
| 全仓测试（含他人 tests/client、tests/static） | 326/326 通过（node --test "tests/**/*.test.js"） |

## 二、运行方式（Node 24.19.0 实测）

```bash
# 全部云函数测试（node 自行展开 glob，跨 shell 均可用）
node --test "tests/cloud/*.test.js"

# 单个函数测试（独立进程，可单独跑）
node --test tests/cloud/adminLogin.test.js
node --test tests/cloud/submitOrder.test.js
# ...
```

注意：本机 Node v24.19.0 中 `node --test tests/cloud/`（传目录）会把目录当模块入口并报
`MODULE_NOT_FOUND: Cannot find module ...\tests\cloud`，属于 Node CLI 行为而非测试失败；
请使用上面的 glob 写法（或 bash 环境下不写引号的 `node --test tests/cloud/*.test.js`，由 shell 展开）。

## 三、文件与用例分布

| 云函数 | 测试文件 | 用例数 | 主要覆盖点 |
| --- | --- | ---: | --- |
| adminLogin | tests/cloud/adminLogin.test.js | 19 | 口令空/错/未配置、签发 token(12h)、openid 掩码、过期会话清理、verify/logout、会话写库失败、未知 action |
| login | tests/cloud/login.test.js | 6 | openid 返回、员工档案查询、多档案取第一条、DB 异常 |
| bindEmployee | tests/cloud/bindEmployee.test.js | 25 | 全角/空格/零宽规范化、长度校验、新绑定、幂等、脏数据自愈、数字工号、ALREADY_BOUND_SELF、rebind、EMP_NO_TAKEN 掩码文案、并发回滚、INTERNAL_ERROR、诊断日志 |
| submitOrder | tests/cloud/submitOrder.test.js | 26 | ping、参数校验、未绑定、规格/加料计价、qty 兜底、不限库存、配送单、取餐号、菜品缺失/下架/库存不足回滚、事务读/提交/计数异常、订阅消息自动映射+fallback+发送失败不影响下单 |
| myOrders | tests/cloud/myOrders.test.js | 4 | 本人订单过滤、倒序、快照副本、DB 异常 |
| orderDetail | tests/cloud/orderDetail.test.js | 9 | 本人可看、他人订单越权、有效/无效/过期 adminToken、DB 异常、订单不存在 |
| orderAdmin | tests/cloud/orderAdmin.test.js | 21 | 鉴权、list 近 7 天/状态过滤、状态机全部非法流转、终态、cancel 别名、同状态幂等、可取餐/已送达通知自动映射与 fallback、发送失败不影响状态、detail、未知 action |
| dishAdmin | tests/cloud/dishAdmin.test.js | 20 | 鉴权、list 排序、get 双 id 兼容、create 默认值/数值转换/空名、update 局部更新、toggle 显式/取反、软删除、未知 action |
| categoryAdmin | tests/cloud/categoryAdmin.test.js | 10 | 鉴权、list/get/create/update/delete、参数校验、DB 异常 |
| settingsAdmin | tests/cloud/settingsAdmin.test.js | 7 | 鉴权、get 空/有配置、update 局部合并、数组/布尔归一、无配置时 upsert、未知 action |
| adminStats | tests/cloud/adminStats.test.js | 8 | 鉴权、今日统计、取消单排除、range 区间、非法日期回落、topDishes 聚合/排序/前 10、浮点防护、DB 异常 |
| deptAdmin | tests/cloud/deptAdmin.test.js | 15 | 公开 list 免登录、排序规则、>100 条分页拉全、鉴权、adminList、create code 自增/rootCode 解析、update、toggle、delete、未知 action |
| employeeAdmin | tests/cloud/employeeAdmin.test.js | 20 | 鉴权(trim)、分页/排序/上限 50、关键字模糊搜索/正则转义/数字工号、幽灵记录兜底扫描、缺 createdAt 兜底、解绑（id/工号/重复档案/数字工号）、NOT_FOUND/RELEASE_FAILED、未知操作 |
| subscribeCheck | tests/cloud/subscribeCheck.test.js | 19 | 鉴权、默认 3 类通知、未配置/命中/未找到/模板列表失败四种状态、关键字解析与中文标签映射、maskId、thing 截断、fallbackMap、测试发送成功/失败、miniprogramState 覆盖 |
| seedData | tests/cloud/seedData.test.js | 8 | key 校验、withOrders=false、订单时间字段 Date 化、幂等（重复执行数量不变）、已存在 settings 原地覆盖、固定 _id、分片写入、失败时保留进度 |

## 四、mock 方案（tests/helpers/mockCloud.js）

- 拦截 `require('wx-server-sdk')`，返回内存版 `cloud`；`createScenario()` 每用例重建 mock、写种子、设置 env、清 require 缓存后加载云函数，保证用例隔离。
- 内存数据库支持：`collection/where/orderBy/skip/limit/get/count/add/doc{get,set,update,remove}`、
  `db.command`（eq/neq/gt/gte/lt/lte/in/nin/exists/and/or + 字段级链式 and）、`db.RegExp`、`db.serverDate`、
  `db.createCollection`、`db.startTransaction()`（doc get/update/set/remove + add；commit 生效 / rollback 丢弃）。
- `getWXContext` 可配置 OPENID；`openapi.subscribeMessage.getTemplateList/send` 可配置模板列表、抛错与返回值，
  并记录调用参数用于断言发送次数与内容。
- `failNext(collection, op, error)` 注入数据库异常；`after(collection, op, fn)` 模拟并发写入（bindEmployee 竞态回滚）。
- 默认语义贴近真实云 SDK：`doc.get()` 缺失文档抛错；`orderBy` 字段缺失的文档被排除（可用 options 切换）。
- console.log/error 默认静默捕获，可断言诊断日志（bindEmployee/employeeAdmin 的排查日志）。
- 断言全部使用 `node:assert/strict`；零外部依赖。

## 五、源码观察 / 缺陷清单（按要求：只报告，未修改源码）

> 下列条目不影响用例通过；测试中已按「现状行为」断言并加注释，供后续排期修复。

### 1) 取消订单不回补库存（中等，建议优先确认）
- 位置：`cloudfunctions/submitOrder/index.js:340`（下单时扣库存）与 `cloudfunctions/orderAdmin/index.js:376-409`（status action 仅更新订单状态）。
- 现象：下单扣减 `dishes.stock` 后，管理端把订单置为 `cancelled`（或非法退单）时没有任何库存回补逻辑。
- 复现：dish_1 stock=10 → submitOrder 下单 qty=2 → stock=8 → orderAdmin `{action:'status',status:'cancelled'}` → stock 仍为 8。
- 期望：取消/退款时按订单 items 回补库存，或明确「取消不补库存」的业务口径。

### 2) 同状态重复提交被视为合法，会重复写历史并发重复通知（中等）
- 位置：`cloudfunctions/orderAdmin/index.js:346`（`if (from === to) return true`）、`:399`（追加 statusHistory）、`:402-406`（触发订阅消息）。
- 现象：对已是 ready 的自取单再次点「可取餐」，第二次仍返回成功、再追加一条历史，并再发一条「可取餐提醒」。
- 建议：`from === to` 时直接返回成功（幂等）且跳过历史/通知。测试 `orderAdmin/status: 同状态重复提交被视为合法…` 记录了现状。

### 3) list 的 `cancel` 状态过滤永远为空（低）
- 位置：`cloudfunctions/orderAdmin/index.js:335`（VALID_STATUS 含 `'cancel'`）、`:370-374`（直接用该值当 where 条件）。
- 现象：库内状态实际存为 `cancelled`，传 `status:'cancel'` 过滤不到任何订单。建议把别名归一化后再过滤。

### 4) 订单不存在分支在真实 SDK 下不可达，错误文案直接透出（低，UX）
- 位置：`cloudfunctions/orderDetail/index.js:26-28`、`cloudfunctions/orderAdmin/index.js:414`。
- 现象：真实 `doc().get()` 找不到文档时会抛错（`employeeAdmin` 源码注释也确认该语义），因此
  `if (!order) return '订单不存在'` / `data: res.data || null` 分支实际不可达；用户会看到 SDK 原始错误。
- 测试用 mock 的 `missingDoc:'null'` 覆盖了预期分支，同时另一条用例断言真实抛错语义下的兜底返回。

### 5) settingsAdmin 新建配置时返回的 createdAt 是 serverDate 哨兵（低）
- 位置：`cloudfunctions/settingsAdmin/index.js:50-52`：`patch.createdAt = db.serverDate()` 后
  `Object.assign({ _id }, patch)` 直接返回给前端，`data.createdAt` 不是 Date/字符串。
- 建议：返回前剔除或换成时间字符串。

### 6) 取餐号在事务外 count 生成，并发可能重号且取消单占号（低）
- 位置：`cloudfunctions/submitOrder/index.js:362-365`（事务外 count 今日订单数 +1）。
- 现象：并发下单可能拿到相同 pickupNo；已取消订单仍计入 count 导致号码空洞。
- 建议：如需严格唯一，用单号计数器文档在事务内自增，或接受展示性号码并说明。

### 7) submitOrder 允许非整数份数（低）
- 位置：`cloudfunctions/submitOrder/index.js:310`：`qty` 只判断 >0，允许 1.5 份并扣 1.5 库存。
- 建议：`Math.floor`/`Number.isInteger` 校验。

### 8) employeeAdmin 鉴权文案/trim 与其他管理函数不一致（低）
- 位置：`cloudfunctions/employeeAdmin/index.js:56`（adminToken 会 trim）、`:70`（未登录文案为「管理登录已失效，请重新输入管理口令」）。
- 其他管理函数不 trim，未登录文案为「请先登录管理后台」。code 都是 `NEED_ADMIN_LOGIN`，客户端按 code 处理不受影响；
  建议统一文案与入参处理，减少前端多分支。

### 9) 删除分类不做引用检查（低）
- 位置：`cloudfunctions/categoryAdmin/index.js:60-63`（物理删除），`cloudfunctions/dishAdmin/index.js:49`（菜品仅存 categoryId）。
- 现象：删除被菜品引用的分类后，菜品 categoryId 悬空。建议删除前校验或改为停用。

### 10) adminStats 单次最多统计 1000 单（低）
- 位置：`cloudfunctions/adminStats/index.js:39`（`.limit(1000)`），超出静默截断。
- 当前业务量远低于该值；如未来单日订单可能破千，建议改分页聚合。

### 11) 已确认无问题的重点逻辑
- `bindEmployee` 规范化/幂等/换绑/占用掩码/并发回滚均符合 task-3 要求；
- 管理云函数 adminToken 会话校验（缺失/无效/过期/DB 异常）行为一致（除文案差异见 #8）；
- `subscribeCheck` 与其他函数的订阅消息自动映射/fallback 逻辑一致。

## 六、限制与说明

- 未连接真实云环境：真实环境中的 openapi 权限（subscribeMessage）、事务隔离级别、云数据库索引行为不覆盖。
- mock 对真实 SDK 的近似：`doc.get()` 缺失默认抛错、`orderBy` 缺失字段默认排除、`doc.update` 缺失文档返回 updated:0
  （真实行为若不同，仅影响对应边界用例的预期）。
- 未覆盖：定时触发器、云函数超时/重试、真机并发压测。


---

## Lead 修复记录（第二轮）

以下缺陷已由 Lead 修复并补充回归用例（`tests/cloud/fixes.round2.test.js`，8 条）：

1. ✅ 取消订单回补有限库存（`orderAdmin` 新增 `restoreStockForCancel`；`stock` 为 null 不回补）。
2. ✅ 同状态重复提交幂等 no-op（不再追加历史、不再重复发送订阅消息）。
3. ✅ `list` 支持 `status:'cancel'` 别名过滤（统一归一化为 `cancelled`）。
4. ✅ `submitOrder` 数量小数向下取整（上限 99，非法值按 1 件）。
5. ✅ `adminStats` range 兜底 `to` 改为 `now + 1ms`，修复同毫秒边界丢单（CI 首次运行暴露）。

其余观察项（orderDetail 不存在分支、settingsAdmin createdAt、pickupNo 并发、分类删除引用、adminStats 1000 上限等）保留为已知风险，见 `docs/TEST_REPORT.md` 第九节。
