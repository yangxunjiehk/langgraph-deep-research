import { FileText } from "lucide-react";

interface ReportGeneratedNotificationProps {
  showReport: boolean;
  onToggleReport: () => void;
}

export function ReportGeneratedNotification({ 
  showReport, 
  onToggleReport 
}: ReportGeneratedNotificationProps) {
  return (
    <div className="mt-4 p-4 bg-neutral-800 border border-neutral-600 rounded-lg">
      {/* 文档图标和标题 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-neutral-700 rounded-lg flex items-center justify-center">
          <FileText className="h-5 w-5 text-neutral-300" />
        </div>
        <div>
          <h3 className="text-white font-medium">研究报告</h3>
          <p className="text-neutral-400 text-sm">{new Date().toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>
      
      {/* 打开按钮 */}
      <button
        onClick={onToggleReport}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-full transition-colors"
      >
        {showReport ? "隐藏报告" : "打开"}
      </button>
    </div>
  );
}