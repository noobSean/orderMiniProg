'use strict'

/**
 * cloudfunctions/dishAdmin —— 快捷售罄开关与 soldOut 字段
 * 运行：node --test tests/cloud/dishAdmin.soldout.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_dish_admin'

function dish(id, extra) {
  return Object.assign({ _id: id, categoryId: 'c1', name: '拿铁', price: 20, stock: 10, available: true, soldOut: false, specs: [], extras: [] }, extra || {})
}
function scenario() {
  return createScenario({
    fn: 'dishAdmin',
    openid: 'openid_admin',
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600 * 1000 })],
      dishes: [dish('d1')]
    }
  })
}
function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('dishAdmin/toggleSoldOut: 一键售罄/恢复，不影响库存与上下架', async () => {
  const s = scenario()
  let res = await call(s, { action: 'toggleSoldOut', dishId: 'd1' })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'd1').soldOut, true)
  assert.equal(s.doc('dishes', 'd1').stock, 10)
  assert.equal(s.doc('dishes', 'd1').available, true)

  res = await call(s, { action: 'toggleSoldOut', dishId: 'd1' })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'd1').soldOut, false)
})

test('dishAdmin/toggleSoldOut: 显式 soldOut 值；未登录拒绝', async () => {
  const s = scenario()
  await call(s, { action: 'toggleSoldOut', dishId: 'd1', soldOut: true })
  assert.equal(s.doc('dishes', 'd1').soldOut, true)
  const res = await s.call({ action: 'toggleSoldOut', dishId: 'd1', soldOut: false })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('dishAdmin/create/update: 支持 soldOut 字段', async () => {
  const s = scenario()
  let res = await call(s, {
    action: 'create', name: '新品', categoryId: 'c1', price: 15, soldOut: true, stock: 5
  })
  assert.equal(res.ok, true)
  const created = s.doc('dishes', res.data._id)
  assert.equal(created.soldOut, true)

  res = await call(s, { action: 'update', dishId: 'd1', soldOut: true })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'd1').soldOut, true)
})
