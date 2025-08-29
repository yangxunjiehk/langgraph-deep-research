import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ProcessedEvent } from "@/components/ActivityTimeline";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatMessagesView } from "@/components/ChatMessagesView";
import { ReportViewer } from "@/components/ReportViewer";
import { ReportHistoryList } from "@/components/ReportHistoryList";

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
  const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const hasFinalizeEventOccurredRef = useRef(false);
  const savedReportsRef = useRef<Set<string>>(new Set()); // 防止重复保存

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
      if (event.clarify_with_user) {
        const clarifyStatus = event.clarify_with_user.clarify_status || "processing";
        const statusMessages = {
          "skipped": "Skipping clarification as requested",
          "needs_clarification": "Requesting user clarification",
          "completed": "User requirements clarified successfully",
          "processing": "Processing user requirements"
        };
        processedEvent = {
          title: "User Clarification",
          data: statusMessages[clarifyStatus] || `Status: ${clarifyStatus}`,
        };
        eventProcessed = true;
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

  // 🎯 FIXED: 只显示用户消息，隐藏AI的中间消息
  const filteredMessages = useMemo(() => {
    if (!thread.messages) return [];
    
    // 只返回用户消息
    return thread.messages.filter((message) => {
      return message.type === "human";
    });
  }, [thread.messages]);

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
      
      // 使用open_deep_research的默认配置，不需要前端指定
      thread.submit({
        messages: newMessages,
        configurable: {
          allow_clarification: false,  // 跳过澄清步骤，直接开始研究
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
      {/* Left Panel - Report History (Optional) */}
      {showHistoryList && (
        <ReportHistoryList
          onSelectReport={loadReport}
          onDeleteReport={handleDeleteReport}
          isVisible={showHistoryList}
        />
      )}
      
      {/* Middle Panel - Chat Interface */}
      <main className={`flex flex-col overflow-hidden ${
        showHistoryList && showReport ? "w-1/3" : 
        showHistoryList || showReport ? "w-2/3" : 
        "flex-1 max-w-4xl mx-auto"
      }`}>
        {/* Header with buttons */}
        <div className="p-4 border-b border-neutral-700 bg-neutral-900">
          <div className="flex justify-between items-center">
            <h1 className="text-lg font-semibold">深度研究助手</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowHistoryList(!showHistoryList)}
                className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-sm"
              >
                {showHistoryList ? "隐藏历史" : "历史报告"}
              </button>
            </div>
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
      
      {/* Right Panel - Report Viewer */}
      {showReport && (
        <div className={`bg-neutral-800 ${
          showHistoryList ? "w-1/3" : "w-1/2"
        }`}>
          <ReportViewer 
            content={finalReport} 
            onClose={() => setShowReport(false)}
          />
        </div>
      )}
    </div>
  );
}
