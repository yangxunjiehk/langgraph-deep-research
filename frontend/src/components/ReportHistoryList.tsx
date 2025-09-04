import { useState, useEffect } from 'react';
import { Trash2, FileText, Clock, BarChart3, Menu, ChevronLeft, MessageCircle } from 'lucide-react';

interface ReportItem {
  id: number;
  title: string;
  query: string;
  created_at: string;
  status: string;
  word_count: number;
  research_time: number;
}

interface ReportHistoryListProps {
  onSelectReport: (reportId: number) => Promise<void>;
  onDeleteReport?: (reportId: number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onShowChatHistory: () => void;
}

export function ReportHistoryList({ onSelectReport, onDeleteReport, isExpanded, onToggle, onShowChatHistory }: ReportHistoryListProps) {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // 加载报告列表
  const loadReports = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('http://localhost:2025/api/reports/');
      if (!response.ok) {
        throw new Error('Failed to load reports');
      }
      const reportsData = await response.json();
      setReports(reportsData);
    } catch (err) {
      setError('加载报告失败');
      console.error('Error loading reports:', err);
    } finally {
      setLoading(false);
    }
  };

  // 删除报告
  const handleDelete = async (reportId: number, event: React.MouseEvent) => {
    event.stopPropagation(); // 防止触发选择事件
    
    if (!confirm('确定要删除这个报告吗？')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:2025/api/reports/${reportId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete report');
      }
      
      // 从列表中移除
      setReports(prev => prev.filter(report => report.id !== reportId));
      onDeleteReport?.(reportId);
    } catch (err) {
      alert('删除报告失败');
      console.error('Error deleting report:', err);
    }
  };

  // 格式化日期
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 格式化研究时间
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  useEffect(() => {
    if (isExpanded) {
      loadReports();
    }
  }, [isExpanded]);

  return (
    <div className={`${isExpanded ? 'w-80' : 'w-12'} bg-neutral-900 border-r border-neutral-700 flex flex-col transition-all duration-300 ease-in-out overflow-hidden`}>
      {/* Header */}
      <div className="relative p-3 border-b border-neutral-700">
        {/* 收起状态的按钮组（始终存在） */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-300 z-10 ${
          !isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <button
            onClick={onToggle}
            className="p-2 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
            title="展开研究报告"
          >
            <FileText size={16} />
          </button>
          <button
            onClick={onShowChatHistory}
            className="p-2 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
            title="查看聊天记录"
          >
            <MessageCircle size={16} />
          </button>
        </div>
        
        {/* 展开状态的内容（始终按完整宽度排版） */}
        <div className={`transition-opacity duration-300 ${
          isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-neutral-100 whitespace-nowrap">历史报告</h2>
            <div className="flex items-center gap-1">
              <button 
                onClick={loadReports}
                className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                disabled={loading}
                title="刷新列表"
              >
                <FileText size={16} />
              </button>
              <button
                onClick={onToggle}
                className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                title="收起侧边栏"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>
          <p className="text-sm text-neutral-400 whitespace-nowrap">
            共 {reports.length} 个报告
          </p>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto transition-opacity duration-300 ${
        isExpanded ? 'opacity-100' : 'opacity-0'
      }`}>
        {loading && (
          <div className="p-4 text-center text-neutral-400">
            加载中...
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && reports.length === 0 && (
          <div className="p-4 text-center text-neutral-500">
            <FileText size={48} className="mx-auto mb-2 opacity-50" />
            <p>暂无历史报告</p>
            <p className="text-sm mt-1">完成研究后报告会自动保存在这里</p>
          </div>
        )}

        {!loading && !error && reports.length > 0 && (
          <div className="space-y-1 p-2">
            {reports.map((report) => (
              <div
                key={report.id}
                onClick={() => onSelectReport(report.id)}
                className="group p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-neutral-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-neutral-200 text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                      {report.title}
                    </h3>
                    <p className="text-xs text-neutral-400 mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
                      {report.query}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(report.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-600 hover:text-white rounded text-neutral-400 ml-2 flex-shrink-0"
                    title="删除报告"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="flex items-center justify-between mt-2 text-xs text-neutral-500">
                  <div className="flex items-center space-x-3 overflow-hidden flex-1 mr-2">
                    <span className="flex items-center whitespace-nowrap">
                      <Clock size={10} className="mr-1 flex-shrink-0" />
                      <span className="overflow-hidden text-ellipsis">{formatDate(report.created_at)}</span>
                    </span>
                    {report.word_count > 0 && (
                      <span className="flex items-center whitespace-nowrap">
                        <BarChart3 size={10} className="mr-1 flex-shrink-0" />
                        <span>{report.word_count}字</span>
                      </span>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-xs whitespace-nowrap flex-shrink-0 ${
                    report.status === 'completed' 
                      ? 'bg-green-600/20 text-green-400' 
                      : 'bg-yellow-600/20 text-yellow-400'
                  }`}>
                    {report.status === 'completed' ? '已完成' : '草稿'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`p-3 border-t border-neutral-700 text-xs text-neutral-500 text-center transition-opacity duration-300 ${
        isExpanded ? 'opacity-100' : 'opacity-0'
      }`}>
        <div className="whitespace-nowrap">
          点击报告可查看详情
        </div>
      </div>
    </div>
  );
}