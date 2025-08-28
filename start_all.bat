@echo off
echo ========================================
echo   启动 LangGraph Deep Research 全栈
echo ========================================
echo.

REM 启动后端（在新窗口）
echo [1/2] 启动后端服务...
start cmd /k "cd /d %~dp0backend && echo 后端启动中... && langgraph dev"

REM 等待几秒让后端启动
echo 等待后端启动...
timeout /t 5 /nobreak >nul

REM 启动前端（在新窗口）
echo [2/2] 启动前端服务...
start cmd /k "cd /d %~dp0frontend && echo 前端启动中... && npm run dev"

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 后端地址: http://localhost:2024
echo 前端地址: http://localhost:5174/app/
echo.
echo 提示：
echo - 两个服务都在独立的命令窗口中运行
echo - 关闭窗口即可停止对应的服务
echo - 或使用 kill_backend_quick.bat 快速停止所有服务
echo.
pause