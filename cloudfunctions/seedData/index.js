const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 仅用于测试环境。上线前请删除或不部署本函数。
// 调用方式：云开发控制台 → 云函数 → seedData → 测试，参数：{"key":"seed2024"}
// 可选：{"key":"seed2024","withOrders":false} 只写门店配置、菜品与科室，不写示例订单
const KEY = 'seed2024'

const SETTINGS = {
  "_id": "settings_main",
  "storeName": "星辰科技 · 员工餐厅",
  "openTime": "08:30",
  "closeTime": "13:30",
  "notice": "每周一至周五 8:30–13:30 供应；11:30–12:30 为用餐高峰，建议错峰下单。",
  "allowSelfPickup": true,
  "allowDelivery": true,
  "locations": [
    "1号楼-3层-前台",
    "1号楼-5层-茶水间",
    "2号楼-2层-工位区",
    "2号楼-8层-会议室",
    "3号楼-B1-食堂取餐口"
  ],
  "departments": [
    "技术部",
    "产品部",
    "市场部",
    "行政部",
    "财务部",
    "人力资源部"
  ],
  "phone": "021-8888-6666"
}

const CATEGORIES = [
  {
    "_id": "cat_1",
    "name": "商务套餐",
    "sort": 1
  },
  {
    "_id": "cat_2",
    "name": "米饭主食",
    "sort": 2
  },
  {
    "_id": "cat_3",
    "name": "面点小吃",
    "sort": 3
  },
  {
    "_id": "cat_4",
    "name": "饮品",
    "sort": 4
  },
  {
    "_id": "cat_5",
    "name": "甜点",
    "sort": 5
  }
]

const DISHES = [
  {
    "_id": "dish_1",
    "categoryId": "cat_1",
    "name": "黑椒牛柳饭",
    "desc": "黑椒风味牛柳，配时蔬与米饭",
    "image": "",
    "price": 28,
    "specs": [
      {
        "name": "标准份",
        "price": 0
      },
      {
        "name": "大份",
        "price": 5
      }
    ],
    "extras": [
      {
        "name": "加蛋",
        "price": 2
      },
      {
        "name": "加饭",
        "price": 1
      }
    ],
    "stock": 50,
    "unit": "份",
    "sort": 1,
    "available": true
  },
  {
    "_id": "dish_2",
    "categoryId": "cat_1",
    "name": "宫保鸡丁套餐",
    "desc": "川味宫保鸡丁，含米饭与小菜",
    "image": "",
    "price": 26,
    "specs": [],
    "extras": [
      {
        "name": "加辣",
        "price": 0
      },
      {
        "name": "加饭",
        "price": 1
      }
    ],
    "stock": null,
    "unit": "份",
    "sort": 2,
    "available": true
  },
  {
    "_id": "dish_3",
    "categoryId": "cat_1",
    "name": "番茄炒蛋盖饭",
    "desc": "家常番茄炒蛋盖饭",
    "image": "",
    "price": 18,
    "specs": [],
    "extras": [],
    "stock": 30,
    "unit": "份",
    "sort": 3,
    "available": true
  },
  {
    "_id": "dish_4",
    "categoryId": "cat_2",
    "name": "扬州炒饭",
    "desc": "粒粒分明，配火腿与青豆",
    "image": "",
    "price": 16,
    "specs": [
      {
        "name": "标准",
        "price": 0
      },
      {
        "name": "加大量",
        "price": 4
      }
    ],
    "extras": [],
    "stock": 40,
    "unit": "份",
    "sort": 1,
    "available": true
  },
  {
    "_id": "dish_5",
    "categoryId": "cat_2",
    "name": "卤肉饭",
    "desc": "台式卤肉配溏心蛋",
    "image": "",
    "price": 22,
    "specs": [],
    "extras": [
      {
        "name": "加卤蛋",
        "price": 2
      }
    ],
    "stock": 25,
    "unit": "份",
    "sort": 2,
    "available": true
  },
  {
    "_id": "dish_6",
    "categoryId": "cat_3",
    "name": "手工水饺(12只)",
    "desc": "现包水饺，可选馅料",
    "image": "",
    "price": 20,
    "specs": [
      {
        "name": "猪肉白菜",
        "price": 0
      },
      {
        "name": "韭菜鸡蛋",
        "price": 2
      }
    ],
    "extras": [],
    "stock": 20,
    "unit": "份",
    "sort": 1,
    "available": true
  },
  {
    "_id": "dish_7",
    "categoryId": "cat_3",
    "name": "牛肉面",
    "desc": "清汤牛肉面",
    "image": "",
    "price": 24,
    "specs": [],
    "extras": [
      {
        "name": "加牛肉",
        "price": 6
      }
    ],
    "stock": 15,
    "unit": "碗",
    "sort": 2,
    "available": true
  },
  {
    "_id": "dish_8",
    "categoryId": "cat_4",
    "name": "鲜榨橙汁",
    "desc": "当日鲜榨",
    "image": "",
    "price": 12,
    "specs": [
      {
        "name": "中杯",
        "price": 0
      },
      {
        "name": "大杯",
        "price": 3
      }
    ],
    "extras": [],
    "stock": null,
    "unit": "杯",
    "sort": 1,
    "available": true
  },
  {
    "_id": "dish_9",
    "categoryId": "cat_4",
    "name": "美式咖啡",
    "desc": "现磨美式",
    "image": "",
    "price": 10,
    "specs": [],
    "extras": [],
    "stock": 100,
    "unit": "杯",
    "sort": 2,
    "available": true
  },
  {
    "_id": "dish_10",
    "categoryId": "cat_4",
    "name": "冰红茶",
    "desc": "柠檬冰红茶",
    "image": "",
    "price": 5,
    "specs": [],
    "extras": [],
    "stock": null,
    "unit": "杯",
    "sort": 3,
    "available": true
  },
  {
    "_id": "dish_11",
    "categoryId": "cat_4",
    "name": "矿泉水",
    "desc": "瓶装饮用水",
    "image": "",
    "price": 3,
    "specs": [],
    "extras": [],
    "stock": 200,
    "unit": "瓶",
    "sort": 4,
    "available": true
  },
  {
    "_id": "dish_12",
    "categoryId": "cat_5",
    "name": "提拉米苏",
    "desc": "意式经典甜点",
    "image": "",
    "price": 15,
    "specs": [],
    "extras": [],
    "stock": 8,
    "unit": "份",
    "sort": 1,
    "available": true
  },
  {
    "_id": "dish_13",
    "categoryId": "cat_5",
    "name": "芝士蛋糕",
    "desc": "重芝士（库存为0，用于测试售罄拦截）",
    "image": "",
    "price": 18,
    "specs": [],
    "extras": [],
    "stock": 0,
    "unit": "份",
    "sort": 2,
    "available": true
  },
  {
    "_id": "dish_14",
    "categoryId": "cat_5",
    "name": "季节限定·鲜果塔",
    "desc": "已下架样例：仅管理端可见",
    "image": "",
    "price": 22,
    "specs": [],
    "extras": [],
    "stock": 10,
    "unit": "份",
    "sort": 9,
    "available": false
  }
]

// 医院真实科室（来源 Dept.json，已清洗：分类根节点 isRoot=true、停用科室 enabled=false）
const DEPARTMENTS = [
  {
    "code": 1,
    "name": "行政科室",
    "pinyin": "XZKS",
    "parentCode": null,
    "rootCode": 1,
    "rootName": "行政科室",
    "rootSort": 1,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 1005,
    "name": "工会",
    "pinyin": "GH",
    "parentCode": 1,
    "rootCode": 1,
    "rootName": "行政科室",
    "rootSort": 1,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 1002,
    "name": "书记室",
    "pinyin": "SJS",
    "parentCode": 1,
    "rootCode": 1,
    "rootName": "行政科室",
    "rootSort": 1,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 1001,
    "name": "院部",
    "pinyin": "YB",
    "parentCode": 1,
    "rootCode": 1,
    "rootName": "行政科室",
    "rootSort": 1,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 1006,
    "name": "总会计师室",
    "pinyin": "ZKJSS",
    "parentCode": 1,
    "rootCode": 1,
    "rootName": "行政科室",
    "rootSort": 1,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2,
    "name": "职能科室",
    "pinyin": "ZNKS",
    "parentCode": null,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2006,
    "name": "财务处",
    "pinyin": "CWC",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2001,
    "name": "党政办",
    "pinyin": "DZB",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 123,
    "name": "公共卫生科",
    "pinyin": "GGWSK",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2003,
    "name": "护理部",
    "pinyin": "HLB",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 114,
    "name": "监督审计科",
    "pinyin": "JDSJK",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 88,
    "name": "科教处",
    "pinyin": "KJC",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 90,
    "name": "人力资源部",
    "pinyin": "RLZYB",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 86,
    "name": "宣传处",
    "pinyin": "XCC",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 89,
    "name": "医保办",
    "pinyin": "YBB",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 48,
    "name": "院感处",
    "pinyin": "YGC",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 87,
    "name": "医患办",
    "pinyin": "YHB",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2002,
    "name": "医务处",
    "pinyin": "YWC",
    "parentCode": 2,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 136,
    "name": "质量管理科",
    "pinyin": "ZLGLK",
    "parentCode": 2002,
    "rootCode": 2,
    "rootName": "职能科室",
    "rootSort": 2,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 5,
    "name": "门急诊科室",
    "pinyin": "MJZKS",
    "parentCode": null,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 121,
    "name": "120急救站",
    "pinyin": "120JJZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 85,
    "name": "肠道门诊",
    "pinyin": "CDMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 130,
    "name": "产科门诊",
    "pinyin": "CKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 96,
    "name": "多学科门诊",
    "pinyin": "DXKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5002,
    "name": "耳鼻咽喉门诊",
    "pinyin": "EBYHMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5035,
    "name": "儿科门诊",
    "pinyin": "EKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5034,
    "name": "妇产科门诊",
    "pinyin": "FCKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5039,
    "name": "妇科门诊",
    "pinyin": "FKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 117,
    "name": "返聘专家",
    "pinyin": "FPZJ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 53,
    "name": "发热门诊",
    "pinyin": "FRMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 132,
    "name": "公安门诊",
    "pinyin": "GAMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5033,
    "name": "肛肠科门诊",
    "pinyin": "GCKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 133,
    "name": "高级专家中心",
    "pinyin": "GJZJZX",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 127,
    "name": "骨科1门诊",
    "pinyin": "GK1MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 128,
    "name": "骨科2门诊",
    "pinyin": "GK2MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 129,
    "name": "骨科3门诊",
    "pinyin": "GK3MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 99,
    "name": "感染性疾病科",
    "pinyin": "GRXJBK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5038,
    "name": "骨伤科门诊",
    "pinyin": "GSKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5008,
    "name": "骨伤科门诊2",
    "pinyin": "GSKMZ2",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 4002,
    "name": "高压氧",
    "pinyin": "GYY",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 39,
    "name": "换药室",
    "pinyin": "HYS",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 5020,
    "name": "急诊科",
    "pinyin": "JZK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 116,
    "name": "康复科",
    "pinyin": "KFK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5004,
    "name": "口腔科",
    "pinyin": "KQK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 107,
    "name": "名医堂",
    "pinyin": "MYT",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5001,
    "name": "门诊部",
    "pinyin": "MZB",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 3202,
    "name": "麻醉科",
    "pinyin": "MZK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5031,
    "name": "内科门诊",
    "pinyin": "NKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5005,
    "name": "皮肤科",
    "pinyin": "PFK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 46,
    "name": "神经外科门诊",
    "pinyin": "SJWKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 5022,
    "name": "社区门诊",
    "pinyin": "SQMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 134,
    "name": "输液护理门诊",
    "pinyin": "SYHLMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 2008,
    "name": "体检中心",
    "pinyin": "TJZX",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 5007,
    "name": "推拿科",
    "pinyin": "TNK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 115,
    "name": "疼痛门诊",
    "pinyin": "TTMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 124,
    "name": "外科1门诊",
    "pinyin": "WK1MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 125,
    "name": "外科2门诊",
    "pinyin": "WK2MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 126,
    "name": "外科3门诊",
    "pinyin": "WK3MZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5032,
    "name": "外科门诊",
    "pinyin": "WKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 9,
    "name": "新冠核酸",
    "pinyin": "XGHS",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 100,
    "name": "心理门诊",
    "pinyin": "XLMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 4001,
    "name": "血透室",
    "pinyin": "XTS",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊",
      "医技"
    ]
  },
  {
    "code": 5003,
    "name": "眼科",
    "pinyin": "YK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊",
      "医技"
    ]
  },
  {
    "code": 101,
    "name": "营养科",
    "pinyin": "YYK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5006,
    "name": "针灸科",
    "pinyin": "ZJK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 52,
    "name": "注射室",
    "pinyin": "ZSS",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 80,
    "name": "治未病科",
    "pinyin": "ZWBK",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 135,
    "name": "中医护理门诊",
    "pinyin": "ZYHLMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 5036,
    "name": "中医内科门诊",
    "pinyin": "ZYNKMZ",
    "parentCode": 5,
    "rootCode": 5,
    "rootName": "门急诊科室",
    "rootSort": 3,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 4,
    "name": "医技科室",
    "pinyin": "YJKS",
    "parentCode": null,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 4004,
    "name": "B超室",
    "pinyin": "BCS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊",
      "医技"
    ]
  },
  {
    "code": 4007,
    "name": "病理科",
    "pinyin": "BLK",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊",
      "医技"
    ]
  },
  {
    "code": 105,
    "name": "采购中心",
    "pinyin": "CGZX",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 54,
    "name": "CT室",
    "pinyin": "CTS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 4009,
    "name": "导管室",
    "pinyin": "DGS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 4003,
    "name": "放射科",
    "pinyin": "FSK",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊",
      "医技"
    ]
  },
  {
    "code": 122,
    "name": "GCP实验室",
    "pinyin": "GCPSYS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 55,
    "name": "煎药房",
    "pinyin": "JYF",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 4006,
    "name": "检验科",
    "pinyin": "JYK",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 97,
    "name": "脑肌电图室",
    "pinyin": "NJDTS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 4008,
    "name": "内窥镜",
    "pinyin": "NKJ",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 113,
    "name": "内窥镜(肺病)",
    "pinyin": "NKJ(FB",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 112,
    "name": "内窥镜(脾胃)",
    "pinyin": "NKJ(PW",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 95,
    "name": "睡眠监测室",
    "pinyin": "SMJCS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 3201,
    "name": "手术室",
    "pinyin": "SSS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 4005,
    "name": "心电图",
    "pinyin": "XDT",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 109,
    "name": "消化动力室",
    "pinyin": "XHDLS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "医技"
    ]
  },
  {
    "code": 6002,
    "name": "西药房",
    "pinyin": "XYF",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 6001,
    "name": "药库",
    "pinyin": "YK",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 6005,
    "name": "制剂室",
    "pinyin": "ZJS",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 6004,
    "name": "中心药房",
    "pinyin": "ZXYF",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 6003,
    "name": "中药房",
    "pinyin": "ZYF",
    "parentCode": 4,
    "rootCode": 4,
    "rootName": "医技科室",
    "rootSort": 4,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 8,
    "name": "病区",
    "pinyin": "BQ",
    "parentCode": null,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 73,
    "name": "10病区",
    "pinyin": "10BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8006,
    "name": "11病区",
    "pinyin": "11BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8008,
    "name": "12病区",
    "pinyin": "12BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8007,
    "name": "13病区",
    "pinyin": "13BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8004,
    "name": "14病区",
    "pinyin": "14BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 79,
    "name": "15病区",
    "pinyin": "15BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8010,
    "name": "1病区",
    "pinyin": "1BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8001,
    "name": "21病区",
    "pinyin": "21BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 84,
    "name": "22病区",
    "pinyin": "22BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8002,
    "name": "23病区",
    "pinyin": "23BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 32,
    "name": "24病区",
    "pinyin": "24BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 35,
    "name": "25病区",
    "pinyin": "25BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 92,
    "name": "26病区",
    "pinyin": "26BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 68,
    "name": "4病区",
    "pinyin": "4BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 69,
    "name": "5病区",
    "pinyin": "5BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 70,
    "name": "6病区",
    "pinyin": "6BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 71,
    "name": "7病区",
    "pinyin": "7BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8005,
    "name": "8病区",
    "pinyin": "8BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 72,
    "name": "9病区",
    "pinyin": "9BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8013,
    "name": "测试病区",
    "pinyin": "CSBQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院",
      "病区"
    ]
  },
  {
    "code": 8003,
    "name": "静配药房",
    "pinyin": "L13BQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "病区"
    ]
  },
  {
    "code": 8012,
    "name": "日间病区",
    "pinyin": "RJBQ",
    "parentCode": 8,
    "rootCode": 8,
    "rootName": "病区",
    "rootSort": 5,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院",
      "病区"
    ]
  },
  {
    "code": 3,
    "name": "住院科室",
    "pinyin": "ZYKS",
    "parentCode": null,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3001,
    "name": "产科病区",
    "pinyin": "CKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2101,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3002,
    "name": "妇科病区",
    "pinyin": "FKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2102,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3004,
    "name": "外科1病区",
    "pinyin": "WK1BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2103,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 30,
    "name": "外科3病区",
    "pinyin": "WK3BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2104,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3003,
    "name": "骨伤科1病区",
    "pinyin": "GSK1BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2105,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3005,
    "name": "肛肠科病区",
    "pinyin": "GCKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2106,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 64,
    "name": "皮肤科病区",
    "pinyin": "PFKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2107,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3011,
    "name": "五官科病区",
    "pinyin": "WGKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2108,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3012,
    "name": "眼科病区",
    "pinyin": "YKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2109,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3013,
    "name": "口腔科病区",
    "pinyin": "KQKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2110,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 65,
    "name": "肾病科",
    "pinyin": "SBK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2111,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3006,
    "name": "脑病科",
    "pinyin": "NBK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2112,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3007,
    "name": "心血管科",
    "pinyin": "XXGK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2113,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 66,
    "name": "呼吸与危重症医学科",
    "pinyin": "HXYWZZ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2114,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 34,
    "name": "脾胃病科",
    "pinyin": "PWBK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2115,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 67,
    "name": "肿瘤科",
    "pinyin": "ZLK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2116,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3008,
    "name": "儿科病区",
    "pinyin": "EKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2117,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 3101,
    "name": "ICU",
    "pinyin": "ICU",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 2118,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 137,
    "name": "EICU",
    "pinyin": "EICU",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 74,
    "name": "骨伤科2病区",
    "pinyin": "GSK2BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 120,
    "name": "骨伤科3病区",
    "pinyin": "GSK3BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 138,
    "name": "急诊病区",
    "pinyin": "JZBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 82,
    "name": "康复科病区",
    "pinyin": "KFKBQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 108,
    "name": "临床药学室",
    "pinyin": "LCYXS",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 98,
    "name": "老年病科",
    "pinyin": "LNBK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 119,
    "name": "内分泌科",
    "pinyin": "NFMK",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 75,
    "name": "外科2病区",
    "pinyin": "WK2BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 104,
    "name": "外科5病区",
    "pinyin": "WK5BQ",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 131,
    "name": "中医经典病房",
    "pinyin": "ZYJDBF",
    "parentCode": 3,
    "rootCode": 3,
    "rootName": "住院科室",
    "rootSort": 6,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 43,
    "name": "后勤保障",
    "pinyin": "HQBZ",
    "parentCode": null,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2007,
    "name": "病案统计",
    "pinyin": "BATJ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 61,
    "name": "保安组",
    "pinyin": "BAZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7005,
    "name": "保洁组",
    "pinyin": "BJZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7006,
    "name": "仓库",
    "pinyin": "CK",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 94,
    "name": "公安局医务室",
    "pinyin": "GAJYWS",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": [
      "门诊"
    ]
  },
  {
    "code": 56,
    "name": "挂号室",
    "pinyin": "GHS",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7001,
    "name": "供应室",
    "pinyin": "GYS",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 58,
    "name": "驾驶组",
    "pinyin": "JSZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7004,
    "name": "经营部",
    "pinyin": "JYB",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 77,
    "name": "老病房楼",
    "pinyin": "LBFL",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 59,
    "name": "配电间",
    "pinyin": "PDJ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 60,
    "name": "汽道组",
    "pinyin": "QDZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2005,
    "name": "设备科",
    "pinyin": "SBK",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7002,
    "name": "食堂",
    "pinyin": "ST",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 81,
    "name": "投诉科",
    "pinyin": "TSK",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2009,
    "name": "图书室",
    "pinyin": "TSS",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 38,
    "name": "物资管理中心",
    "pinyin": "WZGLZX",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 62,
    "name": "洗涤组",
    "pinyin": "XDZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7003,
    "name": "修理组",
    "pinyin": "XLZ",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7007,
    "name": "信息处",
    "pinyin": "XXC",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 36,
    "name": "杏苑药店",
    "pinyin": "XYYD",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 2004,
    "name": "总务处",
    "pinyin": "ZWC",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 57,
    "name": "住院部",
    "pinyin": "ZYB",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 106,
    "name": "住院管理中心",
    "pinyin": "ZYGLZX",
    "parentCode": 43,
    "rootCode": 43,
    "rootName": "后勤保障",
    "rootSort": 7,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7,
    "name": "其他",
    "pinyin": "QT",
    "parentCode": null,
    "rootCode": 7,
    "rootName": "其他",
    "rootSort": 8,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": true,
    "usage": []
  },
  {
    "code": 7009,
    "name": "轮转",
    "pinyin": "LZ",
    "parentCode": 7,
    "rootCode": 7,
    "rootName": "其他",
    "rootSort": 8,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 6010,
    "name": "其他",
    "pinyin": "QT",
    "parentCode": 7,
    "rootCode": 7,
    "rootName": "其他",
    "rootSort": 8,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": true,
    "usage": []
  },
  {
    "code": 49,
    "name": "停用科室",
    "pinyin": "TYKS",
    "parentCode": null,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 0,
    "isRoot": true,
    "sort": 0,
    "enabled": false,
    "usage": []
  },
  {
    "code": 3102,
    "name": "120病房",
    "pinyin": "120BF",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 8011,
    "name": "120病区",
    "pinyin": "120BQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 8009,
    "name": "33病区",
    "pinyin": "33BQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 5023,
    "name": "二门诊",
    "pinyin": "EMZ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 76,
    "name": "妇产科病区",
    "pinyin": "FCKBQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 83,
    "name": "母婴病区",
    "pinyin": "MYBQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 3010,
    "name": "内科1",
    "pinyin": "NK1",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 45,
    "name": "内科3",
    "pinyin": "NK3",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 3009,
    "name": "手外科病区",
    "pinyin": "SWKBQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  },
  {
    "code": 91,
    "name": "新生儿病区",
    "pinyin": "XSEBQ",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": [
      "住院"
    ]
  },
  {
    "code": 28,
    "name": "原门诊肿瘤科",
    "pinyin": "YMZZLK",
    "parentCode": 49,
    "rootCode": 49,
    "rootName": "停用科室",
    "rootSort": 9,
    "level": 1,
    "isRoot": false,
    "sort": 999999,
    "enabled": false,
    "usage": []
  }
]

const ORDER_TEMPLATES = [
  {
    "_id": "ord_seed_1",
    "_agoMin": 12,
    "orderNo": "OSEED001",
    "pickupNo": 1,
    "openid": "seed_openid_1",
    "type": "pickup",
    "buyer": {
      "empNo": "SEED001",
      "name": "张伟",
      "dept": "技术部",
      "location": "1号楼-3层"
    },
    "items": [
      {
        "dishId": "dish_1",
        "name": "黑椒牛柳饭",
        "price": 33,
        "spec": "大份",
        "extras": [],
        "qty": 1
      },
      {
        "dishId": "dish_8",
        "name": "鲜榨橙汁",
        "price": 12,
        "spec": "中杯",
        "extras": [],
        "qty": 1
      }
    ],
    "total": 45,
    "delivery": {
      "target": "",
      "note": "不要辣"
    },
    "status": "pending",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      }
    ]
  },
  {
    "_id": "ord_seed_2",
    "_agoMin": 20,
    "orderNo": "OSEED002",
    "pickupNo": 2,
    "openid": "seed_openid_2",
    "type": "delivery",
    "buyer": {
      "empNo": "SEED002",
      "name": "李娜",
      "dept": "产品部",
      "location": "2号楼-2层"
    },
    "items": [
      {
        "dishId": "dish_4",
        "name": "扬州炒饭",
        "price": 20,
        "spec": "加大量",
        "extras": [],
        "qty": 2
      }
    ],
    "total": 40,
    "delivery": {
      "target": "2号楼-2层-工位区",
      "note": ""
    },
    "status": "making",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      },
      {
        "status": "making",
        "_addMin": 2,
        "note": "已接单"
      }
    ]
  },
  {
    "_id": "ord_seed_3",
    "_agoMin": 35,
    "orderNo": "OSEED003",
    "pickupNo": 3,
    "openid": "seed_openid_3",
    "type": "delivery",
    "buyer": {
      "empNo": "SEED003",
      "name": "王强",
      "dept": "市场部",
      "location": "1号楼-5层"
    },
    "items": [
      {
        "dishId": "dish_7",
        "name": "牛肉面",
        "price": 30,
        "spec": "",
        "extras": [
          "加牛肉"
        ],
        "qty": 1
      },
      {
        "dishId": "dish_10",
        "name": "冰红茶",
        "price": 5,
        "spec": "",
        "extras": [],
        "qty": 1
      }
    ],
    "total": 35,
    "delivery": {
      "target": "1号楼-5层-茶水间",
      "note": ""
    },
    "status": "ready",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      },
      {
        "status": "making",
        "_addMin": 3,
        "note": "已接单"
      },
      {
        "status": "ready",
        "_addMin": 10,
        "note": "制作完成"
      }
    ]
  },
  {
    "_id": "ord_seed_4",
    "_agoMin": 60,
    "orderNo": "OSEED004",
    "pickupNo": 4,
    "openid": "seed_openid_4",
    "type": "pickup",
    "buyer": {
      "empNo": "SEED004",
      "name": "赵敏",
      "dept": "行政部",
      "location": "3号楼-B1"
    },
    "items": [
      {
        "dishId": "dish_2",
        "name": "宫保鸡丁套餐",
        "price": 27,
        "spec": "",
        "extras": [
          "加饭"
        ],
        "qty": 1
      },
      {
        "dishId": "dish_11",
        "name": "矿泉水",
        "price": 3,
        "spec": "",
        "extras": [],
        "qty": 1
      }
    ],
    "total": 30,
    "delivery": {
      "target": "",
      "note": ""
    },
    "status": "done",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      },
      {
        "status": "making",
        "_addMin": 2,
        "note": "已接单"
      },
      {
        "status": "ready",
        "_addMin": 8,
        "note": "制作完成"
      },
      {
        "status": "done",
        "_addMin": 15,
        "note": "已完成"
      }
    ]
  },
  {
    "_id": "ord_seed_5",
    "_agoMin": 90,
    "orderNo": "OSEED005",
    "pickupNo": 5,
    "openid": "seed_openid_5",
    "type": "pickup",
    "buyer": {
      "empNo": "SEED005",
      "name": "陈晨",
      "dept": "财务部",
      "location": "1号楼-3层"
    },
    "items": [
      {
        "dishId": "dish_5",
        "name": "卤肉饭",
        "price": 24,
        "spec": "",
        "extras": [
          "加卤蛋"
        ],
        "qty": 1
      }
    ],
    "total": 24,
    "delivery": {
      "target": "",
      "note": ""
    },
    "status": "cancelled",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      },
      {
        "status": "cancelled",
        "_addMin": 5,
        "note": "用户取消"
      }
    ]
  },
  {
    "_id": "ord_seed_6",
    "_agoMin": 120,
    "orderNo": "OSEED006",
    "pickupNo": 6,
    "openid": "seed_openid_6",
    "type": "delivery",
    "buyer": {
      "empNo": "SEED006",
      "name": "刘洋",
      "dept": "人力资源部",
      "location": "3号楼-B1"
    },
    "items": [
      {
        "dishId": "dish_3",
        "name": "番茄炒蛋盖饭",
        "price": 18,
        "spec": "",
        "extras": [],
        "qty": 2
      }
    ],
    "total": 36,
    "delivery": {
      "target": "3号楼-B1-食堂取餐口",
      "note": ""
    },
    "status": "done",
    "statusHistory": [
      {
        "status": "pending",
        "_addMin": 0,
        "note": "已下单"
      },
      {
        "status": "making",
        "_addMin": 3,
        "note": "已接单"
      },
      {
        "status": "ready",
        "_addMin": 9,
        "note": "制作完成"
      },
      {
        "status": "done",
        "_addMin": 20,
        "note": "已完成"
      }
    ]
  }
]

async function putDoc(collection, docId, data) {
  const payload = Object.assign({}, data)
  delete payload._id
  await db.collection(collection).doc(docId).set({ data: payload })
}

exports.main = async (event) => {
  if (!event || event.key !== KEY) {
    return { ok: false, message: '参数错误：请在云函数测试中传入 {"key":"seed2024"}' }
  }
  const result = { settings: 0, categories: 0, dishes: 0, departments: 0, orders: 0, skippedOrders: false }
  try {
    // settings：若已有配置则原地覆盖，避免出现多条
    const sres = await db.collection('settings').limit(1).get()
    const sData = Object.assign({}, SETTINGS)
    delete sData._id
    if (sres.data && sres.data.length) {
      await db.collection('settings').doc(sres.data[0]._id).set({ data: sData })
    } else {
      await db.collection('settings').add({ data: sData })
    }
    result.settings = 1

    // 分批并发写入，避免逐条串行导致云端测试 3 秒超时
    async function writeBatch(items, fn) {
      const CHUNK = 20
      for (let i = 0; i < items.length; i += CHUNK) {
        await Promise.all(items.slice(i, i + CHUNK).map(fn))
      }
    }
    await writeBatch(CATEGORIES, c => putDoc('menu_categories', c._id, c))
    result.categories = CATEGORIES.length
    await writeBatch(DISHES, d => putDoc('dishes', d._id, d))
    result.dishes = DISHES.length
    await writeBatch(DEPARTMENTS, d => putDoc('departments', 'ks_' + d.code, d))
    result.departments = DEPARTMENTS.length

    if (event.withOrders !== false) {
      const now = Date.now()
      const orderData = ORDER_TEMPLATES.map(function (tpl) {
        const data = JSON.parse(JSON.stringify(tpl))
        const id = data._id
        delete data._id
        const agoMin = data._agoMin || 0
        delete data._agoMin
        const created = new Date(now - agoMin * 60000)
        data.createdAt = created
        data.updatedAt = created
        if (Array.isArray(data.statusHistory)) {
          data.statusHistory = data.statusHistory.map(function (h) {
            return {
              status: h.status,
              time: new Date(created.getTime() + (h._addMin || 0) * 60000),
              note: h.note || ''
            }
          })
        }
        return { id: id, data: data }
      })
      await writeBatch(orderData, function (o) {
        return db.collection('orders').doc(o.id).set({ data: o.data })
      })
      result.orders = orderData.length
    } else {
      result.skippedOrders = true
    }

    return { ok: true, data: result, message: '测试数据写入完成' }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '写入失败', data: result }
  }
}
