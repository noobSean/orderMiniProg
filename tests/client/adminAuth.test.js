'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/adminAuth.js
 * 覆盖 save / read / session / isValid / token / clear / loginUrl / ensure
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const adminAuth = require('../../miniprogram/utils/adminAuth.js');

const KEY = 'dsh_admin_session';
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

let mock = null;

function setup(options) {
  mock = createWxMock(options || {}).install();
  return mock;
}

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

test('save：合法会话写入本地缓存并返回规范化对象', () => {
  setup();
  const saved = adminAuth.save({ token: 'tok-1', expireAt: 1234567890 });
  assert.deepEqual(saved, { token: 'tok-1', expireAt: 1234567890 });
  assert.deepEqual(mock.getStorage(KEY), { token: 'tok-1', expireAt: 1234567890 });
  assert.equal(mock.callCount('setStorageSync'), 1);
});

test('save：无 token 返回 null 且不写缓存', () => {
  setup();
  assert.equal(adminAuth.save(null), null);
  assert.equal(adminAuth.save({}), null);
  assert.equal(adminAuth.save({ token: '' }), null);
  assert.equal(mock.hasStorage(KEY), false);
});

test('save：expireAt 缺失/非法时回退为 12 小时有效期', () => {
  setup();
  const before = Date.now();
  const saved = adminAuth.save({ token: 't' });
  const after = Date.now();
  assert.ok(saved.expireAt >= before + TWELVE_HOURS, 'expireAt 应不小于 now + 12h');
  assert.ok(saved.expireAt <= after + TWELVE_HOURS, 'expireAt 应不大于 after + 12h');
  assert.equal(saved.token, 't');
});

test('isValid：无会话 / 过期 / 缺 token 均为 false，有效会话为 true', () => {
  setup();
  assert.equal(adminAuth.isValid(), false);
  mock.seedStorage(KEY, { token: 't', expireAt: Date.now() + 60000 });
  assert.equal(adminAuth.isValid(), true);
  mock.seedStorage(KEY, { token: 't', expireAt: Date.now() - 1000 });
  assert.equal(adminAuth.isValid(), false);
  mock.seedStorage(KEY, { expireAt: Date.now() + 60000 });
  assert.equal(adminAuth.isValid(), false);
  assert.equal(adminAuth.isValid({ token: 'x', expireAt: Date.now() + 1000 }), true);
  assert.equal(adminAuth.isValid({ token: 'x', expireAt: Date.now() - 1000 }), false);
});

test('session / token：过期会话视为不存在', () => {
  setup();
  mock.seedStorage(KEY, { token: 'valid', expireAt: Date.now() + 60000 });
  assert.equal(adminAuth.token(), 'valid');
  assert.equal(adminAuth.session().token, 'valid');
  mock.seedStorage(KEY, { token: 'expired', expireAt: Date.now() - 1 });
  assert.equal(adminAuth.token(), '');
  assert.equal(adminAuth.session(), null);
});

test('read：缓存值非法 / 读取抛错时返回 null（不崩溃）', () => {
  setup();
  mock.seedStorage(KEY, 'not-a-session');
  assert.equal(adminAuth.read(), null);
  mock.seedStorage(KEY, { foo: 'bar' });
  assert.equal(adminAuth.read(), null);
  mock.seedStorage(KEY, { token: 't' });
  assert.deepEqual(adminAuth.read(), { token: 't' });
  mock.wx.getStorageSync = function () { throw new Error('storage broken'); };
  assert.equal(adminAuth.read(), null);
});

test('clear：删除本地会话；removeStorageSync 抛错时静默', () => {
  setup();
  mock.seedStorage(KEY, { token: 't', expireAt: Date.now() + 1000 });
  adminAuth.clear();
  assert.equal(mock.hasStorage(KEY), false);
  mock.wx.removeStorageSync = function () { throw new Error('remove failed'); };
  assert.doesNotThrow(function () { adminAuth.clear(); });
});

test('save：setStorageSync 抛错时仍返回会话对象（本地兜底不阻断流程）', () => {
  setup();
  mock.wx.setStorageSync = function () { throw new Error('quota exceeded'); };
  const saved = adminAuth.save({ token: 't', expireAt: 1 });
  assert.deepEqual(saved, { token: 't', expireAt: 1 });
});

test('loginUrl：带 redirect 时做 URL 编码', () => {
  setup();
  assert.equal(adminAuth.loginUrl(), '/pages/admin/login');
  assert.equal(adminAuth.loginUrl(''), '/pages/admin/login');
  assert.equal(
    adminAuth.loginUrl('/pages/admin/orders?status=pending'),
    '/pages/admin/login?redirect=' + encodeURIComponent('/pages/admin/orders?status=pending')
  );
});

test('ensure：已登录返回 true 且不跳转', () => {
  setup();
  mock.seedStorage(KEY, { token: 't', expireAt: Date.now() + 60000 });
  assert.equal(adminAuth.ensure(), true);
  assert.equal(mock.callCount('redirectTo'), 0);
});

test('ensure：未登录返回 false，清理旧会话并带当前页 redirect 跳登录页', () => {
  setup();
  mock.seedStorage(KEY, { token: 'stale', expireAt: Date.now() - 1000 });
  mock.setPages([{ route: 'pages/admin/orders', options: { status: 'pending' } }]);
  assert.equal(adminAuth.ensure(), false);
  assert.equal(mock.hasStorage(KEY), false, '无效会话应被清理');
  const call = mock.lastCall('redirectTo');
  const expectedRedirect = '/pages/admin/orders?status=pending';
  assert.equal(call.args.url, '/pages/admin/login?redirect=' + encodeURIComponent(expectedRedirect));
});

test('ensure：支持自定义 redirect；非字符串参数被忽略', () => {
  setup();
  assert.equal(adminAuth.ensure('/pages/admin/home?tab=2'), false);
  assert.equal(
    mock.lastCall('redirectTo').args.url,
    '/pages/admin/login?redirect=' + encodeURIComponent('/pages/admin/home?tab=2')
  );
  mock.resetCalls();
  mock.setPages([{ route: 'pages/admin/stats', options: {} }]);
  assert.equal(adminAuth.ensure(123), false);
  assert.equal(
    mock.lastCall('redirectTo').args.url,
    '/pages/admin/login?redirect=' + encodeURIComponent('/pages/admin/stats')
  );
});

test('ensure：拿不到当前页面（无页面栈 / getCurrentPages 不存在）时仍跳登录页', () => {
  setup();
  mock.setPages([]);
  assert.equal(adminAuth.ensure(), false);
  assert.equal(mock.lastCall('redirectTo').args.url, '/pages/admin/login');

  setup();
  delete globalThis.getCurrentPages;
  assert.equal(adminAuth.ensure(), false);
  assert.equal(mock.lastCall('redirectTo').args.url, '/pages/admin/login');
});
