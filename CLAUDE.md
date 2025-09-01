# LangGraph Deep Research 项目

## 项目概述
这是一个基于 LangGraph 的深度研究系统，提供智能研究助手功能，包括自动化研究、报告生成和历史记录管理。

## ⚠️ 重要架构说明

### 前后端分离架构
当前项目采用**前后端分离**的开发模式：

1. **前端项目**：`D:\Workspace\langgraph-deep-research`
   - 包含React前端应用（位于`frontend/`目录）
   - 包含FastAPI报告存储服务（`backend/report_server.py`）
   - 有自带的后端graph代码但**暂未使用**

2. **后端项目**：`D:\Workspace\open_deep_research`
   - 提供LangGraph研究引擎（端口: 2024）
   - 包含多个助手实现：
     - Deep Researcher (原版)
     - Deep Researcher New (支持进度传递)
     - Deep Researcher New Lite (轻量版)
   - 前端当前连接到此项目的LangGraph服务

### 未来规划
- 调试完成后，计划将`open_deep_research`的后端代码迁移到当前项目
- 实现完整的单体项目架构

## 技术栈

### 后端服务
- **LangGraph SDK**: 智能研究流程编排 (端口: 2024) - 来自`open_deep_research`项目
- **FastAPI**: 报告存储API服务 (端口: 2025) - 位于当前项目
- **MySQL**: 报告数据存储
  - 主机: localhost:3306
  - 用户: root/root
  - 数据库: deep_research

### 前端
- **React + TypeScript**: 用户界面
- **Vite**: 开发服务器 (端口: 5176)
- **Tailwind CSS**: 样式框架
- **Lucide React**: 图标库

## 核心功能

### 1. 智能研究
- 使用 "Deep Researcher New Lite" 助手ID
- 支持 Tavily 搜索API
- 自动生成研究查询和执行搜索
- 智能内容分析和报告生成

### 2. 报告管理
- 自动保存生成的研究报告到MySQL数据库
- 历史报告列表和查看功能
- 报告删除功能
- Markdown格式渲染

### 3. 用户界面
- 三面板布局：可折叠侧边栏 + 对话窗口 + 报告查看器
- 响应式设计，侧边栏可展开/收起
- 报告查看器固定50%宽度在右侧
- 暗色主题界面

## 项目结构

```
langgraph-deep-research/
├── frontend/                 # React前端
│   ├── src/
│   │   ├── components/       # UI组件
│   │   │   ├── ReportHistoryList.tsx    # 历史报告侧边栏
│   │   │   ├── ReportViewer.tsx         # 报告查看器
│   │   │   ├── ChatMessagesView.tsx     # 聊天界面
│   │   │   └── ...
│   │   └── App.tsx          # 主应用组件
│   └── package.json
└── backend/
    ├── report_server.py     # FastAPI报告存储服务
    └── database_schema.sql  # 数据库表结构
```

## 开发命令

### 启动完整系统（需要同时运行）

#### 1. 启动LangGraph后端（在open_deep_research项目）
```bash
cd D:\Workspace\open_deep_research
# 启动LangGraph服务（端口2024）
py -3.12 -c "from langgraph_cli.cli import cli; cli()" dev --host 127.0.0.1 --port 2024
```

#### 2. 启动报告存储服务（在当前项目）
```bash
cd D:\Workspace\langgraph-deep-research\backend
python report_server.py  # 端口2025
```

#### 3. 启动前端开发服务器（在当前项目）
```bash
cd D:\Workspace\langgraph-deep-research\frontend
npm run dev -- --port 5176
```

## 数据库表结构

### research_reports 表
- `id`: 主键
- `title`: 报告标题
- `content`: Markdown格式内容
- `query`: 用户原始查询
- `created_at/updated_at`: 时间戳
- `status`: 报告状态 (completed/draft)
- `word_count`: 字数统计
- `research_time`: 研究耗时(秒)
- `metadata`: JSON格式元数据

## 配置说明

### 环境配置
- 开发环境LangGraph后端: http://localhost:2024
  - 需要Python 3.12版本
  - 使用langgraph_cli启动
- 生产环境LangGraph后端: http://localhost:8123
- 报告API服务: http://localhost:2025

### 重要特性
- 自动保存：研究完成后自动保存到数据库
- 防重复保存：使用hash机制避免重复保存
- 渐进式UI：侧边栏平滑展开/收起动画
- 固定布局：报告查看器宽度固定，不受侧边栏影响

## 🔥 核心技术突破：LangGraph进展传递机制

### 问题背景
在LangGraph中，默认的节点实现（使用Command）无法向前端传递研究进展信息，只能在研究完成后返回最终结果。这导致用户体验不佳，无法看到研究过程。

### 解决方案对比

#### ❌ Deep Researcher (原版) - 无法传递进展
```python
async def clarify_with_user(state, config) -> Command:
    # 只能返回Command，包含goto和update
    return Command(
        goto="write_research_brief",
        update={"messages": [...]}  # 只能更新预定义的state字段
    )
```

#### ✅ Deep Researcher New (新版) - 可以传递进展
```python
async def clarify_with_user_node(state, config):
    # 直接返回字典，可包含任意自定义字段
    return {
        "clarify_status": "completed",  # 自定义状态字段
        "brief_content": "...",         # 自定义内容字段
        "next_node": "write_research_brief"
    }
```

### 关键差异总结

1. **节点返回类型**：
   - 原版：返回`Command`对象，只能指定跳转和更新state
   - 新版：返回普通字典，可包含任意字段供前端消费

2. **前端事件接收**：
   - 原版：前端只能在`onFinish`时获得最终结果
   - 新版：前端通过`onUpdateEvent`实时接收每个节点的状态更新

3. **进度信息传递**：
   - 新版可以传递：`clarify_status`, `brief_status`, `report_status`等自定义状态
   - 这些字段被前端的`onUpdateEvent`捕获并显示在ActivityTimeline中

### 实现要点
- 所有节点函数改为直接返回字典而非Command
- 字典中可包含任意自定义字段用于进度显示
- 使用条件边（conditional_edges）处理节点跳转逻辑
- 前端通过解析event对象的特定字段来展示进度

这是实现LangGraph实时进度传递的核心技术突破！

## 最近更新
- ✅ 实现MySQL数据库集成
- ✅ 完成自动保存功能
- ✅ 优化侧边栏UI和动画效果
- ✅ 修复布局响应性问题
- ✅ 固定报告查看器宽度
- ✅ 总结LangGraph进展传递机制