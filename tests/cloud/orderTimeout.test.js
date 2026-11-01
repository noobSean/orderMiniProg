'use strict'

/**
 * cloudfunctions/orderTimeout —— P0 定时任务
 * 覆盖：超时未付款自动取消 + 回补库存、未超时/已付款/已取消/旧订单不动、幂等、
 *      每日售罄标记重置（dailySoldOutReset 触发）、ping 自检。
 * 运行：node --test tests/cloud/orderTimeout.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

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
function dish(id, stock, extra) {
  return Object.assign({ _id: id, name: '拿铁', price: 20, stock: stock, available: true, specs: [], extras: [] }, extra || {})
}
function scenario(orders, dishes, env) {
  return createScenario({
    fn: 'orderTimeout',
    seed: { orders: orders || [], dishes: dishes || [dish('dish_1', 10)] },
    env: env || {}
  })
}

test('orderTimeout: ping 自检', async () => {
  const s = scenario()
  const res = await s.call({ action: 'ping' })
  assert.equal(res.ok, true)
  assert.equal(res.data.pong, true)
  assert.equal(res.data.fn, 'orderTimeout')
})

test('orderTimeout: 超时未付款订单自动取消、写历史/原因、回补库存', async () => {
  const old = Date.now() - 30 * MIN
  const s = scenario([order('o_old', old)], [dish('dish_1', 10)])
  const res = await s.call({})
  assert.equal(res.ok, true)
  assert.equal(res.data.cancelled, 1)

  const o = s.doc('orders', 'o_old')
  assert.equal(o.status, 'cancelled')
  assert.equal(o.cancelReason, 'unpaid_timeout')
  assert.equal(o.statusHistory[1].status, 'cancelled')
  assert.equal(o.statusHistory[1].note, '超时未付款，自动取消')
  assert.equal(s.doc('dishes', 'dish_1').stock, 12, '应回补 2 份库存')
})

test('orderTimeout: 未超时/已付款/已取消/旧版本订单（无 paymentStatus）不动', async () => {
  const now = Date.now()
  const s = scenario([
    order('o_new', now - 1 * MIN),
    order('o_paid', now - 30 * MIN, { paymentStatus: 'paid' }),
    order('o_cancelled', now - 30 * MIN, { status: 'cancelled' }),
    order('o_legacy', now - 30 * MIN, { paymentStatus: undefined })
  ], [dish('dish_1', 10)])
  const res = await s.call({})
  assert.equal(res.ok, true)
  assert.equal(res.data.cancelled, 0)
  assert.equal(s.doc('orders', 'o_new').status, 'pending')
  assert.equal(s.doc('orders', 'o_paid').status, 'pending')
  assert.equal(s.doc('orders', 'o_cancelled').status, 'cancelled')
  assert.equal(s.doc('orders', 'o_legacy').status, 'pending')
})

test('orderTimeout: 重复执行幂等（第二次不会重复回补库存）', async () => {
  const old = Date.now() - 30 * MIN
  const s = scenario([order('o_old', old)], [dish('dish_1', 10)])
  await s.call({})
  assert.equal(s.doc('dishes', 'dish_1').stock, 12)
  const res2 = await s.call({})
  assert.equal(res2.data.cancelled, 0)
  assert.equal(s.doc('dishes', 'dish_1').stock, 12)
})

test('orderTimeout: 支持 UNPAID_TIMEOUT_MIN 环境变量', async () => {
  const s = scenario([order('o_old', Date.now() - 6 * MIN)], [dish('dish_1', 10)], { UNPAID_TIMEOUT_MIN: '5' })
  const res = await s.call({})
  assert.equal(res.data.cancelled, 1)
  assert.equal(res.data.timeoutMin, 5)
})

test('orderTimeout: dailySoldOutReset 触发时重置售罄标记，不清库存', async () => {
  const s = scenario([], [
    dish('dish_1', 10, { soldOut: true }),
    dish('dish_2', 0, { soldOut: true }),
    dish('dish_3', 5, { soldOut: false })
  ])
  const res = await s.call({ TriggerName: 'dailySoldOutReset' })
  assert.equal(res.ok, true)
  assert.equal(res.data.task, 'dailySoldOutReset')
  assert.equal(res.data.reset, 2)
  assert.equal(s.doc('dishes', 'dish_1').soldOut, false)
  assert.equal(s.doc('dishes', 'dish_2').soldOut, false)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10)
  assert.equal(s.doc('dishes', 'dish_2').stock, 0)
  // 非 daily 触发时执行超时任务
  const res2 = await s.call({})
  assert.equal(res2.data.task, 'unpaidTimeout')
})
