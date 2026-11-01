'use strict'

/**
 * 第二轮测试发现的缺陷修复回归（Lead 修复后补充）
 *  - 取消订单回补有限库存（不限库存不回补）
 *  - 同状态重复提交幂等 no-op（不重复发订阅消息）
 *  - orderAdmin list 支持 status:'cancel' 别名过滤
 *  - submitOrder 数量小数向下取整
 * 运行：node --test tests/cloud/fixes.round2.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_fixes'
const PICKUP_TPL = 'TPL_PICKUP_FIX_1234567890'
const PLACED_TPL = 'TPL_PLACED_FIX_1234567890'

const TEMPLATES = [
  { priTmplId: PICKUP_TPL, title: '取餐提醒', content: '取餐号:{{character_string1.DATA}}', type: 2 },
  { priTmplId: PLACED_TPL, title: '下单成功通知', content: '订单内容:{{thing1.DATA}}', type: 2 }
]

function session() {
  return { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600000 })] }
}

function adminScenario(orders, dishes) {
  return createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600000 })],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }],
      orders: orders,
      dishes: dishes || []
    },
    templates: TEMPLATES
  })
}

function order(id, status, type, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    pickupNo: 8,
    openid: 'openid_order_owner',
    type: type || 'pickup',
    items: [{ dishId: 'dish_1', name: '黑椒牛柳饭', price: 28, qty: 2, spec: '', extras: [] }],
    total: 56,
    delivery: { target: '1号楼-3层', note: '不要辣' },
    status: status,
    statusHistory: [{ status: 'pending', time: new Date('2026-10-30T10:00:00+08:00'), note: '已下单' }],
    createdAt: new Date(),
    updatedAt: new Date()
  }, extra || {})
}

function dish(id, stock, extra) {
  return Object.assign({ _id: id, name: '黑椒牛柳饭', price: 28, stock: stock, available: true, specs: [], extras: [] }, extra || {})
}

test('取消订单：有限库存菜品按数量回补', async () => {
  const s = adminScenario([order('o1', 'pending', 'pickup')], [dish('dish_1', 5)])
  const res = await s.call({ action: 'status', orderId: 'o1', status: 'cancelled', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(s.doc('orders', 'o1').status, 'cancelled')
  assert.equal(s.doc('dishes', 'dish_1').stock, 7, '取消后库存应 5+2=7')
})

test('取消订单：不限库存（stock=null）不回补', async () => {
  const s = adminScenario([order('o1', 'making', 'pickup')], [dish('dish_1', null)])
  const res = await s.call({ action: 'status', orderId: 'o1', status: 'cancel', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'dish_1').stock, null)
})

test('非取消的状态变更不回补库存', async () => {
  const s = adminScenario([order('o1', 'pending', 'pickup')], [dish('dish_1', 5)])
  const res = await s.call({ action: 'status', orderId: 'o1', status: 'making', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'dish_1').stock, 5, '接单不应回补库存')
})

test('同状态重复提交：幂等 no-op 且不重复发订阅消息', async () => {
  const s = adminScenario([order('o1', 'ready', 'pickup')], [dish('dish_1', 5)])
  const res = await s.call({ action: 'status', orderId: 'o1', status: 'ready', adminToken: TOKEN, subscribeTemplateIds: { pickupReady: PICKUP_TPL } })
  assert.deepEqual(res, { ok: true, data: 'ready', noop: true })
  assert.equal(s.doc('orders', 'o1').statusHistory.length, 1, '不应追加历史')
  assert.equal(s.mock.openapi.calls.send.length, 0, '不应重复发送可取餐通知')
})

test('list 过滤兼容 status:cancel 别名，返回真实 cancelled 订单', async () => {
  const s = adminScenario([
    order('o1', 'cancelled', 'pickup'),
    order('o2', 'pending', 'pickup')
  ], [dish('dish_1', 5)])
  const res = await s.call({ action: 'list', status: 'cancel', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (o) { return o._id }), ['o1'])
})

test('list 过滤 status:cancelled 同样可用', async () => {
  const s = adminScenario([order('o1', 'cancelled', 'pickup'), order('o2', 'pending', 'pickup')], [dish('dish_1', 5)])
  const res = await s.call({ action: 'list', status: 'cancelled', adminToken: TOKEN })
  assert.deepEqual(res.data.map(function (o) { return o._id }), ['o1'])
})

test('submitOrder：数量小数向下取整（1.5 -> 1），库存与订单数量一致', async () => {
  const s = createScenario({
    fn: 'submitOrder',
    openid: 'openid_buyer',
    seed: {
      employees: [{ _id: 'emp_1', openid: 'openid_buyer', empNo: 'E1', name: '张三', dept: '技术部' }],
      dishes: [dish('dish_1', 10)],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }]
    },
    templates: TEMPLATES
  })
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: 1.5 }] })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'dish_1').stock, 9, '1.5 应向下取整为 1')
  assert.equal(s.doc('orders', res.data.orderId).items[0].qty, 1)
})
