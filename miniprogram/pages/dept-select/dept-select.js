const api = require('../../utils/api');

const CACHE_KEY = 'dsh_depts';
const CACHE_TTL = 10 * 60 * 1000;

Page({
  data: {
    loading: true,
    keyword: '',
    groups: [],
    flat: [],
    total: 0
  },

  onLoad() { this.load(); },

  load() {
    let cache = null;
    try { cache = wx.getStorageSync(CACHE_KEY); } catch (e) { cache = null; }
    if (cache && cache.list && cache.ts && (Date.now() - cache.ts < CACHE_TTL)) {
      this.build(cache.list);
      this.setData({ loading: false });
    }
    api.getDepartments().then(list => {
      try { wx.setStorageSync(CACHE_KEY, { ts: Date.now(), list: list }); } catch (e) {}
      this.build(list);
      this.setData({ loading: false });
    }).catch(err => {
      this.setData({ loading: false });
      if (!cache) wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    });
  },

  build(list) {
    const map = {};
    const order = [];
    (list || []).forEach(d => {
      const rn = d.rootName || '其他';
      if (!map[rn]) { map[rn] = []; order.push(rn); }
      map[rn].push({ id: d._id, code: d.code, name: d.name, pinyin: d.pinyin || '' });
    });
    this.setData({
      flat: list || [],
      groups: order.map(rn => ({ rootName: rn, items: map[rn] })),
      total: (list || []).length,
      keyword: ''
    });
  },

  onSearch(e) {
    const kw = (e.detail.value || '').trim().toUpperCase();
    this.setData({ keyword: kw });
    if (!kw) { this.build(this.data.flat); return; }
    const matched = (this.data.flat || []).filter(d =>
      (d.name || '').toUpperCase().indexOf(kw) >= 0 || (d.pinyin || '').toUpperCase().indexOf(kw) >= 0
    );
    const map = {}; const order = [];
    matched.forEach(d => {
      const rn = d.rootName || '其他';
      if (!map[rn]) { map[rn] = []; order.push(rn); }
      map[rn].push({ id: d._id, code: d.code, name: d.name, pinyin: d.pinyin || '' });
    });
    this.setData({ groups: order.map(rn => ({ rootName: rn, items: map[rn] })) });
  },

  pick(e) {
    const ds = e.currentTarget.dataset;
    const payload = { id: ds.id, code: ds.code, name: ds.name, rootName: ds.root };
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) ch.emit('picked', payload);
    wx.navigateBack();
  }
});
