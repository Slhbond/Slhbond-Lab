---
title: Markdown 写作指南
date: 2026-07-12
time: 14:00
category: 教程
tags: [Markdown, 教程]
summary: 介绍博客支持的 Markdown 语法，包含代码块、图片、表格等常用写法。
---

## 代码块

用三个反引号包裹代码，后面写语言名称即可自动高亮：

````markdown
```javascript
function hello() {
  console.log("Hello World!");
}
```
````

效果如下：

```javascript
function hello() {
  console.log("Hello World!");
}
```

### 常用语言

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))
```

```bash
# 更新系统
apt update && apt upgrade -y

# 查看 Docker 容器
docker ps -a
```

```json
{
  "name": "my-blog",
  "version": "1.0.0",
  "author": "your-name"
}
```

```yaml
site:
  title: 我的博客
  subtitle: 记录学习与生活
```

---

## 文本格式

**粗体**、*斜体*、~~删除线~~、`行内代码`

> 这是一段引用文字
> 可以多行

---

## 列表

### 无序列表

- 项目一
- 项目二
  - 子项目 A
  - 子项目 B

### 有序列表

1. 第一步
2. 第二步
3. 第三步

---

## 链接与图片

[外部链接](https://example.com)

![图片描述](/images/example.png)

> 图片上传：后台编辑器支持直接粘贴或拖拽上传图片。

---

## 表格

| 语言 | 难度 | 用途 |
|------|------|------|
| JavaScript | 中等 | Web 全栈 |
| Python | 简单 | 脚本/AI |
| Go | 中等 | 后端服务 |

---

以上就是博客支持的主要 Markdown 语法，开始写作吧！
