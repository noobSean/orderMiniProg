'use strict';

/**
 * 小程序端 utils/api.js —— 管理密码修改契约
 * 覆盖：adminChangePwd 调用 adminLogin(changePwd)、自动注入 adminToken/模板 ID、错误码透传。
 * 运行：node --test tests/client/api.password.test.js
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const api = require('../../miniprogram/utils/api.js');
const config = require('../../miniprogram/config/index.js');

const SESSION_KEY = 'dsh_admin_session';
let mock = null;

function setup(handlers) {
  mock = createWxMock({ handlers: handlers || {} }).install();
  return mock;
}

afterEach(() => {
  if (mock) { mock.restore(); mock = null; }
});

test('adminChangePwd：调用 adminLogin/changePwd，并自动注入 adminToken 与订阅模板配置', async () => {
  setup({ callFunction: () => ({ result: { ok: true, data: { changed: true } } }) });
  mock.seedStorage(SESSION_KEY, { token: 'tok-valid', expireAt: Date.now() + 3600 * 1000 });
  const data = await api.adminChangePwd('old-pwd', 'new-pwd-123');
  assert.deepEqual(data, { changed: true });
  const call = mock.lastCall('cloud.callFunction');
  assert.equal(call.args.name, 'adminLogin');
  assert.equal(call.args.data.action, 'changePwd');
  assert.equal(call.args.data.oldPwd, 'old-pwd');
  assert.equal(call.args.data.newPwd, 'new-pwd-123');
  assert.equal(call.args.data.adminToken, 'tok-valid');
  assert.deepEqual(call.args.data.subscribeTemplateIds, config.subscribeTemplates);
});

test('adminChangePwd：原密码错误时透传 code/message，且不清空本地会话', async () => {
  setup({ callFunction: () => ({ result: { ok: false, code: 'PWD_WRONG', message: '原管理密码错误' } }) });
  mock.seedStorage(SESSION_KEY, { token: 'tok-valid', expireAt: Date.now() + 3600 * 1000 });
  await assert.rejects(api.adminChangePwd('bad', 'new-pwd-123'), (err) => {
    assert.equal(err.code, 'PWD_WRONG');
    assert.equal(err.message, '原管理密码错误');
    return true;
  });
  assert.equal(mock.getStorage(SESSION_KEY).token, 'tok-valid');
});

test('adminChangePwd：登录过期（NEED_ADMIN_LOGIN）时清空本地会话', async () => {
  setup({ callFunction: () => ({ result: { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' } }) });
  mock.seedStorage(SESSION_KEY, { token: 'tok-valid', expireAt: Date.now() + 3600 * 1000 });
  await assert.rejects(api.adminChangePwd('old', 'new-pwd-123'), (err) => {
    assert.equal(err.code, 'NEED_ADMIN_LOGIN');
    return true;
  });
  assert.equal(mock.hasStorage(SESSION_KEY), false);
});
