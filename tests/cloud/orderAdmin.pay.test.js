'use strict'

/**
 * cloudfunctions/orderAdmin —— P0 收款与取餐核销
 * 覆盖：pay 鉴权/成功/幂等/已取消拒绝；自取 done 记录 pickedUpAt；配送 done 不记录。
 * 运行：node --test tests/cloud/orderAdmin.pay.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_pay_admin'

function order(id, status, type, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    pickupNo: 8,
    openid: 'o',
    type: type || 'pickup',
    items: [{ dishId: 'dish_1', name: '拿铁', price: 20, qty: 1, spec: '', extras: [] }],
    total: 20,
    delivery: { target: '1号楼-3层', note: '' },
    status: status,
    paymentStatus: 'unpaid',
    statusHistory: [{ status: 'pending', time: new Date(), note: '已下单' }],
    createdAt: new Date(),
    updatedAt: new Date()
  }, extra || {})
}

function scenario(orders) {
  return createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600 * 1000 })],
      orders: orders || []
    },
    templates: []
  })
}

function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('orderAdmin/pay: 未登录返回 NEED_ADMIN_LOGIN', async () => {
  const s = scenario([order('o1', 'pending', 'pickup')])
  const res = await s.call({ action: 'pay', orderId: 'o1' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('orderAdmin/pay: 标记已收款并记录 paidAt；重复标记幂等', async () => {
  const s = scenario([order('o1', 'pending', 'pickup')])
  let res = await call(s, { action: 'pay', orderId: 'o1' })
  assert.equal(res.ok, true)
  let o = s.doc('orders', 'o1')
  assert.equal(o.paymentStatus, 'paid')
  assert.ok(o.paidAt instanceof Date)
  res = await call(s, { action: 'pay', orderId: 'o1' })
  assert.equal(res.ok, true)
  assert.equal(res.data.noop, true)
  o = s.doc('orders', 'o1')
  assert.equal(o.paymentStatus, 'paid')
})

test('orderAdmin/pay: 已取消订单不能收款；缺少 orderId 报错', async () => {
  let s = scenario([order('o1', 'cancelled', 'pickup')])
  let res = await call(s, { action: 'pay', orderId: 'o1' })
  assert.equal(res.ok, false)
  assert.match(res.message, /已取消/)
  s = scenario()
  res = await call(s, { action: 'pay' })
  assert.equal(res.ok, false)
  assert.match(res.message, /orderId/)
})

test('orderAdmin/status: 自取订单 done 记录取餐核销时间 pickedUpAt', async () => {
  const s = scenario([order('o1', 'ready', 'pickup', { paymentStatus: 'paid' })])
  const res = await call(s, { action: 'status', orderId: 'o1', status: 'done' })
  assert.equal(res.ok, true)
  const o = s.doc('orders', 'o1')
  assert.equal(o.status, 'done')
  assert.ok(o.pickedUpAt instanceof Date)
})

test('orderAdmin/status: 配送订单 done 不写 pickedUpAt', async () => {
  const s = scenario([order('o1', 'ready', 'delivery', { paymentStatus: 'paid' })])
  await call(s, { action: 'status', orderId: 'o1', status: 'done' })
  const o = s.doc('orders', 'o1')
  assert.equal(o.status, 'done')
  assert.equal(o.pickedUpAt, undefined)
})
