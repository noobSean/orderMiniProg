/**
 * 数据访问层 —— 前端所有数据出入口。
 *
 * 约定：
 *  - 只读菜单/配置走「云数据库客户端直读」（安全规则允许匿名 read，省云函数调用）；
 *  - 写操作 / 身份 / 订单 / 管理端 走云函数。
 *  - 云函数返回约定：成功 { ok: true, data } ；失败 { ok: false, code, message } （或直接抛错）。
 *  - 管理端登录态：adminLogin 云函数签发 token（见 utils/adminAuth.js），本文件自动把它作为
 *    adminToken 附带到所有云函数参数中；管理端云函数凭 adminToken 鉴权，失败返回
 *    code: 'NEED_ADMIN_LOGIN'，此时会清空本地会话，由页面守卫跳转登录页。
 *  - 本文件是前后端契约的唯一来源，云函数实现必须与这里保持一致。
 */
const config = require('../config/index');
const adminAuth = require('./adminAuth');

function call(name, data) {
  const payload = Object.assign({}, data || {});
  const token = adminAuth.token();
  if (token) payload.adminToken = token;
  // 订阅消息模板 ID 只在小程序端配置一次，自动随请求传给云函数（云函数也可用环境变量覆盖）
  if (config.subscribeTemplates) payload.subscribeTemplateIds = config.subscribeTemplates;
  return wx.cloud.callFunction({ name, data: payload }).then(res => {
    const r = res && res.result;
    if (!r) return Promise.reject(new Error('云函数响应为空'));
    if (r.ok === false) {
      const err = new Error(r.message || '操作失败');
      err.code = r.code || '';
      if (r.dishId) err.dishId = r.dishId;
      if (r.code === 'NEED_ADMIN_LOGIN') adminAuth.clear();
      return Promise.reject(err);
    }
    return r.data;
  }).catch(err => {
    if (err && err.code) throw err;
    const msg = (err && err.message) ? err.message : '网络异常，请重试';
    throw new Error(msg);
  });
}

// 业务时区（东八区）当天 YYYYMMDD：售罄只对当天有效，第二天自动恢复
function cstDay(ts) {
  const date = new Date((typeof ts === 'number' ? ts : Date.now()) + 8 * 3600 * 1000);
  return '' + date.getUTCFullYear() + String(date.getUTCMonth() + 1).padStart(2, '0') + String(date.getUTCDate()).padStart(2, '0');
}

function db() {
  if (!wx.cloud) throw new Error('请在真机或开发者工具中开通云开发');
  return wx.cloud.database();
}

/* ---------------- 云数据库客户端直读（需安全规则允许 read） ---------------- */

// 菜单：分类 + 在售菜品。返回 { categories: [...], dishes: [...] }
async function getMenu() {
  const d = db();
  const [catRes, dishRes] = await Promise.all([
    d.collection('menu_categories').orderBy('sort', 'asc').get(),
    d.collection('dishes').where({ available: true }).orderBy('sort', 'asc').get()
  ]);
  const categories = catRes.data.map(c => ({ _id: c._id, name: c.name, sort: c.sort }));
  const dishes = dishRes.data.map(x => ({
    _id: x._id,
    categoryId: x.categoryId,
    name: x.name,
    desc: x.desc,
    image: x.image,
    price: x.price,
    specs: x.specs || [],      // [{name, price}] 可选规格/做法
    extras: x.extras || [],    // [{name, price}] 可加料
    stock: x.stock,            // 数字或 null(不限)
    soldOut: x.soldOut === true && (!x.soldOutDate || String(x.soldOutDate) === cstDay()), // 快捷售罄（仅当天有效）
    unit: x.unit || '份',
    sort: x.sort
  }));
  return { categories, dishes };
}

// 门店配置（单条）
async function getSettings() {
  const d = db();
  const res = await d.collection('settings').limit(1).get();
  const s = (res.data && res.data[0]) || {};
  return {
    storeName: s.storeName || '企业餐厅',
    openTime: s.openTime || '08:30',
    closeTime: s.closeTime || '13:30',
    notice: s.notice || '',
    allowSelfPickup: s.allowSelfPickup !== false,
    allowDelivery: s.allowDelivery !== false,
    locations: s.locations || [],    // 配送目标：楼栋/楼层/工位 选项
    departments: s.departments || [],// 部门选项
    phone: s.phone || ''
  };
}

/* ---------------- 促销 ---------------- */

// 生效中/未开始的促销活动（客户端直读，安全规则允许 read；具体计算以云函数下单结果为准）
async function getPromotions() {
  const d = db();
  const res = await d.collection('promotions').where({ enabled: true }).get();
  return (res.data || []).map(x => ({
    _id: x._id,
    name: x.name,
    scopeType: x.scopeType,
    categoryIds: x.categoryIds || [],
    dishIds: x.dishIds || [],
    rate: Number(x.rate),
    startAt: x.startAt,
    endAt: x.endAt,
    enabled: x.enabled !== false
  }));
}

/* ---------------- 身份 ---------------- */

// 静默登录：返回 openid 与已绑定档案（未绑定则 profile 为 null）
function login() { return call('login', {}); }

// 首次绑定工号。入参 {empNo, name, dept, location, rebind?}
// rebind: true 表示当前微信已绑定过、确认换绑到新工号
function bindEmployee(payload) { return call('bindEmployee', payload); }

/* ---------------- 订单 ---------------- */

// 下单。items: [{dishId,name,price,spec,extras,qty}]
// delivery: {type:'pickup'|'delivery', target:'部门-工位/楼栋' 或 取餐备注, note}
function submitOrder(payload) { return call('submitOrder', payload); }

// 我的订单（列表，倒序）
function myOrders() { return call('myOrders', {}); }

// 订单详情
function orderDetail(orderId) { return call('orderDetail', { orderId }); }


/* ---------------- 科室 ---------------- */

// 可选科室（启用、非根分类），供选择器使用
function getDepartments() { return call('deptAdmin', { action: 'list' }); }

// 管理端科室管理：action 'adminList'|'create'|'update'|'toggle'|'delete'
function deptAdmin(action, payload) { return call('deptAdmin', Object.assign({ action: action }, payload || {})); }

/* ---------------- 管理端 ---------------- */

/**
 * 管理端登录/会话。
 *  - adminLogin({pwd}) 或 adminLogin('pwd')：口令登录，返回 {token, expireAt, profile}
 *  - adminLogin({action:'verify', token})：校验会话
 *  - adminLogin({action:'logout', token})：注销会话
 */
function adminLogin(payload) {
  const data = (typeof payload === 'string')
    ? { action: 'login', pwd: payload }
    : Object.assign({ action: 'login' }, payload || {});
  return call('adminLogin', data);
}

// 校验管理会话是否有效（token 缺省取本地会话）
function adminVerify(token) { return call('adminLogin', { action: 'verify', token: token || adminAuth.token() }); }

// 修改管理密码（需已登录）。成功后云端会使所有管理会话失效，需用新密码重新登录。
// oldPwd/newPwd：6-32 位、不能含空格；服务端 scrypt 加盐哈希存储。
function adminChangePwd(oldPwd, newPwd) {
  return call('adminLogin', { action: 'changePwd', oldPwd: oldPwd, newPwd: newPwd });
}

// 注销管理会话（云端删除 + 本地清除）
function adminLogout() {
  const token = adminAuth.token();
  return call('adminLogin', { action: 'logout', token: token }).catch(() => null);
}

// 员工绑定管理：action 'list'(关键词/分页) | 'release'(解绑，入参 employeeId 或 empNo)
function employeeAdmin(action, payload) { return call('employeeAdmin', Object.assign({ action: action }, payload || {})); }

// 订单管理：list 拉列表(status 可空=当天全部)；update 改状态
function adminOrders(action, payload) { return call('orderAdmin', Object.assign({ action: action }, payload || {})); }

// 菜品/分类/配置管理
function dishAdmin(action, payload) { return call('dishAdmin', Object.assign({ action: action }, payload || {})); }
function categoryAdmin(action, payload) { return call('categoryAdmin', Object.assign({ action: action }, payload || {})); }
function settingsAdmin(action, payload) { return call('settingsAdmin', Object.assign({ action: action }, payload || {})); }

// 统计 adminStats({mode:'today'|'range', from, to})
function adminStats(payload) { return call('adminStats', payload || {}); }

// 促销活动管理：action 'list'|'save'|'toggle'|'remove'
function promoAdmin(action, payload) { return call('promoAdmin', Object.assign({ action: action }, payload || {})); }

// 订阅消息自检：检查模板 ID/关键字/字段映射，可选发送测试通知给当前微信
function subscribeCheck(payload) { return call('subscribeCheck', payload || {}); }

module.exports = {
  config,
  getMenu,
  getSettings,
  login,
  bindEmployee,
  submitOrder,
  myOrders,
  orderDetail,
  adminLogin,
  adminVerify,
  adminChangePwd,
  adminLogout,
  employeeAdmin,
  adminOrders,
  dishAdmin,
  categoryAdmin,
  settingsAdmin,
  adminStats,
  promoAdmin,
  getPromotions,
  subscribeCheck,
  getDepartments,
  deptAdmin
};
