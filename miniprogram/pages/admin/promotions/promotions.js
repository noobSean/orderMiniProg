/**
 * 管理后台 —— 促销活动（proto）
 *
 * 支持：全部品类 / 指定分类 的折扣活动；同一菜品命中多个活动时取折扣最大者（不叠加）。
 * 时间可选（不填表示长期有效）；保存后 submitOrder 会按活动重新计算订单金额。
 */
const api = require('../../../utils/api.js');
const adminAuth = require('../../../utils/adminAuth.js');
const util = require('../../../utils/util.js');

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dateStr(ms) { const d = new Date(Number(ms)); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function timeStr(ms) { const d = new Date(Number(ms)); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function toMs(date, time) {
  if (!date) return null;
  const parts = String(date).split('-').map(Number);
  const t = String(time || '00:00').split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], t[0] || 0, t[1] || 0, 0, 0).getTime();
}
function fmt(ms) {
  if (ms === null || ms === undefined || ms === '') return '';
  return util.formatTimeValue(new Date(Number(ms))) || dateStr(ms) + ' ' + timeStr(ms);
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    list: [],
    categories: [],
    scopeTypes: [{ value: 'all', label: '全部品类' }, { value: 'category', label: '指定分类' }],
    form: {
      _id: '',
      name: '',
      discount: '',
      scopeType: 'all',
      categoryIds: [],
      startDate: '',
      startTime: '00:00',
      endDate: '',
      endTime: '23:59',
      enabled: true
    }
  },

  onShow() {
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.loadCategories();
    this.load();
  },

  async loadCategories() {
    let list = [];
    try {
      const m = await api.getMenu();
      list = (m && m.categories) || [];
    } catch (e) {
      const cached = wx.getStorageSync('dsh_menu');
      list = (cached && cached.categories) || [];
    }
    this.syncCatChecked(list, this.data.form.categoryIds);
    if (this.data.list.length) this.setData({ list: this.data.list.map(p => this.decorateItem(p)) });
  },

  // 分类 + 勾选状态（供 WXML 直接使用，避免在模板里调用 indexOf）
  syncCatChecked(categories, selected) {
    const sel = (selected || []).map(String);
    const cats = (categories || this.data.categories || []).map(c => Object.assign({}, c, { checked: sel.indexOf(String(c._id)) >= 0 }));
    this.setData({ categories: cats });
  },

  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const list = await api.promoAdmin('list');
      this.setData({ list: (list || []).map(this.decorateItem) });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  decorateItem(p) {
    const now = Date.now();
    const start = (p.startAt === null || p.startAt === undefined || p.startAt === '') ? null : Number(p.startAt);
    const end = (p.endAt === null || p.endAt === undefined || p.endAt === '') ? null : Number(p.endAt);
    let state = '进行中';
    if (p.enabled === false) state = '已停用';
    else if (start !== null && now < start) state = '未开始';
    else if (end !== null && now > end) state = '已结束';
    const rate = Number(p.rate) || 1;
    const zhe = Math.round(rate * 100) / 10;
    const cats = (p.categoryIds || []).map(id => {
      const c = (this.data.categories || []).find(x => x._id === id);
      return c ? c.name : id;
    });
    let scopeText = '全部品类';
    if (p.scopeType === 'category') scopeText = '分类：' + (cats.join('、') || '（未设置）');
    if (p.scopeType === 'dish') scopeText = '指定菜品 ' + ((p.dishIds || []).length) + ' 个';
    return Object.assign({}, p, {
      stateText: state,
      scopeText: scopeText,
      discountText: (Number.isInteger(zhe) ? zhe : zhe.toFixed(1)) + '折',
      timeText: (start === null && end === null) ? '长期有效' : ((start === null ? '不限' : fmt(start)) + ' ~ ' + (end === null ? '不限' : fmt(end)))
    });
  },

  onAdd() {
    this.setData({
      form: { _id: '', name: '', discount: '', scopeType: 'all', categoryIds: [], startDate: '', startTime: '00:00', endDate: '', endTime: '23:59', enabled: true }
    });
    this.syncCatChecked(this.data.categories, []);
  },

  onEdit(e) {
    const p = this.data.list[e.currentTarget.dataset.idx];
    if (!p) return;
    this.setData({
      form: {
        _id: p._id,
        name: p.name || '',
        discount: String(Math.round(Number(p.rate) * 100) / 10),
        scopeType: p.scopeType || 'all',
        categoryIds: (p.categoryIds || []).slice(),
        startDate: p.startAt ? dateStr(p.startAt) : '',
        startTime: p.startAt ? timeStr(p.startAt) : '00:00',
        endDate: p.endAt ? dateStr(p.endAt) : '',
        endTime: p.endAt ? timeStr(p.endAt) : '23:59',
        enabled: p.enabled !== false
      }
    }, () => this.syncCatChecked(this.data.categories, p.categoryIds || []));
  },

  onField(e) { this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value }); },
  onScope(e) { this.setData({ 'form.scopeType': e.detail.value }); },
  onCatChange(e) {
    this.setData({ 'form.categoryIds': e.detail.value });
    this.syncCatChecked(this.data.categories, e.detail.value);
  },
  onEnabled(e) { this.setData({ 'form.enabled': e.detail.value }); },
  onDate(e) { this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value }); },
  onTime(e) { this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value }); },

  async onSubmit() {
    if (this.data.saving) return;
    const f = this.data.form;
    const name = (f.name || '').trim();
    if (!name) return wx.showToast({ title: '请输入活动名称', icon: 'none' });
    const discount = Number(f.discount);
    if (!isFinite(discount) || discount < 1 || discount > 9.9) return wx.showToast({ title: '折扣需在 1-9.9 之间', icon: 'none' });
    if (f.scopeType === 'category' && !(f.categoryIds || []).length) return wx.showToast({ title: '请选择至少一个分类', icon: 'none' });
    const startAt = toMs(f.startDate, f.startTime);
    const endAt = toMs(f.endDate, f.endTime);
    if (f.startDate && startAt === null) return wx.showToast({ title: '开始时间不合法', icon: 'none' });
    if (f.endDate && endAt === null) return wx.showToast({ title: '结束时间不合法', icon: 'none' });
    if (startAt !== null && endAt !== null && startAt >= endAt) return wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' });
    this.setData({ saving: true });
    try {
      await api.promoAdmin('save', {
        _id: f._id || undefined,
        name: name,
        discount: discount,
        scopeType: f.scopeType,
        categoryIds: f.categoryIds,
        startAt: startAt,
        endAt: endAt,
        enabled: f.enabled !== false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.onAdd();
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async onToggle(e) {
    const p = this.data.list[e.currentTarget.dataset.idx];
    if (!p) return;
    try {
      await api.promoAdmin('toggle', { _id: p._id, enabled: !(p.enabled !== false) });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    }
  },

  onDelete(e) {
    const p = this.data.list[e.currentTarget.dataset.idx];
    if (!p) return;
    wx.showModal({
      title: '删除活动',
      content: '确定删除「' + (p.name || '') + '」？删除后不可恢复。',
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.promoAdmin('remove', { _id: p._id });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
        }
      }
    });
  }
});
