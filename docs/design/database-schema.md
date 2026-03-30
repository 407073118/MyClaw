# 数据结构设计入口

根层不直接拥有统一数据库，但需要说明两个工作区的数据入口位置。

## 1. `desktop/`

- 本地状态与持久化由 `desktop/apps/runtime` 管理。
- 相关状态结构与存储逻辑应以 `desktop/apps/runtime` 局部文档与源码为准。

## 2. `cloud/`

- 云端数据库模型以 `cloud/apps/cloud-api/prisma/schema.prisma` 为准。
- 根层只做入口说明，不在这里复制 Prisma 细节。

## 3. 设计约束

- 根层不维护重复 schema。
- 如果跨工作区文档需要引用数据结构，优先链接到真实 schema 位置。

