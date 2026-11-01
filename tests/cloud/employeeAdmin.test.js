'use strict'

/**
 * cloudfunctions/employeeAdmin —— 员工绑定管理（列表搜索分页 + 解绑）
 * 鉴权：adminToken 命中 admin_sessions 且未过期（verifyAdmin 会 trim）。
 * 运行：node --test tests/cloud/employeeAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_employee_admin'

function employee(id, empNo, name, extra) {
  return Object.assign({
    _id: id,
    openid: 'openid_' + id,
    empNo: empNo,
    name: name,
    dept: '技术部',
    location: '1号楼',
    admin: false,
    createdAt: new Date('2026-10-01T10:00:00+08:00')
  }, extra || {})
}

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  if (!seed.admin_sessions) {
    seed.admin_sessions = [makeSession({ token: TOKEN, openid: 'openid_admin', expireAt: Date.now() + 60 * 60 * 1000 })]
  }
  return createScenario({ fn: 'employeeAdmin', openid: 'openid_admin', seed: seed })
}

function callAs(s, event) {
  return s.call(Object.assign({ adminToken: TOKEN }, event || {}))
}

// ---------------- 鉴权 ----------------
test('employeeAdmin: 无 token / 无效 token / 过期 token / 鉴权库异常均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'list' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /管理登录已失效|重新/)

  s = scenario()
  res = await s.call({ action: 'list', adminToken: 'tok_nope' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')

  s = createScenario({
    fn: 'employeeAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')

  s = scenario()
  s.mock.failNext('admin_sessions', 'get', new Error('auth db down'))
  res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('employeeAdmin: adminToken 首尾空白会被 trim（与其他管理云函数不同）', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  const res = await s.call({ action: 'list', adminToken: '  ' + TOKEN + '  ' })
  assert.equal(res.ok, true)
  assert.equal(res.data.list.length, 1)
})

// ---------------- list：默认分页 / 排序 / 掩码 ----------------
test('employeeAdmin/list: 默认 page=1/pageSize=20，createdAt 倒序，返回 openid 掩码', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee('e1', 'A1', '张三', { createdAt: new Date('2026-10-01T10:00:00+08:00'), openid: 'oABCDEFGHIJKLMNOP' }),
        employee('e2', 'A2', '李四', { createdAt: new Date('2026-10-02T10:00:00+08:00') }),
        employee('e3', 'A3', '王五', { createdAt: new Date('2026-10-03T10:00:00+08:00') })
      ]
    }
  })
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['e3', 'e2', 'e1'])
  assert.equal(res.data.total, 3)
  assert.equal(res.data.page, 1)
  assert.equal(res.data.pageSize, 20)
  assert.equal(res.data.fallback, false)
  const first = res.data.list.filter(function (d) { return d._id === 'e1' })[0]
  assert.equal(first.empNo, 'A1')
  assert.equal(first.name, '张三')
  assert.equal(first.dept, '技术部')
  assert.equal(first.location, '1号楼')
  assert.equal(first.admin, false)
  assert.ok(first.createdAt instanceof Date, 'createdAt 应为 Date（云数据库 Date 字段）')
  assert.equal(first.createdAt.getTime(), new Date('2026-10-01T10:00:00+08:00').getTime())
  assert.equal(first.openidMask, 'oABCDE****MNOP')
})

test('employeeAdmin/list: 分页 skip/limit 正确（25 条 -> 第 1 页 20、第 2 页 5）', async () => {
  const list = []
  for (let i = 1; i <= 25; i += 1) {
    list.push(employee('e' + i, 'E' + String(i).padStart(3, '0'), '员工' + i, {
      createdAt: new Date(2026, 9, 1, 10, 0, i)
    }))
  }
  const s = scenario({ seed: { employees: list } })
  let res = await callAs(s, { action: 'list' })
  assert.equal(res.data.list.length, 20)
  assert.equal(res.data.total, 25)
  assert.equal(res.data.list[0]._id, 'e25')

  res = await callAs(s, { action: 'list', page: 2 })
  assert.equal(res.data.list.length, 5)
  assert.equal(res.data.page, 2)
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['e5', 'e4', 'e3', 'e2', 'e1'])
})

test('employeeAdmin/list: pageSize 上限 50，非法 page/pageSize 回落默认值', async () => {
  const list = []
  for (let i = 1; i <= 60; i += 1) list.push(employee('e' + i, 'E' + i, '员工' + i))
  const s = scenario({ seed: { employees: list } })

  let res = await callAs(s, { action: 'list', pageSize: 999 })
  assert.equal(res.data.pageSize, 50)
  assert.equal(res.data.list.length, 50)

  res = await callAs(s, { action: 'list', pageSize: 'abc', page: 'xyz' })
  assert.equal(res.data.pageSize, 20)
  assert.equal(res.data.page, 1)

  res = await callAs(s, { action: 'list', page: 0, pageSize: 0 })
  assert.equal(res.data.page, 1)
  assert.equal(res.data.pageSize, 20)
})

// ---------------- list：搜索 ----------------
test('employeeAdmin/list: keyword 对工号/姓名/科室模糊匹配且不区分大小写', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee('e1', 'A100', '张三', { dept: '技术部' }),
        employee('e2', 'B200', '李四', { dept: '市场部' }),
        employee('e3', 'C300', '王五', { dept: '技术部' })
      ]
    }
  })
  let res = await callAs(s, { action: 'list', keyword: 'a1' })
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['e1'])

  res = await callAs(s, { action: 'list', keyword: '李四' })
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['e2'])

  res = await callAs(s, { action: 'list', keyword: '技术部' })
  assert.deepEqual(res.data.list.map(function (d) { return d._id }).sort(), ['e1', 'e3'])
  assert.equal(res.data.total, 2)
})

test('employeeAdmin/list: keyword 正则元字符被转义（A.B 只匹配字面量）', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee('dot', 'A.B', '点号工号'),
        employee('star', 'AXB', 'X 工号')
      ]
    }
  })
  const res = await callAs(s, { action: 'list', keyword: 'A.B' })
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['dot'])
  assert.equal(res.data.total, 1)
})

test('employeeAdmin/list: 旧数据 empNo 为数字时按关键字也能搜到', async () => {
  const s = scenario({ seed: { employees: [employee('num', 1001, '王五')] } })
  const res = await callAs(s, { action: 'list', keyword: '1001' })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 1)
  assert.equal(res.data.list[0]._id, 'num')
  assert.equal(res.data.list[0].empNo, '1001')
})

test('employeeAdmin/list: 正则搜不到时用 loose 兜底扫描找「幽灵记录」（全角/空格/零宽）', async () => {
  const s = scenario({
    seed: {
      employees: [employee('ghost', 'Ｔ 0001\u200B', '幽灵员工')]
    }
  })
  const res = await callAs(s, { action: 'list', keyword: 'T0001' })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 1)
  assert.equal(res.data.fallback, true)
  assert.equal(res.data.list[0]._id, 'ghost')
  assert.equal(res.data.list[0].empNo, 'Ｔ 0001\u200B')
})

test('employeeAdmin/list: 搜索无结果时返回空列表（total=0, fallback=false）', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  const res = await callAs(s, { action: 'list', keyword: '不存在关键字' })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 0)
  assert.deepEqual(res.data.list, [])
  assert.equal(res.data.fallback, false)
})

test('employeeAdmin/list: 老档案缺 createdAt 时 orderBy 漏行，fallbackRaw 兜底返回', async () => {
  const s = scenario({
    seed: {
      employees: [{ _id: 'legacy', openid: 'openid_legacy', empNo: 'L1', name: '老档案', dept: '技术部' }]
    }
  })
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 1)
  assert.deepEqual(res.data.list.map(function (d) { return d._id }), ['legacy'])
  assert.match(s.logs().join('\n'), /fallback-raw/)
})

test('employeeAdmin/list: 数据库异常返回 INTERNAL_ERROR', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  s.mock.failNext('employees', 'count', new Error('count fail'))
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'INTERNAL_ERROR')
  assert.match(res.message, /^操作失败：/)
  assert.match(res.message, /count fail/)
})

// ---------------- release ----------------
test('employeeAdmin/release: 缺少 employeeId 与 empNo 返回 PARAM_EMPTY', async () => {
  const s = scenario()
  const res = await callAs(s, { action: 'release' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PARAM_EMPTY')
  assert.match(res.message, /缺少 employeeId 或 empNo/)
})

test('employeeAdmin/release: 按 employeeId 解绑并返回 empNo/name', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  const res = await callAs(s, { action: 'release', employeeId: 'e1' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data, { empNo: 'A1', name: '张三', removed: 1 })
  assert.equal(s.count('employees'), 0)
  assert.match(s.logs().join('\n'), /\[employeeAdmin\] release/)
})

test('employeeAdmin/release: 按 empNo 解绑所有同工号重复档案（含数字旧数据）', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee('e1', 'A1', '张三', { openid: 'openid_a' }),
        employee('e2', 'A1', '张三(重复)', { openid: 'openid_b' }),
        employee('e3', 1001, '数字工号')
      ]
    }
  })
  let res = await callAs(s, { action: 'release', empNo: ' A1 ' })
  assert.equal(res.ok, true)
  assert.equal(res.data.removed, 2)
  assert.equal(res.data.empNo, 'A1')
  assert.equal(s.count('employees'), 1)

  res = await callAs(s, { action: 'release', empNo: '1001' })
  assert.equal(res.ok, true)
  assert.equal(res.data.removed, 1)
  assert.equal(res.count, undefined)
  assert.equal(s.count('employees'), 0)
})

test('employeeAdmin/release: 找不到记录返回 NOT_FOUND', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  let res = await callAs(s, { action: 'release', employeeId: 'missing' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NOT_FOUND')
  assert.match(res.message, /未找到该员工的绑定记录/)

  res = await callAs(s, { action: 'release', empNo: 'NOPE' })
  assert.equal(res.code, 'NOT_FOUND')
})

test('employeeAdmin/release: employeeId 查不到时回退按 empNo 删除', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  const res = await callAs(s, { action: 'release', employeeId: 'missing', empNo: 'A1' })
  assert.equal(res.ok, true)
  assert.equal(res.data.removed, 1)
  assert.equal(s.doc('employees', 'e1'), null)
})

test('employeeAdmin/release: 删除失败返回 RELEASE_FAILED', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三')] } })
  s.mock.failNext('employees', 'docRemove', new Error('remove fail'))
  const res = await callAs(s, { action: 'release', employeeId: 'e1' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'RELEASE_FAILED')
  assert.match(res.message, /解绑失败/)
  assert.equal(s.count('employees'), 1, '删除失败时记录仍在')
})

// ---------------- 其它 ----------------
test('employeeAdmin: 未知操作返回 ok:false 且带操作名', async () => {
  const s = scenario()
  const res = await callAs(s, { action: 'export-all' })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知操作：export-all/)
})

test('employeeAdmin/list: openid 长度 <= 10 时掩码原样返回', async () => {
  const s = scenario({ seed: { employees: [employee('e1', 'A1', '张三', { openid: 'shortid' })] } })
  const res = await callAs(s, { action: 'list' })
  assert.equal(res.data.list[0].openidMask, 'shortid')
})
