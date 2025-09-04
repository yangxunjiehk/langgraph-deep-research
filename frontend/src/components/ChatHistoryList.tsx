import { useState, useEffect } from 'react';
import { MessageCircle, Clock } from 'lucide-react';
import { useStream } from "@langchain/langgraph-sdk/react";
import type { Thread } from "@langchain/langgraph-sdk";

interface ChatThread {
  thread_id: string;
  created_at: string;
  updated_at: string;
  values?: {
    messages?: Array<{
      type: string;
      content: string;
    }>;
  };
}

interface ChatHistoryListProps {
  onSelectThread: (threadId: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ChatHistoryList({ onSelectThread, isExpanded, onToggle }: ChatHistoryListProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // 加载聊天线程列表
  const loadThreads = async () => {
    setLoading(true);
    setError('');
    try {
      // 这里需要调用LangGraph SDK来获取threads
      // 暂时使用模拟数据，后续需要集成真实的LangGraph client
      const mockThreads: ChatThread[] = [
        {
          thread_id: 'thread_1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          values: {
            messages: [{
              type: 'human',
              content: '调查一下最新的AI技术发展'
            }]
          }
        },
        {
          thread_id: 'thread_2', 
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          values: {
            messages: [{
              type: 'human',
              content: '研究区块链的最新应用'
            }]
          }
        }
      ];
      
      setThreads(mockThreads);
    } catch (err) {
      setError('加载聊天记录失败');
      console.error('Error loading threads:', err);
    } finally {
      setLoading(false);
    }
  };

  // 格式化日期显示
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffTime = nowOnly.getTime() - dateOnly.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else if (diffDays === 1) {
      return '昨天';
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric'
      });
    }
  };

  // 获取线程的显示文本
  const getThreadDisplayText = (thread: ChatThread) => {
    if (thread.values?.messages && thread.values.messages.length > 0) {
      const firstMessage = thread.values.messages[0];
      const fullText = firstMessage.content;
      return fullText.length > 15 ? fullText.substring(0, 15) + '...' : fullText;
    }
    return thread.thread_id;
  };

  useEffect(() => {
    if (isExpanded) {
      loadThreads();
    }
  }, [isExpanded]);

  return (
    <div className={`${isExpanded ? 'w-80' : 'w-12'} bg-neutral-900 border-r border-neutral-700 flex flex-col transition-all duration-300 ease-in-out overflow-hidden`}>
      {/* Header */}
      <div className="relative p-3 border-b border-neutral-700">
        {/* 收起状态的按钮 */}
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 z-10 ${
          !isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <button
            onClick={onToggle}
            className="p-2 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
            title="展开聊天记录"
          >
            <MessageCircle size={18} />
          </button>
        </div>
        
        {/* 展开状态的内容 */}
        <div className={`transition-opacity duration-300 ${
          isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-neutral-100 whitespace-nowrap">聊天记录</h2>
            <div className="flex items-center gap-1">
              <button 
                onClick={loadThreads}
                className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                disabled={loading}
                title="刷新列表"
              >
                <MessageCircle size={16} />
              </button>
              <button
                onClick={onToggle}
                className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                title="收起侧边栏"
              >
                ←
              </button>
            </div>
          </div>
          <p className="text-sm text-neutral-400 whitespace-nowrap">
            共 {threads.length} 个对话
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

        {!loading && !error && threads.length === 0 && (
          <div className="p-4 text-center text-neutral-500">
            <MessageCircle size={48} className="mx-auto mb-2 opacity-50" />
            <p>暂无聊天记录</p>
            <p className="text-sm mt-1">开始对话后记录会保存在这里</p>
          </div>
        )}

        {!loading && !error && threads.length > 0 && (
          <div className="space-y-1 p-2">
            {threads.map((thread) => (
              <div
                key={thread.thread_id}
                onClick={() => onSelectThread(thread.thread_id)}
                className="group p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-neutral-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-neutral-200 text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                      {getThreadDisplayText(thread)}
                    </h3>
                    <div className="flex items-center text-xs text-neutral-500 mt-1">
                      <Clock size={10} className="mr-1 flex-shrink-0" />
                      <span className="overflow-hidden text-ellipsis">{formatDate(thread.updated_at)}</span>
                    </div>
                  </div>
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
          点击对话可恢复历史记录
        </div>
      </div>
    </div>
  );
}