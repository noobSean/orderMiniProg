const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');
const subscribe = require('../../utils/subscribe.js');

Page({
  data: {
    ready: false,
    saving: false,
    form: {
      storeName: '',
      openTime: '08:30',
      closeTime: '13:30',
      notice: '',
      phone: '',
      allowSelfPickup: true,
      allowDelivery: true,
      departments: [],
      locations: []
    }
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    try {
      const s = await api.getSettings();
      this.setData({
        form: {
          storeName: s.storeName || '',
          openTime: s.openTime || '08:30',
          closeTime: s.closeTime || '13:30',
          notice: s.notice || '',
          phone: s.phone || '',
          allowSelfPickup: s.allowSelfPickup !== false,
          allowDelivery: s.allowDelivery !== false,
          departments: (s.departments || []).concat([]),
          locations: (s.locations || []).concat([])
        }
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    }
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },
  onSwitch(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },
  onTime(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  // 部门动态增删
  onDept(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ ['form.departments[' + i + ']']: e.detail.value });
  },
  addDept() { this.setData({ 'form.departments': this.data.form.departments.concat(['']) }); },
  delDept(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.form.departments.slice();
    arr.splice(i, 1);
    this.setData({ 'form.departments': arr });
  },

  // 配送位置动态增删
  onLoc(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ ['form.locations[' + i + ']']: e.detail.value });
  },
  addLoc() { this.setData({ 'form.locations': this.data.form.locations.concat(['']) }); },
  delLoc(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.form.locations.slice();
    arr.splice(i, 1);
    this.setData({ 'form.locations': arr });
  },

  goDeptManage() { wx.navigateTo({ url: '/pages/admin/dept-manage' }); },

  /* ---------------- 订阅消息自检 ---------------- */

  // 检查三个通知模板的配置/账号内是否存在/字段映射
  async onNotifyCheck() {
    wx.showLoading({ title: '检查中', mask: true });
    try {
      const data = await api.subscribeCheck({ action: 'check' });
      wx.hideLoading();
      wx.showModal({ title: '通知配置检查', content: this.notifySummary(data), showCancel: false, confirmText: '知道了' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '检查失败', icon: 'none' });
    }
  },

  // 发送测试通知：先请求订阅授权，再让云函数给当前微信发一条测试消息
  async onNotifyTest(e) {
    const kind = e.currentTarget.dataset.kind;
    const names = { orderPlaced: '下单成功通知', pickupReady: '可取餐提醒', deliveryDone: '已送达提醒' };
    // 1) 请求订阅授权（必须用户点击触发）
    wx.showLoading({ title: '请求授权', mask: true });
    let sub = { ok: false, status: 'fail' };
    try { sub = await subscribe.request([kind]); } catch (err) {}
    wx.hideLoading();
    // 2) 调云函数检查并发送
    wx.showLoading({ title: '发送测试', mask: true });
    try {
      const data = await api.subscribeCheck({ action: 'check', kinds: [kind], send: true });
      wx.hideLoading();
      const item = (data && data.results && data.results[0]) || {};
      wx.showModal({
        title: (names[kind] || '通知') + '测试结果',
        content: this.notifyItemSummary(item) + '\n订阅授权：' + (sub && sub.ok ? '已允许' : ('未允许（' + ((sub && sub.status) || 'fail') + '）')),
        showCancel: false,
        confirmText: '知道了'
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '测试失败', icon: 'none' });
    }
  },

  notifyStatusText(status) {
    const map = {
      ok: '✅ 模板正常',
      not_configured: '❌ 未配置模板 ID',
      template_not_found: '❌ 模板 ID 不在当前账号下',
      template_list_failed: '⚠️ 拉取模板列表失败'
    };
    return map[status] || ('❓ ' + status);
  },

  notifyItemSummary(item) {
    const lines = [];
    lines.push('【' + (item.title || item.kind || '') + '】' + this.notifyStatusText(item.status));
    if (item.templateTitle) lines.push('模板：' + item.templateTitle);
    if (item.mapping && item.mapping.length) {
      lines.push('字段：' + item.mapping.map(m => m.label + '→' + m.keyword).join('、'));
    }
    if (item.message) lines.push(item.message);
    if (item.availableTemplates && item.availableTemplates.length) {
      lines.push('账号已有模板：' + item.availableTemplates.map(t => t.title).join('、'));
    }
    if (item.error) lines.push('错误：' + (item.error.errCode || '') + ' ' + (item.error.errMsg || ''));
    if (item.sendResult) {
      lines.push('测试发送：' + (item.sendResult.ok ? '✅ 已发送，请查看微信「服务通知」' :
        ('❌ 失败 ' + (item.sendResult.errCode || '') + ' ' + (item.sendResult.errMsg || '') + (Number(item.sendResult.errCode) === 43101 ? '（未授权，请先点允许）' : ''))));
    }
    return lines.join('\n');
  },

  notifySummary(data) {
    if (!data || !data.results) return '未返回检查结果';
    const lines = [];
    if (data.templateListError) {
      lines.push('⚠️ 拉取账号模板列表失败：' + (data.templateListError.errCode || '') + ' ' + (data.templateListError.errMsg || ''));
      lines.push('请确认云函数 subscribeCheck 已部署，且云调用权限已生效（约 10 分钟）。');
    } else {
      lines.push('账号下模板数量：' + (data.accountTemplateCount != null ? data.accountTemplateCount : '未知'));
    }
    data.results.forEach(item => { lines.push(''); lines.push(this.notifyItemSummary(item)); });
    return lines.join('\n');
  },

  async onSave() {
    const f = this.data.form;
    if (!(f.storeName || '').trim()) return wx.showToast({ title: '请填写门店名称', icon: 'none' });
    this.setData({ saving: true });
    try {
      await api.settingsAdmin('update', {
        storeName: f.storeName,
        openTime: f.openTime,
        closeTime: f.closeTime,
        notice: f.notice,
        phone: f.phone,
        allowSelfPickup: f.allowSelfPickup,
        allowDelivery: f.allowDelivery,
        locations: f.locations.map(x => x).filter(x => (x || '').trim())
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
