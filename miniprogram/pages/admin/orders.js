const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const adminAuth = require('../../utils/adminAuth.js');

const STATUS = { pending: '待接', making: '制作中', ready: '可取出', done: '已完成', cancel: '已取消' };

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
    fetchError: '',
    tabs: [
      { key: '', label: '全部' },
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
    this.load();
  },

  async load() {
    this.setData({ fetching: true, fetchError: '' });
    try {
      const status = this.data.activeTab || undefined;
      const list = await api.adminOrders('list', { status });
      this.setData({ orders: (list || []).map(o => this.normOrder(o)) });
    } catch (err) {
      this.setData({ fetchError: (err && err.message) || '加载失败' });
      wx.showToast({ title: this.data.fetchError, icon: 'none' });
    } finally {
      this.setData({ fetching: false });
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
    return {
      _id: o._id,
      orderNo: o.orderNo || o.no || ('NO' + String(o._id || '').slice(-6)),
      typeLabel: type === 'delivery' ? '配送' : '自取',
      name: buyer.name || o.name || '',
      empNo: buyer.empNo || o.empNo || '',
      dept: buyer.dept || o.dept || '',
      location: buyer.location || o.location || '',
      target: o.target || o.pickupNo || '',
      note: (o.delivery && o.delivery.note) || o.note || o.remark || o.notes || '',
      amountText: money(amount),
      status: st,
      statusLabel: STATUS[st],
      time: fmtTime(o.createTime || o.createdAt || o.time || o.createDate),
      showAccept: st === 'pending',
      showMake: st === 'making',
      showDeliver: st === 'making' && type === 'delivery',
      showDone: st === 'ready',
      showCancel: st === 'pending' || st === 'making'
    };
  },

  onTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key });
    this.load();
  },

  onCard(e) {
    wx.navigateTo({ url: '/pages/admin/order-detail?id=' + e.currentTarget.dataset.id });
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
