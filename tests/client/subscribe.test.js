'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/subscribe.js
 * 覆盖：多模板请求、部分 accept/reject、未配置过滤、不支持降级、
 *       requestForOrder 自取/配送模板集合、去重、异常/失败回调。
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const subscribe = require('../../miniprogram/utils/subscribe.js');
const config = require('../../miniprogram/config/index.js');

const ORIGINAL_TEMPLATES = Object.assign({}, config.subscribeTemplates);

let mock = null;

function setup(options) {
  mock = createWxMock(options || {}).install();
  return mock;
}

function restoreConfig() {
  config.subscribeTemplates = Object.assign({}, ORIGINAL_TEMPLATES);
}

afterEach(() => {
  restoreConfig();
  if (mock) {
    mock.restore();
    mock = null;
  }
});

test('request：单模板授权成功时返回 accept 与映射结果', async () => {
  setup();
  const result = await subscribe.request(['orderPlaced']);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'accept');
  assert.deepEqual(result.results, { orderPlaced: 'accept' });
  assert.deepEqual(mock.lastCall('requestSubscribeMessage').args.tmplIds, [
    config.subscribeTemplates.orderPlaced
  ]);
});

test('request：多模板部分 accept 时 ok=true，并逐模板返回状态', async () => {
  setup();
  mock.setHandler('requestSubscribeMessage', function (opt) {
    const res = { errMsg: 'requestSubscribeMessage:ok' };
    res[opt.tmplIds[0]] = 'accept';
    res[opt.tmplIds[1]] = 'reject';
    return res;
  });
  const result = await subscribe.request(['orderPlaced', 'pickupReady']);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'accept');
  assert.deepEqual(result.results, { orderPlaced: 'accept', pickupReady: 'reject' });
  assert.equal(mock.lastCall('requestSubscribeMessage').args.tmplIds.length, 2);
});

test('request：全部 reject 时 ok=false，status=reject', async () => {
  setup();
  mock.setHandler('requestSubscribeMessage', function (opt) {
    const res = { errMsg: 'requestSubscribeMessage:ok' };
    opt.tmplIds.forEach(function (id) { res[id] = 'reject'; });
    return res;
  });
  const result = await subscribe.request(['orderPlaced', 'deliveryDone']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'reject');
  assert.deepEqual(result.results, { orderPlaced: 'reject', deliveryDone: 'reject' });
});

test('request：未知状态（如 ban）不计入 accept', async () => {
  setup();
  mock.setHandler('requestSubscribeMessage', function (opt) {
    const res = { errMsg: 'requestSubscribeMessage:ok' };
    res[opt.tmplIds[0]] = 'ban';
    return res;
  });
  const result = await subscribe.request(['pickupReady']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'reject');
  assert.equal(result.results.pickupReady, 'ban');
});

test('request：微信 fail 回调时返回 status=fail 与原始原因', async () => {
  setup();
  mock.setHandler('requestSubscribeMessage', function () {
    return { __fail: { errMsg: 'requestSubscribeMessage:fail cancel' } };
  });
  const result = await subscribe.request(['orderPlaced', 'pickupReady']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'fail');
  assert.match(result.reason, /cancel/);
  assert.deepEqual(result.results, { orderPlaced: 'fail', pickupReady: 'fail' });
});

test('request：wx 调用同步抛错也被兜住（status=fail）', async () => {
  setup();
  mock.setHandler('requestSubscribeMessage', function () {
    throw new Error('boom');
  });
  const result = await subscribe.request(['orderPlaced']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'fail');
  assert.match(result.reason, /boom/);
  assert.deepEqual(result.results, { orderPlaced: 'fail' });
});

test('request：基础库不支持 requestSubscribeMessage 时降级返回 unsupported', async () => {
  setup();
  delete mock.wx.requestSubscribeMessage;
  const result = await subscribe.request(['orderPlaced']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.results, {});
});

test('request：未配置/未知模板名返回 not-configured，且不弹授权窗', async () => {
  setup();
  assert.deepEqual(await subscribe.request(['noSuchTemplate']), {
    ok: false,
    status: 'not-configured',
    results: {}
  });
  assert.equal(mock.callCount('requestSubscribeMessage'), 0);
  assert.deepEqual(await subscribe.request([]), { ok: false, status: 'not-configured', results: {} });
  assert.deepEqual(await subscribe.request(null), { ok: false, status: 'not-configured', results: {} });
});

test('request：同名模板去重后只请求一次', async () => {
  setup();
  await subscribe.request(['orderPlaced', 'orderPlaced']);
  assert.deepEqual(mock.lastCall('requestSubscribeMessage').args.tmplIds, [
    config.subscribeTemplates.orderPlaced
  ]);
});

test('templateId：返回去除首尾空白的模板 ID；未配置返回空串', () => {
  setup();
  assert.equal(subscribe.templateId('orderPlaced'), ORIGINAL_TEMPLATES.orderPlaced);
  config.subscribeTemplates = Object.assign({}, ORIGINAL_TEMPLATES, { orderPlaced: '  ' + ORIGINAL_TEMPLATES.orderPlaced + '  ' });
  assert.equal(subscribe.templateId('orderPlaced'), ORIGINAL_TEMPLATES.orderPlaced);
  assert.equal(subscribe.templateId('noSuchTemplate'), '');
  assert.equal(subscribe.templateId(), '');
});

test('configured：过滤空白模板，返回已配置的模板名列表', () => {
  setup();
  const list = subscribe.configured();
  ['orderPlaced', 'pickupReady', 'deliveryDone'].forEach(function (name) {
    assert.ok(list.indexOf(name) >= 0, '应包含已配置模板 ' + name);
  });
  config.subscribeTemplates = Object.assign({}, ORIGINAL_TEMPLATES, { deliveryDone: '   ' });
  assert.equal(subscribe.configured().indexOf('deliveryDone'), -1, '空白模板应被过滤');
});

test('requestForOrder：配送单请求「下单成功 + 已送达」模板集合', async () => {
  setup();
  await subscribe.requestForOrder('delivery');
  assert.deepEqual(mock.lastCall('requestSubscribeMessage').args.tmplIds, [
    config.subscribeTemplates.orderPlaced,
    config.subscribeTemplates.deliveryDone
  ]);
});

test('requestForOrder：自取（pickup/其它/空值）请求「下单成功 + 可取餐」模板集合', async () => {
  for (const takeWay of ['pickup', undefined, '', 'other']) {
    setup();
    await subscribe.requestForOrder(takeWay);
    assert.deepEqual(
      mock.lastCall('requestSubscribeMessage').args.tmplIds,
      [config.subscribeTemplates.orderPlaced, config.subscribeTemplates.pickupReady],
      'takeWay=' + String(takeWay)
    );
  }
});
