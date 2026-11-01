'use strict'

/**
 * cloudfunctions/deptAdmin —— 科室管理
 * 公开 action：list（启用、非根节点，无需登录）
 * 管理 action：adminList/create/update/toggle/delete（必须 adminToken）
 * 运行：node --test tests/cloud/deptAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_dept_admin'

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({ fn: 'deptAdmin', openid: 'openid_admin', seed: seed })
}

function dept(id, code, name, extra) {
  return Object.assign({
    _id: id,
    code: code,
    name: name,
    pinyin: '',
    parentCode: null,
    rootCode: null,
    rootName: '',
    rootSort: 999,
    level: 1,
    isRoot: false,
    sort: 999999,
    enabled: true,
    usage: []
  }, extra || {})
}

function rootDept(code, name, sort, extra) {
  return dept('ks_' + code, code, name, Object.assign({ isRoot: true, sort: sort, rootSort: sort }, extra || {}))
}

// ---------------- 公开 list ----------------
test('deptAdmin/list: 无需登录即可返回启用且非根节点的科室', async () => {
  const s = scenario({
    seed: {
      departments: [
        rootDept(1, '技术中心', 1),
        dept('ks_2', 2, '技术部', { rootCode: 1, rootName: '技术中心', rootSort: 1, sort: 2 }),
        dept('ks_3', 3, '停用科室', { enabled: false, rootCode: 1, rootSort: 1, sort: 3 }),
        dept('ks_4', 4, '产品部', { rootCode: 1, rootName: '技术中心', rootSort: 1, sort: 1 })
      ]
    }
  })
  // 不带 adminToken 也应当成功
  const res = await s.call({ action: 'list' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['ks_4', 'ks_2'])
  assert.ok(res.data.every(function (d) { return d.isRoot !== true }), '不应包含分类根节点')
})

test('deptAdmin/list: 排序规则 rootSort -> isRoot -> sort -> pinyin/name', async () => {
  const s = scenario({
    seed: {
      departments: [
        dept('a', 10, '乙科室', { rootSort: 2, sort: 1, pinyin: 'YI' }),
        dept('b', 11, '甲科室', { rootSort: 2, sort: 1, pinyin: 'JIA' }),
        dept('c', 12, '丙科室', { rootSort: 1, sort: 9, pinyin: 'BING' }),
        dept('d', 13, '丁科室', { rootSort: 2, sort: 0, pinyin: 'DING' }),
        rootDept(1, '技术中心', 1)
      ]
    }
  })
  const res = await s.call({ action: 'list' })
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['c', 'd', 'b', 'a'])
})

test('deptAdmin/list: 超过 100 条时通过分页拉全（fetchAll）', async () => {
  const list = []
  for (let i = 1; i <= 120; i += 1) {
    list.push(dept('ks_' + i, i, '科室' + String(i).padStart(3, '0'), { sort: i }))
  }
  const s = scenario({ seed: { departments: list } })
  const res = await s.call({ action: 'list' })
  assert.equal(res.ok, true)
  assert.equal(res.data.length, 120)
})

test('deptAdmin/list: 数据库异常返回 ok:false', async () => {
  const s = scenario()
  s.mock.failNext('departments', 'get', new Error('dept db down'))
  const res = await s.call({ action: 'list' })
  assert.equal(res.ok, false)
  assert.match(res.message, /dept db down/)
})

// ---------------- 鉴权 ----------------
test('deptAdmin: 管理 action 无 token / 过期 token 均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'adminList' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = createScenario({
    fn: 'deptAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ action: 'create', name: '新科室', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期/)
})

test('deptAdmin/adminList: 有 token 时返回全部科室（含停用、含根节点）', async () => {
  const s = scenario({
    seed: {
      departments: [
        rootDept(1, '技术中心', 1),
        dept('ks_2', 2, '技术部', { enabled: true, rootSort: 1, sort: 2 }),
        dept('ks_3', 3, '停用科室', { enabled: false, rootSort: 1, sort: 3 })
      ]
    }
  })
  const res = await s.call({ action: 'adminList', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.length, 3)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['ks_1', 'ks_2', 'ks_3'])
})

// ---------------- create ----------------
test('deptAdmin/create: 空名称返回 ok:false 且不写库', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '   ', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /科室名称不能为空/)
  assert.equal(s.count('departments'), 0)
})

test('deptAdmin/create: code 取现有最大值 +1，id 为 ks_<code>，写入数据库', async () => {
  const s = scenario({
    seed: {
      departments: [rootDept(3, '技术中心', 1), dept('ks_5', 5, '老科室', { sort: 1 })]
    }
  })
  const res = await s.call({
    action: 'create',
    name: '新科室',
    pinyin: 'xin',
    rootCode: 3,
    sort: 2,
    usage: ['pickup'],
    adminToken: TOKEN
  })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'ks_6')
  assert.equal(res.data.code, 6)
  assert.equal(res.data.name, '新科室')
  assert.equal(res.data.pinyin, 'XIN')
  assert.equal(res.data.level, 1)
  assert.equal(res.data.isRoot, false)
  assert.equal(res.data.enabled, true)
  assert.equal(res.data.sort, 2)
  assert.equal(res.data.parentCode, 3)
  assert.equal(res.data.rootCode, 3)
  assert.equal(res.data.rootName, '技术中心')
  assert.equal(res.data.rootSort, 1)
  assert.deepEqual(res.data.usage, ['pickup'])
  const saved = s.doc('departments', 'ks_6')
  assert.equal(saved.name, '新科室')
  assert.ok(saved.createdAt instanceof Date)
})

test('deptAdmin/create: 未传 rootCode 时归入「其他」，enabled 可显式关闭', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '其他科室', enabled: false, adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.code, 1)
  assert.equal(res.data.rootCode, null)
  assert.equal(res.data.parentCode, null)
  assert.equal(res.data.rootName, '其他')
  assert.equal(res.data.rootSort, 999)
  assert.equal(res.data.enabled, false)
  assert.equal(res.data.sort, 999999)
})

// ---------------- update / toggle / delete ----------------
test('deptAdmin/update: 局部更新 name/pinyin/sort/enabled；rootCode 变更会同步 rootName', async () => {
  const s = scenario({
    seed: {
      departments: [
        rootDept(1, '技术中心', 1),
        rootDept(2, '市场中心', 2),
        dept('ks_9', 9, '旧名称', { pinyin: 'JIU', sort: 5, enabled: true, rootCode: 1, rootName: '技术中心', rootSort: 1 })
      ]
    }
  })
  const res = await s.call({
    action: 'update',
    id: 'ks_9',
    name: '  新名称  ',
    pinyin: 'xin',
    sort: '7',
    enabled: false,
    rootCode: 2,
    adminToken: TOKEN
  })
  assert.deepEqual(res, { ok: true })
  const saved = s.doc('departments', 'ks_9')
  assert.equal(saved.name, '新名称')
  assert.equal(saved.pinyin, 'XIN')
  assert.equal(saved.sort, 7)
  assert.equal(saved.enabled, false)
  assert.equal(saved.rootCode, 2)
  assert.equal(saved.rootName, '市场中心')
  assert.equal(saved.rootSort, 2)
})

test('deptAdmin/update: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'update', name: 'x', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 id/)
})

test('deptAdmin/toggle: 显式 enabled 与取反两种语义', async () => {
  const s = scenario({
    seed: {
      departments: [
        dept('on', 1, '启用科室', { enabled: true }),
        dept('off', 2, '停用科室', { enabled: false })
      ]
    }
  })
  let res = await s.call({ action: 'toggle', id: 'on', enabled: false, adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { enabled: false } })
  assert.equal(s.doc('departments', 'on').enabled, false)

  res = await s.call({ action: 'toggle', id: 'off', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { enabled: true } })
  assert.equal(s.doc('departments', 'off').enabled, true)
})

test('deptAdmin/toggle: 缺少 id 或 id 不存在时返回 ok:false', async () => {
  const s = scenario()
  let res = await s.call({ action: 'toggle', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 id/)

  res = await s.call({ action: 'toggle', id: 'missing', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /does not exist|操作失败/)
})

test('deptAdmin/delete: 物理删除；缺少 id 报错', async () => {
  const s = scenario({ seed: { departments: [dept('ks_1', 1, '待删科室')] } })
  let res = await s.call({ action: 'delete', id: 'ks_1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true })
  assert.equal(s.doc('departments', 'ks_1'), null)

  res = await s.call({ action: 'delete', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少 id/)
})

test('deptAdmin: 未知管理 action 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'merge', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知操作/)
})
