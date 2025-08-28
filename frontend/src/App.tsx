import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ProcessedEvent } from "@/components/ActivityTimeline";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatMessagesView } from "@/components/ChatMessagesView";
import { ReportViewer } from "@/components/ReportViewer";

export default function App() {
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const [finalReport, setFinalReport] = useState<string>("");
  const [showReport, setShowReport] = useState<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const hasFinalizeEventOccurredRef = useRef(false);

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
    assistantId: "Deep Researcher New",  // 切换到deep_researcher_new后端
    messagesKey: "messages",
    onFinish: (event: any) => {
      console.log(event);
    },
    onUpdateEvent: (event: any) => {
      console.log("[DEBUG] Received event:", JSON.stringify(event, null, 2));  // 更详细的调试日志
      
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

  // 🎯 NEW: 过滤消息，只显示用户输入和最终报告
  const filteredMessages = useMemo(() => {
    if (!thread.messages) return [];
    
    return thread.messages.filter((message, index) => {
      // 始终显示用户消息
      if (message.type === "human") {
        return true;
      }
      
      // 对于AI消息，只显示包含最终报告的消息
      if (message.type === "ai") {
        const content = typeof message.content === "string" ? message.content : "";
        
        // 检查是否是最终报告（通常包含完整的研究报告标题和结构）
        const isFinalReport = content.includes("# ") && 
                             content.length > 500 && // 最终报告通常很长
                             (content.includes("## Executive Summary") || 
                              content.includes("## Strategic Implications") ||
                              content.includes("## 执行摘要") ||
                              content.includes("## 战略建议"));
        
        return isFinalReport;
      }
      
      return false;
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
      filteredMessages.length > 0
    ) {
      const lastMessage = filteredMessages[filteredMessages.length - 1];
      if (lastMessage && lastMessage.type === "ai" && lastMessage.id) {
        setHistoricalActivities((prev) => ({
          ...prev,
          [lastMessage.id!]: [...processedEventsTimeline],
        }));
      }
      hasFinalizeEventOccurredRef.current = false;
    }
  }, [filteredMessages, thread.isLoading, processedEventsTimeline]);

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
      {/* Left Panel - Chat Interface */}
      <main className={`flex flex-col overflow-hidden transition-all duration-300 ${
        showReport ? "w-1/2" : "flex-1 max-w-4xl mx-auto"
      }`}>
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
            />
          )}
        </div>
      </main>
      
      {/* Right Panel - Report Viewer */}
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
