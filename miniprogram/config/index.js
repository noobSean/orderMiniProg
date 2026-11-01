// 云开发环境 ID：请在微信开发者工具「云开发」控制台创建环境后，把环境 ID 填到这里
// 例如：module.exports = { envId: 'your-env-id' }
//
// 注意：管理口令不保存在小程序端、也不写进代码仓库，
// 只配置在云函数 adminLogin 的环境变量 ADMIN_PWD 中。
const config = {
  envId: 'cloud1-d7gldcn8i241bc206',

  // 订阅消息模板 ID（公众平台 → 功能 → 订阅消息 中选用模板后填写）
  // 必须与云函数里配置的模板 ID 一致（可用云函数环境变量覆盖）：
  //   orderPlaced  → cloudfunctions/submitOrder  ORDER_PLACED_TEMPLATE_ID
  //   pickupReady  → cloudfunctions/orderAdmin   PICKUP_READY_TEMPLATE_ID
  //   deliveryDone → cloudfunctions/orderAdmin   DELIVERY_DONE_TEMPLATE_ID
  subscribeTemplates: {
    orderPlaced: 'k4MrpvyOKcl0OjnjnSOindjCElXk4nx3uC7EeV3T3kY',    // 下单成功通知（自取/配送都发）
    pickupReady: 'hbuCrsbQ-ISbc4qIx0HugeAwp5py_WL9fl4tzaiulIE',    // 自取：餐品可取提醒
    deliveryDone: 'YFRZvcJMIB0o2rWe7p0s3ujFXBQkK4O3Sv9wT-n73NY'    // 配送：已送达提醒
  }
};

module.exports = config;
