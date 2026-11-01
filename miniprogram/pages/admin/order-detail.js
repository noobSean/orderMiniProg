const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const adminAuth = require('../../utils/adminAuth.js');

const STATUS = { pending: '待接', making: '制作中', ready: '可取出', done: '已完成', cancel: '已取消' };
const TYPE = { pickup: '自取', delivery: '配送' };

function money(n) { return (Number(n) || 0).toFixed(2); }

function normStatus(s) {
  if (s == null) return 'pending';
  const str = String(s).toLowerCase();
  if (STATUS[str]) return str;
  for (const k in STATUS) if (STATUS[k] === String(s)) return k;
  return 'pending';
}

function fmtTime(v) {
  if (!v) return '';
  return util.formatTimeValue(v) || String(v);
}

Page({
  data: {
    ready: false,
    orderId: '',
    detail: null,
    actions: [],
    fetching: true
  },

  onLoad(options) { this.setData({ orderId: options.id || '' }); },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    if (!this.data.orderId) { this.setData({ fetching: false }); return; }
    this.setData({ fetching: true });
    try {
      const o = await api.orderDetail(this.data.orderId);
      this.setData({ detail: this.normDetail(o || {}), actions: this.buildActions(o || {}) });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ fetching: false });
    }
  },

  normDetail(o) {
    const type = o.type === 'delivery' ? 'delivery' : 'pickup';
    const buyer = o.buyer || {};
    const items = (o.items || o.dishes || []).map((i, idx) => {
      const unitPrice = Number(i.price) || 0;
      const extraSum = (i.extras || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
      const qty = Number(i.qty) || 1;
      return {
        _id: i._id || idx,
        name: i.name || '',
        spec: i.spec || '',
        extras: i.extras || [],
        price: unitPrice,
        qty,
        lineTotal: money((unitPrice + extraSum) * qty)
      };
    });
    let amount = o.amount != null ? o.amount
      : (o.total != null ? o.total : (o.totalAmount != null ? o.totalAmount : null));
    if (amount == null) amount = items.reduce((s, i) => s + Number(i.lineTotal), 0);
    const discountAmount = Number(o.discountAmount) || 0;
    const originalTotal = (o.originalTotal != null) ? Number(o.originalTotal) : (Number(amount) + discountAmount);
    const st = normStatus(o.status);
    const history = (o.statusHistory || []).map(h => ({
      text: (h.text || h.label || STATUS[normStatus(h.status)] || h.status || ''),
      status: h.status || '',
      time: fmtTime(h.time || h.createTime || h.t)
    }));
    return {
      _id: o._id,
      orderId: o._id,
      orderNo: o.orderNo || o.no || ('NO' + String(o._id || '').slice(-6)),
      type,
      typeLabel: TYPE[type] || type,
      status: st,
      statusLabel: STATUS[st],
      statusClass: st,
      name: buyer.name || o.name || '',
      empNo: buyer.empNo || o.empNo || '',
      dept: buyer.dept || o.dept || '',
      location: buyer.location || o.location || '',
      pickupNo: o.pickupNo || '',
      target: (o.delivery && o.delivery.target) || o.target || '',
      paymentUnpaid: o.paymentStatus === 'unpaid',
      paymentLabel: o.paymentStatus === 'unpaid' ? '待收款' : '已收款',
      paidAt: fmtTime(o.paidAt),
      pickedUpAt: fmtTime(o.pickedUpAt),
      note: (o.delivery && o.delivery.note) || o.note || o.remark || o.notes || '',
      time: fmtTime(o.createTime || o.createdAt || o.time || o.createDate),
      items,
      totalText: money(amount),
      discountAmount: discountAmount,
      discountText: discountAmount > 0 ? money(discountAmount) : '',
      originalTotalText: discountAmount > 0 ? money(originalTotal) : '',
      history
    };
  },

  buildActions(o) {
    const st = normStatus(o.status);
    const type = o.type === 'delivery' ? 'delivery' : 'pickup';
    const A = [];
    if (o.paymentStatus === 'unpaid' && st !== 'cancelled') {
      A.push({ key: 'pay', text: '标记已收款', type: 'pay' });
    }
    if (st === 'pending') {
      A.push({ key: 'making', text: '接单', type: 'primary' });
      A.push({ key: 'cancel', text: '取消', type: 'danger' });
    } else if (st === 'making') {
      A.push({ key: 'ready', text: '制作完成', type: 'primary' });
      if (type === 'delivery') A.push({ key: 'ready', text: '配送', type: 'plain' });
      A.push({ key: 'cancel', text: '取消', type: 'danger' });
    } else if (st === 'ready') {
      A.push({ key: 'done', text: type === 'delivery' ? '完成' : '已取餐', type: 'primary' });
    }
    return A;
  },

  async onAction(e) {
    const status = e.currentTarget.dataset.status;
    wx.showLoading({ title: '处理中' });
    try {
      if (status === 'pay') {
        await api.adminOrders('pay', { orderId: this.data.orderId });
      } else {
        await api.adminOrders('status', { orderId: this.data.orderId, status });
      }
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
