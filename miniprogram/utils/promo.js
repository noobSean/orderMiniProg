/**
 * 促销/折扣（proto）
 *
 * 数据模型（集合 promotions，单条活动）：
 *  - name        活动名称
 *  - scopeType   'all'（全部品类）| 'category'（指定分类）| 'dish'（指定菜品）
 *  - categoryIds 指定分类 _id 数组（scopeType='category'）
 *  - dishIds     指定菜品 _id 数组（scopeType='dish'）
 *  - rate        折扣率（0.01-0.99，如 0.85 表示 8.5 折）
 *  - startAt/endAt 活动起止时间（毫秒时间戳或可被 Date 解析的字符串；为空表示不限）
 *  - enabled     是否启用
 *
 * 规则（proto 版，简单可预期）：
 *  - 同一菜品同时命中多个活动时，只取折扣力度最大的一个（不叠加）；
 *  - 折扣作用在「菜品单价（含规格/加料）」× 数量上，按分四舍五入；
 *  - 服务端 submitOrder 会重新计算并落单，客户端这里的计算仅用于展示预估。
 */
const round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };

function toTs(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

function isActive(promo, now) {
  if (!promo || promo.enabled === false) return false;
  const rate = Number(promo.rate);
  if (!(rate > 0 && rate < 1)) return false;
  const at = now === undefined ? Date.now() : now;
  const start = toTs(promo.startAt);
  const end = toTs(promo.endAt);
  if (start !== null && at < start) return false;
  if (end !== null && at > end) return false;
  return true;
}

function activePromotions(list, now) {
  return (Array.isArray(list) ? list : []).filter(function (p) { return isActive(p, now); });
}

// 判断活动是否作用于某个菜品（dish: {_id, categoryId}）
function scopeMatch(promo, dish) {
  if (!promo || !dish) return false;
  const type = promo.scopeType || 'all';
  if (type === 'all') return true;
  if (type === 'category') {
    const ids = Array.isArray(promo.categoryIds) ? promo.categoryIds : [];
    return ids.map(String).indexOf(String(dish.categoryId)) >= 0;
  }
  if (type === 'dish') {
    const ids = Array.isArray(promo.dishIds) ? promo.dishIds : [];
    return ids.map(String).indexOf(String(dish._id)) >= 0;
  }
  return false;
}

// 返回该菜品命中的最优活动（折扣率最低）；没有返回 null
function bestPromotion(promos, dish) {
  let best = null;
  (promos || []).forEach(function (p) {
    if (!scopeMatch(p, dish)) return;
    const rate = Number(p.rate);
    if (!(rate > 0 && rate < 1)) return;
    if (!best || rate < Number(best.rate)) best = p;
  });
  return best;
}

// 计算购物车条目的预估优惠
// items: [{dishId, categoryId, price(单价，含规格/加料), qty, ...}]
function applyToItems(items, promos, now) {
  const list = Array.isArray(items) ? items : [];
  const active = activePromotions(promos, now);
  let originalTotal = 0;
  let total = 0;
  const discountMap = {};
  const decorated = list.map(function (it) {
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    const base = Number(it.price) || 0;
    const originalLine = round2(base * qty);
    const promo = bestPromotion(active, { _id: it.dishId, categoryId: it.categoryId });
    const rate = promo ? Number(promo.rate) : 1;
    const lineTotal = round2(originalLine * rate);
    const discount = round2(originalLine - lineTotal);
    originalTotal = round2(originalTotal + originalLine);
    total = round2(total + lineTotal);
    if (promo && discount > 0) {
      const key = promo._id || promo.name;
      if (!discountMap[key]) discountMap[key] = { promotionId: promo._id || '', name: promo.name || '促销活动', rate: rate, amount: 0 };
      discountMap[key].amount = round2(discountMap[key].amount + discount);
    }
    return Object.assign({}, it, {
      qty: qty,
      originalLine: originalLine,
      lineTotal: lineTotal,
      discountAmount: discount,
      hasDiscount: !!promo && discount > 0,
      promotionName: promo ? (promo.name || '') : '',
      discountRate: rate
    });
  });
  return {
    items: decorated,
    originalTotal: originalTotal,
    discountAmount: round2(originalTotal - total),
    total: total,
    discounts: Object.keys(discountMap).map(function (k) { return discountMap[k]; })
  };
}

module.exports = { round2, isActive, activePromotions, scopeMatch, bestPromotion, applyToItems };
