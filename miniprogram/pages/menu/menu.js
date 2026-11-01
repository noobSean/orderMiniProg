const api = require('../../utils/api');
const store = require('../../utils/store');
const promo = require('../../utils/promo');

// 原生 tabBar 显隐（低版本基础库用 fail 兜底，不影响交互）
function hideTabBar() {
  try { wx.hideTabBar({ animation: true, fail: function () {} }); } catch (e) {}
}
function showTabBar() {
  try { wx.showTabBar({ animation: true, fail: function () {} }); } catch (e) {}
}

Page({
  data: {
    storeName: '企业餐厅',
    openTime: '08:30',
    closeTime: '13:30',
    notice: '',
    categories: [],
    dishes: [],
    activeCat: null,
    catDishes: [],
    cartQty: 0,
    cartAmount: '0.00',
    promotions: [],
    qtyMap: {},
    // 规格/加料弹层
    showPopup: false,
    curDish: null,
    selSpecIdx: -1,
    selExtras: [],
    extraSel: [],        // 加料选中标记（与 extras 一一对应，供 WXML 直接判断，避免在 WXML 里调用 indexOf）
    popupPrice: '0.00',
    popupHasPromo: false,
    popupSalePrice: '0.00',
    popupPromoTag: '',
    popupQty: 1
  },

  onShow() {
    this.loadData();
    this.refreshCart();
  },

  // 切走页面时收起规格弹层（固定弹层无法盖住原生 tabBar，离开时需复位）
  onHide() {
    if (this.data.showPopup) {
      this.setData({ showPopup: false, curDish: null });
      showTabBar();
    }
  },

  loadData() {
    const st = wx.getStorageSync('dsh_settings');
    if (st) this.applySettings(st);
    const promosCached = wx.getStorageSync('dsh_promotions');
    if (promosCached && promosCached.length) this.setPromotions(promosCached);
    const m = wx.getStorageSync('dsh_menu');
    if (m) { this.setData({ categories: m.categories || [], dishes: this.decorateDishes(m.dishes || []) }); this.filterDishes(); }
    Promise.all([
      api.getSettings().catch(() => null),
      api.getMenu().catch(() => null),
      api.getPromotions().catch(() => null)
    ]).then(([s, menu, promos]) => {
      if (s) { wx.setStorageSync('dsh_settings', s); this.applySettings(s); }
      if (promos) {
        wx.setStorageSync('dsh_promotions', promos);
        this.setPromotions(promos);
      }
      if (menu) {
        wx.setStorageSync('dsh_menu', menu);
        this.setData({ categories: menu.categories || [], dishes: this.decorateDishes(menu.dishes || []) });
        this.filterDishes();
      }
      this.refreshCart();
    });
  },

  // 保存并筛选生效中的活动；重新装饰菜品价格
  setPromotions(list) {
    const active = promo.activePromotions(list || []);
    this.setData({ promotions: active });
    this.setData({ dishes: this.decorateDishes(this.data.dishes) });
    this.filterDishes();
  },

  // 给菜品加上促销展示字段（不改变原始价格，计算仍由服务端为准）
  decorateDishes(dishes) {
    const promos = this.data.promotions || [];
    return (dishes || []).map(d => {
      const p = promo.bestPromotion(promos, d);
      if (!p) return Object.assign({}, d, { hasPromo: false });
      const rate = Number(p.rate) || 1;
      const sale = promo.round2((Number(d.price) || 0) * rate);
      const zhe = Math.round(rate * 100) / 10;
      return Object.assign({}, d, {
        hasPromo: true,
        salePrice: sale.toFixed(2),
        promoTag: (Number.isInteger(zhe) ? zhe : zhe.toFixed(1)) + '折',
        promotionName: p.name || ''
      });
    });
  },

  applySettings(s) {
    this.setData({ storeName: s.storeName, openTime: s.openTime, closeTime: s.closeTime, notice: s.notice });
  },

  filterDishes() {
    const { dishes, activeCat, cart } = this.data;
    let cat = activeCat;
    if (!cat || !this.data.categories.some(c => c._id === cat)) {
      cat = this.data.categories.length ? this.data.categories[0]._id : null;
    }
    const list = cat ? dishes.filter(d => d.categoryId === cat) : dishes;
    const qtyMap = {};
    (cart || []).forEach(i => { qtyMap[i.dishId] = (qtyMap[i.dishId] || 0) + i.qty; });
    this.setData({ activeCat: cat, catDishes: list, qtyMap });
  },

  refreshCart() {
    const cart = store.loadCart();
    const qtyMap = {};
    cart.forEach(i => { qtyMap[i.dishId] = (qtyMap[i.dishId] || 0) + i.qty; });
    let amount = store.totalAmount(cart);
    try {
      const calc = promo.applyToItems(cart, this.data.promotions);
      amount = calc.total;
    } catch (e) {}
    this.setData({ cart, cartQty: store.totalQty(cart), cartAmount: amount.toFixed(2), qtyMap });
  },

  onCatTap(e) {
    this.setData({ activeCat: e.currentTarget.dataset.id });
    this.filterDishes();
  },

  // 点菜品/加号：无规格加料则直接加，有则弹规格选择
  onDishTap(e) {
    const id = e.currentTarget.dataset.id;
    const dish = this.data.dishes.find(d => d._id === id);
    if (!dish) return;
    if ((dish.specs && dish.specs.length) || (dish.extras && dish.extras.length)) {
      this.openSpec(dish);
    } else {
      store.add({ dishId: dish._id, categoryId: dish.categoryId, name: dish.name, price: dish.price, spec: '', extras: [] });
      this.refreshCart();
    }
  },

  onDec(e) {
    const id = e.currentTarget.dataset.id;
    const cart = store.loadCart();
    for (let i = cart.length - 1; i >= 0; i--) {
      if (cart[i].dishId === id) { store.remove(cart[i]); break; }
    }
    this.refreshCart();
  },

  // 规格/加料弹层
  openSpec(dish) {
    this.setData({
      showPopup: true,
      curDish: dish,
      selSpecIdx: (dish.specs && dish.specs.length) ? 0 : -1,
      selExtras: [],
      extraSel: (dish.extras || []).map(function () { return false; }),
      popupQty: 1
    });
    this.calcPopupPrice();
    // 弹层是 fixed 定位，盖不住原生 tabBar，打开时先隐藏 tabBar，避免误切页
    hideTabBar();
  },
  closePopup() {
    this.setData({ showPopup: false, curDish: null, selExtras: [], extraSel: [] });
    showTabBar();
  },
  onSpecTap(e) { this.setData({ selSpecIdx: e.currentTarget.dataset.idx }); this.calcPopupPrice(); },
  onExtraTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const sel = this.data.selExtras.slice();
    const flags = (this.data.extraSel || []).slice();
    const p = sel.indexOf(idx);
    if (p >= 0) {
      sel.splice(p, 1);
      flags[idx] = false;
    } else {
      sel.push(idx);
      flags[idx] = true;
    }
    this.setData({ selExtras: sel, extraSel: flags });
    this.calcPopupPrice();
  },
  onPopupQty(e) {
    const mode = e.currentTarget.dataset.mode;
    let q = this.data.popupQty;
    if (mode === 'dec') q -= 1; else q += 1;
    this.setData({ popupQty: Math.max(1, q) });
  },
  calcPopupPrice() {
    const d = this.data.curDish;
    if (!d) return;
    let p = d.price;
    if (this.data.selSpecIdx >= 0 && d.specs && d.specs[this.data.selSpecIdx]) p += d.specs[this.data.selSpecIdx].price;
    (this.data.selExtras || []).forEach(i => { if (d.extras && d.extras[i]) p += d.extras[i].price; });
    const matched = promo.bestPromotion(this.data.promotions, d);
    const rate = matched ? Number(matched.rate) : 1;
    const zhe = Math.round(rate * 100) / 10;
    this.setData({
      popupPrice: p.toFixed(2),
      popupHasPromo: !!matched,
      popupSalePrice: promo.round2(p * rate).toFixed(2),
      popupPromoTag: matched ? ((Number.isInteger(zhe) ? zhe : zhe.toFixed(1)) + '折') : ''
    });
  },
  confirmAdd() {
    const d = this.data.curDish;
    if (!d) return;
    const spec = (this.data.selSpecIdx >= 0 && d.specs && d.specs[this.data.selSpecIdx]) ? d.specs[this.data.selSpecIdx].name : '';
    const extras = this.data.selExtras.map(i => (d.extras && d.extras[i]) ? d.extras[i].name : '').filter(Boolean);
    const price = Number(this.data.popupPrice) || 0;
    const qty = Math.max(1, this.data.popupQty || 1);
    const item = { dishId: d._id, categoryId: d.categoryId, name: d.name, price, spec, extras };
    for (let i = 0; i < qty; i++) store.add(item);
    this.setData({ showPopup: false, curDish: null });
    showTabBar();
    this.refreshCart();
  },

  goCart() {
    if (this.data.cartQty <= 0) return;
    wx.navigateTo({ url: '/pages/cart/cart' });
  }
});
