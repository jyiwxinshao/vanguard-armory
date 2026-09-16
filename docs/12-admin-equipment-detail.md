# Stage 6.2 管理端装备详情

本步接通 `GET /api/admin/equipments/:id` 与 `/admin/equipments/:id`，沿用现有管理权限、Service、API、请求取消与会话隔离机制。只读查询，无数据库迁移及业务写入。

## 接口与页面边界

- 管理员可读取在售、下架、已软删及售罄装备；普通用户、未登录及冻结管理员不能访问，响应统一 `Cache-Control: no-store`。
- ID 复用公共装备校验，范围 1–4294967295，非法格式返回 422，数据库不存在返回 404。使用绑定参数和明确字段查询，不改变公开商城详情的可见性。
- 返回对象字段：id/name/price/rarity/category/image/attack/defense/description/stock/status/series_code/new_until/is_new/created_at/updated_at；金额仍为分，新品标识由服务端时间计算。
- 列表装备名称进入详情；展示图片、状态、价格、完整属性（包括零值）、系列、新品期限、创建/更新时间及介绍。图片复用安全来源与降级组件，文本由 Vue 转义，时间按浏览器本地时区显示。
- 返回列表保留原查询与页码；`returnTo` 只接受 `/admin/equipments` 及支持的查询参数，不作为接口参数，不接受外部地址、其他页面或嵌套跳转。
- 加载期间清除旧详情；路由 ID 改变重新查询，旧请求/卸载后响应不回写，会话变更由管理布局卸载并重建页面。404 与 422 给出不同提示，网络/服务端故障提供重试。
- 新增、编辑、库存调整和删除继续返回 501；不提供这些未实现操作的按钮。

## 文件入口与后续

- 后端：`modules/admin/equipments/equipment.service.js` 实现 `get`，Router 沿用预留路由。
- 前端：`views/admin/EquipmentDetail.vue`、`utils/admin/equipment-detail.js`，列表新增入口，管理路由及样式同步。
- 回归：`server/tests/admin.test.js`、`server/tests/admin-equipment-database.test.js`、`client/tests/admin-equipment-detail.test.js`。

下一小步建议实现新增装备，再实现资料编辑；库存调整继续走独立接口，不能让编辑表单覆盖实时库存。

## 验证状态（2026-09-16）

- `npm test`：后端 40/40、前端 100/100 通过；`npm run test:db`：70/70 通过。覆盖 ID/404、全部状态详情、售罄、管理权限和公开商城可见性隔离。
- `npm run build` 与 `git diff --check` 通过。
- 浏览器验收：未登录跳转、管理员登录、下架装备详情、刷新、返回保留状态筛选、已删除装备详情和退出登录均正常；桌面布局、图片、零值属性及状态提示已检查。
- 页面验收使用独立临时库及 3101/5174 预览端口，完成后已退出临时账号、关闭页面、停止预览并删除临时库。现有 3000/5173 服务、业务库与 `.env` 均未修改。
