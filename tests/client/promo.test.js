'use strict';

/**
 * 小程序端 utils/promo.js —— 促销计算工具（proto）
 * 覆盖：活动生效判断（启用/时间窗）、范围匹配（全部/分类/菜品）、最优活动选择、金额四舍五入。
 * 运行：node --test tests/client/promo.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const promo = require('../../miniprogram/utils/promo.js');

const NOW = new Date('2026-11-01T10:00:00+08:00').getTime();

function p(rate, scopeType, extra) {
  return Object.assign({
    _id: 'p_' + rate, name: rate + '折', scopeType: scopeType || 'all',
    categoryIds: [], dishIds: [], rate: rate, enabled: true, startAt: null, endAt: null
  }, extra || {});
}

test('isActive：启用且不在时间窗外的活动生效', () => {
  assert.equal(promo.isActive(p(0.8), NOW), true);
  assert.equal(promo.isActive(p(0.8, 'all', { enabled: false }), NOW), false);
  assert.equal(promo.isActive(p(0.8, 'all', { startAt: NOW + 1000 }), NOW), false);
  assert.equal(promo.isActive(p(0.8, 'all', { endAt: NOW - 1000 }), NOW), false);
  assert.equal(promo.isActive(p(0.8, 'all', { startAt: NOW - 1000, endAt: NOW + 1000 }), NOW), true);
  assert.equal(promo.isActive(p(1.1), NOW), false, '非法折扣率不生效');
});

test('scopeMatch：全部/分类/菜品范围', () => {
  const dish = { _id: 'dish_1', categoryId: 'cat_1' };
  assert.equal(promo.scopeMatch(p(0.8, 'all'), dish), true);
  assert.equal(promo.scopeMatch(p(0.8, 'category', { categoryIds: ['cat_1'] }), dish), true);
  assert.equal(promo.scopeMatch(p(0.8, 'category', { categoryIds: ['cat_2'] }), dish), false);
  assert.equal(promo.scopeMatch(p(0.8, 'dish', { dishIds: ['dish_1'] }), dish), true);
  assert.equal(promo.scopeMatch(p(0.8, 'dish', { dishIds: ['dish_2'] }), dish), false);
});

test('bestPromotion：多个命中活动取折扣率最低（力度最大）', () => {
  const dish = { _id: 'dish_1', categoryId: 'cat_1' };
  const list = [
    p(0.9, 'all'),
    p(0.7, 'category', { categoryIds: ['cat_1'] }),
    p(0.8, 'dish', { dishIds: ['dish_1'] })
  ];
  assert.equal(promo.bestPromotion(list, dish)._id, 'p_0.7');
  assert.equal(promo.bestPromotion([], dish), null);
  assert.equal(promo.bestPromotion([p(0.9, 'category', { categoryIds: ['cat_2'] })], dish), null);
});

test('applyToItems：按条目计算优惠、原价/实付/优惠明细、四舍五入', () => {
  const items = [
    { dishId: 'dish_food', categoryId: 'cat_food', price: 28, qty: 2 },
    { dishId: 'dish_drink', categoryId: 'cat_drink', price: 12, qty: 3 }
  ];
  const promos = [p(0.8, 'category', { categoryIds: ['cat_drink'], _id: 'p_drink', name: '饮品 8 折' })];
  const r = promo.applyToItems(items, promos, NOW);
  // 食品 56；饮品 36*0.8=28.8 => 合计 84.8；原价 92，优惠 7.2
  assert.equal(r.originalTotal, 92);
  assert.equal(r.total, 84.8);
  assert.equal(r.discountAmount, 7.2);
  assert.equal(r.items[0].hasDiscount, false);
  assert.equal(r.items[0].lineTotal, 56);
  assert.equal(r.items[1].hasDiscount, true);
  assert.equal(r.items[1].lineTotal, 28.8);
  assert.equal(r.items[1].discountAmount, 7.2);
  assert.equal(r.items[1].promotionName, '饮品 8 折');
  assert.deepEqual(r.discounts, [{ promotionId: 'p_drink', name: '饮品 8 折', rate: 0.8, amount: 7.2 }]);
});

test('applyToItems：无活动/无优惠时保持原价', () => {
  const r = promo.applyToItems([{ dishId: 'd1', price: 10, qty: 2 }], [], NOW);
  assert.equal(r.total, 20);
  assert.equal(r.originalTotal, 20);
  assert.equal(r.discountAmount, 0);
  assert.deepEqual(r.discounts, []);
  assert.equal(r.items[0].hasDiscount, false);
});
