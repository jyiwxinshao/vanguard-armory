# 第四阶段：购物车（游客、服务器与登录合并）

本阶段接入游客购物车、普通用户服务器购物车、登录自动合并、原子批量删除与合并幂等回执，并实现 `/cart` 页面和详情页加购。前台继续使用 **VANGUARD ARMORY / 先锋军械库** 品牌与 [DESIGN.md](DESIGN.md) 视觉体系，不重做导航和首页；认证、装备浏览、公开详情等既有能力保持不变。

数据库在六张业务表之外新增一张 `cart_merge_receipts`，用于购物车合并的持久去重。原表结构不变，已有数据库执行 `npm run db:init` 即可补建新表并保留业务数据。

## 功能范围

- 游客购物车保存在浏览器 `localStorage`（键 `game_store.guest_cart.v1`），通过 Web Locks 协调跨标签页写入；按批次保存，每批只存 `equipment_id` 和 `quantity`。
- 普通用户购物车由服务器持久化，支持读取、添加、修改数量、单删、批删和清空。
- 登录后自动把游客未决批次合并到服务器购物车；合并结果附调整说明，只有明确成功后才清理对应本地批次。
- 合并使用 `cart_merge_receipts` 持久回执，同一批次、同一内容的重试不会再次累加数量。
- 详情页支持游客和普通用户加购；数量最小 1，最大为当前库存与 9999 的较小值，售罄或下架不可加购。
- `/cart` 页面支持改数量、单删、批量删除选中、清空、失效条目识别、可购买金额摘要和真实数量角标。
- 购物车阶段不扣减装备库存；金额与库存始终以后端实时数据为准。

## 后端行为

### 购物车接口

以下接口均要求 `active` 普通用户；未登录返回 401，管理员访问返回 403。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cart` | 返回当前购物车、装备实时信息、库存、失效原因和金额 |
| POST | `/api/cart/items` | `equipment_id、quantity`；相同装备数量累加，不新增重复明细 |
| PUT | `/api/cart/items/:id` | `quantity`；设置绝对数量 |
| DELETE | `/api/cart/items/:id` | 删除自己的一项 |
| POST | `/api/cart/items/batch-delete` | `ids` 数组；校验全部归属后在事务中整批删除 |
| DELETE | `/api/cart` | 清空自己的购物车 |
| POST | `/api/cart/merge` | `merge_id（UUID v4）、items`；合并游客批次，返回购物车、批次确认和调整说明 |

所有写操作返回最新购物车。批量删除若包含他人条目则整批失败，不按不受限制的 ID 删除。

### 购物车返回结构

`GET /api/cart` 返回：

```json
{
  "items": [
    {
      "id": 1,
      "equipment_id": 3,
      "name": "晨星长剑",
      "image": "/images/equipments/placeholder.svg",
      "price": 12900,
      "rarity": "R",
      "category": "weapon",
      "quantity": 2,
      "stock": 24,
      "status": "on_sale",
      "available": true,
      "reason": null,
      "subtotal": 25800
    }
  ],
  "total_price": 25800,
  "available_total_price": 25800,
  "invalid_count": 0,
  "checkout_allowed": true
}
```

- `available` 表示装备仍在售且当前数量不超过实时库存；否则 `reason` 为 `off_sale`、`deleted`、`sold_out` 或 `insufficient_stock`。
- `total_price` 保留全车参考金额；`available_total_price` 只汇总可购买条目。
- `checkout_allowed` 仅在购物车非空且所有条目可购买时为 true。金额均为整数分。

### 校验与事务

- 单项数量为 1–9999，购物车最多 100 种装备；装备 ID 和购物车明细 ID 均为正整数且不超出 `INT UNSIGNED` 范围。
- 添加时校验累加后数量：超过库存返回 409/10005，超过单项上限返回 422；不存在、已删除、已下架装备返回 404。
- 修改数量同样校验绝对数量与当前库存；明细不属于当前用户返回 404。
- 所有写操作先锁定用户 `carts` 行，涉及装备读取与合并按固定顺序处理，保证并发请求不会重复累加或跨账号操作。
- 购物车阶段不更新装备库存。

### 合并幂等

`POST /api/cart/merge` 使用 `cart_merge_receipts` 持久去重：

- 同 `merge_id` 与同 `payload_hash` 重复调用不会再次累加，返回 `merge: { merge_id, replayed: true }`、原调整结果和当前购物车。
- 首次完成返回 `replayed: false`。
- 同 ID 但换账号或换内容返回 409/10011，用户身份从 JWT 读取。
- 合并会归并请求中重复的装备 ID，再与服务器数量相加；最终数量取合计、当前库存、9999 三者的最小值。调整记录在 `adjustments` 中说明每项的期望数量与最终保存数量。
- 合并后超过 100 种装备时整笔回滚并返回 422，本地批次保留。

## 前端行为

### Cart Store

`useCartStore` 维护 `items`、`totalPrice`、`loading`、`error`、`notice`、`adjustments`、`mode`、`phase`、`scope`，并提供：

- `itemCount`：购物车商品总数量。
- `availableTotal`：可购买商品金额。
- `checkoutAllowed`：是否可进入结算。
- `canWrite`、`canManage`：当前模式与阶段下是否允许写操作。

`mode` 为 `guest`（游客）、`server`（普通用户）、`admin` 或 `pending`；`phase` 覆盖 `idle/loading/ready/merging/merge-error/merge-rejected/error/uncertain/blocked`。读写请求串行化，旧请求不会覆盖新账号状态；账号切换或退出后丢弃迟到响应。

### 游客购物车与登录合并

`client/src/cart-session.js` 是唯一的会话驱动入口，根据认证状态切换游客/服务器/管理员模式；`client/src/utils/guest-cart-storage.js` 负责本地批次读写，使用 Web Locks 避免跨标签页并发写入。

- 游客加购写入本地批次；价格、图片和库存通过公开详情接口刷新。
- 登录后进入 `merging`，调用 `/api/cart/merge`；成功后再清理本地批次。
- 合并失败保留本地批次，刷新和重试复用同一 `merge_id`，不会重复累加。
- 游客结算入口跳转登录，返回后继续合并。

### 页面

- `Cart.vue`：左侧装备清单 + 右侧订单摘要；支持选择、全选、改数量、单删、批删、清空；失效条目不可结算但可删除。
- `EquipmentDetail.vue`：接入 `cartStore.addItem()`，游客与普通用户均可加购，售罄/下架禁用。
- 顶部购物车角标显示 `cart.itemCount`，`/cart` 对游客和登录用户开放。

## 验证记录

| 验证 | 结果 |
| --- | --- |
| 服务端单元测试（API、认证、装备、购物车） | 通过，29/29 |
| 真实 MySQL 集成测试（基础、认证、装备、购物车） | 通过，43/43 |
| 前端回归测试（认证、装备、购物车、游客存储、会话协调） | 通过，59/59 |
| 前端生产构建 | 通过 |
| 浏览器点击验收 | 未执行，保留待办 |

数据库集成测试自行创建唯一命名的临时数据库，测试完成后删除；覆盖注册事务、账号权限、装备筛选、购物车 CRUD、售罄/下架/删除/库存不足识别、原子批删、合并去重、并发合并、回执回放和 100 种上限回滚。不在 `game_store` 业务库中修改库存或删除记录。

## 页面验收清单

- [ ] 游客在详情页加购，刷新后本地购物车保持，多标签页数量一致。
- [ ] 游客登录后自动合并到服务器购物车；合并失败刷新重试不重复累加，成功后本地批次清理。
- [ ] 同装备重复加购数量累加；数量 0、负数、小数、超库存被拒绝；售罄/下架不可加购。
- [ ] 购物车页改数量、单删、全选、批删、清空均返回最新购物车，角标实时更新。
- [ ] 失效条目显示售罄/下架/已删除/库存不足，不能结算，但可删除。
- [ ] 订单摘要只汇总可购买商品；游客结算跳转登录；登录用户结算显示下一阶段提示。
- [ ] 切换账号或退出后看不到上一账号购物车；管理员账号不使用购物车。
- [ ] 窄屏下购物车清单与摘要可操作，订单/支付仍保持未实现状态。

下一阶段按[开发计划](03-development-plan.md)接入订单确认、创建订单、模拟支付、取消与订单历史。
