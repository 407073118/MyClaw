# assets/

此目录用于存放静态资源文件。

例如：
- 图标（SVG、PNG）
- 样式表（CSS）
- 字体文件

HTML 页面可以通过相对路径引用此目录下的文件：
```html
<img src="assets/logo.svg" alt="Logo">
<link rel="stylesheet" href="assets/theme.css">
```

检测到此目录后，技能卡片上会显示 "assets" 标签。
