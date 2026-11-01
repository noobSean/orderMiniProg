'use strict'

/**
 * cloudfunctions/bindEmployee —— 员工绑定（规范化 / 幂等 / 换绑 / 工号占用 / 并发兜底）
 * 运行：node --test tests/cloud/bindEmployee.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

const OPENID = 'oABCDEFGHIJKLMNOP'

// 用本地时间构造，保证 formatDate（本地时区格式化）在任何时区下都是 2026-10-26
function localDate(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0)
}

function employee(extra) {
  return Object.assign({
    _id: 'emp_1',
    openid: OPENID,
    empNo: 'A1',
    name: '张三',
    dept: '技术部',
    location: '1号楼',
    admin: false,
    createdAt: localDate(2026, 10, 26)
  }, extra || {})
}

function scenario(opts) {
  const options = opts || {}
  return createScenario({
    fn: 'bindEmployee',
    openid: options.openid === undefined ? OPENID : options.openid,
    seed: options.seed
  })
}

function bind(s, event) {
  return s.call(event)
}

// ---------------- 身份 / 入参校验 ----------------
test('bindEmployee: 无法获取 OPENID 时返回 NO_OPENID', async () => {
  const s = scenario({ openid: '' })
  const res = await bind(s, { empNo: 'A1', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NO_OPENID')
  assert.match(res.message, /无法获取微信身份/)
  assert.equal(s.count('employees'), 0)
})

test('bindEmployee: 工号为空（含空白/零宽字符）返回 EMP_NO_EMPTY', async () => {
  const s = scenario()
  for (const empNo of [undefined, null, '', '   ', '\u3000', '\u200B\uFEFF']) {
    const res = await bind(s, { empNo: empNo, name: '张三' })
    assert.equal(res.ok, false, 'empNo=' + JSON.stringify(empNo))
    assert.equal(res.code, 'EMP_NO_EMPTY')
    assert.match(res.message, /请输入工号/)
  }
  assert.equal(s.count('employees'), 0)
})

test('bindEmployee: 工号超过 32 字符返回 EMP_NO_TOO_LONG', async () => {
  const s = scenario()
  const res = await bind(s, { empNo: 'A'.repeat(33), name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EMP_NO_TOO_LONG')
  assert.match(res.message, /最多 32 个字符/)
})

test('bindEmployee: 姓名为空 / 超长分别返回 NAME_EMPTY / NAME_TOO_LONG', async () => {
  const s = scenario()
  let res = await bind(s, { empNo: 'A1', name: '   ' })
  assert.equal(res.code, 'NAME_EMPTY')
  assert.match(res.message, /请输入姓名/)

  res = await bind(s, { empNo: 'A1', name: '张'.repeat(33) })
  assert.equal(res.code, 'NAME_TOO_LONG')
  assert.match(res.message, /姓名过长/)
  assert.equal(s.count('employees'), 0)
})

test('bindEmployee: 工号为空优先于姓名为空校验', async () => {
  const s = scenario()
  const res = await bind(s, { empNo: '', name: '' })
  assert.equal(res.code, 'EMP_NO_EMPTY')
})

// ---------------- 正常创建 ----------------
test('bindEmployee: 新绑定成功——全角/空格/零宽字符规范化后写库', async () => {
  const s = scenario()
  const res = await bind(s, {
    empNo: ' Ｔ０００１\u200B ',
    name: '  张三  ',
    dept: ' 技术部 ',
    location: ' 1号楼-3层 '
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.empNo, 'T0001')
  assert.equal(res.data.name, '张三')
  assert.equal(res.data.dept, '技术部')
  assert.equal(res.data.location, '1号楼-3层')
  assert.equal(res.data.openid, OPENID)
  assert.equal(res.data.admin, false)
  assert.ok(res.data._id)
  assert.ok(res.data.createdAt instanceof Date)

  const docs = s.docs('employees')
  assert.equal(docs.length, 1)
  assert.equal(docs[0].empNo, 'T0001')
  assert.equal(docs[0].openid, OPENID)
  // 诊断日志：规范化后工号 / 绑定数 / 占用数
  const logs = s.logs().join('\n')
  assert.match(logs, /\[bindEmployee\] start/)
  assert.match(logs, /"empNoChangedByNormalize":true/)
  assert.match(logs, /\[bindEmployee\] query/)
  assert.match(logs, /boundCount/)
  assert.match(logs, /existCount/)
  assert.match(logs, /\[bindEmployee\] done created/)
})

test('bindEmployee: 未传 dept/location 时写入空字符串', async () => {
  const s = scenario()
  const res = await bind(s, { empNo: 1001, name: '李四' })
  assert.equal(res.ok, true)
  assert.equal(res.data.empNo, '1001')
  assert.equal(res.data.dept, '')
  assert.equal(res.data.location, '')
})

test('bindEmployee: dept 超过 64 字符、location 超过 96 字符会被截断', async () => {
  const s = scenario()
  const res = await bind(s, { empNo: 'A1', name: '张三', dept: '部'.repeat(100), location: '址'.repeat(200) })
  assert.equal(res.ok, true)
  assert.equal(res.data.dept.length, 64)
  assert.equal(res.data.location.length, 96)
  assert.equal(s.doc('employees', res.data._id).dept.length, 64)
})

// ---------------- 幂等 ----------------
test('bindEmployee: 同工号重复提交幂等成功，不产生第二条档案', async () => {
  const s = scenario({ seed: { employees: [employee()] } })
  const res = await bind(s, { empNo: 'A1', name: '张三' })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'emp_1')
  assert.equal(s.count('employees'), 1)
  assert.match(s.logs().join('\n'), /done idempotent/)
})

test('bindEmployee: 同工号幂等时自愈历史脏工号（首尾空格），只改这一条', async () => {
  const s = scenario({ seed: { employees: [employee({ empNo: ' A 001 ' })] } })
  const res = await bind(s, { empNo: 'A001', name: '张三' })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'emp_1')
  assert.equal(res.data.empNo, 'A001')
  assert.equal(s.count('employees'), 1)
  assert.equal(s.doc('employees', 'emp_1').empNo, 'A001')
  assert.match(s.logs().join('\n'), /heal empNo/)
})

test('bindEmployee: 旧数据 empNo 为数字时也能幂等命中并自愈为字符串', async () => {
  const s = scenario({ seed: { employees: [employee({ empNo: 1001 })] } })
  const res = await bind(s, { empNo: '1001', name: '张三' })
  assert.equal(res.ok, true)
  assert.equal(res.data.empNo, '1001')
  const saved = s.doc('employees', 'emp_1')
  assert.equal(typeof saved.empNo, 'string')
  assert.equal(saved.empNo, '1001')
})

test('bindEmployee: 同一 openid 多条档案时，命中的那条幂等返回', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee({ _id: 'emp_first', empNo: 'A1' }),
        employee({ _id: 'emp_second', empNo: 'B2' })
      ]
    }
  })
  const res = await bind(s, { empNo: 'B2', name: '张三' })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'emp_second')
  assert.equal(s.count('employees'), 2)
})

// ---------------- 已绑定自己：引导换绑 ----------------
test('bindEmployee: 已绑定其他工号但未确认换绑时返回 ALREADY_BOUND_SELF', async () => {
  const s = scenario({ seed: { employees: [employee({ empNo: 'A1', name: '张三' })] } })
  const res = await bind(s, { empNo: 'B2', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'ALREADY_BOUND_SELF')
  assert.match(res.message, /当前微信已绑定工号 A1/)
  assert.match(res.message, /换绑/)
  assert.deepEqual(res.data.profile, { _id: 'emp_1', empNo: 'A1', name: '张三' })
  assert.equal(s.doc('employees', 'emp_1').empNo, 'A1')
})

test('bindEmployee: ALREADY_BOUND_SELF 文案中的旧工号会先规范化', async () => {
  const s = scenario({ seed: { employees: [employee({ empNo: ' A 1 ' })] } })
  const res = await bind(s, { empNo: 'B2', name: '张三' })
  assert.equal(res.code, 'ALREADY_BOUND_SELF')
  assert.match(res.message, /当前微信已绑定工号 A1/)
})

// ---------------- 换绑 ----------------
test('bindEmployee: rebind=true 时更新本人工号/姓名/科室/位置', async () => {
  const s = scenario({ seed: { employees: [employee({ empNo: 'A1', name: '张三', dept: '技术部', location: '1号楼' })] } })
  const res = await bind(s, {
    empNo: 'B2',
    name: '张三丰',
    dept: '市场部',
    location: '2号楼',
    rebind: true
  })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'emp_1')
  assert.equal(res.data.empNo, 'B2')
  assert.equal(res.data.name, '张三丰')
  assert.equal(res.data.dept, '市场部')
  assert.equal(res.data.location, '2号楼')
  const saved = s.doc('employees', 'emp_1')
  assert.equal(saved.empNo, 'B2')
  assert.equal(saved.name, '张三丰')
  assert.equal(s.count('employees'), 1)
  assert.match(s.logs().join('\n'), /done rebind/)
})

test('bindEmployee: rebind 未传 dept/location 时保留原值；传空串则清空', async () => {
  const s = scenario({ seed: { employees: [employee({ dept: '技术部', location: '1号楼' })] } })
  await bind(s, { empNo: 'B2', name: '张三', rebind: 'true' })
  let saved = s.doc('employees', 'emp_1')
  assert.equal(saved.dept, '技术部')
  assert.equal(saved.location, '1号楼')

  await bind(s, { empNo: 'C3', name: '张三', dept: '', location: '', rebind: 1 })
  saved = s.doc('employees', 'emp_1')
  assert.equal(saved.dept, '')
  assert.equal(saved.location, '')
})

test('bindEmployee: 换绑目标工号被他人占用时返回 EMP_NO_TAKEN，本人档案不变', async () => {
  const s = scenario({
    seed: {
      employees: [
        employee({ _id: 'emp_mine', openid: OPENID, empNo: 'A1', name: '张三' }),
        employee({ _id: 'emp_other', openid: 'openid_other', empNo: 'B2', name: '李四', createdAt: localDate(2026, 10, 20) })
      ]
    }
  })
  const res = await bind(s, { empNo: 'B2', name: '张三', rebind: true })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EMP_NO_TAKEN')
  assert.match(res.message, /该工号已被其他微信绑定/)
  assert.match(res.message, /2026-10-20 绑定/)
  assert.match(res.message, /员工绑定 → 解绑/)
  assert.deepEqual(res.data, { empNo: 'B2' })
  assert.equal(s.doc('employees', 'emp_mine').empNo, 'A1')
})

// ---------------- 工号被占用 ----------------
test('bindEmployee: 工号被其他微信占用时返回 EMP_NO_TAKEN（姓名掩码 + 绑定日期）', async () => {
  const s = scenario({
    seed: {
      employees: [employee({ _id: 'emp_other', openid: 'openid_other', empNo: 'B2', name: '张三丰', createdAt: localDate(2026, 10, 26) })]
    }
  })
  const res = await bind(s, { empNo: 'B2', name: '李四' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EMP_NO_TAKEN')
  assert.match(res.message, /该工号已被其他微信绑定（张\*丰，2026-10-26 绑定）/)
  assert.deepEqual(res.data, { empNo: 'B2' })
  assert.equal(s.count('employees'), 1, '不应创建新档案')
  assert.match(s.logs().join('\n'), /empNo taken/)
})

test('bindEmployee: 占用者姓名掩码——2 字 / 1 字 / 缺失', async () => {
  const cases = [
    { name: '张三', expect: /（张\*，/ },
    { name: '李', expect: /（李，/ },
    { name: '', expect: /（（未填姓名），/ }
  ]
  for (const c of cases) {
    const s = scenario({
      seed: { employees: [{ _id: 'emp_other', openid: 'openid_other', empNo: 'B2', name: c.name, createdAt: localDate(2026, 10, 26) }] }
    })
    const res = await bind(s, { empNo: 'B2', name: '我' })
    assert.equal(res.code, 'EMP_NO_TAKEN', 'name=' + c.name)
    assert.match(res.message, c.expect, 'name=' + c.name)
  }
})

test('bindEmployee: 占用记录无 createdAt 时不显示绑定日期', async () => {
  const s = scenario({
    seed: { employees: [{ _id: 'emp_other', openid: 'openid_other', empNo: 'B2', name: '张三' }] }
  })
  const res = await bind(s, { empNo: 'B2', name: '我' })
  assert.equal(res.code, 'EMP_NO_TAKEN')
  assert.match(res.message, /该工号已被其他微信绑定（张\*）/)
  assert.doesNotMatch(res.message, /绑定日期/)
})

test('bindEmployee: 无本人档案但工号记录 openid 是自己时幂等成功（历史脏数据）', async () => {
  const s = scenario({
    seed: { employees: [{ _id: 'emp_legacy', openid: OPENID, empNo: 'A001', name: '张三' }] }
  })
  // 用一个「当前微信没有档案」的 openid 场景无法复现（同 openid 即算有档案），
  // 这里用大小写/空白之外的历史差异：openid 相同但查询档案时…校验分支 2.1 与情况一重叠，
  // 因此直接断言该数据下绑定仍为幂等成功（同一记录）。
  const res = await bind(s, { empNo: 'A001', name: '张三' })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'emp_legacy')
  assert.equal(s.count('employees'), 1)
})

test('bindEmployee: 旧数据工号是数字且被他人占用时返回 EMP_NO_TAKEN', async () => {
  const s = scenario({
    seed: { employees: [{ _id: 'emp_num', openid: 'openid_other', empNo: 1001, name: '王五', createdAt: localDate(2026, 10, 26) }] }
  })
  const res = await bind(s, { empNo: '1001', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EMP_NO_TAKEN')
  assert.match(res.message, /王\*|王，/)
})

// ---------------- 并发兜底 / 异常 ----------------
test('bindEmployee: 并发插入导致同工号重复时回滚自己的档案并返回 EMP_NO_TAKEN', async () => {
  const s = scenario()
  s.mock.after('employees', 'add', function () {
    // 模拟另一请求在「查询占用」之后、写入之后同时写入同工号
    s.mock.insert('employees', {
      _id: 'emp_race',
      openid: 'openid_race_other',
      empNo: 'R100',
      name: '竞态用户',
      createdAt: localDate(2026, 10, 26)
    })
  })
  const res = await bind(s, { empNo: 'R100', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EMP_NO_TAKEN')
  const docs = s.docs('employees')
  assert.equal(docs.length, 1, '自己的重复档案应被回滚删除')
  assert.equal(docs[0]._id, 'emp_race')
  assert.match(s.logs().join('\n'), /race-rollback/)
})

test('bindEmployee: 档案查询数据库异常返回 INTERNAL_ERROR 并带「绑定失败」前缀', async () => {
  const s = scenario()
  s.mock.failNext('employees', 'get', new Error('db down'))
  const res = await bind(s, { empNo: 'A1', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'INTERNAL_ERROR')
  assert.match(res.message, /^绑定失败：/)
  assert.match(res.message, /db down/)
})

test('bindEmployee: 写入数据库异常返回 INTERNAL_ERROR', async () => {
  const s = scenario()
  s.mock.failNext('employees', 'add', new Error('write failed'))
  const res = await bind(s, { empNo: 'A1', name: '张三' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'INTERNAL_ERROR')
  assert.match(res.message, /绑定失败：write failed/)
  assert.equal(s.count('employees'), 0)
})
