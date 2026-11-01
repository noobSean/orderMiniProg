const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');
const util = require('../../utils/util.js');

const STATUS = { pending: '待接', making: '制作中', ready: '可取出', done: '已完成', cancel: '已取消' };

function money(n) { return (Number(n) || 0).toFixed(2); }

function normKey(s) {
  if (s == null) return 'pending';
  const str = String(s).toLowerCase();
  if (STATUS[str]) return str;
  for (const k in STATUS) if (STATUS[k] === String(s)) return k;
  return 'pending';
}

Page({
  data: {
    ready: false,
    mode: 'today',       // today | range
    from: '',
    to: '',
    fetching: true,
    result: null
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode });
    this.load();
  },

  onFrom(e) { this.setData({ from: e.detail.value }); },
  onTo(e) { this.setData({ to: e.detail.value }); },

  refresh() { this.load(); },

  async load() {
    this.setData({ fetching: true });
    let payload = { mode: this.data.mode };
    if (this.data.mode === 'range') {
      if (!this.data.from || !this.data.to) {
        const d = new Date();
        const today = d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate());
        if (!this.data.from) this.setData({ from: today });
        if (!this.data.to) this.setData({ to: today });
        payload = { mode: 'range', from: this.data.from || today, to: this.data.to || today };
      } else {
        payload = { mode: 'range', from: this.data.from, to: this.data.to };
      }
    }
    try {
      const r = await api.adminStats(payload);
      this.setData({ result: this.normResult(r || {}) });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ fetching: false });
    }
  },

  normResult(r) {
    const byTypeRaw = r.byType || {};
    const byStatusRaw = r.byStatus || {};
    let byStatus = [];
    if (Array.isArray(byStatusRaw)) {
      byStatus = byStatusRaw.map(s => ({
        key: normKey(s.status || s.key || s.name),
        label: STATUS[normKey(s.status || s.key || s.name)],
        count: s.count || s.value || 0
      }));
    } else {
      const order = ['pending', 'making', 'ready', 'done', 'cancel'];
      order.forEach(k => {
        const v = byStatusRaw[k] != null ? byStatusRaw[k] : byStatusRaw[STATUS[k]];
        if (v != null) byStatus.push({ key: k, label: STATUS[k], count: v });
      });
    }

    let topDishes = r.topDishes || r.hotDishes || r.topProducts || [];
    topDishes = (Array.isArray(topDishes) ? topDishes : []).map(d => ({
      _id: d._id || d.dishId || d.name || 'x',
      name: d.name || d.dishName || '—',
      count: d.count || d.qty || d.quantity || 0,
      amountText: money(d.amount != null ? d.amount : (d.total != null ? d.total : 0))
    }));

    const maxBar = byStatus.reduce((m, s) => Math.max(m, Number(s.count) || 0), 0) || 1;
    return {
      orderCount: r.orderCount != null ? r.orderCount : (r.total || 0),
      revenueText: money(r.revenue != null ? r.revenue : (r.totalAmount != null ? r.totalAmount : (r.amount != null ? r.amount : 0))),
      pickupCount: r.pickupCount != null ? r.pickupCount : (byTypeRaw.pickup || 0),
      deliveryCount: r.deliveryCount != null ? r.deliveryCount : (byTypeRaw.delivery || 0),
      byStatus,
      topDishes,
      maxBar
    };
  }
});
