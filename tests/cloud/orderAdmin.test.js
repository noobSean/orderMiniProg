'use strict'

/**
 * cloudfunctions/orderAdmin —— 管理端订单（list/status/detail + 订阅消息）
 * 状态机 TRANSITIONS：pending→[making,cancelled]，making→[ready,cancelled]，ready→[done]，
 * done/cancelled 为终态；from===to 视为幂等 no-op（不追加历史、不重复发通知）。
 * 运行：node --test tests/cloud/orderAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_order_admin'
const PICKUP_TPL = 'TPL_PICKUP_READY_1234567890'
const DELIVERY_TPL = 'TPL_DELIVERY_DONE_1234567890'

const TEMPLATES = [
  {
    priTmplId: PICKUP_TPL,
    title: '可取餐提醒',
    content: '取餐号:{{character_string1.DATA}}\n门店:{{thing2.DATA}}\n时间:{{time3.DATA}}\n提示:{{thing4.DATA}}',
    type: 2
  },
  {
    priTmplId: DELIVERY_TPL,
    title: '已送达提醒',
    content: '门店:{{thing1.DATA}}\n订单号:{{character_string2.DATA}}\n地址:{{thing3.DATA}}\n配送时间:{{time4.DATA}}\n提示:{{thing5.DATA}}',
    type: 2
  }
]

function order(id, status, type, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    pickupNo: 8,
    openid: 'openid_order_owner',
    type: type,
    items: [{ dishId: 'dish_1', name: '黑椒牛柳饭', price: 28, qty: 1, spec: '', extras: [] }],
    total: 28,
    delivery: { target: '1号楼-3层', note: '不要辣' },
    status: status,
    statusHistory: [{ status: 'pending', time: new Date('2026-10-30T10:00:00+08:00'), note: '已下单' }],
    createdAt: new Date(),
    updatedAt: new Date()
  }, extra || {})
}

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  if (!seed.admin_sessions) {
    seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  }
  if (!seed.settings) seed.settings = [{ _id: 'settings_main', storeName: '企业餐厅' }]
  return createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: seed,
    templates: options.templates === undefined ? TEMPLATES : options.templates,
    templateListError: options.templateListError,
    sendError: options.sendError,
    env: options.env || {}
  })
}

function callAs(s, event) {
  return s.call(Object.assign({ adminToken: TOKEN }, event || {}))
}

// ---------------- 自检 / 鉴权 ----------------
test('orderAdmin: action=ping 无需登录直接返回 pong', async () => {
  const s = scenario()
  const res = await s.call({ action: 'ping' })
  assert.equal(res.ok, true)
  assert.equal(res.data.pong, true)
  assert.equal(res.data.fn, 'orderAdmin')
})

test('orderAdmin: 无 token / 无效 token / 过期 token / 鉴权库异常均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'list' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = scenario()
  res = await s.call({ action: 'list', adminToken: 'tok_nope' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期|重新登录/)

  s = createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')

  s = scenario()
  s.mock.failNext('admin_sessions', 'get', new Error('auth db down'))
  res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

// ---------------- list ----------------
test('orderAdmin/list: 返回近 7 天订单，createdAt 倒序，过期订单不返回', async () => {
  const now = new Date()
  const s = scenario({
    seed: {
      orders: [
        order('o1', 'pending', 'pickup', { createdAt: new Date(now.getTime() - 2 * 3600 * 1000) }),
        order('o2', 'done', 'delivery', { createdAt: new Date(now.getTime() - 3600 * 1000) }),
        order('o_old', 'done', 'pickup', { createdAt: new Date(now.getTime() - 8 * 24 * 3600 * 1000) })
      ]
    }
  })
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['o2', 'o1'])
})

test('orderAdmin/list: status 过滤生效；非法 status 被忽略（返回全部）', async () => {
  const now = new Date()
  const s = scenario({
    seed: {
      orders: [
        order('o1', 'pending', 'pickup', { createdAt: now }),
        order('o2', 'done', 'delivery', { createdAt: now })
      ]
    }
  })
  let res = await callAs(s, { action: 'list', status: 'pending' })
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['o1'])

  res = await callAs(s, { action: 'list', status: 'bogus-status' })
  assert.equal(res.data.length, 2)
})

test('orderAdmin/list: 数据库异常返回 ok:false', async () => {
  const s = scenario()
  s.mock.failNext('orders', 'get', new Error('orders db down'))
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.ok, false)
  assert.match(res.message, /orders db down/)
})

// ---------------- status：参数 / 终态 / 状态机 ----------------
test('orderAdmin/status: 缺少 orderId / 目标状态非法返回 ok:false', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  let res = await callAs(s, { action: 'status', status: 'making' })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 orderId/)

  res = await callAs(s, { action: 'status', orderId: 'o1', status: 'flying' })
  assert.equal(res.ok, false)
  assert.match(res.message, /目标状态不合法/)
})

test('orderAdmin/status: 订单不存在（返回 null 语义）提示订单不存在', async () => {
  const s = createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    options: { missingDoc: 'null' },
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 60000 })],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }]
    }
  })
  const res = await callAs(s, { action: 'status', orderId: 'o_missing', status: 'making' })
  assert.equal(res.ok, false)
  assert.match(res.message, /订单不存在/)
})

test('orderAdmin/status: 终态订单不可再变更', async () => {
  const s = scenario({
    seed: {
      orders: [order('done', 'done', 'pickup'), order('cancelled', 'cancelled', 'pickup')]
    }
  })
  let res = await callAs(s, { action: 'status', orderId: 'done', status: 'cancelled' })
  assert.equal(res.ok, false)
  assert.match(res.message, /订单已终态，不可再变更/)
  res = await callAs(s, { action: 'status', orderId: 'cancelled', status: 'making' })
  assert.equal(res.ok, false)
  assert.match(res.message, /订单已终态/)
})

test('orderAdmin/status: 非法状态流转被拒绝且不写库', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'ready' })
  assert.equal(res.ok, false)
  assert.match(res.message, /状态流转不合法：pending -> ready/)
  assert.equal(s.doc('orders', 'o1').status, 'pending')
  assert.equal(s.doc('orders', 'o1').statusHistory.length, 1)
})

test('orderAdmin/status: pending→making 合法，写入状态与历史（附备注）', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'making' })
  assert.deepEqual(res, { ok: true, data: 'making' })
  const saved = s.doc('orders', 'o1')
  assert.equal(saved.status, 'making')
  assert.equal(saved.statusHistory.length, 2)
  assert.equal(saved.statusHistory[1].status, 'making')
  assert.equal(saved.statusHistory[1].note, '开始制作')
  assert.ok(saved.statusHistory[1].time instanceof Date)
  assert.ok(saved.updatedAt instanceof Date)
})

test('orderAdmin/status: 兼容 cancel 别名 -> 落库为 cancelled', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'cancel' })
  assert.deepEqual(res, { ok: true, data: 'cancelled' })
  assert.equal(s.doc('orders', 'o1').status, 'cancelled')
  assert.equal(s.doc('orders', 'o1').statusHistory[1].note, '已取消')
})

test('orderAdmin/status: 同状态重复提交幂等 no-op（不追加历史、不重复发通知）', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'pending' })
  assert.deepEqual(res, { ok: true, data: 'pending', noop: true })
  const saved = s.doc('orders', 'o1')
  assert.equal(saved.status, 'pending')
  assert.equal(saved.statusHistory.length, 1, '同状态重复提交不应追加历史')
  assert.equal(s.mock.openapi.calls.send.length, 0)
})

test('orderAdmin/status: 更新订单数据库异常返回 ok:false', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'pending', 'pickup')] } })
  s.mock.failNext('orders', 'docUpdate', new Error('update fail'))
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'making' })
  assert.equal(res.ok, false)
  assert.match(res.message, /update fail/)
})

// ---------------- status：订阅消息 ----------------
test('orderAdmin/status: 自取 ready 时发送「可取餐提醒」一次（标签自动映射）', async () => {
  const s = scenario({
    seed: { orders: [order('o1', 'making', 'pickup', { statusHistory: [
      { status: 'pending', time: new Date(), note: '已下单' },
      { status: 'making', time: new Date(), note: '制作中' }
    ] })] }
  })
  const res = await callAs(s, {
    action: 'status',
    orderId: 'o1',
    status: 'ready',
    subscribeTemplateIds: { pickupReady: PICKUP_TPL }
  })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const sent = s.mock.openapi.calls.send[0]
  assert.equal(sent.touser, 'openid_order_owner')
  assert.equal(sent.templateId, PICKUP_TPL)
  assert.equal(sent.page, 'pages/order-detail/order-detail?id=o1')
  assert.equal(sent.data.character_string1.value, '8')
  assert.equal(sent.data.thing2.value, '企业餐厅')
  assert.match(sent.data.time3.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.match(sent.data.thing4.value, /餐品已备好/)
})

test('orderAdmin/status: 配送 done 时发送「已送达提醒」，时间取 ready 历史', async () => {
  const readyTime = new Date('2026-10-30T10:30:00+08:00')
  const s = scenario({
    seed: { orders: [order('o2', 'ready', 'delivery', { statusHistory: [
      { status: 'pending', time: new Date('2026-10-30T10:00:00+08:00'), note: '' },
      { status: 'making', time: new Date('2026-10-30T10:10:00+08:00'), note: '' },
      { status: 'ready', time: readyTime, note: '' }
    ] })] }
  })
  const res = await callAs(s, {
    action: 'status',
    orderId: 'o2',
    status: 'done',
    subscribeTemplateIds: { deliveryDone: DELIVERY_TPL }
  })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const sent = s.mock.openapi.calls.send[0]
  assert.equal(sent.templateId, DELIVERY_TPL)
  assert.equal(sent.data.thing1.value, '企业餐厅')
  assert.equal(sent.data.character_string2.value, 'Oo2')
  assert.equal(sent.data.thing3.value, '1号楼-3层')
  // 配送时间取自状态历史里 ready 的时间；formatCst 固定 +8，与运行机器时区无关
  assert.equal(sent.data.time4.value, '2026-10-30 10:30')
  assert.match(sent.data.thing5.value, /已送达/)
})

test('orderAdmin/status: 配送 ready / 自取 done 不发送「可取餐/已送达」通知', async () => {
  let s = scenario({ seed: { orders: [order('o2', 'making', 'delivery')] } })
  await callAs(s, { action: 'status', orderId: 'o2', status: 'ready', subscribeTemplateIds: { pickupReady: PICKUP_TPL } })
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 0, '配送单 ready 不是可取餐场景')

  s = scenario({ seed: { orders: [order('o1', 'ready', 'pickup')] } })
  await callAs(s, { action: 'status', orderId: 'o1', status: 'done', subscribeTemplateIds: { deliveryDone: DELIVERY_TPL } })
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 0, '自取单 done 不是送达场景')
})

test('orderAdmin/status: 未配置模板时不发送订阅消息，状态照常更新', async () => {
  const s = scenario({ seed: { orders: [order('o1', 'making', 'pickup')] } })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'ready' })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.mock.openapi.calls.getTemplateList.length, 0)
  assert.equal(s.mock.openapi.calls.send.length, 0)
})

test('orderAdmin/status: 模板列表拉取失败时用 fallbackMap 发送可取餐提醒', async () => {
  const s = scenario({
    templateListError: new Error('openapi down'),
    seed: { orders: [order('o1', 'making', 'pickup')] }
  })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'ready', subscribeTemplateIds: { pickupReady: PICKUP_TPL } })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const data = s.mock.openapi.calls.send[0].data
  assert.deepEqual(Object.keys(data).sort(), ['character_string1', 'thing2', 'thing4', 'time3'].sort())
  assert.equal(data.character_string1.value, '8')
})

test('orderAdmin/status: 订阅消息发送失败不影响状态变更（fire-and-forget）', async () => {
  const s = scenario({
    sendError: Object.assign(new Error('send failed'), { errCode: 43101 }),
    seed: { orders: [order('o1', 'making', 'pickup')] }
  })
  const res = await callAs(s, { action: 'status', orderId: 'o1', status: 'ready', subscribeTemplateIds: { pickupReady: PICKUP_TPL } })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.doc('orders', 'o1').status, 'ready')
  assert.equal(s.mock.openapi.calls.send.length, 1)
})

// ---------------- detail / 未知 action ----------------
test('orderAdmin/detail: 返回订单；缺 orderId 报错；查不到时返回 null', async () => {
  const o = order('o1', 'pending', 'pickup')
  const s = scenario({ seed: { orders: [o] } })
  let res = await callAs(s, { action: 'detail', orderId: 'o1' })
  assert.deepEqual(res, { ok: true, data: o })

  res = await callAs(s, { action: 'detail' })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 orderId/)

  const s2 = createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    options: { missingDoc: 'null' },
    seed: { admin_sessions: [makeSession({ token: TOKEN })] }
  })
  res = await callAs(s2, { action: 'detail', orderId: 'o_missing' })
  assert.deepEqual(res, { ok: true, data: null })
})

test('orderAdmin: 未知 action 返回 ok:false', async () => {
  const s = scenario()
  const res = await callAs(s, { action: 'export' })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: export/)
})
