// 购物车：本地持久化购物车，按 菜品+规格 组合合并数量
const KEY = 'dsh_cart';

function loadCart() {
  try { return wx.getStorageSync(KEY) || []; } catch (e) { return []; }
}
function saveCart(list) {
  wx.setStorageSync(KEY, list);
}
function keyOf(item) {
  return item.dishId + '|' + (item.spec || '') + '|' + JSON.stringify(item.extras || []);
}
// 加车。step 为数量增量（可为负）。返回新购物车
function change(item, step, qty) {
  const list = loadCart();
  const k = keyOf(item);
  const idx = list.findIndex(i => keyOf(i) === k);
  if (idx >= 0) {
    let n = qty != null ? qty : (list[idx].qty + step);
    if (n <= 0) list.splice(idx, 1); else list[idx].qty = n;
  } else if (step > 0 || (qty != null && qty > 0)) {
    list.push({ ...item, qty: qty != null ? qty : step });
  }
  saveCart(list);
  return list;
}
function setItemQty(item, qty) { return change(item, 0, qty); }
function add(item) { return change(item, 1); }
function remove(item) { return change(item, -1); }
// 移除某个菜品（所有规格/加料组合），用于菜单已删除/下架后的脏购物车清理
function removeDish(dishId) {
  const list = loadCart().filter(i => String(i.dishId) !== String(dishId));
  saveCart(list);
  return list;
}
function clear() { wx.removeStorageSync(KEY); return []; }
function totalQty(list) {
  return (list || loadCart()).reduce((s, i) => s + i.qty, 0);
}
function totalAmount(list) {
  return (list || loadCart()).reduce((s, i) => s + i.qty * i.price, 0);
}
module.exports = { loadCart, add, remove, setItemQty, removeDish, clear, totalQty, totalAmount };
