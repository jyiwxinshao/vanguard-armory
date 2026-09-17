# Stage 6 管理端开发骨架

本阶段固定布局、权限、路由、模块与接口边界。骨架阶段未新增数据库表；后续已接通装备新增、编辑/上下架、库存调整与软删除、用户查询与冻结/解冻、订单查询与取消/交付，并新增库存回执表 inventory_adjustments。

当前进度：骨架已独立提交，装备列表、详情、新增、编辑、库存调整与软删除，以及用户、订单管理均已接通。装备部分详见[装备列表记录](11-admin-equipment-list.md)、[装备详情记录](12-admin-equipment-detail.md)、[新增装备记录](13-admin-equipment-create.md)、[装备编辑记录](14-admin-equipment-edit.md)和[库存调整记录](15-admin-stock-adjustment.md)。以下结构继续作为开发约束。

## 已搭建内容

- `App.vue` 保留全局通知和顶层路由；原商城页头、搜索、页脚迁入 `layouts/StorefrontLayout.vue`，用户端路径保持不变。
- `layouts/AdminLayout.vue` 提供独立侧栏、三个模块入口、账号区、退出和返回商城，复用 Vanguard Armory 配色。
- `/admin` 及全部子路由要求登录与 admin 角色。管理员从无 returnTo 的登录入口进入装备管理；合法站内 returnTo 仍优先。
- `router/guards.js` 同时供导航守卫和会话变化监听使用。未确认身份时仅显示恢复界面；确认普通用户则进入 403。会话检查/失效时卸载管理内容，账号 revision 改变时重新创建子页面。
- 管理端共用现有 auth Store、Axios、会话恢复与通知；原购物车会话机制保持管理员不合并游客车的规则。
- `server/src/modules/admin/admin.router.js` 统一认证、admin 权限与 no-store；原 `/api/admin/me` 行为保持兼容。
- 三个业务模块的 Router、Service 工厂和前端 API 模块已接通。装备列表、详情、新增、编辑、库存调整与软删除，以及用户查询/状态、订单查询/状态均已接通真实数据。

## 页面与模块对应

| 前端页面 | 路由 | 后端模块 |
| --- | --- | --- |
| `views/admin/EquipmentList.vue` | `/admin/equipments` | `modules/admin/equipments/` |
| `views/admin/EquipmentDetail.vue` | `/admin/equipments/:id` | 同上，完整资料、维护入口与软删除 |
| `views/admin/EquipmentCreate.vue` | `/admin/equipments/new` | 同上，新增表单 |
| `views/admin/EquipmentEdit.vue` | `/admin/equipments/:id/edit` | 同上，资料编辑与上下架 |
| `views/admin/EquipmentStock.vue` | `/admin/equipments/:id/stock` | 同上，独立库存增减与原操作恢复 |
| `views/admin/UserList.vue` | `/admin/users` | `modules/admin/users/` |
| `views/admin/UserDetail.vue` | `/admin/users/:id` | 同上，冻结/恢复普通账号，历史订单走管理订单筛选 |
| `views/admin/OrderList.vue` | `/admin/orders` | `modules/admin/orders/` |
| `views/admin/OrderDetail.vue` | `/admin/orders/:id` | 同上，商品快照与取消/完成交付 |

装备列表、详情、新增、编辑、库存调整与软删除，以及用户、订单页面均已接通真实数据。库存使用独立页面；软删除关联未完成订单时拒绝。

## 已实现的 API

全部位于 `/api/admin`。`/me`、装备的列表/详情/新增/编辑/库存调整/软删除，以及用户与订单的列表/详情/状态接口均已实现，各自带有字段校验。

| 模块 | 方法与相对路径 | Service 方法 |
| --- | --- | --- |
| 装备 | GET `/equipments`、GET `/equipments/:id` | list / get |
| 装备 | POST `/equipments`、PUT `/equipments/:id` | create / update |
| 装备 | PATCH `/equipments/:id/stock` | adjustStock |
| 装备 | DELETE `/equipments/:id` | remove |
| 用户 | GET `/users`、GET `/users/:id` | list / get |
| 用户 | PUT `/users/:id/status` | changeStatus |
| 订单 | GET `/orders`、GET `/orders/:id` | list / get |
| 订单 | PUT `/orders/:id/status` | changeStatus |

写操作由 Router 传入服务器认证出的 actorId，客户端不决定管理员身份。`createApp({ adminServices })` 支持注入 equipments/users/orders 服务供接口测试；Service 仿照现有订单模块注入 withConnection/withTransaction。各模块新增自己的 `*.validation.js`，先校验查询、ID 和请求体，再读写数据库；成功响应继续复用现有 success 格式。

## 后续实现顺序与固定边界

1. **装备查询与维护**：先列表、筛选、分页、详情，再新增/编辑/上下架。使用管理端分页约定 10/20/50，不能直接套用商城固定 12 条的查询工具。资料表单包含 series_code/new_until，编辑不接收 stock；复用现有图片资源与金额分单位。
2. **库存与软删除**：库存已独立增减，请求体 `{ request_id, delta }`；操作编号与库存变化同事务记录，成功与业务拒绝均保存原结果，响应丢失重试不重复加减。新表须通过迁移补建；回执不自动过期。删除采用软删除；关联 pending/paid 订单时拒绝，通过装备行锁和当前读与下单协调。库存不能为负，资料编辑不能覆盖实时库存。
3. **用户查询与状态**：只返回显式安全字段，禁止 password_hash；仅管理普通用户的 active/frozen 状态，不提供角色修改或冻结管理员。历史订单复用管理订单的 user_id 筛选。
4. **订单处理**：读取商品快照，只允许 pending → cancelled、paid → completed。将现有用户端取消事务中可共享的部分提取为内部函数，保留用户端归属校验；管理员不能靠伪造 userId 调用用户接口。取消锁订单后按装备 ID 顺序返库，重复取消不二次返库；重复完成不重写完成时间。

前端数据优先保存在页面，筛选条件放 URL；仅有真实跨页面需求才新增 Store。请求使用 AbortController/latest-request 及已有会话 revision 保护，切换账号、退出或离开页面后不回写旧响应。数据库版本变化继续通过 schema、迁移和完整结构检查同步，禁止删库重建规避升级。

## 骨架验收与后续测试门槛

- 前端路由测试覆盖管理员、普通用户、游客、身份恢复失败、登录默认去向、站内深链接、账号切换和嵌套权限继承。
- 后端测试遍历全部管理接口，验证游客 401、普通用户 403、冻结管理员 403；/me 正常且响应不可缓存；模块注入不绕过统一权限。
- 各模块已补充验证与真实 MySQL 测试；库存操作覆盖超卖/负数、网络重试、取消与调库存竞争；用户模块覆盖冻结后的旧 Token；订单覆盖重复操作、状态竞争和商品快照稳定。

当前管理端基础功能已完成。数据看板、上传、审计流水、真实支付、退款等不在本轮范围。

## 本轮验证记录

2026-09-16：`npm test` 后端 37/37、前端 94/94 通过；`npm run build` 和 `git diff --check` 通过。浏览器实际访问 `/admin/orders`，游客正确跳到 `/login?returnTo=/admin/orders`，拆分后的商城登录页正常显示。

`npm run test:db` 本轮未能执行数据库场景：本机 MySQL 的 127.0.0.1:3306 拒绝连接，服务启动需要系统管理员密码。数据库回归及真实管理员登录后的页面验收留待 MySQL 恢复后进行；不能将本轮 HTTP 模拟数据测试计作真实数据库或完整管理页面验收。此次未修改数据库结构与业务数据。

后续补验：本机 MySQL 恢复后，骨架版本的真实数据库回归 **64/64 通过**。骨架作为独立提交保存，再逐步接通业务模块。

2026-09-17 管理端收尾：装备软删除、用户查询与冻结/解冻、订单查询与取消/交付已全部接通。最终回归结果为后端 **51/51**、前端 **127/127**、真实 MySQL **89/89**，生产构建通过，0 失败。

2026-09-17 复审修复：统一路由与接口 ID 的比较，补齐详情页写操作的页面代次、会话和卸载隔离；网络失败及 5xx 先核对最新状态，404/409 提供刷新入口。新增 31 项真实页面组件回归；当前后端 **51/51**、前端 **164/164**、真实 MySQL **89/89**，构建通过。详情及验收边界见[复审修复记录](19-admin-review-fixes.md)。
