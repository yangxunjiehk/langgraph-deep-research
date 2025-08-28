@echo off
echo ========================================
echo   停止 LangGraph Deep Research 后端
echo ========================================
echo.

REM 尝试通过端口查找并杀死进程
echo [1] 查找占用端口 8000 的进程...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000"') do (
    echo 找到进程 PID: %%a
    taskkill /F /PID %%a >nul 2>&1
    if !errorlevel! == 0 (
        echo 成功终止进程 %%a
    )
)

REM 尝试通过端口查找并杀死进程
echo [2] 查找占用端口 8123 的进程...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8123"') do (
    echo 找到进程 PID: %%a
    taskkill /F /PID %%a >nul 2>&1
    if !errorlevel! == 0 (
        echo 成功终止进程 %%a
    )
)

echo.
echo [3] 查找所有 Python 进程...
echo.

REM 列出所有Python进程供用户参考
wmic process where "name like 'python%%'" get ProcessId,CommandLine /format:list 2>nul | findstr /v "^$" | findstr /v "^CommandLine=$" | findstr /v "^ProcessId=$"

echo.
echo [4] 强制终止所有包含 "agent" 或 "graph.py" 的 Python 进程...
for /f "tokens=2" %%a in ('wmic process where "name like 'python%%' and CommandLine like '%%agent%%'" get ProcessId /format:list 2^>nul ^| findstr "="') do (
    set pid=%%a
    echo 终止进程 PID: !pid!
    taskkill /F /PID !pid! >nul 2>&1
)

for /f "tokens=2" %%a in ('wmic process where "name like 'python%%' and CommandLine like '%%graph.py%%'" get ProcessId /format:list 2^>nul ^| findstr "="') do (
    set pid=%%a
    echo 终止进程 PID: !pid!
    taskkill /F /PID !pid! >nul 2>&1
)

echo.
echo ========================================
echo   操作完成！
echo ========================================
echo.
echo 提示：如果后端进程仍在运行，你可以：
echo 1. 打开任务管理器，手动查找并结束 python.exe 进程
echo 2. 运行命令：taskkill /F /IM python.exe （这会杀死所有Python进程）
echo.
pause