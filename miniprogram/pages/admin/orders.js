const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const adminAuth = require('../../utils/adminAuth.js');

const STATUS = { pending: '待接', making: '制作中', ready: '可取出', done: '已完成', cancel: '已取消' };

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

const POLL_MS = 15000;

Page({
  data: {
    ready: false,
    fetchError: '',
    tabs: [
      { key: '', label: '全部' },
      { key: 'unpaid', label: '待收款' },
      { key: 'pending', label: '待接' },
      { key: 'making', label: '制作中' },
      { key: 'ready', label: '可取出' },
      { key: 'done', label: '已完成' }
    ],
    activeTab: '',
    orders: [],
    fetching: false
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this._knownIds = null;
    this.verifySessionAndLoad();
    this.startPoll();
  },

  // 服务端会话校验：本地 token 看似有效但云端会话可能已失效（改密/过期/被清理），先验证再拉数据
  async verifySessionAndLoad() {
    try {
      const v = await api.adminVerify();
      if (!v || v.valid !== true) {
        adminAuth.clear();
        wx.redirectTo({ url: adminAuth.loginUrl('/pages/admin/orders') });
        return;
      }
    } catch (err) {
      if (err && err.code === 'NEED_ADMIN_LOGIN') {
        adminAuth.clear();
        wx.redirectTo({ url: adminAuth.loginUrl('/pages/admin/orders') });
        return;
      }
      // 网络异常时仍尝试加载列表，列表错误会显示重试入口
    }
    this.load();
  },

  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },

  // 订单页自动轮询，店员不手动刷新也能看到新订单
  startPoll() {
    this.stopPoll();
    this._timer = setInterval(() => {
      if (!this.data.ready) return;
      this.load({ silent: true });
    }, POLL_MS);
  },
  stopPoll() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async load(opts) {
    const options = opts || {};
    if (this._loading) return;
    this._loading = true;
    if (!options.silent) this.setData({ fetching: true, fetchError: '' });
    try {
      const isUnpaidTab = this.data.activeTab === 'unpaid';
      const status = (this.data.activeTab && !isUnpaidTab) ? this.data.activeTab : undefined;
      const list = await api.adminOrders('list', { status, days: 30 });
      let orders = (list || []).map(o => this.normOrder(o));
      if (isUnpaidTab) orders = orders.filter(o => o.paymentUnpaid && o.status !== 'cancel');
      this.detectNewOrders(orders);
      console.log('[adminOrders] loaded', orders.length, 'orders')
      this.setData({ orders, fetchError: '' });
    } catch (err) {
      if (err && err.code === 'NEED_ADMIN_LOGIN') {
        this.stopPoll();
        adminAuth.clear();
        wx.redirectTo({ url: adminAuth.loginUrl('/pages/admin/orders') });
        return;
      }
      if (!options.silent) {
        this.setData({ fetchError: (err && err.message) || '加载失败' });
        wx.showToast({ title: this.data.fetchError, icon: 'none' });
      }
    } finally {
      this._loading = false;
      if (!options.silent) this.setData({ fetching: false });
    }
  },

  // 轮询发现新订单时提示（新订单 = 之前未出现过的 pending 订单）
  detectNewOrders(orders) {
    const pendingIds = (orders || []).filter(o => o.status === 'pending').map(o => o._id);
    const known = this._knownIds;
    if (!known) {
      this._knownIds = {};
      pendingIds.forEach(id => { this._knownIds[id] = true; });
      return;
    }
    const fresh = pendingIds.filter(id => !known[id]);
    pendingIds.forEach(id => { known[id] = true; });
    if (fresh.length) {
      try { wx.vibrateLong({ fail: function () {} }); } catch (e) {}
      wx.showToast({ title: '有新订单 +' + fresh.length, icon: 'none', duration: 2000 });
    }
  },

  normOrder(o) {
    const type = o.type === 'delivery' ? 'delivery' : 'pickup';
    const buyer = o.buyer || {};
    const items = o.items || o.dishes || [];
    let amount = o.amount != null ? o.amount
      : (o.total != null ? o.total : (o.totalAmount != null ? o.totalAmount : o.price));
    if (amount == null) {
      amount = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    }
    const st = normStatus(o.status);
    // 历史订单没有 paymentStatus 字段，按已收款处理；新订单显式 unpaid
    const paymentUnpaid = o.paymentStatus === 'unpaid';
    return {
      _id: o._id,
      orderNo: o.orderNo || o.no || ('NO' + String(o._id || '').slice(-6)),
      typeLabel: type === 'delivery' ? '配送' : '自取',
      name: buyer.name || o.name || '',
      empNo: buyer.empNo || o.empNo || '',
      dept: buyer.dept || o.dept || '',
      location: buyer.location || o.location || '',
      pickupNo: o.pickupNo || '',
      target: (o.delivery && o.delivery.target) || o.target || o.pickupNo || '',
      note: (o.delivery && o.delivery.note) || o.note || o.remark || o.notes || '',
      amountText: money(amount),
      status: st,
      statusLabel: STATUS[st],
      doneText: type === 'delivery' ? '完成' : '已取餐',
      paymentUnpaid: paymentUnpaid,
      paymentLabel: paymentUnpaid ? '待收款' : '已收款',
      time: fmtTime(o.createTime || o.createdAt || o.time || o.createDate),
      // 收款和交付合并：只有「待取餐且未收款」才显示「收款并交付」
      showCheckout: st === 'ready' && paymentUnpaid,
      checkoutText: type === 'delivery' ? '收款并完成' : '收款并交付',
      showAccept: st === 'pending',
      showMake: st === 'making',
      showDone: st === 'ready' && !paymentUnpaid,
      showCancel: st === 'pending' || st === 'making'
    };
  },

  onTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key });
    this._knownIds = null;
    this.load();
  },

  // 加载失败时手动重试
  reload() {
    this.setData({ fetchError: '' });
    this.verifySessionAndLoad();
  },

  // 页面顶部手动刷新
  onRefresh() {
    this._knownIds = null;
    this.reload();
  },

  onCard(e) {
    wx.navigateTo({ url: '/pages/admin/order-detail?id=' + e.currentTarget.dataset.id });
  },

  // 到店交付：一次完成「收款 + 完成 + 取餐核销」
  async onCheckout(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '处理中' });
    try {
      await api.adminOrders('checkout', { orderId: id });
      wx.showToast({ title: '已收款并完成', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onAction(e) {
    const { id, status } = e.currentTarget.dataset;
    wx.showLoading({ title: '处理中' });
    try {
      await api.adminOrders('status', { orderId: id, status });
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
