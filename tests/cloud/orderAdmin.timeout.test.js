'use strict'

/**
 * cloudfunctions/orderAdmin —— 惰性超时清理（定时触发器未配置时的兜底）
 * 打开/刷新管理端订单列表时，自动取消超过 UNPAID_TIMEOUT_MIN 的 pending+unpaid 订单并回补库存。
 * 运行：node --test tests/cloud/orderAdmin.timeout.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_list_timeout'
const MIN = 60 * 1000

function order(id, createdAt, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    pickupNo: 1,
    openid: 'o',
    type: 'pickup',
    items: [{ dishId: 'dish_1', name: '拿铁', price: 20, qty: 2, spec: '', extras: [] }],
    total: 40,
    status: 'pending',
    paymentStatus: 'unpaid',
    statusHistory: [{ status: 'pending', time: new Date(createdAt), note: '已下单' }],
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt)
  }, extra || {})
}
function dish(id, stock) {
  return { _id: id, name: '拿铁', price: 20, stock: stock, available: true, soldOut: false, specs: [], extras: [] }
}
function scenario(orders) {
  return createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600 * 1000 })],
      orders: orders || [],
      dishes: [dish('dish_1', 10)]
    },
    templates: []
  })
}
function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('orderAdmin/list: 惰性取消超时未付款订单并回补库存', async () => {
  const old = Date.now() - 30 * MIN
  const s = scenario([order('o_old', old)])
  const res = await call(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.equal(res.data.length, 1)
  assert.equal(res.autoCancelled, 1)
  const o = s.doc('orders', 'o_old')
  assert.equal(o.status, 'cancelled')
  assert.equal(o.cancelReason, 'unpaid_timeout')
  assert.equal(s.doc('dishes', 'dish_1').stock, 12)
})

test('orderAdmin/list: 未超时/已付款/无 paymentStatus 的订单不被误取消', async () => {
  const now = Date.now()
  const s = scenario([
    order('o_new', now - 1 * MIN),
    order('o_paid', now - 30 * MIN, { paymentStatus: 'paid' }),
    order('o_legacy', now - 30 * MIN, { paymentStatus: undefined })
  ])
  const res = await call(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.equal(res.autoCancelled, 0)
  assert.equal(s.doc('orders', 'o_new').status, 'pending')
  assert.equal(s.doc('orders', 'o_paid').status, 'pending')
  assert.equal(s.doc('orders', 'o_legacy').status, 'pending')
})

test('orderAdmin/list: 重复刷新幂等，不会重复回补库存', async () => {
  const old = Date.now() - 30 * MIN
  const s = scenario([order('o_old', old)])
  await call(s, { action: 'list' })
  assert.equal(s.doc('dishes', 'dish_1').stock, 12)
  const res2 = await call(s, { action: 'list' })
  assert.equal(res2.autoCancelled, 0)
  assert.equal(s.doc('dishes', 'dish_1').stock, 12)
})
