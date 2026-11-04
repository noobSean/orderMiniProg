'use strict';

/**
 * 管理端取消状态展示回归
 * 服务端状态为 cancelled，管理端展示键为 cancel；曾因未做别名归一化，取消单在后台被当成 pending
 * （状态显示“待接”、仍然出现接单/取消按钮）——本用例锁定修复。
 * 运行：node --test tests/client/adminCancelStatus.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const req = createRequire(path.join(__dirname, 'load.js'));

const apiPath = req.resolve(path.join(ROOT, 'miniprogram/utils/api.js'));
const authPath = req.resolve(path.join(ROOT, 'miniprogram/utils/adminAuth.js'));

req.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    adminVerify: async () => ({ valid: true }),
    adminOrders: async () => [],
    orderDetail: async () => ({})
  }
};
req.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    ensure: () => true,
    clear: () => {},
    token: () => 'tok',
    loginUrl: (u) => '/pages/admin/login?redirect=' + encodeURIComponent(u)
  }
};

globalThis.wx = {
  redirectTo: () => {}, showToast: () => {}, vibrateLong: () => {},
  showLoading: () => {}, hideLoading: () => {}, navigateTo: () => {},
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {}
};

function loadPage(rel) {
  let def = null;
  globalThis.Page = (d) => { def = d; };
  const file = req.resolve(path.join(ROOT, 'miniprogram/pages', rel));
  delete req.cache[file];
  req(file);
  return def;
}
function instantiate(def) {
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data || {}));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return page;
}

const CANCELLED_ORDER = {
  _id: 'o_cancel',
  orderNo: 'O123',
  pickupNo: 7,
  type: 'pickup',
  buyer: { name: '张三', empNo: 'E1', dept: '信息处' },
  items: [{ name: '拿铁', price: 20, qty: 1 }],
  total: 20,
  paymentStatus: 'paid',
  delivery: { target: '', note: '' },
  status: 'cancelled',
  statusHistory: [{ status: 'pending', time: '2026-11-03T00:00:00.000Z' }],
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:01:00.000Z'
};

test('管理端订单列表：cancelled 归一化为「已取消」，不再显示待接/操作按钮', () => {
  const page = instantiate(loadPage('admin/orders.js'));
  const o = page.normOrder(CANCELLED_ORDER);
  assert.equal(o.status, 'cancel');
  assert.equal(o.statusLabel, '已取消');
  assert.equal(o.showAccept, false);
  assert.equal(o.showCancel, false);
  assert.equal(o.showCheckout, false);
  assert.equal(o.showDone, false);
  assert.match(o.time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('管理端订单详情：cancelled 显示「已取消」，操作按钮为空', () => {
  const page = instantiate(loadPage('admin/order-detail.js'));
  const detail = page.normDetail(CANCELLED_ORDER);
  assert.equal(detail.status, 'cancel');
  assert.equal(detail.statusLabel, '已取消');
  assert.equal(detail.statusClass, 'cancel');
  assert.equal(page.buildPrimaryAction(CANCELLED_ORDER), null);
  assert.equal(page.canCancel(CANCELLED_ORDER), false);
});


test('管理端订单详情：底部只保留一个主流程按钮，取消为次要操作', () => {
  const page = instantiate(loadPage('admin/order-detail.js'));
  const pending = Object.assign({}, CANCELLED_ORDER, { status: 'pending' });
  assert.deepEqual(page.buildPrimaryAction(pending), { key: 'making', text: '接单' });
  assert.equal(page.canCancel(pending), true);

  const makingPickup = Object.assign({}, CANCELLED_ORDER, { status: 'making', type: 'pickup' });
  assert.deepEqual(page.buildPrimaryAction(makingPickup), { key: 'ready', text: '制作完成' });

  const makingDelivery = Object.assign({}, CANCELLED_ORDER, { status: 'making', type: 'delivery' });
  assert.deepEqual(page.buildPrimaryAction(makingDelivery), { key: 'ready', text: '开始配送' });

  // 已收款的待取餐：主按钮「已取餐」
  const readyPaid = Object.assign({}, CANCELLED_ORDER, { status: 'ready', type: 'pickup', paymentStatus: 'paid' });
  assert.deepEqual(page.buildPrimaryAction(readyPaid), { key: 'done', text: '已取餐' });
  assert.equal(page.canCancel(readyPaid), true);

  // 未收款的待取餐：主按钮「收款并交付」，交付时一并收款
  const readyUnpaid = Object.assign({}, CANCELLED_ORDER, { status: 'ready', type: 'pickup', paymentStatus: 'unpaid' });
  assert.deepEqual(page.buildPrimaryAction(readyUnpaid), { key: 'checkout', text: '收款并交付' });

  // 配送单：未收款「收款并完成配送」，已收款「完成配送」
  const readyDeliveryUnpaid = Object.assign({}, CANCELLED_ORDER, { status: 'ready', type: 'delivery', paymentStatus: 'unpaid' });
  assert.deepEqual(page.buildPrimaryAction(readyDeliveryUnpaid), { key: 'checkout', text: '收款并完成配送' });
  const readyDeliveryPaid = Object.assign({}, CANCELLED_ORDER, { status: 'ready', type: 'delivery', paymentStatus: 'paid' });
  assert.deepEqual(page.buildPrimaryAction(readyDeliveryPaid), { key: 'done', text: '完成配送' });
});


test('管理端：已取消且未收款的订单不再出现「收款」按钮，也不进待收款 Tab', () => {
  const page = instantiate(loadPage('admin/orders.js'));
  const cancelledUnpaid = Object.assign({}, CANCELLED_ORDER, { paymentStatus: 'unpaid' });
  const o = page.normOrder(cancelledUnpaid);
  assert.equal(o.status, 'cancel');
  assert.equal(o.paymentUnpaid, true);
  assert.equal(o.showCheckout, false, '已取消订单不允许再交付/收款');
  assert.equal(o.showAccept, false);
  assert.equal(o.showCancel, false);
  assert.equal(o.showCheckout, false);
  assert.equal(o.showDone, false);
});
