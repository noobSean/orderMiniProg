'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/store.js（本地购物车）
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const store = require('../../miniprogram/utils/store.js');

const KEY = 'dsh_cart';

let mock = null;

function setup() {
  mock = createWxMock().install();
  return mock;
}

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

function dish(overrides) {
  return Object.assign({ dishId: 'd1', name: '黑椒牛柳饭', price: 10, spec: '', extras: [] }, overrides || {});
}

test('add：新菜品加购数量为 1 并持久化', () => {
  setup();
  const list = store.add(dish());
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 1);
  assert.equal(list[0].name, '黑椒牛柳饭');
  assert.deepEqual(mock.getStorage(KEY), list);
});

test('add：同菜品 + 同规格 + 同加料合并数量', () => {
  setup();
  store.add(dish());
  const list = store.add(dish());
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 2);
});

test('add：不同规格 / 不同加料视为不同条目', () => {
  setup();
  store.add(dish());
  store.add(dish({ spec: '大份' }));
  store.add(dish({ extras: ['加蛋'] }));
  const list = store.loadCart();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(function (item) { return item.qty; }), [1, 1, 1]);
});

test('setItemQty：设置指定数量；设为 0 时移除条目', () => {
  setup();
  store.add(dish());
  const list = store.setItemQty(dish(), 5);
  assert.equal(list[0].qty, 5);
  const empty = store.setItemQty(dish(), 0);
  assert.equal(empty.length, 0);
});

test('remove：数量减一；减到 0 时移除', () => {
  setup();
  store.add(dish());
  store.add(dish());
  assert.equal(store.remove(dish())[0].qty, 1);
  assert.equal(store.remove(dish()).length, 0);
});

test('change：对不存在条目使用负数增量时不会加入购物车', () => {
  setup();
  const list = store.remove(dish());
  assert.equal(list.length, 0);
  assert.equal(store.loadCart().length, 0);
});

test('totalQty / totalAmount：按数量与单价汇总', () => {
  setup();
  store.add(dish({ dishId: 'd1', price: 10 }));
  store.add(dish({ dishId: 'd1', price: 10 }));
  store.add(dish({ dishId: 'd2', name: '橙汁', price: 5.5, spec: '中杯' }));
  assert.equal(store.totalQty(), 3);
  assert.equal(store.totalAmount(), 25.5);
  assert.equal(store.totalQty([{ qty: 2 }, { qty: 3 }]), 5);
  assert.equal(store.totalAmount([{ qty: 2, price: 3 }, { qty: 1, price: 4.5 }]), 10.5);
});

test('clear：清空购物车并移除本地缓存', () => {
  setup();
  store.add(dish());
  const list = store.clear();
  assert.deepEqual(list, []);
  assert.equal(mock.hasStorage(KEY), false);
  assert.deepEqual(store.loadCart(), []);
});

test('loadCart：可恢复本地已保存的购物车；读取异常时返回空数组', () => {
  setup();
  mock.seedStorage(KEY, [{ dishId: 'd9', name: '预存', price: 1, qty: 2, spec: '', extras: [] }]);
  const list = store.loadCart();
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 2);

  setup();
  mock.wx.getStorageSync = function () { throw new Error('storage broken'); };
  assert.deepEqual(store.loadCart(), []);
});
