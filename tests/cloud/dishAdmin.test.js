'use strict'

/**
 * cloudfunctions/dishAdmin —— 菜品管理（list/get/create/update/toggle/delete）
 * 鉴权：event.adminToken 命中 admin_sessions 且未过期
 * 运行：node --test tests/cloud/dishAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_dish_admin'

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({
    fn: 'dishAdmin',
    openid: 'openid_admin',
    seed: seed
  })
}

function dish(id, sort, extra) {
  return Object.assign({
    _id: id,
    categoryId: 'cat_1',
    name: '菜品' + id,
    desc: '',
    image: '',
    price: 10,
    specs: [],
    extras: [],
    stock: 100,
    unit: '份',
    sort: sort,
    available: true
  }, extra || {})
}

// ---------------- 鉴权 ----------------
test('dishAdmin: 无 adminToken 时提示先登录，无效 token 时提示重新登录，均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'list' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = scenario()
  res = await s.call({ action: 'list', adminToken: 'tok_nope' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期|重新登录/)
})

test('dishAdmin: 过期 token 返回 NEED_ADMIN_LOGIN 且提示重新登录', async () => {
  const s = createScenario({
    fn: 'dishAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  const res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期|重新登录/)
})

test('dishAdmin: 鉴权查询数据库异常时也返回 NEED_ADMIN_LOGIN', async () => {
  const s = scenario()
  s.mock.failNext('admin_sessions', 'get', new Error('auth db down'))
  const res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

// ---------------- list / get ----------------
test('dishAdmin/list: 有 token 时返回按 sort 升序的全部菜品', async () => {
  const s = scenario({
    seed: { dishes: [dish('d2', 2), dish('d1', 1), dish('d3', 3)] }
  })
  const res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['d1', 'd2', 'd3'])
})

test('dishAdmin/list: 数据库异常返回 ok:false', async () => {
  const s = scenario()
  s.mock.failNext('dishes', 'get', new Error('dishes get fail'))
  const res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /dishes get fail/)
})

test('dishAdmin/get: 兼容 dishId 与 _id 两种入参', async () => {
  const d = dish('d1', 1)
  const s = scenario({ seed: { dishes: [d] } })
  let res = await s.call({ action: 'get', dishId: 'd1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: d })
  res = await s.call({ action: 'get', _id: 'd1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: d })
})

test('dishAdmin/get: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少菜品 id/)
})

// ---------------- create ----------------
test('dishAdmin/create: 缺省字段补默认值并写入数据库', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '宫保鸡丁', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.ok(res.data._id, '应返回 _id')
  assert.equal(res.data.name, '宫保鸡丁')
  assert.equal(res.data.categoryId, '')
  assert.equal(res.data.price, 0)
  assert.equal(res.data.stock, null)
  assert.equal(res.data.unit, '份')
  assert.equal(res.data.sort, 0)
  assert.equal(res.data.available, true)
  assert.deepEqual(res.data.specs, [])
  assert.deepEqual(res.data.extras, [])
  const saved = s.doc('dishes', res.data._id)
  assert.equal(saved.name, '宫保鸡丁')
  assert.ok(saved.createdAt instanceof Date, 'createdAt 由 serverDate 落成 Date')
})

test('dishAdmin/create: 数值字符串会被转成数字，stock=0 表示售罄而非 unlimited', async () => {
  const s = scenario()
  const res = await s.call({
    action: 'create',
    name: '可乐',
    price: '3.5',
    stock: '0',
    sort: '9',
    categoryId: 'cat_4',
    available: false,
    adminToken: TOKEN
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.price, 3.5)
  assert.equal(res.data.stock, 0)
  assert.equal(res.data.sort, 9)
  assert.equal(res.data.available, false)
})

test('dishAdmin/create: 非法数值回落默认值 0', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '测试菜', price: 'abc', sort: null, adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.price, 0)
  assert.equal(res.data.sort, 0)
})

test('dishAdmin/create: 菜品名为空返回 ok:false 且不写库', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /菜品名不能为空/)
  assert.equal(s.count('dishes'), 0)
})

// ---------------- update / toggle / delete ----------------
test('dishAdmin/update: 只更新传入字段，其余字段保持不变', async () => {
  const original = dish('d1', 1, { desc: '原描述', stock: 20 })
  const s = scenario({ seed: { dishes: [original] } })
  const res = await s.call({ action: 'update', dishId: 'd1', name: '新菜名', price: '18.8', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'd1' } })
  const saved = s.doc('dishes', 'd1')
  assert.equal(saved.name, '新菜名')
  assert.equal(saved.price, 18.8)
  assert.equal(saved.desc, '原描述')
  assert.equal(saved.stock, 20)
  assert.equal(saved.sort, 1)
})

test('dishAdmin/update: stock=null 表示不限库存', async () => {
  const s = scenario({ seed: { dishes: [dish('d1', 1, { stock: 20 })] } })
  await s.call({ action: 'update', dishId: 'd1', stock: null, adminToken: TOKEN })
  assert.equal(s.doc('dishes', 'd1').stock, null)
})

test('dishAdmin/update: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'update', name: 'x', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少菜品 id/)
})

test('dishAdmin/toggle: 显式 available 时按入参设置', async () => {
  const s = scenario({ seed: { dishes: [dish('d1', 1, { available: true })] } })
  let res = await s.call({ action: 'toggle', dishId: 'd1', available: false, adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'd1', available: false } })
  assert.equal(s.doc('dishes', 'd1').available, false)

  res = await s.call({ action: 'toggle', dishId: 'd1', available: true, adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'd1', available: true } })
})

test('dishAdmin/toggle: 未传 available 时按当前值取反', async () => {
  const s = scenario({ seed: { dishes: [dish('on', 1, { available: true }), dish('off', 2, { available: false })] } })
  let res = await s.call({ action: 'toggle', dishId: 'on', adminToken: TOKEN })
  assert.equal(res.data.available, false)
  assert.equal(s.doc('dishes', 'on').available, false)
  res = await s.call({ action: 'toggle', dishId: 'off', adminToken: TOKEN })
  assert.equal(res.data.available, true)
  assert.equal(s.doc('dishes', 'off').available, true)
})

test('dishAdmin/toggle: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'toggle', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少菜品 id/)
})

test('dishAdmin/delete: 软删除（置 available=false，记录仍在）', async () => {
  const s = scenario({ seed: { dishes: [dish('d1', 1, { available: true })] } })
  const res = await s.call({ action: 'delete', dishId: 'd1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'd1' } })
  const saved = s.doc('dishes', 'd1')
  assert.ok(saved, '记录不应被物理删除')
  assert.equal(saved.available, false)
})

test('dishAdmin/delete: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'delete', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少菜品 id/)
})

test('dishAdmin: 未知 action 返回 ok:false 且带 action 名', async () => {
  const s = scenario()
  const res = await s.call({ action: 'nuke', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: nuke/)
})
