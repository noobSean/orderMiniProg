'use strict'

/**
 * cloudfunctions/submitOrder —— P0 支付状态与售罄拦截
 * 运行：node --test tests/cloud/submitOrder.p0.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

function scenario(dishes) {
  return createScenario({
    fn: 'submitOrder',
    openid: 'openid_buyer',
    seed: {
      employees: [{ _id: 'emp_1', openid: 'openid_buyer', empNo: 'E1', name: '张三', dept: '技术部', location: '1号楼' }],
      dishes: dishes || [{
        _id: 'dish_1', categoryId: 'cat_1', name: '拿铁', price: 20, stock: 10, available: true, soldOut: false, specs: [], extras: [], unit: '杯'
      }],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }]
    },
    templates: []
  })
}

test('submitOrder: 新订单 paymentStatus=unpaid，并随返回结果返回', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: 1 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.paymentStatus, 'unpaid')
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.paymentStatus, 'unpaid')
  assert.equal(order.paidAt, undefined)
})

test('submitOrder: soldOut=true 的菜品拒绝下单，不扣库存/不生成订单', async () => {
  const s = scenario([{
    _id: 'dish_1', categoryId: 'cat_1', name: '拿铁', price: 20, stock: 10, available: true, soldOut: true, specs: [], extras: [], unit: '杯'
  }])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: 1 }] })
  assert.equal(res.ok, false)
  assert.match(res.message, /售罄/)
  assert.equal(s.count('orders'), 0)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10)
})

test('submitOrder: soldOut=false 正常下单', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: 1 }] })
  assert.equal(res.ok, true)
  assert.equal(s.doc('dishes', 'dish_1').stock, 9)
})

test('submitOrder: 售罄标记只对当天有效，昨日售罄的菜品今天可正常下单', async () => {
  const t = new Date(Date.now() - 24 * 3600 * 1000 + 8 * 3600 * 1000)
  const yesterday = '' + t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, '0') + String(t.getUTCDate()).padStart(2, '0')
  const s2 = scenario([{
    _id: 'dish_1', categoryId: 'cat_1', name: '拿铁', price: 20, stock: 10, available: true, soldOut: true, soldOutDate: yesterday, specs: [], extras: [], unit: '杯'
  }])
  const res = await s2.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: 1 }] })
  assert.equal(res.ok, true, '昨日售罄标记不应阻止今天下单')
  assert.equal(s2.doc('dishes', 'dish_1').stock, 9)
})
