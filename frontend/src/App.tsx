import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FileText, MessageCircle, ChevronLeft, Clock, BarChart3 } from 'lucide-react';
import { ProcessedEvent } from "@/components/ActivityTimeline";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatMessagesView } from "@/components/ChatMessagesView";
import { ReportViewer } from "@/components/ReportViewer";
import { ReportHistoryList } from "@/components/ReportHistoryList";
import { ChatHistoryList } from "@/components/ChatHistoryList";

// 扩展Window类型
declare global {
  interface Window {
    _pendingReport?: { content: string; timestamp: number };
  }
}

export default function App() {
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const [finalReport, setFinalReport] = useState<string>("");
  const [showReport, setShowReport] = useState<boolean>(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);
  const [isChatHistoryExpanded, setIsChatHistoryExpanded] = useState<boolean>(false);
  const [activePanel, setActivePanel] = useState<'reports' | 'chats' | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const hasFinalizeEventOccurredRef = useRef(false);
  const savedReportsRef = useRef<Set<string>>(new Set()); // 防止重复保存

  // 加载报告列表
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const response = await fetch('http://localhost:2025/api/reports/');
      if (!response.ok) {
        throw new Error('Failed to load reports');
      }
      const reportsData = await response.json();
      setReports(reportsData);
    } catch (err) {
      console.error('Error loading reports:', err);
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  // 保存报告到数据库
  const saveReport = useCallback(async (content: string, query: string) => {
    try {
      const response = await fetch('http://localhost:2025/api/reports/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '', // 后端会从content中提取标题
          content: content,
          query: query,
          research_time: 0, // 先设为0，避免复杂的时间计算
          metadata: {
            frontend_version: '1.0',
            assistant_id: 'Deep Researcher New Lite'
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save report: ${response.status} ${errorText}`);
      }

      const savedReport = await response.json();
      console.log('✅ Report saved automatically:', savedReport.title);
      return savedReport;
    } catch (error) {
      console.error('❌ Error saving report:', error);
      throw error;
    }
  }, []);

  // 从数据库加载报告
  const loadReport = useCallback(async (reportId: number) => {
    try {
      const response = await fetch(`http://localhost:2025/api/reports/${reportId}`);
      if (!response.ok) {
        throw new Error('Failed to load report');
      }

      const report = await response.json();
      setFinalReport(report.content);
      setShowReport(true);
      return report;
    } catch (error) {
      console.error('Error loading report:', error);
      alert('加载报告失败');
    }
  }, []);

  // 删除报告的回调
  const handleDeleteReport = useCallback((reportId: number) => {
    // 如果当前显示的是被删除的报告，则隐藏报告面板
    // 可以添加后续的清理逻辑
  }, []);

  // 处理聊天记录选择
  const handleSelectThread = useCallback((threadId: string) => {
    console.log('Selected thread:', threadId);
    // TODO: 实现恢复线程逻辑
    // 这里需要使用 useStream 的相关方法来恢复thread
  }, []);

  // 处理面板切换
  const handleShowReports = useCallback(() => {
    setActivePanel('reports');
    setIsHistoryExpanded(true);
    setIsChatHistoryExpanded(false);
    loadReports();
  }, [loadReports]);

  const handleShowChatHistory = useCallback(() => {
    setActivePanel('chats');
    setIsChatHistoryExpanded(true);
    setIsHistoryExpanded(false);
  }, []);

  const handleToggleReports = useCallback(() => {
    if (activePanel === 'reports' && isHistoryExpanded) {
      setIsHistoryExpanded(false);
      setActivePanel(null);
    } else {
      handleShowReports();
    }
  }, [activePanel, isHistoryExpanded, handleShowReports]);

  const handleToggleChatHistory = useCallback(() => {
    if (activePanel === 'chats' && isChatHistoryExpanded) {
      setIsChatHistoryExpanded(false);
      setActivePanel(null);
    } else {
      handleShowChatHistory();
    }
  }, [activePanel, isChatHistoryExpanded, handleShowChatHistory]);

  const thread = useStream<{
    messages: Message[];
    configurable?: {
      allow_clarification?: boolean;
      search_api?: string;
    };
  }>({
    apiUrl: import.meta.env.DEV
      ? "http://localhost:2024"
      : "http://localhost:8123",
    assistantId: "Deep Researcher New Lite",  // 切换到deep_researcher_new_lite后端 - 快速开发测试
    messagesKey: "messages",
    onFinish: (event: any) => {
      console.log(event);
    },
    onUpdateEvent: (event: any) => {
      console.log("[Frontend] Received event:", JSON.stringify(event, null, 2));
      
      // 检查是否有完整的values数据，用于保存待处理的报告
      if (event.values && event.values.messages && event.values.final_report && window._pendingReport) {
        const pendingReport = window._pendingReport;
        const currentTime = Date.now();
        
        // 检查是否是最近的待处理报告（5分钟内）
        if (currentTime - pendingReport.timestamp < 5 * 60 * 1000) {
          // 提取用户查询
          const eventMessages = event.values.messages;
          const userMessage = eventMessages.find(m => m.type === "human");
          
          if (userMessage && typeof userMessage.content === 'string') {
            const query = userMessage.content.trim();
            const reportContent = event.values.final_report || pendingReport.content;
            
            saveReport(reportContent, query).catch(console.error);
            delete window._pendingReport; // 清除待处理报告
          }
        }
      }
      
      let processedEvent: ProcessedEvent | null = null;
      let eventProcessed = false;
      
      // 特殊处理clarify_with_user节点
      if (event.clarify_with_user) {
        const clarifyStatus = event.clarify_with_user.clarify_status || "processing";
        
        // 如果需要澄清，应该将消息显示在对话窗口而不是进展中
        if (clarifyStatus === "needs_clarification") {
          // 检查是否有messages字段包含AI的澄清问题
          if (event.clarify_with_user.messages && event.clarify_with_user.messages.length > 0) {
            const aiMessage = event.clarify_with_user.messages[0];
            if (aiMessage && aiMessage.content) {
              // 这里应该将AI消息添加到thread.messages中显示
              // 但由于useStream的限制，我们暂时只能通过其他方式处理
              console.log("[Clarify] AI asking for clarification:", aiMessage.content);
            }
          }
          // 不创建进展事件，让消息正常显示
          eventProcessed = false;
        } else if (clarifyStatus === "skipped" || clarifyStatus === "skipped_lite") {
          // 跳过澄清，开始研究 - 创建一个简单的进展事件
          processedEvent = {
            title: "Starting Research",
            data: "Proceeding with research task...",
          };
          eventProcessed = true;
        } else if (clarifyStatus === "completed" || clarifyStatus === "completed_lite") {
          // 澄清完成，准备开始研究
          processedEvent = {
            title: "Requirements Clarified",
            data: "User requirements understood, starting research...",
          };
          eventProcessed = true;
        }
      } else if (event.write_research_brief) {
        const briefStatus = event.write_research_brief.brief_status || "processing";
        const briefContent = event.write_research_brief.brief_content;
        const statusMessages = {
          "completed": briefContent ? `Research brief created: ${briefContent.substring(0, 100)}...` : "Research brief completed successfully",
          "processing": "Analyzing and organizing research requirements...",
          "error": "Error creating research brief"
        };
        processedEvent = {
          title: "Writing Research Brief", 
          data: statusMessages[briefStatus] || "Creating research strategy...",
        };
        eventProcessed = true;
      } else if (event.generate_queries) {
        processedEvent = {
          title: "Generating Search Queries",
          data: event.generate_queries.query_list 
            ? event.generate_queries.query_list.join(", ")
            : "Preparing search queries...",
        };
        eventProcessed = true;
      } else if (event.perform_searches) {
        const sources = event.perform_searches.sources_gathered || [];
        const numSources = sources.length;
        const uniqueLabels = [
          ...new Set(sources.map((s: any) => s.label).filter(Boolean)),
        ];
        const exampleLabels = uniqueLabels.slice(0, 3).join(", ");
        processedEvent = {
          title: "Web Research",
          data: `Gathered ${numSources} sources. Related to: ${
            exampleLabels || "N/A"
          }.`,
        };
        eventProcessed = true;
      } else if (event.analyze_search_results) {
        const followUpQueries = event.analyze_search_results.reflection_follow_up_queries || [];
        processedEvent = {
          title: "Reflection",
          data: event.analyze_search_results.reflection_is_sufficient
            ? "Search successful, generating final answer."
            : followUpQueries.length > 0
            ? `Need more information, searching for ${followUpQueries.join(", ")}`
            : "Analyzing research results...",
        };
        eventProcessed = true;
      } else if (event.plan_research && (event.plan_research.planner_node || event.plan_research.planner)) {
        const plannerData = event.plan_research.planner_node || event.plan_research.planner;
        processedEvent = {
          title: "Planning Research Strategy",
          data: plannerData.plan 
            ? `Generated ${plannerData.plan.length} research tasks`
            : "Analyzing research requirements...",
        };
        eventProcessed = true;
      } else if (event.execute_research_tools) {
        processedEvent = {
          title: "Executing Research Tools",
          data: event.execute_research_tools.execution_status === "ready_for_search"
            ? "Preparing to execute research tasks"
            : "Processing research execution strategy",
        };
        eventProcessed = true;
      } else if (event.compress_research) {
        processedEvent = {
          title: "Compressing Research",
          data: event.compress_research.compressed_notes_count 
            ? `Compressed ${event.compress_research.compressed_notes_count} research notes`
            : "Organizing and compressing research findings...",
        };
        eventProcessed = true;
      } else if (event.content_enhancement_analysis) {
        processedEvent = {
          title: "Content Enhancement Analysis",
          data: event.content_enhancement_analysis.needs_enhancement
            ? `Enhancement needed: ${event.content_enhancement_analysis.reasoning || 'Analyzing content quality'}`
            : "Content quality sufficient, proceeding with report generation",
        };
        eventProcessed = true;
      } else if (event.evaluate_research_enhanced) {
        processedEvent = {
          title: "Research Quality Evaluation",
          data: event.evaluate_research_enhanced.evaluation_is_sufficient
            ? "Research meets quality standards"
            : "Additional research required",
        };
        eventProcessed = true;
      } else if (event.content_enhancement) {
        const enhancementStatus = event.content_enhancement.enhancement_status || "unknown";
        const statusMessages = {
          "skipped": "Content enhancement skipped - quality sufficient",
          "completed": "Content enhancement completed successfully", 
          "failed": "Content enhancement failed",
          "error": "Content enhancement encountered errors",
          "analyzing": "Analyzing content enhancement needs",
          "skipped_no_api": "Content enhancement skipped - no API key"
        };
        processedEvent = {
          title: "Content Enhancement Analysis",
          data: statusMessages[enhancementStatus] || `Status: ${enhancementStatus}`,
        };
        eventProcessed = true;
      } else if (event.record_task_completion) {
        const recordData = event.record_task_completion;
        const nextDecision = recordData.next_node_decision || "continue";
        const ledger = recordData.ledger || [];
        const completedTask = ledger.length > 0 ? ledger[0].description : "Unknown task";
        processedEvent = {
          title: "Task Completion Recorded",
          data: nextDecision === "end" 
            ? `All tasks completed. Final task: ${completedTask}`
            : `Task completed: ${completedTask}. Moving to next task.`,
        };
        eventProcessed = true;
      } else if (event.generate_final_report) {
        processedEvent = {
          title: "Finalizing Answer",
          data: "Composing and presenting the final answer.",
        };
        hasFinalizeEventOccurredRef.current = true;
        eventProcessed = true;
      } else if (event.final_report_generation) {
        const reportStatus = event.final_report_generation.report_status || "processing";
        const reportContent = event.final_report_generation.final_report;
        const statusMessages = {
          "completed": "Final report generated successfully",
          "error": "Error generating final report",
          "processing": "Composing and presenting the final answer..."
        };
        processedEvent = {
          title: "Final Report Generation", 
          data: statusMessages[reportStatus] || "Generating final report...",
        };
        
        // 如果有报告内容，存储并显示
        if (reportContent) {
          setFinalReport(reportContent);
          setShowReport(true);
          
          // 自动保存报告到数据库 - 从event中提取数据
          let query = '';
          
          // 尝试从event.values.messages中获取用户查询
          if (event.values && event.values.messages) {
            const eventMessages = event.values.messages;
            const userMessage = eventMessages.find(m => m.type === "human");
            
            if (userMessage && typeof userMessage.content === 'string') {
              query = userMessage.content;
            }
          }
          
          // 如果event中没有找到，再尝试thread.messages
          if (!query) {
            const allMessages = thread.messages || [];
            const userMessages = allMessages.filter(m => m.type === "human");
            const lastUserMessage = userMessages[userMessages.length - 1];
            if (lastUserMessage && typeof lastUserMessage.content === 'string') {
              query = lastUserMessage.content;
            }
          }
          
          if (query) {
            saveReport(reportContent, query).catch(console.error);
          } else {
            // 临时保存报告内容，稍后在有完整数据时保存
            window._pendingReport = { content: reportContent, timestamp: Date.now() };
          }
        }
        
        hasFinalizeEventOccurredRef.current = true;
        eventProcessed = true;
      }
      
      
      if (processedEvent) {
        setProcessedEventsTimeline((prevEvents) => [
          ...prevEvents,
          processedEvent!,
        ]);
      }
    },
  });

  // 🎯 修改：智能过滤消息 - 显示用户消息和澄清相关的AI消息
  const filteredMessages = useMemo(() => {
    if (!thread.messages) return [];
    
    return thread.messages.filter((message, index) => {
      // 始终显示用户消息
      if (message.type === "human") {
        return true;
      }
      
      // 显示AI的澄清消息（通常是第一个AI回复，在研究开始前）
      if (message.type === "ai") {
        // 检查是否是澄清相关的消息（通常包含问号或特定关键词）
        const content = typeof message.content === "string" ? message.content : "";
        const isClarificationMessage = 
          content.includes("?") || 
          content.includes("clarify") || 
          content.includes("请问") ||
          content.includes("需要了解") ||
          content.includes("想要研究") ||
          content.includes("确认");
        
        // 如果是澄清消息，或者还没有开始真正的研究（没有进展事件），则显示
        const hasResearchStarted = processedEventsTimeline.length > 0;
        if (isClarificationMessage || !hasResearchStarted) {
          // 但不显示最终报告（太长了）
          if (content.includes("#") && content.length > 1000) {
            return false;
          }
          return true;
        }
      }
      
      return false;
    });
  }, [thread.messages, processedEventsTimeline]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [filteredMessages]);

  useEffect(() => {
    if (
      hasFinalizeEventOccurredRef.current &&
      !thread.isLoading &&
      thread.messages && thread.messages.length > 0
    ) {
      // 查找最后一条AI消息（从所有消息中，而不是过滤后的消息）
      const aiMessages = thread.messages.filter(m => m.type === "ai");
      const lastAiMessage = aiMessages[aiMessages.length - 1];
      
      if (lastAiMessage && lastAiMessage.id) {
        // 将进度活动关联到最后一条用户消息（而不是AI消息）
        const userMessages = thread.messages.filter(m => m.type === "human");
        const lastUserMessage = userMessages[userMessages.length - 1];
        
        if (lastUserMessage && lastUserMessage.id) {
          setHistoricalActivities((prev) => ({
            ...prev,
            [lastUserMessage.id!]: [...processedEventsTimeline],
          }));
        }
        
        // 如果最后一条AI消息包含报告内容，也要设置finalReport
        const content = typeof lastAiMessage.content === "string" ? lastAiMessage.content : "";
        if (content.includes("# ") && content.length > 500) {
          setFinalReport(content);
          
          // 在这里尝试自动保存报告 - 此时thread.messages应该有完整数据
          const allMessages = thread.messages || [];
          const userMessages = allMessages.filter(m => m.type === "human");
          const lastUserMessage = userMessages[userMessages.length - 1];
          
          if (lastUserMessage && typeof lastUserMessage.content === 'string') {
            const query = lastUserMessage.content.trim();
            const reportHash = content.slice(0, 100) + query.slice(0, 50); // 简单的hash
            
            // 检查是否已经保存过
            if (!savedReportsRef.current.has(reportHash)) {
              savedReportsRef.current.add(reportHash);
              saveReport(content, query).catch(console.error);
            }
          }
        }
      }
      hasFinalizeEventOccurredRef.current = false;
    }
  }, [thread.messages, thread.isLoading, processedEventsTimeline]);

  const handleSubmit = useCallback(
    (submittedInputValue: string) => {
      if (!submittedInputValue.trim()) return;
      setProcessedEventsTimeline([]);
      setFinalReport("");
      setShowReport(false);
      hasFinalizeEventOccurredRef.current = false;

      const newMessages: Message[] = [
        ...(filteredMessages || []),
        {
          type: "human",
          content: submittedInputValue,
          id: Date.now().toString(),
        },
      ];
      
      // 使用open_deep_research的默认配置，允许澄清
      thread.submit({
        messages: newMessages,
        configurable: {
          allow_clarification: true,  // 允许澄清步骤，让AI可以询问澄清问题
          search_api: "tavily",  // 确保使用tavily搜索
          max_researcher_iterations: 2,  // 限制研究迭代次数
          max_concurrent_research_units: 1  // 限制并发研究单元
        }
      });
    },
    [thread, filteredMessages]
  );

  const handleCancel = useCallback(() => {
    thread.stop();
    window.location.reload();
  }, [thread]);

  return (
    <div className="flex h-screen bg-neutral-800 text-neutral-100 font-sans antialiased">
      {/* Left Panel - 动态侧边栏 */}
      <div className={`${(isHistoryExpanded || isChatHistoryExpanded) ? 'w-80' : 'w-12'} bg-neutral-900 border-r border-neutral-700 flex flex-col transition-all duration-300 ease-in-out overflow-hidden`}>
        {/* Header */}
        <div className="relative p-3 border-b border-neutral-700">
          {/* 收起状态的按钮组（始终存在） */}
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-300 z-10 ${
            !(isHistoryExpanded || isChatHistoryExpanded) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}>
            <button
              onClick={handleToggleReports}
              className="p-2 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
              title="展开研究报告"
            >
              <FileText size={16} />
            </button>
            <button
              onClick={handleToggleChatHistory}
              className="p-2 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
              title="查看聊天记录"
            >
              <MessageCircle size={16} />
            </button>
          </div>
          
          {/* 展开状态的内容 */}
          <div className={`transition-opacity duration-300 ${
            (isHistoryExpanded || isChatHistoryExpanded) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-neutral-100 whitespace-nowrap">
                {activePanel === 'chats' ? '聊天记录' : '历史报告'}
              </h2>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => {
                    if (activePanel === 'chats') {
                      // TODO: 刷新聊天记录列表
                    } else {
                      loadReports();
                    }
                  }}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                  disabled={reportsLoading}
                  title="刷新列表"
                >
                  {activePanel === 'chats' ? <MessageCircle size={16} /> : <FileText size={16} />}
                </button>
                <button
                  onClick={() => {
                    if (activePanel === 'chats') {
                      handleToggleChatHistory();
                    } else {
                      handleToggleReports();
                    }
                  }}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200"
                  title="收起侧边栏"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
            </div>
            <p className="text-sm text-neutral-400 whitespace-nowrap">
              {activePanel === 'chats' 
                ? '共 0 个对话' 
                : reportsLoading 
                  ? '加载中...' 
                  : `共 ${reports.length} 个报告`
              }
            </p>
          </div>
        </div>

        {/* Content - 条件显示不同的内容 */}
        <div className={`flex-1 overflow-y-auto transition-opacity duration-300 ${
          (isHistoryExpanded || isChatHistoryExpanded) ? 'opacity-100' : 'opacity-0'
        }`}>
          {activePanel === 'reports' && isHistoryExpanded && (
            <>
              {reportsLoading && (
                <div className="p-4 text-center text-neutral-400">
                  加载中...
                </div>
              )}
              {!reportsLoading && reports.length === 0 && (
                <div className="p-4 text-center text-neutral-500">
                  <FileText size={48} className="mx-auto mb-2 opacity-50" />
                  <p>暂无历史报告</p>
                  <p className="text-sm mt-1">完成研究后报告会自动保存在这里</p>
                </div>
              )}
              {!reportsLoading && reports.length > 0 && (
                <div className="space-y-1 p-2">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      onClick={() => loadReport(report.id)}
                      className="group p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-neutral-600"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-neutral-200 text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                            {report.title || '无标题报告'}
                          </h3>
                          <p className="text-xs text-neutral-400 mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
                            {report.query || ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2 text-xs text-neutral-500">
                        <div className="flex items-center space-x-3 overflow-hidden flex-1 mr-2">
                          <span className="flex items-center whitespace-nowrap">
                            <Clock size={10} className="mr-1 flex-shrink-0" />
                            <span className="overflow-hidden text-ellipsis">
                              {new Date(report.created_at).toLocaleString('zh-CN', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
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
            </>
          )}
          {activePanel === 'chats' && isChatHistoryExpanded && (
            <div className="p-4 text-center text-neutral-500">
              <MessageCircle size={48} className="mx-auto mb-2 opacity-50" />
              <p>暂无聊天记录</p>
              <p className="text-sm mt-1">开始对话后记录会保存在这里</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-3 border-t border-neutral-700 text-xs text-neutral-500 text-center transition-opacity duration-300 ${
          (isHistoryExpanded || isChatHistoryExpanded) ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className="whitespace-nowrap">
            {activePanel === 'chats' ? '点击对话可恢复历史记录' : '点击报告可查看详情'}
          </div>
        </div>
      </div>
      
      {/* Middle Panel - Chat Interface */}
      <main className={`flex flex-col overflow-hidden ${
        showReport 
          ? (isHistoryExpanded || isChatHistoryExpanded)
            ? "flex-1" // 任一侧边栏展开 + 报告显示：填充剩余空间
            : "flex-1" // 侧边栏收起 + 报告显示：填充剩余空间
          : (isHistoryExpanded || isChatHistoryExpanded)
            ? "flex-1 max-w-4xl mx-auto" // 任一侧边栏展开 + 无报告：居中限制宽度
            : "flex-1 max-w-4xl mx-auto"  // 侧边栏收起 + 无报告：居中限制宽度
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-neutral-700 bg-neutral-900">
          <div className="flex justify-center">
            <h1 className="text-lg font-semibold">深度研究助手</h1>
          </div>
        </div>

        <div
          className={`flex-1 overflow-y-auto ${
            filteredMessages.length === 0 && !thread.isLoading && processedEventsTimeline.length === 0 ? "flex" : ""
          }`}
        >
          {filteredMessages.length === 0 && processedEventsTimeline.length === 0 ? (
            <WelcomeScreen
              handleSubmit={handleSubmit}
              isLoading={thread.isLoading}
              onCancel={handleCancel}
            />
          ) : (
            <ChatMessagesView
              messages={filteredMessages}
              isLoading={thread.isLoading}
              scrollAreaRef={scrollAreaRef}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              liveActivityEvents={processedEventsTimeline}
              historicalActivities={historicalActivities}
              showReport={showReport}
              onToggleReport={() => setShowReport(!showReport)}
              hasReport={finalReport.length > 0}
            />
          )}
        </div>
      </main>
      
      {/* Right Panel - Report Viewer - 固定宽度 */}
      {showReport && (
        <div className="w-1/2 bg-neutral-800">
          <ReportViewer 
            content={finalReport} 
            onClose={() => setShowReport(false)}
          />
        </div>
      )}
    </div>
  );
}
