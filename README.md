# xMine Chrome Extension

一个强大的 Chrome 浏览器插件，专注于捕获、管理和导出 X (Twitter) 推文与回复。它提供了一个美观的仪表盘界面，帮助用户高效整理信息，并支持一键导出到 Obsidian 知识库。

## ✨ 核心功能

*   **数据抓取**: 自动捕获当前页面的推文、回复及相关图片。
*   **可视化仪表盘 (Dashboard)**:
    *   **列表视图**: 清晰的推文列表，包含用户、分类、内容摘要、标签、媒体预览及互动数据（浏览/转发/点赞）。
    *   **响应式布局**: 根据屏幕尺寸智能调整列宽，适配从宽屏到笔记本等多种分辨率。
    *   **卡片视图**: 提供更加可视化的网格布局查看模式。
*   **信息整理**:
    *   **分类管理**: 自定义推文分类。
    *   **标签系统**: 为推文添加多维度标签。
*   **数据导出**:
    *   **Obsidian 集成**: 支持直接导出 Markdown 格式到 Obsidian Vault。
    *   **多格式支持**: 支持导出为 JSON 等格式。
*   **媒体查看**: 内置图片预览功能，支持紧凑模式显示。

## 🛠️ 技术栈

本项目基于现代 Web 技术栈构建：
*   **前端框架**: [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
*   **构建工具**: [Vite](https://vitejs.dev/)
*   **样式库**: [Tailwind CSS](https://tailwindcss.com/)
*   **状态管理**: [Zustand](https://github.com/pmndrs/zustand)
*   **图标库**: [Lucide React](https://lucide.dev/)
*   **浏览器扩展 API**: Manifest V3

## 🚀 安装与开发指南

### 1. 环境准备
确保您的电脑上安装了 [Node.js](https://nodejs.org/) (推荐 LTS 版本)。

### 2. 获取代码与安装依赖
```bash
# 进入项目目录
cd extension

# 安装项目依赖
npm install
```

### 3. 开发模式
启动 Vite 开发服务器：
```bash
npm run dev
```

### 4. 构建插件
将项目打包为 Chrome 扩展可用的格式：
```bash
npm run build
```
构建完成后，产物会生成在 `dist` 目录下。

### 5. 加载到 Chrome 浏览器
1.  打开 Chrome 浏览器，访问 `chrome://extensions/`。
2.  开启右上角的 **"开发者模式" (Developer mode)**。
3.  点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**。
4.  选择本项目下的 **`extension/dist`** 文件夹（注意是 `dist` 目录，不是根目录）。
5.  加载成功后，您应该能看到 **xMine** 插件图标。

## 📖 使用说明

1.  **抓取数据**: 在 X (Twitter) 页面浏览时，插件会在后台自动或手动（取决于具体配置）捕获推文。
2.  **打开仪表盘**: 点击浏览器工具栏的 xMine 图标，打开管理面板。
3.  **整理内容**: 在列表中勾选推文，点击分类或标签进行编辑。
4.  **导出**: 选择需要归档的推文，点击顶部的“导出”按钮，选择目标格式或 Obsidian 路径。

## 🛡️ 隐私与安全
*   本项目所有数据均存储在用户本地浏览器 (`chrome.storage.local`) 中，不上传到任何远程服务器。
*   代码中**不包含**任何硬编码的密码或私有 API Key。

## 🤝 贡献
欢迎提交 Issue 或 Pull Request 来改进此项目。

---
License: MIT
