@echo off
echo ========================================
echo   启动 LangGraph Deep Research 后端
echo ========================================
echo.

cd /d "%~dp0backend"

echo 正在启动后端服务...
echo.
echo 提示：
echo - 后端将在端口 2024 运行
echo - LangGraph UI 会自动在浏览器打开
echo - 按 Ctrl+C 可以停止服务
echo.

langgraph dev

pause