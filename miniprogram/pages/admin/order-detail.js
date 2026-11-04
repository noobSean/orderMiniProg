const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const adminAuth = require('../../utils/adminAuth.js');

const STATUS = { pending: '待接', making: '制作中', ready: '可取出', done: '已完成', cancel: '已取消' };
const TYPE = { pickup: '自取', delivery: '配送' };

function money(n) { return (Number(n) || 0).toFixed(2); }

function normStatus(s) {
  if (s == null) return 'pending';
  const str = String(s).toLowerCase();
  // 服务端取消态是 cancelled（英文），管理端展示键是 cancel；必须做别名归一化，
  // 否则 cancelled 会被当成未知状态落到 pending，订单看起来“没更新”。
  if (str === 'cancelled' || str === 'canceled' || str === 'cancel') return 'cancel';
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
    primaryAction: null,
    canCancel: false,
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
      this.setData({
        detail: this.normDetail(o || {}),
        primaryAction: this.buildPrimaryAction(o || {}),
        canCancel: this.canCancel(o || {})
      });
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

  // 底部只放当前状态唯一的“主流程”按钮，避免三个同等权重大按钮堆在底部
  buildPrimaryAction(o) {
    const st = normStatus(o.status);
    const type = o.type === 'delivery' ? 'delivery' : 'pickup';
    if (st === 'pending') return { key: 'making', text: '接单' };
    if (st === 'making') return { key: 'ready', text: type === 'delivery' ? '开始配送' : '制作完成' };
    if (st === 'ready') {
      // 到店取餐/配送时先收款再完成：未收款用「收款并交付」，已收款才是「已取餐」
      if (o.paymentStatus === 'unpaid') {
        return { key: 'checkout', text: type === 'delivery' ? '收款并完成配送' : '收款并交付' };
      }
      return { key: 'done', text: type === 'delivery' ? '完成配送' : '已取餐' };
    }
    return null;
  },

  // 只有待接/制作中可以取消；取消是次要操作，放在底部左侧文字链
  canCancel(o) {
    const st = normStatus(o.status);
    // 待取餐也允许取消：员工一直不来时释放库存，避免爽约单占库存
    return st === 'pending' || st === 'making' || st === 'ready';
  },

  onAction(e) {
    const key = e.currentTarget.dataset.status;
    if (key === 'checkout') {
      this.checkout();
      return;
    }
    this.updateStatus(key);
  },

  // 到店交付：一次完成「收款 + 完成 + 取餐核销」
  async checkout() {
    wx.showLoading({ title: '处理中' });
    try {
      await api.adminOrders('checkout', { orderId: this.data.orderId });
      wx.showToast({ title: '已收款并完成', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 取消前二次确认，避免误触（取消会回补库存）
  onCancel() {
    wx.showModal({
      title: '取消订单',
      content: '取消后不可恢复，库存会自动回补。确定取消该订单？',
      confirmColor: '#fa5151',
      confirmText: '取消订单',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.updateStatus('cancel');
      }
    });
  },

  async updateStatus(status) {
    wx.showLoading({ title: '处理中' });
    try {
      await api.adminOrders('status', { orderId: this.data.orderId, status });
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
