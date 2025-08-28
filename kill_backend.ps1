# LangGraph Deep Research 后端进程管理脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LangGraph Deep Research 后端进程管理  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Kill-ProcessByPort {
    param([int]$Port)
    
    Write-Host "[*] 检查端口 $Port..." -ForegroundColor Yellow
    
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    
    if ($connections) {
        $processes = $connections | ForEach-Object {
            Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        } | Select-Object -Unique
        
        foreach ($proc in $processes) {
            Write-Host "    找到进程: $($proc.Name) (PID: $($proc.Id))" -ForegroundColor White
            try {
                Stop-Process -Id $proc.Id -Force
                Write-Host "    ✓ 成功终止进程 $($proc.Id)" -ForegroundColor Green
            } catch {
                Write-Host "    ✗ 无法终止进程 $($proc.Id): $_" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "    没有进程占用端口 $Port" -ForegroundColor Gray
    }
}

function Show-PythonProcesses {
    Write-Host ""
    Write-Host "[*] 当前运行的 Python 进程:" -ForegroundColor Yellow
    
    $pythonProcesses = Get-Process python*, py -ErrorAction SilentlyContinue
    
    if ($pythonProcesses) {
        $pythonProcesses | ForEach-Object {
            $proc = $_
            try {
                $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
                Write-Host ""
                Write-Host "    PID: $($proc.Id)" -ForegroundColor White
                Write-Host "    进程名: $($proc.Name)" -ForegroundColor Gray
                Write-Host "    命令行: $cmdLine" -ForegroundColor Gray
                
                # 检查是否是后端进程
                if ($cmdLine -like "*agent*" -or $cmdLine -like "*graph.py*" -or $cmdLine -like "*backend*") {
                    Write-Host "    → 这可能是 LangGraph 后端进程" -ForegroundColor Magenta
                }
            } catch {
                Write-Host "    无法获取进程详情" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "    没有找到 Python 进程" -ForegroundColor Gray
    }
}

function Kill-BackendProcesses {
    Write-Host ""
    Write-Host "[*] 终止 LangGraph 后端相关进程..." -ForegroundColor Yellow
    
    $killed = 0
    
    # 查找并终止包含特定关键字的Python进程
    $pythonProcesses = Get-Process python*, py -ErrorAction SilentlyContinue
    
    foreach ($proc in $pythonProcesses) {
        try {
            $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
            
            if ($cmdLine -like "*agent*" -or 
                $cmdLine -like "*graph.py*" -or 
                $cmdLine -like "*backend*" -or
                $cmdLine -like "*langgraph*" -or
                $cmdLine -like "*8000*" -or
                $cmdLine -like "*8123*") {
                
                Write-Host "    终止进程 PID: $($proc.Id) - $cmdLine" -ForegroundColor White
                Stop-Process -Id $proc.Id -Force
                $killed++
                Write-Host "    ✓ 成功" -ForegroundColor Green
            }
        } catch {
            # 忽略错误
        }
    }
    
    if ($killed -eq 0) {
        Write-Host "    没有找到需要终止的后端进程" -ForegroundColor Gray
    } else {
        Write-Host "    共终止 $killed 个进程" -ForegroundColor Green
    }
}

# 主菜单
Write-Host "请选择操作:" -ForegroundColor Cyan
Write-Host "1. 自动清理所有后端进程 (推荐)" -ForegroundColor White
Write-Host "2. 只显示当前 Python 进程" -ForegroundColor White
Write-Host "3. 终止所有 Python 进程 (慎用)" -ForegroundColor White
Write-Host "4. 手动输入 PID 终止特定进程" -ForegroundColor White
Write-Host "5. 退出" -ForegroundColor White
Write-Host ""

$choice = Read-Host "请输入选项 (1-5)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "执行自动清理..." -ForegroundColor Cyan
        Kill-ProcessByPort -Port 8000
        Kill-ProcessByPort -Port 8123
        Kill-BackendProcesses
        Write-Host ""
        Write-Host "✓ 清理完成!" -ForegroundColor Green
    }
    "2" {
        Show-PythonProcesses
    }
    "3" {
        Write-Host ""
        Write-Host "警告：这将终止所有 Python 进程！" -ForegroundColor Red
        $confirm = Read-Host "确定要继续吗? (y/N)"
        if ($confirm -eq "y" -or $confirm -eq "Y") {
            Get-Process python*, py -ErrorAction SilentlyContinue | Stop-Process -Force
            Write-Host "✓ 已终止所有 Python 进程" -ForegroundColor Green
        } else {
            Write-Host "操作已取消" -ForegroundColor Yellow
        }
    }
    "4" {
        Write-Host ""
        $pid = Read-Host "请输入要终止的进程 PID"
        try {
            Stop-Process -Id $pid -Force
            Write-Host "✓ 成功终止进程 $pid" -ForegroundColor Green
        } catch {
            Write-Host "✗ 无法终止进程 $pid: $_" -ForegroundColor Red
        }
    }
    "5" {
        Write-Host "退出程序" -ForegroundColor Gray
        exit
    }
    default {
        Write-Host "无效的选项" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")