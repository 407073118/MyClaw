---
name: Data Viewer
description: 示例技能 — 在右侧面板展示可搜索的数据表格（可作为模板复制）
---

# Data Viewer 示例

这是一个完整的 WebPanel 示例技能，展示如何：

1. 用 `view.html` 渲染数据表格
2. 通过 `postMessage` 从宿主接收数据
3. 实现搜索过滤、状态高亮等交互

## 使用方式

1. 在技能页面点击"打开面板"按钮
2. 右侧弹出 WebPanel，显示示例员工数据
3. 可在搜索框中输入关键词过滤

## 数据格式

view.html 接受以下格式的 payload：

```json
{
  "title": "表格标题",
  "columns": ["col1", "col2"],
  "rows": [
    { "col1": "值1", "col2": "值2" }
  ]
}
```

也支持自动推断列名：

```json
{
  "data": [
    { "name": "张三", "age": 28 }
  ]
}
```

## 作为模板

复制本文件夹，修改 view.html 即可创建你自己的可视化技能。
