'use strict'

/**
 * cloudfunctions/orderDetail —— 订单详情：本人或已登录管理端会话可查看
 * 鉴权：event.adminToken 命中 admin_sessions 且 expireAt > Date.now()
 * 运行：node --test tests/cloud/orderDetail.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const OWNER = 'openid_order_owner'
const OTHER = 'openid_order_other'
const ADMIN_TOKEN = 'tok_order_detail_admin'

function baseOrder() {
  return {
    _id: 'ord_1',
    orderNo: 'O20261030001',
    pickupNo: 8,
    openid: OWNER,
    type: 'pickup',
    items: [{ dishId: 'dish_1', name: '黑椒牛柳饭', price: 28, qty: 1 }],
    total: 28,
    status: 'pending'
  }
}

function scenario(opts) {
  const options = opts || {}
  return createScenario({
    fn: 'orderDetail',
    openid: options.openid === undefined ? OWNER : options.openid,
    seed: options.seed
  })
}

test('orderDetail: 缺少 orderId 返回 ok:false 与提示', async () => {
  const s = scenario()
  const res = await s.call({})
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 orderId/)
})

test('orderDetail: 本人订单可直接查看（完整订单对象）', async () => {
  const order = baseOrder()
  const s = scenario({ seed: { orders: [order] } })
  const res = await s.call({ orderId: 'ord_1' })
  assert.deepEqual(res, { ok: true, data: order })
})

test('orderDetail: 他人订单且无 adminToken 返回无权查看', async () => {
  const s = scenario({ openid: OTHER, seed: { orders: [baseOrder()] } })
  const res = await s.call({ orderId: 'ord_1' })
  assert.equal(res.ok, false)
  assert.match(res.message, /无权查看该订单/)
  assert.equal(res.data, undefined)
})

test('orderDetail: 他人订单 + 有效 adminToken 可以查看', async () => {
  const s = scenario({
    openid: OTHER,
    seed: {
      orders: [baseOrder()],
      admin_sessions: [makeSession({ token: ADMIN_TOKEN, openid: 'openid_admin', expireAt: Date.now() + 60000 })]
    }
  })
  const res = await s.call({ orderId: 'ord_1', adminToken: ADMIN_TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'ord_1')
  assert.equal(res.data.openid, OWNER)
})

test('orderDetail: 无效 adminToken 查看他人订单被拒绝', async () => {
  const s = scenario({ openid: OTHER, seed: { orders: [baseOrder()] } })
  const res = await s.call({ orderId: 'ord_1', adminToken: 'tok_not_exist' })
  assert.equal(res.ok, false)
  assert.match(res.message, /无权查看该订单/)
})

test('orderDetail: 已过期 adminToken 被拒绝', async () => {
  const s = scenario({
    openid: OTHER,
    seed: {
      orders: [baseOrder()],
      admin_sessions: [makeSession({ token: ADMIN_TOKEN, expireAt: Date.now() - 1 })]
    }
  })
  const res = await s.call({ orderId: 'ord_1', adminToken: ADMIN_TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /无权查看该订单/)
})

test('orderDetail: admin_sessions 查询异常时按无权限处理', async () => {
  const s = scenario({
    openid: OTHER,
    seed: { orders: [baseOrder()], admin_sessions: [makeSession({ token: ADMIN_TOKEN })] }
  })
  s.mock.failNext('admin_sessions', 'get', new Error('session db down'))
  const res = await s.call({ orderId: 'ord_1', adminToken: ADMIN_TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /无权查看该订单/)
})

test('orderDetail: 订单不存在时（mock 允许返回 null）返回「订单不存在」', async () => {
  const s = createScenario({ fn: 'orderDetail', openid: OWNER, options: { missingDoc: 'null' } })
  const res = await s.call({ orderId: 'ord_missing' })
  assert.equal(res.ok, false)
  assert.match(res.message, /订单不存在/)
})

test('orderDetail: 真实 SDK 语义下 doc 不存在会抛错，被兜底为 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ orderId: 'ord_missing' })
  assert.equal(res.ok, false)
  // 源码未区分「不存在」和「查询失败」，会把 SDK 错误文案透出（见测试报告中的源码观察项）
  assert.match(res.message, /does not exist|查询失败/)
})
