'use strict'

/**
 * cloudfunctions/myOrders —— 返回调用者自己的订单（createdAt 倒序）
 * 运行：node --test tests/cloud/myOrders.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

const OPENID = 'openid_my_orders'

function order(id, openid, createdAt, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    openid: openid,
    status: 'pending',
    total: 10,
    createdAt: createdAt
  }, extra || {})
}

test('myOrders: 无订单时返回空数组', async () => {
  const s = createScenario({ fn: 'myOrders', openid: OPENID })
  const res = await s.call({})
  assert.deepEqual(res, { ok: true, data: [] })
})

test('myOrders: 只返回当前 openid 的订单，且 createdAt 倒序', async () => {
  const s = createScenario({
    fn: 'myOrders',
    openid: OPENID,
    seed: {
      orders: [
        order('o1', OPENID, new Date('2026-10-01T10:00:00+08:00'), { status: 'done', total: 11 }),
        order('o2', 'openid_other', new Date('2026-10-02T10:00:00+08:00')),
        order('o3', OPENID, new Date('2026-10-03T10:00:00+08:00'), { status: 'cancelled', total: 33 }),
        order('o4', OPENID, new Date('2026-10-02T12:00:00+08:00'), { status: 'making', total: 22 })
      ]
    }
  })
  const res = await s.call({})
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['o3', 'o4', 'o1'])
  // 字段完整保留
  assert.equal(res.data[0].total, 33)
  assert.equal(res.data[0].status, 'cancelled')
  assert.equal(res.data[0].openid, OPENID)
})

test('myOrders: 返回的是查询快照副本（修改结果不影响库内数据）', async () => {
  const s = createScenario({
    fn: 'myOrders',
    openid: OPENID,
    seed: { orders: [order('o1', OPENID, new Date('2026-10-01T10:00:00+08:00'))] }
  })
  const res = await s.call({})
  res.data[0].status = 'hacked'
  assert.equal(s.doc('orders', 'o1').status, 'pending')
})

test('myOrders: 数据库异常时返回 ok:false 与错误信息', async () => {
  const s = createScenario({ fn: 'myOrders', openid: OPENID })
  s.mock.failNext('orders', 'get', new Error('orders db error'))
  const res = await s.call({})
  assert.equal(res.ok, false)
  assert.equal(res.message, 'orders db error')
})
