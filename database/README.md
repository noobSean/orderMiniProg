# 云数据库初始化指南

本文说明如何创建各集合、写入初始数据、以及如何把某员工设为管理员。

## 一、创建集合

在微信开发者工具 → 云开发控制台 → 数据库 中，新建以下集合（无需预设字段，云函数写入时自动建结构）：

| 集合名 | 用途 | 主要字段 |
| --- | --- | --- |
| settings | 单条门店配置 | storeName, openTime, closeTime, notice, allowSelfPickup, allowDelivery, locations, departments, phone |
| menu_categories | 菜品分类 | name, sort |
| dishes | 菜品 | categoryId, name, desc, image(云存储 fileID 或外链 URL), price, specs, extras, stock, unit, sort, available, soldOut(快捷售罄), soldOutDate(售罄日期 YYYYMMDD，跨日自动失效), createdAt |
| departments | 科室（医院真实科室） | code, name, pinyin, parentCode, rootCode, rootName, rootSort, level, isRoot, sort, enabled, usage |
| employees | 员工档案 | openid, empNo, name, dept, location, admin(历史字段，仅展示), createdAt, updatedAt |
| admin_sessions | 管理端登录会话 | token, openid, expireAt(毫秒时间戳), createdAt |
| admin_config | 管理端配置（管理密码哈希） | `_id: admin_pwd`, salt, hash, algo(scrypt), updatedAt |
| admin_users | 管理员微信白名单 | `_id: openid`, openid, name, role, enabled, createdAt, lastLoginAt |
| admin_attempts | 管理登录失败计数/锁定 | `_id: openid`, openid, count, lockUntil, updatedAt |
| promotions | 促销活动（折扣，proto） | name, scopeType(all/category/dish), categoryIds, dishIds, discount(折), rate, startAt, endAt(毫秒), enabled, createdAt, updatedAt |
| orders | 订单 | orderNo, pickupNo, openid, type, buyer, items, total, originalTotal, discountAmount, discounts, delivery, status, paymentStatus(unpaid/paid), paidAt, pickedUpAt, cancelReason, statusHistory, createdAt, updatedAt |

> 提示：云函数使用 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`，会自动指向部署所在环境。
> `admin_sessions` / `admin_config` / `admin_users` / `admin_attempts` 由 `adminLogin` 云函数首次登录/首次改密时自动创建（云环境不允许云函数建集合时请手动新建，权限设为「仅云函数可读写」）。
>
> **员工端登录**：员工没有账号密码，身份为微信 openid。小程序启动时调用 `login` 云函数按 openid 查询 `employees` 档案，查到即静默恢复登录（清缓存 / 换设备无需重新绑定），查不到才提示绑定；员工主动「退出登录」后需点「重新登录」恢复。管理员解绑或改资料后，员工端回到前台 / 下拉刷新会同步。

## 二、写入初始 settings（门店配置，单条）

在「settings」集合手动新增一条文档（或通过管理端 settingsAdmin 云函数的 update 写入）：

```json
{
  "storeName": "企业餐厅",
  "openTime": "08:30",
  "closeTime": "13:30",
  "notice": "工作日 8:30-13:30 供应，请提前下单",
  "allowSelfPickup": true,
  "allowDelivery": true,
  "locations": ["1号楼-1层", "1号楼-2层", "2号楼-3层", "A座-工位区", "B座-会议室"],
  "departments": ["技术部", "产品部", "市场部", "行政部"],
  "phone": "021-00000000"
}
```

## 三、初始 menu_categories 样例

在「menu_categories」集合新增：

```json
{ "name": "商务套餐", "sort": 1 }
{ "name": "主食", "sort": 2 }
{ "name": "饮品", "sort": 3 }
{ "name": "加餐", "sort": 4 }
```

## 四、dishes 菜品样例

在「dishes」集合新增（categoryId 填上面分类的 _id）：

```json
{
  "categoryId": "<商务套餐分类的 _id>",
  "name": "红烧牛肉饭",
  "desc": "经典红烧牛肉，配时蔬与米饭",
  "image": "",
  "price": 25,
  "specs": [ { "name": "大份", "price": 5 }, { "name": "微辣", "price": 0 } ],
  "extras": [ { "name": "加蛋", "price": 2 }, { "name": "加米饭", "price": 1 } ],
  "stock": 50,
  "unit": "份",
  "sort": 1,
  "available": true
}
```

> stock 为 null 或省略表示不限库存；前端 getMenu 只读取 available:true 的菜品。

## 五、管理端入口与管理员会话

1. **管理员微信白名单**：小程序「我的」页面只对 `admin_users` 白名单内的微信显示「管理后台」入口；首次无管理员时临时开放 bootstrap，首位登录者自动绑定。
2. 前端调用 `adminLogin({action:'login', pwd})`，云函数先用 `admin_config/admin_pwd` 的 scrypt 哈希校验（没有记录时回退环境变量 `ADMIN_PWD`），通过后写入 `admin_sessions` 并返回 `{token, expireAt}`；token 有效期默认 12 小时。
3. 管理后台「修改密码」调用 `adminLogin({action:'changePwd', oldPwd, newPwd, adminToken})`：校验原密码后写入新的 scrypt 哈希，并删除所有 `admin_sessions`（所有设备需用新密码重新登录）。
4. 之后所有管理端云函数（orderAdmin / dishAdmin / categoryAdmin / settingsAdmin / adminStats / deptAdmin / employeeAdmin / orderDetail 的越权查看）都校验 `event.adminToken`，与员工档案、`employees.admin` 字段**无关**。
5. 管理首页底部「退出管理登录」会调用 `adminLogin({action:'logout'})` 删除会话并清本地缓存；会话过期后页面会自动跳回管理登录页。

> 管理口令初始值由云函数 `adminLogin` 的**环境变量** `ADMIN_PWD` 提供（不写进代码仓库，小程序端也不保存）；首次登录后可在管理后台「修改密码」修改，之后以 `admin_config/admin_pwd` 的哈希为准。两者都未配置时管理后台会提示「管理口令未配置」。
>
> 注意：改密只更新数据库哈希，**不会修改云函数环境变量**（环境变量属于部署配置，运行时不可写）；登录时数据库优先，因此环境变量保持旧值不影响使用，仅作为重置兜底。
> `employees.admin` 字段是旧版本遗留，仅用于「我的」页面展示管理员标签，不再参与鉴权。

## 六、员工绑定管理与解绑

员工端绑定工号时如果提示「该工号已被其他微信绑定」，又确认不是本人 / 是测试遗留记录，可在管理端处理：

1. 管理后台 →「员工绑定」→ 输入工号 / 姓名 / 科室搜索。
2. 找到记录后点「解绑」，二次确认后删除该员工档案（释放工号），员工即可重新绑定。
3. 解绑属于高危操作，云函数 `employeeAdmin` 会校验管理会话 token，并打印操作日志（操作者 openid 掩码、解绑工号、档案 _id）到云函数日志。

> 绑定工号做了工号规范化（全角转半角、去空格 / 零宽字符）与幂等处理：同一微信重复提交相同工号会直接返回成功；确需更换工号时前端会提示「换绑」。
>
> **建议**：在云开发控制台给 `employees` 集合的 `empNo` 字段建**唯一索引**（唯一、非空），可从数据库层彻底避免并发重复绑定；云函数已做「写入后复查回滚」兜底，建索引后重复写入会报错，员工重试即可。

## 七、安全规则说明

见 `database/rules.json`（文字版建议，需在控制台逐集合配置）：
- settings / menu_categories / dishes：允许任意登录用户 read（前端 getMenu / getSettings 直读）。
- employees / orders：仅本人（openid == doc.openid）可读；所有写操作统一走云函数（服务端具备较高权限），客户端写权限请收紧为「仅创建者」或关闭。
- admin_sessions / admin_config / admin_users / admin_attempts：客户端**完全不可读写**（仅云函数可读写），避免管理 token、密码哈希、白名单与失败计数泄露。
- promotions：**所有登录用户可读、仅云函数可写**（员工端菜单/购物车读取进行中的活动；活动增删改只走管理端 `promoAdmin` 云函数）。
- 管理员鉴权在云函数端通过 `admin_sessions` 的 token 完成；不要在前端或数据库规则里用 `employees.admin` 判断管理员。

## 七之一、定时任务（orderTimeout）

云函数 `orderTimeout` 通过 `config.json` 配置两个 timer 触发器：

- `unpaidTimeout`：每 5 分钟扫描「pending + paymentStatus=unpaid + 超过 15 分钟」的订单，自动取消并回补有限库存；`cancelReason=unpaid_timeout`，状态历史记录「超时未付款，自动取消」；超时分钟数可用环境变量 `UNPAID_TIMEOUT_MIN` 覆盖。
- `dailySoldOutReset`：每天 04:00 清除菜品的 `soldOut` 标记（**可选**；售罄标记带 `soldOutDate`，按东八区自然日自动失效，不配触发器第二天也会恢复在售）。

> 部署后在云开发控制台「云函数 → orderTimeout → 定时触发器」确认触发器已创建；触发器时区以云环境为准，必要时调整 cron。

## 八、内置测试数据（database/seed）

项目内置测试数据，覆盖全流程：

- `database/seed/settings.jsonl`：门店配置（名称/营业时间/公告/配送位置/部门/电话）。
- `database/seed/menu_categories.jsonl`：5 个分类（商务套餐/米饭主食/面点小吃/饮品/甜点）。
- `database/seed/dishes.jsonl`：14 个菜品，含规格、加料、不限库存、售罄(stock:0)、下架(available:false)样例。
- `database/seed/departments.jsonl`：医院真实科室 185 条（来源 Dept.json，已清洗；分类根节点 isRoot=true，停用科室 enabled=false）。

**导入方式**：

1. 推荐：部署并调用 `cloudfunctions/seedData`（控制台测试参数 `{"key":"seed2024"}`），会同时写入 185 条科室与 6 笔示例订单。
2. 或：控制台各集合「导入」对应 `.jsonl` 文件（JSON Lines 格式，冲突覆盖）。

> 固定 `_id`（如 `cat_1`、`dish_1`）保证菜品与分类引用一致；重复导入/执行会覆盖而非重复。
> 示例订单的 `openid` 为 `seed_openid_*`，不会出现在任何真实员工的「我的订单」中，仅供管理端与统计展示。

## 九、科室管理与真实数据

- 科室存于独立集合 `departments`，字段：`code`(科室代码)、`name`、`pinyin`(拼音码，用于搜索)、`parentCode`/`rootCode`/`rootName`(所属分类)、`rootSort`(分类排序)、`level`、`isRoot`(是否分类根节点)、`sort`、`enabled`(启用)、`usage`(门诊/住院/医技/病区)。
- 员工端「绑定工号」「配送」通过 `pages/dept-select` 搜索选择，数据来自 `deptAdmin` 云函数 action=`list`（仅返回启用且非根节点的科室）。
- 管理端「科室管理」（`pages/admin/dept-manage`）通过 `deptAdmin` 云函数 `adminList/create/update/toggle/delete` 维护，可搜索、新增、编辑、启用/停用、删除。
- 新增科室时后台自动生成 `code`（现有最大值+1）与 `_id`（`ks_<code>`），并需选择所属分类。
- 停用科室默认不在选择器中出现，管理员可随时启用。
