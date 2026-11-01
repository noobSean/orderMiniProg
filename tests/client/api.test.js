'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/api.js
 * 覆盖：adminToken / subscribeTemplateIds 自动注入、ok:false 错误契约、
 *       NEED_ADMIN_LOGIN 清理会话、云函数名/参数契约、云数据库直读映射。
 * 全部基于 wx mock，不连网络。
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const api = require('../../miniprogram/utils/api.js');
const config = require('../../miniprogram/config/index.js');

const SESSION_KEY = 'dsh_admin_session';

let mock = null;

function setup(handlers) {
  mock = createWxMock({ handlers: handlers || {} }).install();
  return mock;
}

function validSession() {
  return { token: 'tok-valid', expireAt: Date.now() + 3600 * 1000 };
}

function lastFnCall() {
  return mock.lastCall('cloud.callFunction');
}

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

// 极简云数据库替身：记录每次 get() 的查询条件与返回数据
function createDatabaseStub(rows, log) {
  function collection(name) {
    const entry = { collection: name, where: null, orderBy: [], limit: null };
    const chain = {
      where: function (where) { entry.where = where; return chain; },
      orderBy: function (field, direction) { entry.orderBy.push([field, direction]); return chain; },
      limit: function (n) { entry.limit = n; return chain; },
      get: function () {
        log.push(entry);
        return Promise.resolve({ data: rows[name] || [] });
      }
    };
    return chain;
  }
  return { collection: collection };
}

test('成功响应：解包 result.data，并自动附带 adminToken 与 subscribeTemplateIds', async () => {
  setup({ callFunction: () => ({ result: { ok: true, data: { list: [1, 2] } } }) });
  mock.seedStorage(SESSION_KEY, validSession());
  const data = await api.myOrders();
  assert.deepEqual(data, { list: [1, 2] });
  const call = lastFnCall();
  assert.equal(call.args.name, 'myOrders');
  assert.equal(call.args.data.adminToken, 'tok-valid');
  assert.deepEqual(call.args.data.subscribeTemplateIds, config.subscribeTemplates);
});

test('无会话 / 会话过期时不附带 adminToken', async () => {
  setup({ callFunction: () => ({ result: { ok: true, data: null } }) });
  await api.login();
  assert.equal('adminToken' in lastFnCall().args.data, false);

  mock.seedStorage(SESSION_KEY, { token: 'expired', expireAt: Date.now() - 1000 });
  await api.login();
  assert.equal('adminToken' in lastFnCall().args.data, false);
});

test('ok:false：抛错并保留 code/message；业务错误不清会话', async () => {
  setup({
    callFunction: () => ({
      result: { ok: false, code: 'EMP_NO_TAKEN', message: '该工号已被其他微信绑定' }
    })
  });
  mock.seedStorage(SESSION_KEY, validSession());
  await assert.rejects(api.bindEmployee({ empNo: 'T1' }), (err) => {
    assert.equal(err.code, 'EMP_NO_TAKEN');
    assert.equal(err.message, '该工号已被其他微信绑定');
    return true;
  });
  assert.equal(mock.getStorage(SESSION_KEY).token, 'tok-valid', '业务错误不应清空管理会话');
});

test('NEED_ADMIN_LOGIN：抛错同时清空本地管理会话', async () => {
  setup({
    callFunction: () => ({
      result: { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
    })
  });
  mock.seedStorage(SESSION_KEY, validSession());
  await assert.rejects(api.adminOrders('list', {}), (err) => {
    assert.equal(err.code, 'NEED_ADMIN_LOGIN');
    assert.equal(err.message, '请先登录管理后台');
    return true;
  });
  assert.equal(mock.hasStorage(SESSION_KEY), false);
});

test('云函数响应为空时抛出明确错误', async () => {
  setup({ callFunction: () => ({}) });
  await assert.rejects(api.login(), /云函数响应为空/);
  setup({ callFunction: () => ({ result: null }) });
  await assert.rejects(api.login(), /云函数响应为空/);
});

test('云函数调用异常：保留 message；无 message 时提示网络异常', async () => {
  setup({ callFunction: () => { throw new Error('network down'); } });
  await assert.rejects(api.login(), /network down/);

  setup({ callFunction: () => { throw { errMsg: 'cloud.callFunction:fail timeout' }; } });
  await assert.rejects(api.login(), /网络异常，请重试/);
});

test('ok:false 但无 code/message：message 兜底为操作失败（空 code 不保留）', async () => {
  // 说明：api.js 仅在 err.code 为真值时原样抛出，空 code 会被包装成普通 Error；
  // 这里按现状固化契约，避免未来误改错误处理逻辑。
  setup({ callFunction: () => ({ result: { ok: false } }) });
  await assert.rejects(api.login(), (err) => {
    assert.equal(err.code, undefined);
    assert.equal(err.message, '操作失败');
    return true;
  });
});

test('云函数名与参数契约：全部业务/管理 API', async () => {
  setup({ callFunction: () => ({ result: { ok: true, data: null } }) });
  const cases = [
    { label: 'api.login()', run: () => api.login(), name: 'login', data: {} },
    {
      label: 'api.bindEmployee()',
      run: () => api.bindEmployee({ empNo: 'T0001', name: '张三' }),
      name: 'bindEmployee',
      data: { empNo: 'T0001', name: '张三' }
    },
    {
      label: 'api.submitOrder()',
      run: () => api.submitOrder({ items: [{ dishId: 'd1', qty: 1 }], delivery: { type: 'pickup' } }),
      name: 'submitOrder',
      data: { items: [{ dishId: 'd1', qty: 1 }], delivery: { type: 'pickup' } }
    },
    { label: 'api.myOrders()', run: () => api.myOrders(), name: 'myOrders', data: {} },
    {
      label: 'api.orderDetail(id)',
      run: () => api.orderDetail('order_1'),
      name: 'orderDetail',
      data: { orderId: 'order_1' }
    },
    { label: 'api.getDepartments()', run: () => api.getDepartments(), name: 'deptAdmin', data: { action: 'list' } },
    {
      label: 'api.deptAdmin(create)',
      run: () => api.deptAdmin('create', { name: '内科' }),
      name: 'deptAdmin',
      data: { action: 'create', name: '内科' }
    },
    {
      label: 'api.adminLogin(pwd)',
      run: () => api.adminLogin('pw123'),
      name: 'adminLogin',
      data: { action: 'login', pwd: 'pw123' }
    },
    {
      label: 'api.adminLogin({action:verify})',
      run: () => api.adminLogin({ action: 'verify', token: 'tk' }),
      name: 'adminLogin',
      data: { action: 'verify', token: 'tk' }
    },
    {
      label: 'api.employeeAdmin(list)',
      run: () => api.employeeAdmin('list', { keyword: '张' }),
      name: 'employeeAdmin',
      data: { action: 'list', keyword: '张' }
    },
    {
      label: 'api.adminOrders(list)',
      run: () => api.adminOrders('list', { status: 'pending' }),
      name: 'orderAdmin',
      data: { action: 'list', status: 'pending' }
    },
    {
      label: 'api.dishAdmin(save)',
      run: () => api.dishAdmin('save', { _id: 'd1' }),
      name: 'dishAdmin',
      data: { action: 'save', _id: 'd1' }
    },
    {
      label: 'api.categoryAdmin(list)',
      run: () => api.categoryAdmin('list'),
      name: 'categoryAdmin',
      data: { action: 'list' }
    },
    {
      label: 'api.settingsAdmin(save)',
      run: () => api.settingsAdmin('save', { storeName: 'A' }),
      name: 'settingsAdmin',
      data: { action: 'save', storeName: 'A' }
    },
    {
      label: 'api.adminStats(today)',
      run: () => api.adminStats({ mode: 'today' }),
      name: 'adminStats',
      data: { mode: 'today' }
    },
    {
      label: 'api.subscribeCheck()',
      run: () => api.subscribeCheck({ action: 'check' }),
      name: 'subscribeCheck',
      data: { action: 'check' }
    }
  ];

  for (const item of cases) {
    mock.clearStorage();
    mock.resetCalls();
    await item.run();
    const call = lastFnCall();
    assert.ok(call, item.label + ' 未调用云函数');
    assert.equal(call.args.name, item.name, item.label + ' 云函数名不符');
    const payload = call.args.data;
    Object.keys(item.data || {}).forEach(function (key) {
      assert.deepEqual(payload[key], item.data[key], item.label + ' 参数 ' + key + ' 不符');
    });
    assert.deepEqual(payload.subscribeTemplateIds, config.subscribeTemplates, item.label + ' 未附带订阅模板 ID');
    assert.equal('adminToken' in payload, false, item.label + ' 无会话时不应附带 adminToken');
  }
});

test('adminVerify / adminLogout：默认使用本地会话 token，可显式覆盖', async () => {
  setup({ callFunction: () => ({ result: { ok: true, data: null } }) });
  mock.seedStorage(SESSION_KEY, { token: 'tk-local', expireAt: Date.now() + 60000 });

  await api.adminVerify();
  assert.equal(lastFnCall().args.name, 'adminLogin');
  assert.equal(lastFnCall().args.data.action, 'verify');
  assert.equal(lastFnCall().args.data.token, 'tk-local');

  await api.adminVerify('tk-override');
  assert.equal(lastFnCall().args.data.token, 'tk-override');

  await api.adminLogout();
  assert.equal(lastFnCall().args.data.action, 'logout');
  assert.equal(lastFnCall().args.data.token, 'tk-local');
});

test('adminLogout：云端注销失败时静默返回 null（不阻塞本地清理）', async () => {
  setup({ callFunction: () => { throw new Error('cloud down'); } });
  mock.seedStorage(SESSION_KEY, validSession());
  const result = await api.adminLogout();
  assert.equal(result, null);
});

test('getMenu：客户端直读分类与在售菜品，并补齐默认字段', async () => {
  const log = [];
  const rows = {
    menu_categories: [{ _id: 'c1', name: '商务套餐', sort: 1 }],
    dishes: [
      {
        _id: 'd1',
        categoryId: 'c1',
        name: '黑椒牛柳饭',
        desc: '',
        image: '',
        price: 28,
        available: true,
        sort: 1
      },
      {
        _id: 'd2',
        categoryId: 'c1',
        name: '橙汁',
        desc: '鲜榨',
        image: 'cloud://x',
        price: 12,
        specs: [],
        extras: [],
        stock: null,
        unit: '杯',
        sort: 2
      }
    ]
  };
  setup({ database: () => createDatabaseStub(rows, log) });
  const menu = await api.getMenu();

  assert.equal(log.length, 2);
  assert.equal(log[0].collection, 'menu_categories');
  assert.deepEqual(log[0].orderBy, [['sort', 'asc']]);
  assert.equal(log[1].collection, 'dishes');
  assert.deepEqual(log[1].where, { available: true });
  assert.deepEqual(log[1].orderBy, [['sort', 'asc']]);

  assert.deepEqual(menu.categories, [{ _id: 'c1', name: '商务套餐', sort: 1 }]);
  assert.deepEqual(menu.dishes[0], {
    _id: 'd1',
    categoryId: 'c1',
    name: '黑椒牛柳饭',
    desc: '',
    image: '',
    price: 28,
    specs: [],
    extras: [],
    stock: undefined,
    soldOut: false,
    unit: '份',
    sort: 1
  });
  assert.equal(menu.dishes[1].unit, '杯');
  assert.equal(menu.dishes[1].stock, null);
});

test('getSettings：无配置时返回默认门店配置', async () => {
  const log = [];
  setup({ database: () => createDatabaseStub({ settings: [] }, log) });
  const settings = await api.getSettings();
  assert.deepEqual(settings, {
    storeName: '企业餐厅',
    openTime: '08:30',
    closeTime: '13:30',
    notice: '',
    allowSelfPickup: true,
    allowDelivery: true,
    locations: [],
    departments: [],
    phone: ''
  });
  assert.equal(log.length, 1);
  assert.equal(log[0].collection, 'settings');
  assert.equal(log[0].limit, 1);
});

test('getSettings：已有配置字段保留，仅缺省项用默认值（allowSelfPickup:false 不被覆盖）', async () => {
  const rows = {
    settings: [
      {
        storeName: '星辰餐厅',
        openTime: '09:00',
        closeTime: '14:00',
        notice: '公告',
        allowSelfPickup: false,
        locations: ['1号楼-3层'],
        departments: ['内科'],
        phone: '021-8888'
      }
    ]
  };
  setup({ database: () => createDatabaseStub(rows, []) });
  const settings = await api.getSettings();
  assert.equal(settings.storeName, '星辰餐厅');
  assert.equal(settings.openTime, '09:00');
  assert.equal(settings.closeTime, '14:00');
  assert.equal(settings.notice, '公告');
  assert.equal(settings.allowSelfPickup, false);
  assert.equal(settings.allowDelivery, true);
  assert.deepEqual(settings.locations, ['1号楼-3层']);
  assert.equal(settings.phone, '021-8888');
});

test('未开通云开发时，数据库直读 API 给出明确错误', async () => {
  setup();
  delete mock.wx.cloud;
  await assert.rejects(api.getMenu(), /开通云开发/);
  await assert.rejects(api.getSettings(), /开通云开发/);
});
