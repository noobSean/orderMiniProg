'use strict'

/**
 * cloudfunctions/adminStats —— 经营统计（今日 / 自定义区间）
 * 规则：排除 cancelled；totalAmount 保留 2 位；topDishes 按份数降序取前 10。
 * 运行：node --test tests/cloud/adminStats.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_stats_admin'

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({ fn: 'adminStats', openid: 'openid_admin', seed: seed })
}

function order(id, createdAt, status, type, total, items) {
  return {
    _id: id,
    orderNo: 'O' + id,
    createdAt: createdAt,
    status: status,
    type: type,
    total: total,
    items: items || []
  }
}

test('adminStats: 无 token / 过期 token / 鉴权库异常均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({})
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = createScenario({
    fn: 'adminStats',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期/)

  s = scenario()
  s.mock.failNext('admin_sessions', 'get', new Error('auth down'))
  res = await s.call({ adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('adminStats: 默认统计今日订单，排除 cancelled', async () => {
  const now = new Date()
  const s = scenario({
    seed: {
      orders: [
        order('o1', now, 'pending', 'pickup', 28, [{ dishId: 'd1', name: '黑椒牛柳饭', price: 28, qty: 1 }]),
        order('o2', now, 'making', 'delivery', 30.5, [{ dishId: 'd2', name: '番茄炒蛋盖饭', price: 15.25, qty: 2 }]),
        order('o3', now, 'cancelled', 'pickup', 99, [{ dishId: 'd3', name: '取消的菜', price: 99, qty: 1 }])
      ]
    }
  })
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.orderCount, 2)
  assert.equal(res.data.totalAmount, 58.5)
  assert.deepEqual(res.data.byStatus, { pending: 1, making: 1 })
  assert.deepEqual(res.data.byType, { pickup: 1, delivery: 1 })
  assert.deepEqual(res.data.topDishes, [
    { name: '番茄炒蛋盖饭', qty: 2, amount: 30.5 },
    { name: '黑椒牛柳饭', qty: 1, amount: 28 }
  ])
})

test('adminStats: 昨日订单不计入今日统计', async () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
  const s = scenario({ seed: { orders: [order('o_old', yesterday, 'done', 'pickup', 20, [])] } })
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.orderCount, 0)
  assert.equal(res.data.totalAmount, 0)
  assert.deepEqual(res.data.byStatus, {})
  assert.deepEqual(res.data.byType, { pickup: 0, delivery: 0 })
  assert.deepEqual(res.data.topDishes, [])
})

test('adminStats: range 模式按 from/to（含 from、不含 to）统计', async () => {
  const s = scenario({
    seed: {
      orders: [
        order('o_in1', new Date('2026-10-01T10:00:00+08:00'), 'done', 'pickup', 10, []),
        order('o_in2', new Date('2026-10-02T23:59:00+08:00'), 'done', 'delivery', 20, []),
        order('o_out1', new Date('2026-09-30T10:00:00+08:00'), 'done', 'pickup', 30, []),
        order('o_out2', new Date('2026-10-03T00:00:00+08:00'), 'done', 'pickup', 40, [])
      ]
    }
  })
  const res = await s.call({
    mode: 'range',
    from: '2026-10-01T00:00:00+08:00',
    to: '2026-10-03T00:00:00+08:00',
    adminToken: TOKEN
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.orderCount, 2)
  assert.equal(res.data.totalAmount, 30)
})

test('adminStats: range 模式非法 from/to 回落到「今日 0 点 ~ 现在」', async () => {
  const now = new Date()
  const s = scenario({
    seed: { orders: [order('o_now', now, 'pending', 'pickup', 12.3, [])] }
  })
  const res = await s.call({ mode: 'range', from: 'not-a-date', to: 'also-bad', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.orderCount, 1)
  assert.equal(res.data.totalAmount, 12.3)
})

test('adminStats: topDishes 按 dishId 聚合（fallback name），按份数降序并取前 10', async () => {
  const now = new Date()
  const items = []
  // 造 12 个菜品，份数 12..1，验证只取前 10
  for (let i = 0; i < 12; i += 1) {
    items.push({ dishId: 'dish_' + i, name: '菜' + i, price: 1, qty: 12 - i })
  }
  items.push({ name: '仅名称菜', price: 2, qty: 5 })
  items.push({ price: 3, qty: 5 }) // 无 dishId 且无 name，应被跳过
  const s = scenario({ seed: { orders: [order('o1', now, 'pending', 'pickup', 100, items)] } })
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.topDishes.length, 10)
  const qtys = res.data.topDishes.map(function (d) { return d.qty })
  assert.deepEqual(qtys, [12, 11, 10, 9, 8, 7, 6, 5, 5, 4])
  assert.equal(res.data.topDishes[0].name, '菜0')
  assert.equal(res.data.topDishes[0].amount, 12)
  const onlyName = res.data.topDishes.filter(function (d) { return d.name === '仅名称菜' })[0]
  assert.ok(onlyName, '无 dishId 时用 name 聚合')
  assert.equal(onlyName.qty, 5)
  assert.equal(onlyName.amount, 10)
})

test('adminStats: 金额与份数做浮点防护（Number 转换 + 四舍五入到分）', async () => {
  const now = new Date()
  const s = scenario({
    seed: {
      orders: [
        order('o1', now, 'pending', 'pickup', '10.10', [
          { dishId: 'd1', name: '菜A', price: '3.33', qty: '3' },
          { dishId: 'd2', name: '菜B', price: 0.1, qty: 1 }
        ]),
        order('o2', now, 'pending', 'pickup', 0.2, [{ dishId: 'd1', name: '菜A', price: 3.33, qty: 1 }])
      ]
    }
  })
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.totalAmount, 10.3)
  const a = res.data.topDishes.filter(function (d) { return d.name === '菜A' })[0]
  assert.equal(a.qty, 4)
  assert.equal(a.amount, 13.32)
})

test('adminStats: 订单查询异常返回 ok:false 与错误信息', async () => {
  const s = scenario()
  s.mock.failNext('orders', 'get', new Error('stats db down'))
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /stats db down/)
})
