# Stage 6.1 管理端装备查询列表

本步只接通 `/admin/equipments` 与 `GET /api/admin/equipments`。新增/编辑、装备详情、库存调整、删除和其他管理业务继续返回 501；未修改数据库结构或本机业务数据。

## 查询约定

- 名称搜索，分类、稀有度多选、系列等值匹配、仅有库存、状态和排序可以组合。特殊字符 `%`、`_`、`!`、反斜杠按名称文字匹配，不作为通配符。
- 默认包含 on_sale/off_sale，排除 deleted。显式筛选 on_sale/off_sale/deleted 时只返回对应状态；售罄装备仍可查询。
- 每页 10/20/50 条，默认 10；列表与 total 使用同一 REPEATABLE READ 只读快照，支持最新创建、价格升降序、稀有度降序，以 ID 保证排序稳定。
- 查询沿用参数化 SQL 和公共装备筛选校验，管理状态与分页独立验证。未知参数、重复标量参数、非法枚举和不安全页码返回 422。
- 返回 `{ items, total, page, page_size }`，包含装备资料、状态、新品标识、系列归属与创建/更新时间。统一管理权限仍在查询前验证，普通用户/冻结管理员不能读取列表。

## 页面交互

表单点击“查询”或回车提交，重置清除全部条件。已提交条件写入 URL，刷新及前进后退可恢复；翻页基于已提交条件，未提交的表单修改不改变分页含义。改变每页数量回到第一页，越界页按真实总数回到最后有效页。

列表展示图片、名称、编号、分类、稀有度、价格、库存、状态和系列，新品显示标记。提供加载、空结果、错误重试状态；窄屏筛选纵向排列，表格可横向滚动。没有未实现的编辑或删除按钮。

请求复用 Axios、latest-request、AbortController 和会话 revision 检查。页面卸载取消请求，旧查询和旧账号响应不能覆盖当前列表；管理布局在身份失效时卸载内容。

## 文件入口

- `client/src/views/admin/EquipmentList.vue`：筛选表单、表格、分页及加载过程。
- `client/src/utils/admin/equipment-query.js`：管理查询参数与 URL 归一化。
- `server/src/modules/admin/equipments/equipment.validation.js`：后端校验。
- `server/src/modules/admin/equipments/equipment.service.js`：只读快照查询；写方法继续占位。
- `client/tests/admin-equipment-query.test.js`、`server/tests/admin.test.js`、`server/tests/admin-equipment-database.test.js`：URL、输入校验、权限、数据筛选及一致性回归。

下一小步建议接通装备详情读取，再完善新增/编辑；库存仍通过独立接口处理，不并入资料编辑表单。

## 本步验证（2026-09-16）

- `npm test`：后端 39/39、前端 97/97 通过。
- `npm run test:db`：69/69 通过，使用独立临时数据库，覆盖组合筛选、分页、权限和查询快照一致性。
- `npm run build` 与 `git diff --check` 通过。
- 浏览器实测：未登录访问管理页跳转登录；管理员登录后正常加载；分类与系列组合筛选、刷新恢复条件、重置、翻页、空结果及退出登录正常，桌面布局已检查。
- 界面验证使用单独创建并填充种子数据的临时数据库；完成后退出验证账号、停止本轮预览进程并删除该临时库，本机业务数据库及 `.env` 未修改。
