const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');

function money(n) { return (Number(n) || 0).toFixed(2); }

Page({
  data: {
    ready: false,
    categories: [],
    activeCat: '',
    allDishesRaw: [],   // 完整原始菜品（编辑回填用）
    allDishes: [],      // 归一化后的菜品
    displayDishes: [],  // 按分类过滤后的展示
    fetching: true
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    this.setData({ fetching: true });
    try {
      let catRes = {};
      try { catRes = await api.getMenu(); } catch (e) { catRes = {}; }
      const categories = (catRes.categories || []).concat([]);
      let rawDishes = [];
      try { rawDishes = (await api.dishAdmin('list', {})) || []; }
      catch (e) { rawDishes = catRes.dishes || []; }

      const activeCat = this.data.activeCat || (categories.length ? categories[0]._id : '');
      this.setData({ categories, allDishesRaw: rawDishes, allDishes: rawDishes.map(d => this.normDish(d)), activeCat });
      this.refreshDisplay(activeCat);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ fetching: false });
    }
  },

  normDish(d) {
    return {
      _id: d._id,
      categoryId: d.categoryId || '',
      name: d.name || '',
      image: d.image || '',
      price: d.price,
      priceText: money(d.price),
      unit: d.unit || '份',
      available: d.available !== false,
      soldOut: (d.soldOutActive !== undefined) ? d.soldOutActive === true : (d.soldOut === true),
      specCount: (d.specs || []).length,
      extraCount: (d.extras || []).length
    };
  },

  refreshDisplay(cat) {
    const c = cat != null ? cat : this.data.activeCat;
    const { allDishes } = this.data;
    const list = c ? allDishes.filter(d => d.categoryId === c) : allDishes;
    this.setData({ displayDishes: list });
  },

  onCat(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ activeCat: id });
    this.refreshDisplay(id);
  },

  // 快捷售罄/恢复：高峰期一键操作，不改库存数字
  async onToggleSoldOut(e) {
    const id = e.currentTarget.dataset.id;
    const dish = this.data.allDishes.find(d => d._id === id);
    wx.showLoading({ title: '处理中' });
    try {
      await api.dishAdmin('toggleSoldOut', { dishId: id, soldOut: dish ? !dish.soldOut : undefined });
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onToggle(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '处理中' });
    try {
      const dish = this.data.allDishes.find(d => d._id === id);
      await api.dishAdmin('toggle', { dishId: id, available: dish ? !dish.available : undefined });
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onAddDish() {
    wx.removeStorageSync('dsh_dish_edit_raw');
    wx.navigateTo({ url: '/pages/admin/dish-edit' });
  },

  onEditDish(e) {
    const id = e.currentTarget.dataset.id;
    const raw = this.data.allDishesRaw.find(d => d._id === id) || null;
    wx.setStorageSync('dsh_dish_edit_raw', raw);
    wx.navigateTo({ url: '/pages/admin/dish-edit?id=' + id });
  },

  onAddCat() {
    wx.showModal({
      title: '新增分类', editable: true, placeholderText: '分类名称',
      success: async res => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return wx.showToast({ title: '名称不能为空', icon: 'none' });
        try {
          await api.categoryAdmin('create', { name, sort: this.data.categories.length });
          wx.showToast({ title: '已添加', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        }
      }
    });
  },

  onEditCat(e) {
    const id = e.currentTarget.dataset.id;
    const cat = this.data.categories.find(c => c._id === id);
    wx.showModal({
      title: '修改分类', editable: true, content: cat ? cat.name : '',
      success: async res => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return wx.showToast({ title: '名称不能为空', icon: 'none' });
        try {
          await api.categoryAdmin('update', { categoryId: id, name });
          wx.showToast({ title: '已更新', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        }
      }
    });
  },

  onDelCat(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除分类', content: '该操作不可恢复，确定删除？', confirmColor: '#fa5151',
      success: async res => {
        if (!res.confirm) return;
        try {
          await api.categoryAdmin('delete', { categoryId: id });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.setData({ activeCat: '' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        }
      }
    });
  }
});
