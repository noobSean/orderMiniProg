const api = require('../../utils/api');
const store = require('../../utils/store');
const subscribe = require('../../utils/subscribe');
const promo = require('../../utils/promo');

Page({
  data: {
    list: [],
    totalQty: 0,
    totalAmount: '0.00',
    discountAmount: '0.00',
    originalTotal: '0.00',
    promotions: [],
    settings: { allowSelfPickup: true, allowDelivery: true, locations: [] },
    takeWay: 'pickup',
    deptName: '',
    deptCode: '',
    location: '',
    note: '',
    submitting: false
  },

  onShow() {
    const s = wx.getStorageSync('dsh_settings');
    if (s) this.setData({ settings: s });
    const cachedPromos = wx.getStorageSync('dsh_promotions');
    if (cachedPromos && cachedPromos.length) this.setData({ promotions: promo.activePromotions(cachedPromos) });
    api.getPromotions().then(list => {
      wx.setStorageSync('dsh_promotions', list);
      this.setData({ promotions: promo.activePromotions(list) });
      this.refresh();
    }).catch(() => {});
    api.getSettings().then(s => { wx.setStorageSync('dsh_settings', s); this.setData({ settings: s }); }).catch(() => {});
    const p = getApp().getCachedProfile();
    if (p && p.dept && !this.data.deptName) this.setData({ deptName: p.dept });
    this.refresh();
  },

  refresh() {
    const raw = store.loadCart();
    const calc = promo.applyToItems(raw, this.data.promotions);
    this.setData({
      list: calc.items,
      totalQty: store.totalQty(raw),
      totalAmount: calc.total.toFixed(2),
      discountAmount: calc.discountAmount.toFixed(2),
      originalTotal: calc.originalTotal.toFixed(2)
    });
  },

  // 购物车操作只回传必要字段，避免把展示字段写回缓存
  baseItem(o) {
    return { dishId: o.dishId, categoryId: o.categoryId, name: o.name, price: o.price, spec: o.spec || '', extras: o.extras || [] };
  },

  onTakeWay(e) { this.setData({ takeWay: e.currentTarget.dataset.v }); },

  onPickDept() {
    wx.navigateTo({
      url: '/pages/dept-select/dept-select',
      events: {
        picked: (d) => this.setData({ deptName: d.name, deptCode: d.code || '' })
      }
    });
  },

  onLoc(e) { this.setData({ location: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  inc(e) { const o = this.data.list[e.currentTarget.dataset.idx]; if (o) { store.add(this.baseItem(o)); this.refresh(); } },
  dec(e) { const o = this.data.list[e.currentTarget.dataset.idx]; if (o) { store.remove(this.baseItem(o)); this.refresh(); } },
  del(e) { const o = this.data.list[e.currentTarget.dataset.idx]; if (o) { store.setItemQty(this.baseItem(o), 0); this.refresh(); } },
  goMenu() { wx.switchTab({ url: '/pages/menu/menu' }); },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.list.length) { wx.showToast({ title: '购物车为空', icon: 'none' }); return; }
    // 在用户点击（手势）内请求订阅：下单成功通知 + 对应方式的取餐/送达提醒（未配置模板时自动跳过）
    const subscribeTask = subscribe.requestForOrder(this.data.takeWay);
    const app = getApp();
    let profile = app.getCachedProfile();
    if (!profile) {
      // 本地登录态丢失（清缓存/换设备等）：先静默登录恢复，再决定是否去绑定
      wx.showLoading({ title: '登录中', mask: true });
      const r = await app.ensureLogin();
      wx.hideLoading();
      profile = (r && r.profile) || app.getCachedProfile();
      if (!profile) {
        if (r && r.state === 'logged_out') {
          wx.showToast({ title: '请先在「我的」页登录', icon: 'none' });
          setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 600);
        } else {
          wx.showToast({ title: '请先绑定工号', icon: 'none' });
          setTimeout(() => wx.navigateTo({ url: '/pages/bind/bind' }), 600);
        }
        return;
      }
      if (profile.dept && !this.data.deptName) this.setData({ deptName: profile.dept });
    }
    const takeWay = this.data.takeWay;
    if (takeWay === 'delivery' && !this.data.deptName) {
      wx.showToast({ title: '请选择配送科室', icon: 'none' });
      return;
    }
    // 等待订阅弹窗结果（用户取消/拒绝不阻断下单）
    try { await subscribeTask; } catch (e) {}
    this.setData({ submitting: true });
    const loc = (this.data.location || '').trim();
    const target = takeWay === 'delivery' ? (this.data.deptName + (loc ? '-' + loc : '')) : '';
    const payload = {
      type: takeWay,
      items: this.data.list.map(i => ({
        dishId: i.dishId, categoryId: i.categoryId, name: i.name, price: i.price, spec: i.spec || '', extras: i.extras || [], qty: i.qty
      })),
      delivery: {
        type: takeWay,
        target: target,
        note: takeWay === 'delivery' ? '' : (this.data.note || '')
      },
      note: this.data.note || ''
    };
    wx.showLoading({ title: '提交中' });
    api.submitOrder(payload).then(res => {
      wx.hideLoading();
      store.clear();
      const order = res && res.order ? res.order : (res || {});
      const orderId = (res && (res.orderId || res._id)) || order._id || order.orderId || '';
      const q = [];
      if (orderId) q.push('id=' + encodeURIComponent(orderId));
      const orderNo = res.orderNo || order.orderNo;
      const pickupNo = (res.pickupNo != null) ? res.pickupNo : (order.pickupNo != null ? order.pickupNo : '');
      const total = (res.total != null) ? res.total : (order.total != null ? order.total : '');
      if (orderNo) q.push('orderNo=' + encodeURIComponent(orderNo));
      if (pickupNo != null && pickupNo !== '') q.push('pickupNo=' + encodeURIComponent(pickupNo));
      if (total !== '') q.push('total=' + encodeURIComponent(total));
      wx.redirectTo({ url: '/pages/order-detail/order-detail?' + q.join('&') });
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      // 菜品已删除/不存在：自动移除脏购物车条目，提示刷新菜单
      if (err && err.code === 'DISH_NOT_FOUND') {
        if (err.dishId) store.removeDish(err.dishId);
        this.refresh();
        wx.showModal({
          title: '菜品已失效',
          content: (err.message || '菜品已不存在') + '\n已从购物车移除，请刷新菜单后重新选择。',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      wx.showToast({ title: (err && err.message) || '下单失败', icon: 'none' });
    });
  }
});
