'use strict'

/**
 * cloudfunctions/submitOrder —— 事务下单（校验/扣库存/生成订单/下单成功订阅消息）
 * 运行：node --test tests/cloud/submitOrder.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

const BUYER_OPENID = 'openid_buyer'
const ADMIN_TPL = 'TPL_ORDER_PLACED_1234567890'

const TEMPLATES = [
  {
    priTmplId: ADMIN_TPL,
    title: '下单成功通知',
    content: '门店:{{thing1.DATA}}\n订单号:{{character_string2.DATA}}\n金额:{{amount3.DATA}}\n时间:{{time4.DATA}}\n提示:{{thing5.DATA}}',
    type: 2
  }
]

function buyer(extra) {
  return Object.assign({
    _id: 'emp_buyer',
    openid: BUYER_OPENID,
    empNo: 'E1001',
    name: '张三',
    dept: '技术部',
    location: '1号楼-3层'
  }, extra || {})
}

function dish(id, name, price, extra) {
  return Object.assign({
    _id: id,
    categoryId: 'cat_1',
    name: name,
    price: price,
    specs: [],
    extras: [],
    stock: 10,
    available: true,
    unit: '份'
  }, extra || {})
}

function defaultDishes() {
  return [
    dish('dish_1', '黑椒牛柳饭', 28, {
      specs: [{ name: '标准份', price: 0 }, { name: '大份', price: 5 }],
      extras: [{ name: '加蛋', price: 2 }, { name: '加辣', price: 0 }],
      stock: 10
    }),
    dish('dish_2', '鲜榨橙汁', 10, { stock: null }),
    dish('dish_3', '下架菜', 9, { available: false }),
    dish('dish_4', '限量菜', 12, { stock: 1 }),
    dish('dish_5', '第二份菜', 15, { stock: 10 }),
    dish('dish_6', '备用菜', 5, { stock: 100 })
  ]
}

function scenario(opts) {
  const options = opts || {}
  return createScenario({
    fn: 'submitOrder',
    openid: options.openid === undefined ? BUYER_OPENID : options.openid,
    seed: {
      employees: options.employees === undefined ? [buyer()] : options.employees,
      dishes: options.dishes === undefined ? defaultDishes() : options.dishes,
      settings: options.settings === undefined ? [{ _id: 'settings_main', storeName: '企业餐厅' }] : options.settings
    },
    env: options.env || {},
    templates: options.templates === undefined ? TEMPLATES : options.templates,
    templateListError: options.templateListError,
    sendError: options.sendError
  })
}

function pickupItems(dishId, qty, extra) {
  return [Object.assign({ dishId: dishId, qty: qty }, extra || {})]
}

// ---------------- 自检 / 参数校验 ----------------
test('submitOrder: action=ping 直接返回 pong，不校验身份', async () => {
  const s = scenario({ employees: [] })
  const res = await s.call({ action: 'ping' })
  assert.equal(res.ok, true)
  assert.equal(res.data.pong, true)
  assert.equal(res.data.fn, 'submitOrder')
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 配送方式非法返回 ok:false 且不写库', async () => {
  for (const type of ['dinein', '', undefined, null]) {
    const s = scenario()
    const res = await s.call({ type: type, items: pickupItems('dish_1', 1) })
    assert.equal(res.ok, false, 'type=' + String(type))
    assert.match(res.message, /配送方式不合法/)
    assert.equal(s.count('orders'), 0)
  }
})

test('submitOrder: 未选菜品返回 ok:false', async () => {
  for (const items of [[], undefined, 'not-array']) {
    const s = scenario()
    const res = await s.call({ type: 'pickup', items: items })
    assert.equal(res.ok, false)
    assert.match(res.message, /请选择至少一个菜品/)
  }
})

test('submitOrder: 未绑定员工档案返回 ok:false 且不写库', async () => {
  const s = scenario({ employees: [] })
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /请先绑定员工档案再下单/)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 员工查询数据库异常返回 ok:false', async () => {
  const s = scenario()
  s.mock.failNext('employees', 'get', new Error('employee db down'))
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /employee db down/)
})

// ---------------- 成功下单 ----------------
test('submitOrder: 自取下单成功——订单落库、库存扣减、返回单号/取餐号/金额', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 2) })
  assert.equal(res.ok, true)
  assert.ok(res.data.orderId)
  assert.match(res.data.orderNo, /^O\d+$/)
  assert.equal(res.data.pickupNo, 1)
  assert.equal(res.data.total, 56)

  // 库存扣减（事务提交）
  assert.equal(s.doc('dishes', 'dish_1').stock, 8)

  // 订单字段
  const order = s.doc('orders', res.data.orderId)
  assert.ok(order)
  assert.equal(order.orderNo, res.data.orderNo)
  assert.equal(order.openid, BUYER_OPENID)
  assert.equal(order.type, 'pickup')
  assert.equal(order.status, 'pending')
  assert.equal(order.total, 56)
  assert.equal(order.pickupNo, 1)
  assert.deepEqual(order.buyer, { empNo: 'E1001', name: '张三', dept: '技术部', location: '1号楼-3层' })
  assert.deepEqual(order.items, [{ dishId: 'dish_1', name: '黑椒牛柳饭', price: 28, spec: '', extras: [], qty: 2 }])
  assert.deepEqual(order.delivery, { target: '', note: '' })
  assert.equal(order.statusHistory.length, 1)
  assert.equal(order.statusHistory[0].status, 'pending')
  assert.equal(order.statusHistory[0].note, '已下单')
  assert.ok(order.statusHistory[0].time instanceof Date)
  assert.ok(order.createdAt instanceof Date)
  assert.ok(order.updatedAt instanceof Date)
})

test('submitOrder: 规格与加料价格累加；未知加料不加价但保留', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: [{ dishId: 'dish_1', qty: 1, spec: '大份', extras: ['加蛋', '加辣', '芝士'] }]
  })
  assert.equal(res.ok, true)
  // 28 + 5(大份) + 2(加蛋) + 0(加辣) + 0(未知加料)
  assert.equal(res.data.total, 35)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.items[0].price, 35)
  assert.equal(order.items[0].spec, '大份')
  assert.deepEqual(order.items[0].extras, ['加蛋', '加辣', '芝士'])
})

test('submitOrder: 未知规格按原价计费但保留 spec 文本', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: [{ dishId: 'dish_1', qty: 1, spec: '超大份' }]
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 28)
  assert.equal(s.doc('orders', res.data.orderId).items[0].spec, '超大份')
})

test('submitOrder: qty 非法（0/负数/非数字）按 1 件处理', async () => {
  for (const qty of [0, -3, 'abc', null]) {
    const s = scenario()
    const res = await s.call({ type: 'pickup', items: [{ dishId: 'dish_1', qty: qty }] })
    assert.equal(res.ok, true, 'qty=' + String(qty))
    assert.equal(res.data.total, 28)
    assert.equal(s.doc('dishes', 'dish_1').stock, 9)
  }
})

test('submitOrder: 不限库存（stock=null）不扣库存', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_2', 5) })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 50)
  assert.equal(s.doc('dishes', 'dish_2').stock, null)
})

test('submitOrder: 配送单记录 target/note（event.note 优先于 delivery.note）', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'delivery',
    items: pickupItems('dish_1', 1),
    delivery: { target: '1号楼-3层-前台', note: '抽纸一份' },
    note: '不要辣'
  })
  assert.equal(res.ok, true)
  const order = s.doc('orders', res.data.orderId)
  assert.equal(order.type, 'delivery')
  assert.equal(order.delivery.target, '1号楼-3层-前台')
  assert.equal(order.delivery.note, '不要辣')
})

test('submitOrder: delivery.note 在 event.note 为空时生效', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'delivery',
    items: pickupItems('dish_1', 1),
    delivery: { target: '2号楼', note: '少放盐' }
  })
  assert.equal(s.doc('orders', res.data.orderId).delivery.note, '少放盐')
})

test('submitOrder: 取餐号 = 今日已有订单数 + 1（昨日订单不计入）', async () => {
  const s = scenario()
  s.mock.insert('orders', [
    { _id: 'old_today', createdAt: new Date(), status: 'pending', total: 1 },
    { _id: 'old_yesterday', createdAt: new Date(Date.now() - 24 * 3600 * 1000), status: 'pending', total: 1 }
  ])
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, true)
  assert.equal(res.data.pickupNo, 2)
  assert.equal(s.count('orders'), 3)
})

// ---------------- 失败与事务回滚 ----------------
test('submitOrder: 菜品不存在返回 ok:false，事务回滚（库存全部不变）', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: [{ dishId: 'dish_1', qty: 1 }, { dishId: 'dish_missing', qty: 1 }]
  })
  assert.equal(res.ok, false)
  assert.match(res.message, /菜品不存在/)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10, '回滚后库存应恢复')
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 菜品下架返回 ok:false 且提示菜名，不写订单', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_3', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /菜品【下架菜】已下架/)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 库存不足返回 ok:false，且前面菜品已扣的库存被回滚', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: [{ dishId: 'dish_1', qty: 2 }, { dishId: 'dish_4', qty: 2 }]
  })
  assert.equal(res.ok, false)
  assert.match(res.message, /菜品【限量菜】库存不足/)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10, '第一件菜品的扣减应随事务回滚')
  assert.equal(s.doc('dishes', 'dish_4').stock, 1)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 菜品缺少 dishId 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: [{ qty: 1 }] })
  assert.equal(res.ok, false)
  assert.match(res.message, /菜品缺少 dishId/)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 事务内读取菜品抛错时返回 ok:false 并回滚', async () => {
  const s = scenario()
  s.mock.failNext('dishes', 'txGet', new Error('tx read fail'))
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /tx read fail/)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 事务提交失败返回 ok:false，不产生订单', async () => {
  const s = scenario()
  s.mock.failNext('*', 'commit', new Error('commit fail'))
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /commit fail/)
  assert.equal(s.count('orders'), 0)
})

test('submitOrder: 统计当日订单数失败返回 ok:false 并回滚库存', async () => {
  const s = scenario()
  s.mock.failNext('orders', 'count', new Error('count fail'))
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, false)
  assert.match(res.message, /count fail/)
  assert.equal(s.doc('dishes', 'dish_1').stock, 10)
  assert.equal(s.count('orders'), 0)
})

// ---------------- 订阅消息 ----------------
test('submitOrder: 未配置下单模板时不调用订阅消息接口，下单仍成功', async () => {
  const s = scenario()
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.getTemplateList.length, 0)
  assert.equal(s.mock.openapi.calls.send.length, 0)
})

test('submitOrder: 配置模板后按中文标签自动映射并发送一次下单通知', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: pickupItems('dish_1', 1),
    subscribeTemplateIds: { orderPlaced: ADMIN_TPL }
  })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.getTemplateList.length, 1)
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const sent = s.mock.openapi.calls.send[0]
  assert.equal(sent.touser, BUYER_OPENID)
  assert.equal(sent.templateId, ADMIN_TPL)
  assert.equal(sent.page, 'pages/order-detail/order-detail?id=' + res.data.orderId)
  assert.equal(sent.miniprogramState, 'formal')
  assert.equal(sent.data.thing1.value, '企业餐厅')
  assert.equal(sent.data.character_string2.value, res.data.orderNo)
  assert.equal(sent.data.amount3.value, '¥28.00')
  assert.match(sent.data.time4.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.match(sent.data.thing5.value, /已收到订单/)
})

test('submitOrder: 模板列表读取失败时用 fallbackMap 兜底发送', async () => {
  const s = scenario({ templateListError: new Error('openapi down'), settings: [{ _id: 'settings_main', storeName: '测试餐厅' }] })
  const res = await s.call({
    type: 'delivery',
    items: pickupItems('dish_1', 1),
    subscribeTemplateIds: { orderPlaced: ADMIN_TPL }
  })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const data = s.mock.openapi.calls.send[0].data
  assert.deepEqual(Object.keys(data).sort(), ['amount3', 'character_string2', 'thing1', 'thing5', 'time4'].sort())
  assert.equal(data.thing1.value, '测试餐厅')
  assert.equal(data.amount3.value, '¥28.00')
})

test('submitOrder: 模板 ID 配错（账号模板列表里没有）时静默跳过发送', async () => {
  const s = scenario()
  const res = await s.call({
    type: 'pickup',
    items: pickupItems('dish_1', 1),
    subscribeTemplateIds: { orderPlaced: 'TPL_WRONG_NOT_IN_LIST' }
  })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.getTemplateList.length, 1)
  assert.equal(s.mock.openapi.calls.send.length, 0)
})

test('submitOrder: 订阅消息发送失败不影响下单结果', async () => {
  const s = scenario({ sendError: Object.assign(new Error('send failed'), { errCode: 43101 }) })
  const res = await s.call({
    type: 'pickup',
    items: pickupItems('dish_1', 1),
    subscribeTemplateIds: { orderPlaced: ADMIN_TPL }
  })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.send.length, 1)
  assert.equal(s.count('orders'), 1)
  assert.equal(s.doc('dishes', 'dish_1').stock, 9)
})

test('submitOrder: 通过环境变量 ORDER_PLACED_TEMPLATE_ID 配置模板', async () => {
  const s = scenario({ env: { ORDER_PLACED_TEMPLATE_ID: ADMIN_TPL } })
  const res = await s.call({ type: 'pickup', items: pickupItems('dish_1', 1) })
  assert.equal(res.ok, true)
  assert.equal(s.mock.openapi.calls.send.length, 1)
  assert.equal(s.mock.openapi.calls.send[0].templateId, ADMIN_TPL)
})
