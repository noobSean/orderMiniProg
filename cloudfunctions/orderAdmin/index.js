const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 订阅消息（可取餐 / 配送已送达） ====================
// 模板 ID 与小程序端 config 的 subscribeTemplates 一致，可用云函数环境变量覆盖。
/**
 * 订阅消息公共逻辑（内联版：自动读取模板关键字，按中文标签自动映射字段）
 *
 * 背景：不同账号选用的订阅消息模板，关键字名/顺序都不同（thing1、character_string2…），
 * 手写映射容易配错。这里通过云调用 subscribeMessage.getTemplateList 读取本账号已添加的
 * 模板内容（形如 "取餐号:{{character_string1.DATA}}"），自动解析关键字并按中文标签匹配：
 *   取餐号/订单号/金额/时间/地址/门店/提示/姓名
 * 只有当自动匹配失败（拿不到模板、标签识别不了）时，才用调用方传入的 fallbackMap 兜底。
 *
 * 说明：本段逻辑已内联在云函数 index.js 中（不依赖额外文件，避免上传遗漏导致函数启动失败）。
 */
const CACHE_TTL = 10 * 60 * 1000;
const DEFAULT_STORE_NAME = '企业餐厅';

function createSubscribe(ctx) {
  const cloud = ctx.cloud;
  const db = ctx.db;
  const cache = {};   // templateId -> { ts, info }

  // 按模板关键字类型截断（thing≤20、phrase≤5、name≤10、time/date≤24、其余≤32）
  function clipByKey(key, v) {
    const s = (v === undefined || v === null) ? '' : String(v);
    let max = 32;
    if (/^thing/.test(key)) max = 20;
    else if (/^phrase/.test(key)) max = 5;
    else if (/^name/.test(key)) max = 10;
    else if (/^(time|date)/.test(key)) max = 24;
    return s.length > max ? s.slice(0, max) : s;
  }

  // 北京时间（云函数运行时通常是 UTC，固定 +8）
  function formatCst(date) {
    const d = new Date((date ? date.getTime() : Date.now()) + 8 * 3600 * 1000);
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  // 解析模板 content："取餐号:{{character_string1.DATA}}\n时间:{{time2.DATA}}"
  function parseContent(content) {
    const out = [];
    String(content || '').split(/\r?\n/).forEach(function (line) {
      const m = /\{\{([a-zA-Z_]+\d*)\.DATA\}\}/.exec(line);
      if (!m) return;
      const key = m[1];
      const label = line.replace(/\{\{[^}]+\}\}/g, '').replace(/[:：\s]/g, '');
      out.push({ key: key, type: key.replace(/\d+$/, ''), label: label });
    });
    return out;
  }

  // 返回 { info, fetched, error }：fetched=true 表示已成功拿到账号模板列表（此时找不到=模板 ID 配错，不再兜底硬发）
  async function getTemplateInfo(templateId) {
    const now = Date.now();
    const hit = cache[templateId];
    if (hit && (now - hit.ts) < CACHE_TTL) return hit;
    try {
      const res = await cloud.openapi.subscribeMessage.getTemplateList({});
      const list = (res && res.data) || [];
      const t = list.find(function (x) { return x && x.priTmplId === templateId; });
      const info = t ? { title: t.title, content: t.content, keywords: parseContent(t.content), type: t.type } : null;
      const record = { ts: now, info: info, fetched: true, error: null };
      cache[templateId] = record;
      if (info) {
        console.log('[subscribe] template loaded', JSON.stringify({ templateId: templateId, title: info.title, keywords: info.keywords.map(function (k) { return k.key + '(' + k.label + ')'; }) }));
      } else {
        console.log('[subscribe] template not found in account', JSON.stringify({ templateId: templateId, accountTemplates: list.map(function (x) { return { id: x.priTmplId, title: x.title }; }) }));
      }
      return record;
    } catch (e) {
      console.log('[subscribe] getTemplateList failed', JSON.stringify({ templateId: templateId, errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' }));
      const record = { ts: now, info: null, fetched: false, error: { errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' } };
      cache[templateId] = record;
      return record;
    }
  }

  // 按中文标签 → 语义角色
  function pickRole(kw, values) {
    const label = kw.label || '';
    const has = function (r) { return values && values[r] !== undefined && values[r] !== null && values[r] !== ''; };
    const rules = [
      [/取餐(号|码)/, 'pickupNo'],          // 取餐号码 / 取餐号
      [/配送时间/, 'deliveryTime'],          // 配送时间（开始配送/出餐时间）
      [/订单(号|编号)/, 'orderNo'],
      // 餐品相关（餐品详情/订单内容/餐品数量/商品名/商品名称…）
      [/数量|份数/, 'dishQty'],
      [/详情|明细|内容/, 'dishDetail'],       // 餐品详情 / 订单内容
      [/名称|商品名|餐品名|菜品名/, 'dishNames'], // 商品名称 / 商品名
      [/金额|费用|价格|合计|总价/, 'amount'],
      [/时间|日期/, 'time'],                 // 送达时间 / 下单时间 / 取餐时间
      [/备注/, 'remark'],                    // 订单备注
      [/地址|位置|地点|配送至/, 'address'],
      [/门店|店铺|商家|餐厅|企业|取餐点/, 'store'],
      [/提示|说明/, 'tip'],                  // 温馨提示 / 提示说明
      [/餐品|菜品|商品/, 'dishNames'],
      [/姓名|员工|取餐人/, 'name']
    ];
    for (let i = 0; i < rules.length; i++) {
      if (rules[i][0].test(label) && has(rules[i][1])) return rules[i][1];
    }
    const byType = {
      time: 'time', date: 'time', amount: 'amount', character_string: 'orderNo',
      thing: 'tip', phrase: 'tip', name: 'name', number: 'amount'
    };
    const role = byType[kw.type];
    if (has(role)) return role;
    const order = ['orderNo', 'pickupNo', 'amount', 'time', 'store', 'address', 'tip', 'name'];
    for (let i = 0; i < order.length; i++) if (has(order[i])) return order[i];
    return null;
  }

  function buildData(keywords, values) {
    const data = {};
    (keywords || []).forEach(function (kw) {
      const role = pickRole(kw, values);
      if (!role) return;
      let v = values[role];
      // thing 类型最多 20 字：餐品详情太长时自动改用精简版（商品名×数量），避免被截断成半截
      if (role === 'dishDetail' && /^thing/.test(kw.key) && String(v === undefined ? '' : v).length > 20 && values.dishBrief) {
        v = values.dishBrief;
      }
      data[kw.key] = { value: clipByKey(kw.key, v) };
    });
    return data;
  }

  // fallbackMap: { 语义角色: 模板关键字 }，自动解析失败时使用
  function buildFallbackData(fallbackMap, values) {
    const data = {};
    Object.keys(fallbackMap || {}).forEach(function (role) {
      const key = fallbackMap[role];
      if (!key || values[role] === undefined || values[role] === null || values[role] === '') return;
      data[key] = { value: clipByKey(key, values[role]) };
    });
    return data;
  }


  // 订单餐品汇总：商品名 / 总份数 / 明细（供模板里的「商品名/餐品数量/餐品详情」等字段使用）
  function summarizeItems(items) {
    const list = Array.isArray(items) ? items : [];
    const names = [];
    let qty = 0;
    const parts = [];
    const briefs = [];
    list.forEach(function (it) {
      const name = (it && it.name) ? String(it.name) : '';
      if (!name) return;
      if (names.indexOf(name) < 0) names.push(name);
      const q = Number(it && it.qty) || 1;
      qty += q;
      const spec = (it && it.spec) ? '(' + it.spec + ')' : '';
      const extras = (it && Array.isArray(it.extras) && it.extras.length) ? '+' + it.extras.join('/') : '';
      parts.push(name + spec + extras + '×' + q);
      briefs.push(name + '×' + q);
    });
    return { dishNames: names.join('、'), dishQty: String(qty), dishDetail: parts.join('；'), dishBrief: briefs.join('、') };
  }

  async function send(opts) {
    const o = opts || {};
    if (!o.templateId) {
      console.log('[subscribe] skip: templateId 未配置', o.kind || '');
      return { ok: false, reason: 'not_configured' };
    }
    if (!o.openid) {
      console.log('[subscribe] skip: openid 缺失', o.kind || '');
      return { ok: false, reason: 'no_openid' };
    }
    const tpl = await getTemplateInfo(o.templateId);
    const info = tpl.info;
    if (!info && tpl.fetched) {
      // 账号模板列表能拉到，但没有这个 ID：说明模板 ID 配错了（或模板没加到账号下）
      console.log('[subscribe] skip: template not found in account', JSON.stringify({ kind: o.kind || '', templateId: o.templateId }));
      return { ok: false, reason: 'template_not_found' };
    }
    let data = null;
    if (info && info.keywords && info.keywords.length) data = buildData(info.keywords, o.values || {});
    if ((!data || !Object.keys(data).length) && o.fallbackMap) {
      data = buildFallbackData(o.fallbackMap, o.values || {});
      console.log('[subscribe] use fallback map', o.kind || '');
    }
    if (!data || !Object.keys(data).length) {
      console.log('[subscribe] skip: 无法确定模板字段', JSON.stringify({ kind: o.kind || '', templateId: o.templateId }));
      return { ok: false, reason: 'no_fields' };
    }
    try {
      const res = await cloud.openapi.subscribeMessage.send({
        touser: o.openid,
        templateId: o.templateId,
        page: o.page || '',
        lang: 'zh_CN',
        miniprogramState: o.miniprogramState || 'formal',
        data: data
      });
      console.log('[subscribe] sent', JSON.stringify({ kind: o.kind || '', templateId: o.templateId, page: o.page || '', result: res }));
      return { ok: true, result: res };
    } catch (e) {
      const errCode = (e && e.errCode !== undefined) ? e.errCode : '';
      const errMsg = (e && (e.errMsg || e.message)) || '';
      console.log('[subscribe] send failed', JSON.stringify({ kind: o.kind || '', templateId: o.templateId, errCode: errCode, errMsg: errMsg }));
      return { ok: false, error: { errCode: errCode, errMsg: errMsg } };
    }
  }

  async function getStoreName() {
    try {
      const r = await db.collection('settings').limit(1).get();
      return (r.data && r.data[0] && r.data[0].storeName) || DEFAULT_STORE_NAME;
    } catch (e) {
      return DEFAULT_STORE_NAME;
    }
  }

  return {
    send: send,
    summarizeItems: summarizeItems,
    getStoreName: getStoreName,
    formatCst: formatCst,
    parseContent: parseContent,
    clipByKey: clipByKey
  };
}

const subscribe = createSubscribe({ cloud: cloud, db: db })
const PICKUP_READY_TEMPLATE_ID = process.env.PICKUP_READY_TEMPLATE_ID || ''
const DELIVERY_DONE_TEMPLATE_ID = process.env.DELIVERY_DONE_TEMPLATE_ID || ''
const SUBSCRIBE_MINIPROGRAM_STATE = process.env.SUBSCRIBE_MINIPROGRAM_STATE || 'formal'
// 自动解析模板失败时的兜底映射（语义角色 → 模板关键字），一般无需修改
const PICKUP_READY_FALLBACK_MAP = {
  pickupNo: 'character_string1',
  store: 'thing2',
  time: 'time3',
  tip: 'thing4'
}
const DELIVERY_DONE_FALLBACK_MAP = {
  store: 'thing1',
  orderNo: 'character_string2',
  address: 'thing3',
  time: 'time4',
  tip: 'thing5'
}

// 自取「可取餐提醒」
async function sendPickupReadyNotice(order, clientIds) {
  const storeName = await subscribe.getStoreName()
  const items = subscribe.summarizeItems(order.items)
  const ids = clientIds || {}
  return subscribe.send({
    kind: 'pickupReady',
    templateId: ids.pickupReady || PICKUP_READY_TEMPLATE_ID,
    openid: order.openid,
    page: 'pages/order-detail/order-detail?id=' + order._id,
    miniprogramState: SUBSCRIBE_MINIPROGRAM_STATE,
    values: {
      pickupNo: (order.pickupNo !== undefined && order.pickupNo !== null) ? order.pickupNo : '--',
      store: storeName,
      time: subscribe.formatCst(new Date()),
      tip: '餐品已备好，请到取餐点领取',
      dishNames: items.dishNames,
      dishQty: items.dishQty,
      dishDetail: items.dishDetail,
      dishBrief: items.dishBrief,
      remark: (order.delivery && order.delivery.note) || '无',
      name: (order.buyer && order.buyer.name) || ''
    },
    fallbackMap: PICKUP_READY_FALLBACK_MAP
  })
}

// 配送「已送达提醒」
async function sendDeliveryDoneNotice(order, clientIds) {
  const storeName = await subscribe.getStoreName()
  const items = subscribe.summarizeItems(order.items)
  // 配送时间：取状态历史里「ready（开始配送/制作完成）」的时间
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : []
  let readyAt = null
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && (history[i].status === 'ready' || history[i].status === 'making')) {
      readyAt = history[i].time
      if (history[i].status === 'ready') break
    }
  }
  let deliveryTime = subscribe.formatCst(new Date())
  if (readyAt) {
    const t = new Date(readyAt)
    if (!isNaN(t.getTime())) deliveryTime = subscribe.formatCst(t)
  }
  const ids = clientIds || {}
  return subscribe.send({
    kind: 'deliveryDone',
    templateId: ids.deliveryDone || DELIVERY_DONE_TEMPLATE_ID,
    openid: order.openid,
    page: 'pages/order-detail/order-detail?id=' + order._id,
    miniprogramState: SUBSCRIBE_MINIPROGRAM_STATE,
    values: {
      store: storeName,
      orderNo: order.orderNo || '--',
      address: (order.delivery && order.delivery.target) || '配送地址',
      time: subscribe.formatCst(new Date()),
      tip: '餐品已送达，请查收',
      dishNames: items.dishNames,
      dishQty: items.dishQty,
      dishDetail: items.dishDetail,
      dishBrief: items.dishBrief,
      deliveryTime: deliveryTime,
      remark: (order.delivery && order.delivery.note) || '无',
      name: (order.buyer && order.buyer.name) || ''
    },
    fallbackMap: DELIVERY_DONE_FALLBACK_MAP
  })
}

// 惰性兜底：管理端打开/刷新订单列表时，顺便取消超时未付款订单（定时触发器未配置时也能工作）
async function cancelExpiredUnpaidOrders() {
  const timeoutMin = Math.max(1, Number(process.env.UNPAID_TIMEOUT_MIN) || 15)
  const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000)
  const res = await db.collection('orders')
    .where({ status: 'pending', paymentStatus: 'unpaid', createdAt: _.lt(cutoff) })
    .limit(20)
    .get()
  const list = res.data || []
  let cancelled = 0
  for (const order of list) {
    try {
      const cur = await db.collection('orders').doc(order._id).get()
      const o = cur && cur.data
      if (!o || o.status !== 'pending' || o.paymentStatus !== 'unpaid') continue
      const history = Array.isArray(o.statusHistory) ? o.statusHistory : []
      history.push({ status: 'cancelled', time: db.serverDate(), note: '超时未付款，自动取消' })
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'cancelled',
          statusHistory: history,
          cancelReason: 'unpaid_timeout',
          updatedAt: db.serverDate()
        }
      })
      await restoreStockForCancel(o)
      cancelled += 1
    } catch (e) {
      console.log('[orderAdmin] auto cancel failed', (e && e.message) || '')
    }
  }
  if (cancelled > 0) console.log('[orderAdmin] auto-cancelled unpaid orders', JSON.stringify({ cancelled: cancelled, timeoutMin: timeoutMin }))
  return cancelled
}

// 管理端鉴权：校验 adminLogin 签发的会话 token（admin_sessions 集合，12 小时有效）
async function checkAdmin(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  if (!token) return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
  try {
    const res = await db.collection('admin_sessions')
      .where({ token: token, expireAt: db.command.gt(Date.now()) })
      .limit(1).get()
    if (res.data && res.data.length) return null
  } catch (e) { console.error('checkAdmin error', e && e.message) }
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已过期，请重新登录' }
}

const VALID_STATUS = ['pending', 'making', 'ready', 'done', 'cancelled']
// 状态机合法流转
const TRANSITIONS = {
  pending: ['making', 'cancelled'],
  making: ['ready', 'cancelled'],
  ready: ['done', 'cancelled'],
  done: [],
  cancelled: []
}

function canTransit(from, to) {
  if (from === to) return true
  const next = TRANSITIONS[from] || []
  return next.indexOf(to) !== -1
}

// 取消订单时回补库存：只回补有限库存（stock 为数字）的菜品；失败只记日志、不影响状态变更
async function restoreStockForCancel(order) {
  const items = Array.isArray(order && order.items) ? order.items : []
  for (const it of items) {
    if (!it || !it.dishId) continue
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1))
    try {
      const dres = await db.collection('dishes').doc(it.dishId).get()
      const dish = dres && dres.data
      if (!dish) continue
      if (typeof dish.stock !== 'number') continue // null/undefined 表示不限库存，无需回补
      await db.collection('dishes').doc(it.dishId).update({ data: { stock: dish.stock + qty } })
      console.log('[orderAdmin] stock restored', JSON.stringify({ orderId: order._id, dishId: it.dishId, qty: qty }))
    } catch (e) {
      console.log('[orderAdmin] restore stock failed', JSON.stringify({ orderId: order._id, dishId: it.dishId, err: (e && e.message) || '' }))
    }
  }
}

const STATUS_NOTE = {
  making: '开始制作',
  ready: '可取出/配送中',
  done: '已完成',
  cancelled: '已取消'
}

exports.main = async (event, context) => {
  // 自测：云函数测试时传 {"action":"ping"}（无需登录），能返回即说明函数部署/启动正常
  if (event && event.action === 'ping') {
    return { ok: true, data: { pong: true, fn: 'orderAdmin', version: 'notify-inline-v1', now: new Date().toISOString() } }
  }
  const deny = await checkAdmin(event)
  if (deny) return deny
  const action = event && event.action
  try {
    if (action === 'list') {
      let status = event.status
      if (status === 'cancel') status = 'cancelled' // 兼容前端别名
      // days：默认 7 天；传 0 表示不限日期（最多返回 100 条）。管理端现在默认传 30 天，避免测试/历史订单“突然不见”
      const days = (event && event.days !== undefined) ? Number(event.days) : 7
      let q = {}
      if (isFinite(days) && days > 0) {
        const since = new Date()
        since.setDate(since.getDate() - days)
        q.createdAt = _.gte(since)
      }
      if (status && VALID_STATUS.indexOf(status) !== -1) q.status = status
      const res = await db.collection('orders').where(q).orderBy('createdAt', 'desc').limit(100).get()
      // 惰性兜底：列表查询成功后再清理超时未付款订单（失败不影响本次列表返回）
      let autoCancelled = 0
      try { autoCancelled = await cancelExpiredUnpaidOrders() } catch (e) {}
      const list = res.data || []
      console.log('[orderAdmin] list', JSON.stringify({ status: status || '', count: list.length, autoCancelled: autoCancelled }))
      return { ok: true, data: list, autoCancelled: autoCancelled }
    }
    if (action === 'status') {
      const orderId = event.orderId
      let status = event.status
      // 兼容前端别名 'cancel' -> 'cancelled'
      if (status === 'cancel') status = 'cancelled'
      if (!orderId) return { ok: false, message: '缺少 orderId' }
      if (VALID_STATUS.indexOf(status) === -1) return { ok: false, message: '目标状态不合法' }
      const res = await db.collection('orders').doc(orderId).get()
      const order = res.data
      if (!order) return { ok: false, message: '订单不存在' }
      if (order.status === 'done' || order.status === 'cancelled') {
        return { ok: false, message: '订单已终态，不可再变更' }
      }
      if (order.status === status) {
        // 重复提交同一状态：幂等返回，不再追加历史、不再重复发订阅消息
        return { ok: true, data: status, noop: true }
      }
      // 正常流程：取餐时先收款再完成；未收款禁止直接完成（请用「收款并交付」）
      if (status === 'done' && order.paymentStatus === 'unpaid') {
        return { ok: false, code: 'PAYMENT_REQUIRED', message: '请先收款再完成订单，请使用「收款并交付」' }
      }
      if (!canTransit(order.status, status)) {
        return { ok: false, message: '状态流转不合法：' + order.status + ' -> ' + status }
      }
      const history = Array.isArray(order.statusHistory) ? order.statusHistory : []
      history.push({
        status: status,
        time: db.serverDate(),
        note: STATUS_NOTE[status] || ''
      })
      const patch = { status: status, statusHistory: history, updatedAt: db.serverDate() }
      // 自取订单完成 = 已取餐核销，记录核销时间便于对账
      if (status === 'done' && order.type === 'pickup') patch.pickedUpAt = db.serverDate()
      await db.collection('orders').doc(orderId).update({ data: patch })
      // 取消订单：回补有限库存（原扣库存逻辑见 submitOrder）
      if (status === 'cancelled') {
        await restoreStockForCancel(order)
      }
      // 订阅消息：自取 →「可取餐提醒」；配送 →「已送达提醒」（用户下单时授权过才成功，失败不影响状态）
      const clientIds = event.subscribeTemplateIds || {}
      if (status === 'ready' && order.type === 'pickup') {
        sendPickupReadyNotice(order, clientIds).catch(function () {})
      } else if (status === 'done' && order.type === 'delivery') {
        sendDeliveryDoneNotice(order, clientIds).catch(function () {})
      }
      return { ok: true, data: status }
    }
    // 收款并交付：员工到店核对餐品后，一次操作完成「收款 + 完成 + 取餐核销」
    if (action === 'checkout') {
      const orderId = event.orderId
      if (!orderId) return { ok: false, message: '缺少 orderId' }
      const res = await db.collection('orders').doc(orderId).get()
      const order = res.data
      if (!order) return { ok: false, message: '订单不存在' }
      if (order.status === 'cancelled') return { ok: false, message: '订单已取消，不能交付' }
      if (order.status !== 'ready') return { ok: false, code: 'BAD_STATUS', message: '当前状态不可交付（需待取餐）' }
      const history = Array.isArray(order.statusHistory) ? order.statusHistory : []
      history.push({
        status: 'done',
        time: db.serverDate(),
        note: order.type === 'pickup' ? '已收款并交付' : '已收款并完成配送'
      })
      const patch = {
        status: 'done',
        paymentStatus: 'paid',
        paidAt: order.paidAt || db.serverDate(),
        statusHistory: history,
        updatedAt: db.serverDate()
      }
      if (order.type === 'pickup') patch.pickedUpAt = db.serverDate()
      await db.collection('orders').doc(orderId).update({ data: patch })
      // 配送单完成时发送「已送达提醒」（失败不影响交付）
      if (order.type === 'delivery') {
        sendDeliveryDoneNotice(order, event.subscribeTemplateIds || {}).catch(function () {})
      }
      return { ok: true, data: { status: 'done', paymentStatus: 'paid' } }
    }

    // 线下收款标记：员工在 POS 刷卡后，店员在后台标记已收款（不改变制作状态）
    if (action === 'pay') {
      const orderId = event.orderId
      if (!orderId) return { ok: false, message: '缺少 orderId' }
      const res = await db.collection('orders').doc(orderId).get()
      const order = res.data
      if (!order) return { ok: false, message: '订单不存在' }
      if (order.status === 'cancelled') return { ok: false, message: '订单已取消，不能收款' }
      if (order.paymentStatus === 'paid') {
        return { ok: true, data: { paymentStatus: 'paid', noop: true } }
      }
      await db.collection('orders').doc(orderId).update({
        data: { paymentStatus: 'paid', paidAt: db.serverDate(), updatedAt: db.serverDate() }
      })
      return { ok: true, data: { paymentStatus: 'paid' } }
    }
    if (action === 'detail') {
      const orderId = event.orderId
      if (!orderId) return { ok: false, message: '缺少 orderId' }
      const res = await db.collection('orders').doc(orderId).get()
      return { ok: true, data: res.data || null }
    }
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
