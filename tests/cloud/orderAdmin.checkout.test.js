'use strict'

/**
 * cloudfunctions/orderAdmin —— 到店交付流程
 * 覆盖：checkout（未收款一次完成收款+完成+取餐核销）、已收款完成、未收款禁止直接 done、
 *      ready 允许取消并回补库存、历史订单（无 paymentStatus）兼容、配送完成通知。
 * 运行：node --test tests/cloud/orderAdmin.checkout.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_checkout'
const DELIVERY_TPL = 'TPL_DELIVERY_CHECKOUT_1234567890'
const TEMPLATES = [{
  priTmplId: DELIVERY_TPL,
  title: '配送结果通知',
  content: '配送时间:{{time1.DATA}}\n商品名称:{{thing2.DATA}}\n送达时间:{{time3.DATA}}\n备注:{{thing4.DATA}}',
  type: 2
}]

function order(id, status, type, extra) {
  return Object.assign({
    _id: id,
    orderNo: 'O' + id,
    pickupNo: 8,
    openid: 'openid_order_owner',
    type: type || 'pickup',
    items: [{ dishId: 'dish_1', name: '拿铁', price: 20, qty: 1, spec: '', extras: [] }],
    total: 20,
    paymentStatus: 'unpaid',
    delivery: { target: '1号楼-3层', note: '' },
    status: status,
    statusHistory: [{ status: 'pending', time: new Date(), note: '已下单' }],
    createdAt: new Date(),
    updatedAt: new Date()
  }, extra || {})
}
function dish(id, stock) {
  return { _id: id, name: '拿铁', price: 20, stock: stock, available: true, soldOut: false, specs: [], extras: [], unit: '杯' }
}
function scenario(orders, extraSeed, opts) {
  return createScenario({
    fn: 'orderAdmin',
    openid: 'openid_admin',
    seed: Object.assign({
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600 * 1000 })],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }],
      orders: orders || [],
      dishes: [dish('dish_1', 10)]
    }, extraSeed || {}),
    templates: (opts && opts.templates) || TEMPLATES
  })
}
function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('checkout: 未收款待取餐 → 一次完成收款/完成/取餐核销', async () => {
  const s = scenario([order('o1', 'ready', 'pickup')])
  const res = await call(s, { action: 'checkout', orderId: 'o1' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data, { status: 'done', paymentStatus: 'paid' })
  const o = s.doc('orders', 'o1')
  assert.equal(o.status, 'done')
  assert.equal(o.paymentStatus, 'paid')
  assert.ok(o.paidAt instanceof Date)
  assert.ok(o.pickedUpAt instanceof Date)
  assert.equal(o.statusHistory[o.statusHistory.length - 1].status, 'done')
  assert.equal(o.statusHistory[o.statusHistory.length - 1].note, '已收款并交付')
  assert.equal(s.mock.openapi.calls.send.length, 0, '自取完成不发配送通知')
})

test('checkout: 已收款待取餐 → 直接完成，不重复改收款时间', async () => {
  const paidAt = new Date('2026-11-03T10:00:00+08:00')
  const s = scenario([order('o1', 'ready', 'pickup', { paymentStatus: 'paid', paidAt: paidAt })])
  const res = await call(s, { action: 'checkout', orderId: 'o1' })
  assert.equal(res.ok, true)
  const o = s.doc('orders', 'o1')
  assert.equal(o.status, 'done')
  assert.equal(o.paidAt.getTime(), paidAt.getTime())
})

test('checkout: 非待取餐状态拒绝；已取消拒绝', async () => {
  let s = scenario([order('o1', 'making', 'pickup')])
  let res = await call(s, { action: 'checkout', orderId: 'o1' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'BAD_STATUS')
  assert.match(res.message, /待取餐/)

  s = scenario([order('o1', 'cancelled', 'pickup')])
  res = await call(s, { action: 'checkout', orderId: 'o1' })
  assert.equal(res.ok, false)
  assert.match(res.message, /已取消/)
})

test('status done: 未收款订单被拒绝，要求先收款/使用收款并交付', async () => {
  const s = scenario([order('o1', 'ready', 'pickup')])
  const res = await call(s, { action: 'status', orderId: 'o1', status: 'done' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PAYMENT_REQUIRED')
  assert.equal(s.doc('orders', 'o1').status, 'ready')
})

test('status: 待取餐允许取消并回补库存（员工未取餐）', async () => {
  const s = scenario([order('o1', 'ready', 'pickup')])
  const res = await call(s, { action: 'status', orderId: 'o1', status: 'cancel' })
  assert.equal(res.ok, true)
  const o = s.doc('orders', 'o1')
  assert.equal(o.status, 'cancelled')
  assert.equal(s.doc('dishes', 'dish_1').stock, 11)
})

test('checkout: 历史订单（无 paymentStatus）也能完成并补记已收款', async () => {
  const legacy = order('o1', 'ready', 'pickup', { paymentStatus: undefined })
  const s = scenario([legacy])
  const res = await call(s, { action: 'checkout', orderId: 'o1' })
  assert.equal(res.ok, true)
  const o = s.doc('orders', 'o1')
  assert.equal(o.paymentStatus, 'paid')
  assert.equal(o.status, 'done')
})

test('checkout: 配送单完成时发送「已送达提醒」', async () => {
  const s = scenario([order('o1', 'ready', 'delivery', { paymentStatus: 'paid' })])
  const res = await call(s, {
    action: 'checkout', orderId: 'o1', subscribeTemplateIds: { deliveryDone: DELIVERY_TPL }
  })
  assert.equal(res.ok, true)
  await s.flush()
  assert.equal(s.mock.openapi.calls.send.length, 1)
  assert.equal(s.mock.openapi.calls.send[0].templateId, DELIVERY_TPL)
})
