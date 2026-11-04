'use strict'

/**
 * cloudfunctions/employeeAdmin —— 管理员白名单管理（第一层安全）
 * 运行：node --test tests/cloud/employeeAdmin.setAdmin.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_emp_admin'
const ADMIN = 'openid_owner'
const STAFF = 'openid_staff'

function scenario(extraSeed) {
  return createScenario({
    fn: 'employeeAdmin',
    openid: ADMIN,
    seed: Object.assign({
      admin_sessions: [makeSession({ token: TOKEN, openid: ADMIN, expireAt: Date.now() + 3600000 })],
      employees: [
        { _id: 'emp_staff', openid: STAFF, empNo: 'E100', name: '店员A', dept: '信息处', createdAt: new Date() }
      ],
      admin_users: []
    }, extraSeed || {})
  })
}
function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('setAdmin: 把员工微信加入管理员白名单，list 返回 admin=true', async () => {
  const s = scenario()
  const res = await call(s, { action: 'setAdmin', employeeId: 'emp_staff', admin: true })
  assert.equal(res.ok, true)
  const rec = s.doc('admin_users', STAFF)
  assert.ok(rec)
  assert.equal(rec.enabled, true)
  assert.equal(rec.role, 'admin')

  const list = await call(s, { action: 'list' })
  assert.equal(list.ok, true)
  const item = list.data.list.find(function (x) { return x._id === 'emp_staff' })
  assert.equal(item.admin, true)
})

test('setAdmin: 取消管理员会停用白名单并删除该 openid 的会话', async () => {
  const s = scenario({
    admin_users: [{ _id: STAFF, openid: STAFF, name: '店员A', enabled: true, role: 'admin' }],
    admin_sessions: [
      makeSession({ token: TOKEN, openid: ADMIN, expireAt: Date.now() + 3600000 }),
      makeSession({ token: 'tok_staff', openid: STAFF, expireAt: Date.now() + 3600000 })
    ]
  })
  const res = await call(s, { action: 'setAdmin', employeeId: 'emp_staff', admin: false })
  assert.equal(res.ok, true)
  const rec = s.doc('admin_users', STAFF)
  assert.equal(rec.enabled, false)
  assert.equal(s.doc('admin_sessions', 'tok_staff'), null)
})

test('setAdmin: 不能停用当前登录管理员自己的权限', async () => {
  const s = scenario({
    employees: [{ _id: 'emp_self', openid: ADMIN, empNo: 'E001', name: '店主', createdAt: new Date() }]
  })
  const res = await call(s, { action: 'setAdmin', employeeId: 'emp_self', admin: false })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'CANNOT_DISABLE_SELF')
})

test('setAdmin: 员工没有 openid 时拒绝', async () => {
  const s = scenario({ employees: [{ _id: 'emp_noid', empNo: 'E002', name: '无微信' }] })
  const res = await call(s, { action: 'setAdmin', employeeId: 'emp_noid', admin: true })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NO_OPENID')
})
