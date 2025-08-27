import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, useEffect, useRef, useCallback } from "react";
import { ProcessedEvent } from "@/components/ActivityTimeline";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatMessagesView } from "@/components/ChatMessagesView";
import { transformEventsToHierarchy, debugTransformResult, EventData } from "@/utils/dataTransformer";

// 添加类型定义
interface StreamEvent {
  [key: string]: unknown;
}

interface SourceData {
  title?: string;
  url?: string; 
  label?: string;
  snippet?: string;
}

export default function App() {
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const hasFinalizeEventOccurredRef = useRef(false);

  const thread = useStream<{
    messages: Message[];
    initial_search_query_count: number;
    max_research_loops: number;
    reasoning_model: string;
  }>({
    apiUrl: import.meta.env.DEV
      ? "http://127.0.0.1:2024"
      : "http://localhost:8123",
    assistantId: "Deep Researcher Flat", // 使用新的扁平图
    messagesKey: "messages",
    streamSubgraphs: true, // 启用子图流式传输以接收嵌套图事件
    onFinish: (state) => {
      console.log(state);
    },
    onUpdateEvent: (event: StreamEvent) => {
      // 🐛 DEBUG: 完整事件日志
      console.log("📨 收到事件:", event);
      
      // 🔧 NEW: 检查是否为子图事件
      const isSubgraphEvent = event.namespace || event.ns;
      if (isSubgraphEvent) {
        console.log("📊 子图事件详情:", {
          namespace: event.namespace || event.ns,
          eventKeys: Object.keys(event),
          event: event
        });
      }
      
      console.log("📊 事件结构分析:", {
        eventKeys: Object.keys(event),
        eventType: typeof event,
        isSubgraphEvent: isSubgraphEvent,
        namespace: event.namespace || event.ns || "main",
        hasGenerateQuery: !!event.generate_query,
        hasWebResearch: !!event.web_research,
        hasReflection: !!event.reflection,
        hasPlanner: !!(event.planner_node || event.planner),
        hasContentEnhancement: !!event.content_enhancement_analysis,
        hasEvaluateResearch: !!event.evaluate_research_enhanced,
        hasFinalizeAnswer: !!event.finalize_answer,
        hasRecordTaskCompletion: !!event.record_task_completion,
        allEventKeys: Object.keys(event).join(", ")
      });
      
      // 🔧 NEW: 收集事件用于转换器测试 - 现在使用静态收集而不是状态
      const allEvents = JSON.parse(sessionStorage.getItem('research_events') || '[]') as EventData[];
      allEvents.push(event as EventData);
      sessionStorage.setItem('research_events', JSON.stringify(allEvents));
      
      // 每5个事件测试一次转换器（避免过于频繁）
      if (allEvents.length % 5 === 0) {
        try {
          const transformedData = transformEventsToHierarchy(allEvents, thread.messages || []);
          console.log("🔍 数据转换器测试结果:");
          debugTransformResult(transformedData);
        } catch (error) {
          console.warn("⚠️ 数据转换器测试失败:", error);
        }
      }
      
      let processedEvent: ProcessedEvent | null = null;
      let eventProcessed = false;
      
      // 🔧 NEW: 处理子图事件（带namespace的事件）
      if (isSubgraphEvent) {
        const namespace = event.namespace || event.ns || "";
        console.log("🎯 处理子图事件, namespace:", namespace);
        
        // 检查是否为researcher子图的事件
        if (namespace.includes("researcher") || namespace.includes("supervisor")) {
          // 提取子图中的具体节点名称
          const nodeNames = Object.keys(event).filter(key => 
            !['namespace', 'ns', 'metadata', 'tags'].includes(key)
          );
          
          console.log("📍 子图节点:", nodeNames);
          
          // 处理researcher_tools节点（这是tavily搜索所在的节点）
          if (event.researcher_tools || nodeNames.includes('researcher_tools')) {
            processedEvent = {
              title: "🔍 Tavily Search",
              data: "Executing web searches and gathering information...",
            };
            eventProcessed = true;
            console.log("✅ 检测到researcher_tools子图事件！");
          } else if (event.researcher || nodeNames.includes('researcher')) {
            processedEvent = {
              title: "Research Planning (Subgraph)",
              data: "Planning research approach in subgraph...",
            };
            eventProcessed = true;
          } else if (event.compress_research || nodeNames.includes('compress_research')) {
            processedEvent = {
              title: "Compressing Research (Subgraph)",
              data: "Summarizing research findings in subgraph...",
            };
            eventProcessed = true;
          }
        }
      }
      
      // 🔧 新增: 支持扁平图的事件结构
      if (!eventProcessed && event.clarify_with_user) {
        processedEvent = {
          title: "Clarifying Requirements",
          data: "Analyzing user request and determining if clarification is needed...",
        };
        eventProcessed = true;
      } else if (event.write_research_brief) {
        processedEvent = {
          title: "Writing Research Brief",
          data: "Creating detailed research brief and planning strategy...",
        };
        eventProcessed = true;
      } else if (event.plan_research) {
        processedEvent = {
          title: "Planning Research",
          data: "Analyzing research requirements and creating execution plan...",
        };
        eventProcessed = true;
      } else if (event.execute_research_tools) {
        processedEvent = {
          title: "Preparing Research Tools",
          data: "Setting up research tools and validation parameters...",
        };
        eventProcessed = true;
      } else if (event.perform_searches) {
        processedEvent = {
          title: "🔍 Performing Web Searches",
          data: "Executing Tavily searches and gathering information from web sources...",
        };
        eventProcessed = true;
        console.log("✅ 检测到perform_searches节点事件 - Tavily搜索执行中！");
      } else if (event.analyze_search_results) {
        processedEvent = {
          title: "📊 Analyzing Search Results",
          data: "Processing and summarizing collected research information...",
        };
        eventProcessed = true;
      } else if (event.supervisor) {
        processedEvent = {
          title: "Research Supervision",
          data: "Coordinating research activities and monitoring progress...",
        };
        eventProcessed = true;
      } else if (event.supervisor_tools) {
        processedEvent = {
          title: "Supervisor Analysis",
          data: "Evaluating research progress and determining next steps...",
        };
        eventProcessed = true;
      } else if (event.researcher) {
        processedEvent = {
          title: "Research Planning",
          data: "Planning detailed research approach and generating search queries...",
        };
        eventProcessed = true;
      } else if (event.researcher_tools) {
        // 检查是否有工具调用的详细信息
        console.log("🔍 Researcher Tools 事件详细信息:", event.researcher_tools);
        
        // 尝试从事件中提取更具体的信息
        const toolsData = event.researcher_tools as any;
        let detailedInfo = "Executing research operations...";
        let title = "Conducting Research";
        
        // 检查是否包含搜索查询信息
        if (toolsData && typeof toolsData === 'object') {
          if (toolsData.search_queries || toolsData.query || toolsData.tavily_search) {
            title = "Web Search";
            detailedInfo = "Performing Tavily web searches and gathering information...";
          } else if (toolsData.summary || toolsData.summarize || toolsData.analysis) {
            title = "Content Analysis";
            detailedInfo = "Analyzing and summarizing collected research data...";
          } else if (toolsData.tools_called || toolsData.tool_calls) {
            title = "Research Tools";
            detailedInfo = "Executing research tools and processing results...";
          }
        }
        
        processedEvent = {
          title,
          data: detailedInfo,
        };
        eventProcessed = true;
      } else if (event.tool_execution_details) {
        // 🔧 NEW: 处理工具执行详情事件 - 支持实时状态更新
        console.log("🔧 Tool Execution Details 事件详细信息:", event.tool_execution_details);
        
        const detailsArray = event.tool_execution_details as Array<{
          tool_name?: string;
          tool_index?: number;
          total_tools?: number;
          status?: string;
          args?: any;
          result_length?: number;
          timestamp?: string;
        }>;
        
        // 使用最后一个工具的信息创建事件
        if (detailsArray && detailsArray.length > 0) {
          const currentTool = detailsArray[detailsArray.length - 1];
          const toolName = currentTool.tool_name || "Unknown Tool";
          const index = currentTool.tool_index || 1;
          const total = currentTool.total_tools || 1;
          const status = currentTool.status || "unknown";
          
          let title = `工具执行状态`;
          let data = ``;
          
          // 根据状态显示不同的信息
          if (status === "starting") {
            if (toolName === "tavily_search") {
              title = `Tavily 搜索`;
              data = `🔄 正在执行网络搜索... (${index}/${total})`;
            } else if (toolName === "tavily_summarize") {
              title = `内容摘要`;
              data = `🔄 正在生成内容摘要... (${index}/${total})`;
            } else {
              title = `${toolName}`;
              data = `🔄 进行中... (${index}/${total})`;
            }
          } else if (status === "completed") {
            if (toolName === "tavily_search") {
              title = `Tavily 搜索`;
              data = `✅ 网络搜索完成，获取了 ${currentTool.result_length || 0} 字符的数据 (${index}/${total})`;
            } else if (toolName === "tavily_summarize") {
              title = `内容摘要`;
              data = `✅ 摘要生成完成，生成了 ${currentTool.result_length || 0} 字符 (${index}/${total})`;
            } else {
              title = `${toolName}`;
              data = `✅ 执行完成，生成了 ${currentTool.result_length || 0} 字符 (${index}/${total})`;
            }
          } else if (status === "error") {
            if (toolName === "tavily_search") {
              title = `Tavily 搜索`;
              data = `❌ 搜索执行出错: ${currentTool.error || "未知错误"} (${index}/${total})`;
            } else if (toolName === "tavily_summarize") {
              title = `内容摘要`;
              data = `❌ 摘要生成出错: ${currentTool.error || "未知错误"} (${index}/${total})`;
            } else {
              title = `${toolName}`;
              data = `❌ 执行出错: ${currentTool.error || "未知错误"} (${index}/${total})`;
            }
          } else {
            // 向后兼容旧格式 - 多个工具的统计信息
            title = `Tools Execution Summary`;
            data = `Completed ${detailsArray.length} tool operations`;
            
            if (detailsArray.length === 1) {
              if (toolName === "tavily_search") {
                title = `Tavily Search Complete`;
                data = `Web search completed, found ${currentTool.result_length || 0} characters of data`;
              } else if (toolName === "tavily_summarize") {
                title = `Content Summary Complete`;
                data = `Summarization completed, generated ${currentTool.result_length || 0} characters`;
              } else {
                title = `${toolName} Complete`;
                data = `Tool execution completed, generated ${currentTool.result_length || 0} characters`;
              }
            } else {
              const searchCount = detailsArray.filter(t => t.tool_name === "tavily_search").length;
              const summaryCount = detailsArray.filter(t => t.tool_name === "tavily_summarize").length;
              const parts = [];
              if (searchCount > 0) parts.push(`${searchCount} searches`);
              if (summaryCount > 0) parts.push(`${summaryCount} summaries`);
              data = `Completed: ${parts.join(", ")}`;
            }
          }
          
          processedEvent = {
            title,
            data,
          };
          eventProcessed = true;
        }
      } else if (event.current_tool_status) {
        // 🔧 NEW: 处理实时工具状态事件
        console.log("🔧 Current Tool Status 事件:", event.current_tool_status);
        
        processedEvent = {
          title: "工具执行状态",
          data: event.current_tool_status as string,
        };
        eventProcessed = true;
      } else if (event.compress_research) {
        processedEvent = {
          title: "Compressing Research Data",
          data: "Analyzing and summarizing collected research information...",
        };
        eventProcessed = true;
      } else if (event.generate_final_report || event.final_report_generation) {
        processedEvent = {
          title: "Generating Final Report",
          data: "Creating comprehensive research report with findings and analysis...",
        };
        hasFinalizeEventOccurredRef.current = true;
        eventProcessed = true;
      }
      
      // 🔧 FALLBACK: 保留旧的事件处理逻辑以向后兼容
      if (!eventProcessed) {
        if (event.generate_query) {
          const queryData = event.generate_query as { query_list?: string[] };
          processedEvent = {
            title: "Generating Search Queries",
            data: queryData.query_list?.join(", ") || "No queries",
          };
          eventProcessed = true;
        } else if (event.web_research) {
          console.log("🔍 Web Research 事件详细信息:", event.web_research);
          
          const researchData = event.web_research as { sources_gathered?: SourceData[] };
          const sources = researchData.sources_gathered || [];
          const numSources = sources.length;
          
          if (sources.length > 0) {
            console.log("📊 第一个来源的结构:", sources[0]);
            console.log("📊 所有来源的keys:", sources.map(s => Object.keys(s)));
          }
          
          const uniqueLabels = [
            ...new Set(sources.map((s: SourceData) => s.label).filter(Boolean)),
          ];
          const exampleLabels = uniqueLabels.slice(0, 3).join(", ");
          processedEvent = {
            title: "Web Research",
            data: `Gathered ${numSources} sources. Related to: ${
              exampleLabels || "N/A"
            }.`,
          };
          eventProcessed = true;
        } else if (event.reflection) {
          console.log("🤔 Reflection 事件详细信息:", event.reflection);
          
          const reflectionData = event.reflection as {
            reflection_is_sufficient?: boolean;
            reflection_follow_up_queries?: string[];
          };
          processedEvent = {
            title: "Reflection",
            data: reflectionData.reflection_is_sufficient
              ? "Search successful, generating final answer."
              : `Need more information, searching for ${(reflectionData.reflection_follow_up_queries || []).join(
                  ", "
                )}`,
          };
          eventProcessed = true;
        } else if (event.finalize_answer) {
          processedEvent = {
            title: "Finalizing Answer",
            data: "Composing and presenting the final answer.",
          };
          hasFinalizeEventOccurredRef.current = true;
          eventProcessed = true;
        }
      }
      
      // 🐛 DEBUG: 检查是否有未处理的事件
      if (!eventProcessed) {
        console.warn("⚠️ 未处理的事件类型:", {
          eventKeys: Object.keys(event),
          eventData: event,
          possibleMissingHandlers: [
            "clarify_with_user",
            "write_research_brief", 
            "supervisor",
            "supervisor_tools",
            "researcher",
            "researcher_tools",
            "tool_execution_details",
            "current_tool_status",
            "compress_research",
            "final_report_generation"
          ]
        });
      } else {
        console.log("✅ 事件已处理:", processedEvent?.title);
        
        // 🔧 NEW: 在任何关键事件处理后都尝试保存快照，包括研究工具事件
        if (processedEvent?.title === "Research Supervision" || 
            processedEvent?.title === "Compressing Research Data" ||
            processedEvent?.title === "Generating Final Report" ||
            processedEvent?.title?.includes("Web Search") ||
            processedEvent?.title?.includes("Content Analysis") ||
            processedEvent?.title === "Conducting Research") {
          console.log(`🎯 检测到关键事件，准备保存快照: ${processedEvent.title}`);
          saveCurrentStateSnapshot(processedEvent.title);
        }
      }
      
      if (processedEvent) {
        console.log(`➕ 添加新事件到时间线: ${processedEvent.title}`);
        setProcessedEventsTimeline((prevEvents) => {
          const newEvents = [...prevEvents, processedEvent!];
          console.log(`📋 更新后的事件时间线 (${newEvents.length}):`, newEvents.map(e => e.title));
          return newEvents;
        });
      }
    },
  });

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [thread.messages]);

  useEffect(() => {
    if (
      hasFinalizeEventOccurredRef.current &&
      !thread.isLoading &&
      thread.messages.length > 0
    ) {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (lastMessage && lastMessage.type === "ai" && lastMessage.id) {
        setHistoricalActivities((prev) => ({
          ...prev,
          [lastMessage.id!]: [...processedEventsTimeline],
        }));
      }
      hasFinalizeEventOccurredRef.current = false;
    }
  }, [thread.messages, thread.isLoading, processedEventsTimeline]);

  const handleSubmit = useCallback(
    (submittedInputValue: string, effort: string, model: string) => {
      if (!submittedInputValue.trim()) return;
      setProcessedEventsTimeline([]);
      hasFinalizeEventOccurredRef.current = false;
      
      // 清空事件存储
      sessionStorage.removeItem('research_events');

      // convert effort to, initial_search_query_count and max_research_loops
      // low means max 1 loop and 1 query
      // medium means max 3 loops and 3 queries
      // high means max 10 loops and 5 queries
      let initial_search_query_count = 0;
      let max_research_loops = 0;
      switch (effort) {
        case "low":
          initial_search_query_count = 1;
          max_research_loops = 1;
          break;
        case "medium":
          initial_search_query_count = 3;
          max_research_loops = 3;
          break;
        case "high":
          initial_search_query_count = 5;
          max_research_loops = 10;
          break;
      }

      const newMessages: Message[] = [
        ...(thread.messages || []),
        {
          type: "human",
          content: submittedInputValue,
          id: Date.now().toString(),
        },
      ];
      thread.submit({
        messages: newMessages,
        initial_search_query_count: initial_search_query_count,
        max_research_loops: max_research_loops,
        reasoning_model: model,
      });
    },
    [thread]
  );

  const handleCancel = useCallback(() => {
    thread.stop();
    window.location.reload();
  }, [thread]);

  // 新增：保存中间状态快照的函数
  const saveCurrentStateSnapshot = useCallback((stateName: string) => {
    console.log(`📸 保存状态快照: ${stateName}`);
    console.log(`📊 当前消息数量: ${thread.messages?.length || 0}`);
    console.log(`📊 当前时间线事件数: ${processedEventsTimeline.length}`);
    
    // 增加延迟时间，确保AI消息已创建
    setTimeout(() => {
      console.log(`⏰ 延迟后检查消息: ${thread.messages?.length || 0}`);
      if (thread.messages && thread.messages.length > 0) {
        const lastMessage = thread.messages[thread.messages.length - 1];
        console.log(`📋 最后一条消息:`, { 
          id: lastMessage.id, 
          type: lastMessage.type, 
          contentLength: typeof lastMessage.content === 'string' ? lastMessage.content.length : 'non-string'
        });
        
        if (lastMessage && lastMessage.type === "ai" && lastMessage.id) {
          // 创建当前时间线的快照
          const snapshot = [...processedEventsTimeline];
          console.log(`📷 为消息 ${lastMessage.id} 保存快照 (${snapshot.length} 事件):`, snapshot.map(e => e.title));
          
          setHistoricalActivities((prev) => {
            const newActivities = {
              ...prev,
              [lastMessage.id!]: snapshot,
            };
            console.log(`✅ 快照已保存，历史活动数:`, Object.keys(newActivities).length);
            return newActivities;
          });
        } else {
          console.warn(`⚠️ 无法保存快照 ${stateName}: 最后一条消息不是AI消息`);
        }
      } else {
        console.warn(`⚠️ 无法保存快照 ${stateName}: 没有消息`);
      }
    }, 300); // 增加延迟到300ms
  }, [thread.messages, processedEventsTimeline]);

  return (
    <div className="flex h-screen bg-neutral-800 text-neutral-100 font-sans antialiased">
      <main className="flex-1 flex flex-col overflow-hidden w-full h-full">
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {thread.messages.length === 0 ? (
            <WelcomeScreen
              handleSubmit={handleSubmit}
              isLoading={thread.isLoading}
              onCancel={handleCancel}
            />
          ) : (
            <ChatMessagesView
              messages={thread.messages}
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
    </div>
  );
}
