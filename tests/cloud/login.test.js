'use strict'

/**
 * cloudfunctions/login —— 返回调用者 openid 与已绑定员工档案
 * 运行：node --test tests/cloud/login.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario } = require('../helpers/mockCloud')

const OPENID = 'openid_login_user'

test('login: 未绑定员工时返回 profile=null，openid 来自 getWXContext', async () => {
  const s = createScenario({ fn: 'login', openid: OPENID })
  const res = await s.call({})
  assert.deepEqual(res, { ok: true, data: { openid: OPENID, profile: null } })
})

test('login: 已绑定员工时返回第一条员工档案（完整字段）', async () => {
  const profile = {
    _id: 'emp_1',
    openid: OPENID,
    empNo: 'E1001',
    name: '张三',
    dept: '技术部',
    location: '1号楼-3层',
    admin: false
  }
  const s = createScenario({ fn: 'login', openid: OPENID, seed: { employees: [profile] } })
  const res = await s.call({})
  assert.equal(res.ok, true)
  assert.deepEqual(res.data, { openid: OPENID, profile })
})

test('login: 只返回当前 openid 的档案，不会串号', async () => {
  const s = createScenario({
    fn: 'login',
    openid: OPENID,
    seed: {
      employees: [
        { _id: 'emp_other', openid: 'openid_somebody_else', empNo: 'E2002', name: '李四' },
        { _id: 'emp_mine', openid: OPENID, empNo: 'E1001', name: '张三' }
      ]
    }
  })
  const res = await s.call({})
  assert.equal(res.ok, true)
  assert.equal(res.data.profile._id, 'emp_mine')
  assert.equal(res.data.profile.empNo, 'E1001')
})

test('login: 同一 openid 有多条档案时取第一条（limit 1）', async () => {
  const s = createScenario({
    fn: 'login',
    openid: OPENID,
    seed: {
      employees: [
        { _id: 'emp_a', openid: OPENID, empNo: 'A1', name: '旧档案' },
        { _id: 'emp_b', openid: OPENID, empNo: 'B2', name: '新档案' }
      ]
    }
  })
  const res = await s.call({})
  assert.equal(res.data.profile._id, 'emp_a')
})

test('login: getWXContext 的 OPENID 变化会影响查询结果', async () => {
  const s = createScenario({
    fn: 'login',
    openid: OPENID,
    seed: { employees: [{ _id: 'emp_a', openid: 'openid_another', empNo: 'A1', name: '另一人' }] }
  })
  let res = await s.call({})
  assert.equal(res.data.profile, null)
  s.mock.setOpenid('openid_another')
  res = await s.call({})
  assert.equal(res.data.profile._id, 'emp_a')
})

test('login: 数据库查询抛错时返回 ok:false 且 message 保留底层错误', async () => {
  const s = createScenario({ fn: 'login', openid: OPENID })
  s.mock.failNext('employees', 'get', new Error('db unavailable'))
  const res = await s.call({})
  assert.equal(res.ok, false)
  assert.equal(res.message, 'db unavailable')
})
