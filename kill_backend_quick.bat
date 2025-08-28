@echo off
REM 快速终止后端进程 - 一键执行版本

echo 正在终止 LangGraph 后端进程...

REM 杀死占用 8000 和 8123 端口的进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8123"') do taskkill /F /PID %%a >nul 2>&1

REM 杀死所有Python进程（慎用）
REM 如果你有其他Python程序在运行，请注释掉下面这行
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM py.exe >nul 2>&1

echo 完成！后端进程已被终止。
timeout /t 2 >nul