'use strict'

/**
 * cloudfunctions/submitOrder —— 促销折扣计算（proto）
 * 覆盖：全部品类/指定分类/指定菜品、同菜品多活动取最优（不叠加）、未开始/已结束/停用忽略、
 *      规格加料计价、金额四舍五入、订单优惠字段落库、库存与状态不受影响。
 * 运行：node --test tests/cloud/submitOrder.promo.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

const OPENID = 'openid_buyer'

function buyer() {
  return { _id: 'emp_1', openid: OPENID, empNo: 'E1', name: '张三', dept: '技术部', location: '1号楼' }
}
function dish(id, name, categoryId, price, extra) {
  return Object.assign({
    _id: id, categoryId: categoryId, name: name, price: price, specs: [], extras: [], stock: 10, available: true, unit: '份'
  }, extra || {})
}
function promo(id, rate, scopeType, extra) {
  return Object.assign({
    _id: id, name: '活动' + id, scopeType: scopeType, categoryIds: [], dishIds: [],
    rate: rate, discount: Math.round(rate * 10 * 10) / 10, startAt: null, endAt: null, enabled: true,
    createdAt: new Date()
  }, extra || {})
}
function scenario(promotions, dishes) {
  return createScenario({
    fn: 'submitOrder',
    openid: OPENID,
    seed: {
      employees: [buyer()],
      dishes: dishes || [
        dish('dish_food', '黑椒牛柳饭', 'cat_food', 28, {
          specs: [{ name: '大份', price: 5 }],
          extras: [{ name: '加蛋', price: 2 }]
        }),
        dish('dish_drink', '鲜榨橙汁', 'cat_drink', 12)
      ],
      settings: [{ _id: 'settings_main', storeName: '企业餐厅' }],
      promotions: promotions || []
    },
    templates: []
  })
}

test('submitOrder/promo: 全部品类 8 折——金额、优惠明细、订单字段正确', async () => {
  const s = scenario([promo('p_all', 0.8, 'all')])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 2 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 44.8)
  assert.equal(res.data.originalTotal, 56)
  assert.equal(res.data.discountAmount, 11.2)
  assert.deepEqual(res.data.discounts, [{ promotionId: 'p_all', name: '活动p_all', rate: 0.8, amount: 11.2 }])

  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.total, 44.8)
  assert.equal(order.originalTotal, 56)
  assert.equal(order.discountAmount, 11.2)
  assert.equal(order.items[0].price, 28, '单价仍保留原价')
  assert.equal(order.items[0].originalPrice, 28)
  assert.equal(order.items[0].discountRate, 0.8)
  assert.equal(order.items[0].discountAmount, 11.2)
  assert.equal(order.items[0].lineTotal, 44.8)
  assert.equal(order.items[0].promotionId, 'p_all')
  assert.equal(s.doc('dishes', 'dish_food').stock, 8)
})

test('submitOrder/promo: 指定分类——只对饮品打折，食品原价', async () => {
  const s = scenario([promo('p_drink', 0.5, 'category', { categoryIds: ['cat_drink'] })])
  const res = await s.call({
    type: 'pickup',
    items: [{ dishId: 'dish_food', qty: 1 }, { dishId: 'dish_drink', qty: 2 }]
  })
  assert.equal(res.ok, true)
  // 食品 28 + 饮品 12*2*0.5=12 => 40；原价 52，优惠 12
  assert.equal(res.data.total, 40)
  assert.equal(res.data.originalTotal, 52)
  assert.equal(res.data.discountAmount, 12)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.items[0].discountAmount || 0, 0, '食品不参与饮品活动')
  assert.equal(order.items[1].discountAmount, 12)
})

test('submitOrder/promo: 指定菜品活动生效', async () => {
  const s = scenario([promo('p_dish', 0.6, 'dish', { dishIds: ['dish_food'] })])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 1 }, { dishId: 'dish_drink', qty: 1 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 28.8)
  assert.equal(res.data.originalTotal, 40)
})

test('submitOrder/promo: 同一菜品命中多个活动时取折扣最大者（不叠加）', async () => {
  const s = scenario([
    promo('p_all_9', 0.9, 'all'),
    promo('p_cat_7', 0.7, 'category', { categoryIds: ['cat_food'] })
  ])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 2 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 39.2, '应按 7 折而非 9 折或叠加')
  assert.equal(res.data.discounts.length, 1)
  assert.equal(res.data.discounts[0].promotionId, 'p_cat_7')
})

test('submitOrder/promo: 停用/未开始/已结束的活动不生效', async () => {
  const now = Date.now()
  const s = scenario([
    promo('p_off', 0.5, 'all', { enabled: false }),
    promo('p_future', 0.5, 'all', { startAt: now + 24 * 3600 * 1000 }),
    promo('p_past', 0.5, 'all', { endAt: now - 24 * 3600 * 1000 })
  ])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 1 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 28)
  assert.equal(res.data.discountAmount, undefined)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.discountAmount, undefined)
  assert.equal(order.items[0].discountAmount, undefined)
})

test('submitOrder/promo: 折扣作用于含规格/加料的单价，并四舍五入到分', async () => {
  const s = scenario([promo('p_all', 0.85, 'all')])
  // 单价 28 + 大份5 + 加蛋2 = 35；35*0.85=29.75
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 1, spec: '大份', extras: ['加蛋'] }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 29.75)
  assert.equal(res.data.originalTotal, 35)
  assert.equal(res.data.discountAmount, 5.25)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.items[0].price, 35)
  assert.equal(order.items[0].lineTotal, 29.75)
})

test('submitOrder/promo: 无活动时行为与原先一致（无优惠字段）', async () => {
  const s = scenario([])
  const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_food', qty: 2 }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 56)
  assert.equal(res.data.originalTotal, undefined)
  assert.equal(res.data.discountAmount, undefined)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.total, 56)
  assert.equal(order.discountAmount, undefined)
  assert.equal(order.items[0].discountRate, undefined)
})
