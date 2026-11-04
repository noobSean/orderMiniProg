'use strict';

/**
 * 管理端订单页手动刷新反馈
 * 运行：node --test tests/client/adminOrdersRefresh.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const req = createRequire(path.join(__dirname, 'load.js'));
const apiPath = req.resolve(path.join(ROOT, 'miniprogram/utils/api.js'));
const authPath = req.resolve(path.join(ROOT, 'miniprogram/utils/adminAuth.js'));

const calls = { toast: [], loading: 0, hide: 0 };
req.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    adminVerify: async () => ({ valid: true }),
    adminOrders: async () => [{
      _id: 'o1', orderNo: 'O1', pickupNo: 3, type: 'pickup', status: 'pending',
      buyer: { name: '张三' }, items: [{ name: '拿铁', price: 20, qty: 1 }], total: 20,
      paymentStatus: 'unpaid', createdAt: '2026-11-04T00:00:00.000Z'
    }]
  }
};
req.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { ensure: () => true, clear: () => {}, isValid: () => true, loginUrl: (u) => u }
};

globalThis.wx = {
  navigateTo: () => {}, redirectTo: () => {}, vibrateLong: () => {},
  showToast: (o) => calls.toast.push(o.title),
  showLoading: () => { calls.loading += 1; },
  hideLoading: () => { calls.hide += 1; }
};

let def = null;
globalThis.Page = (d) => { def = d; };
const file = req.resolve(path.join(ROOT, 'miniprogram/pages/admin/orders.js'));
delete req.cache[file];
req(file);
const page = Object.assign({}, def);
page.data = JSON.parse(JSON.stringify(def.data));
page.setData = function (patch) { Object.assign(this.data, patch); };

test('手动刷新：显示 loading、成功后 Toast 并更新刷新时间', async () => {
  await page.onRefresh();
  assert.equal(page.data.refreshing, false);
  assert.match(page.data.lastRefreshText, /^更新于 \d{2}:\d{2}:\d{2}$/);
  assert.ok(calls.loading >= 1, '应展示 loading');
  assert.ok(calls.hide >= 1, '应关闭 loading');
  assert.ok(calls.toast.includes('已刷新'), '应提示已刷新');
  assert.equal(page.data.orders.length, 1);
});
