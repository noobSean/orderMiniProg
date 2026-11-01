'use strict'

/**
 * cloudfunctions/seedData —— 测试数据初始化（幂等冒烟）
 * 调用：{"key":"seed2024"}；{"key":"seed2024","withOrders":false} 不写示例订单。
 * 运行：node --test tests/cloud/seedData.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

function scenario(opts) {
  return createScenario({ fn: 'seedData', env: {}, seed: (opts || {}).seed })
}

function counts(s) {
  return {
    settings: s.count('settings'),
    categories: s.count('menu_categories'),
    dishes: s.count('dishes'),
    departments: s.count('departments'),
    orders: s.count('orders')
  }
}

test('seedData: 缺少 key / key 错误返回 ok:false 且不写任何数据', async () => {
  for (const event of [{}, { key: 'wrong' }, { key: '' }]) {
    const s = scenario()
    const res = await s.call(event)
    assert.equal(res.ok, false)
    assert.match(res.message, /seed2024/)
    assert.deepEqual(counts(s), { settings: 0, categories: 0, dishes: 0, departments: 0, orders: 0 })
  }
})

test('seedData: withOrders=false 只写基础数据并返回 skippedOrders', async () => {
  const s = scenario()
  const res = await s.call({ key: 'seed2024', withOrders: false })
  assert.equal(res.ok, true)
  assert.equal(res.message, '测试数据写入完成')
  assert.equal(res.data.skippedOrders, true)
  assert.equal(res.data.orders, 0)
  assert.equal(res.data.settings, 1)
  assert.ok(res.data.categories > 0)
  assert.ok(res.data.dishes > 0)
  assert.ok(res.data.departments > 0)
  const c = counts(s)
  assert.equal(c.settings, 1)
  assert.equal(c.categories, res.data.categories)
  assert.equal(c.dishes, res.data.dishes)
  assert.equal(c.departments, res.data.departments)
  assert.equal(c.orders, 0)
})

test('seedData: 默认写入示例订单，订单字段（时间/状态历史）被正确转为 Date', async () => {
  const s = scenario()
  const res = await s.call({ key: 'seed2024' })
  assert.equal(res.ok, true)
  assert.equal(res.data.skippedOrders, false)
  assert.equal(res.data.orders, 6)
  assert.equal(s.count('orders'), 6)
  const before = Date.now()
  for (const order of s.docs('orders')) {
    assert.match(order._id, /^ord_seed_/)
    assert.ok(order.orderNo)
    assert.ok(typeof order.pickupNo === 'number')
    assert.ok(order.createdAt instanceof Date && !isNaN(order.createdAt.getTime()))
    assert.ok(order.createdAt.getTime() <= before)
    assert.ok(Array.isArray(order.statusHistory) && order.statusHistory.length > 0)
    for (const h of order.statusHistory) {
      assert.ok(h.time instanceof Date, 'statusHistory.time 应为 Date')
      assert.ok(h.time.getTime() >= order.createdAt.getTime(), '状态时间不早于下单时间')
    }
  }
})

test('seedData: 重复执行幂等——各集合数量不变、settings 始终只有一条', async () => {
  const s = scenario()
  const first = await s.call({ key: 'seed2024' })
  const afterFirst = counts(s)
  const second = await s.call({ key: 'seed2024' })
  const afterSecond = counts(s)
  assert.equal(second.ok, true)
  assert.deepEqual(afterSecond, afterFirst)
  assert.equal(afterSecond.settings, 1)
  assert.deepEqual(second.data, first.data)

  const third = await s.call({ key: 'seed2024' })
  assert.equal(third.ok, true)
  assert.deepEqual(counts(s), afterFirst)
})

test('seedData: 已存在 settings 文档时原地覆盖，不新增第二条', async () => {
  const s = scenario({ seed: { settings: [{ _id: 'custom_settings', storeName: '旧店名', phone: '000' }] } })
  const res = await s.call({ key: 'seed2024' })
  assert.equal(res.ok, true)
  assert.equal(s.count('settings'), 1)
  const saved = s.doc('settings', 'custom_settings')
  assert.ok(saved, '应复用已有 settings 文档 _id')
  assert.equal(saved.storeName, '星辰科技 · 员工餐厅')
  assert.equal(saved.phone, '021-8888-6666')
})

test('seedData: 基础数据使用固定 _id 写入，菜品/分类/科室齐全且科室 id 为 ks_<code>', async () => {
  const s = scenario()
  await s.call({ key: 'seed2024', withOrders: false })
  const categories = s.docs('menu_categories').sort(function (a, b) { return a.sort - b.sort })
  assert.deepEqual(categories.map(function (c) { return c._id }), ['cat_1', 'cat_2', 'cat_3', 'cat_4', 'cat_5'])
  assert.equal(categories[0].name, '商务套餐')

  const dishes = s.docs('dishes')
  assert.ok(dishes.length >= 10)
  assert.ok(s.doc('dishes', 'dish_1'), '固定 _id dish_1 应存在')
  assert.equal(s.doc('dishes', 'dish_1').name, '黑椒牛柳饭')

  const depts = s.docs('departments')
  assert.ok(depts.length > 100, '科室数据超过 100 条（writeBatch 分片）')
  const ids = new Set(depts.map(function (d) { return d._id }))
  assert.equal(ids.size, depts.length, '科室 _id 不应重复')
  for (const d of depts) {
    assert.equal(d._id, 'ks_' + d.code)
    assert.equal(typeof d.code, 'number')
  }
})

test('seedData: settings 读取异常时返回 ok:false 并保留 data 进度', async () => {
  const s = scenario()
  s.mock.failNext('settings', 'get', new Error('settings read fail'))
  const res = await s.call({ key: 'seed2024' })
  assert.equal(res.ok, false)
  assert.match(res.message, /settings read fail/)
  assert.equal(res.data.settings, 0)
  assert.equal(s.count('settings'), 0)
})

test('seedData: 写入过程中途失败返回 ok:false，已完成的阶段计数保留', async () => {
  const s = scenario()
  s.mock.failNext('dishes', 'docSet', new Error('dish write fail'))
  const res = await s.call({ key: 'seed2024' })
  assert.equal(res.ok, false)
  assert.match(res.message, /dish write fail/)
  assert.equal(res.data.settings, 1, 'settings 阶段应已完成')
  assert.equal(res.data.categories, 5, '分类阶段应已完成')
  assert.equal(s.count('orders'), 0, '失败后不会继续写订单')
})
