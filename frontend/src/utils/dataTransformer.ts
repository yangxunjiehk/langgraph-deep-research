/**
 * 数据转换器：将平铺的事件流转换为层次化的任务结构
 */

// 添加类型定义
export interface EventData {
  [key: string]: unknown;
}

export interface SourceData {
  title?: string;
  url?: string;
  label?: string;
  snippet?: string;
}

export interface TaskData {
  id: string;
  description: string;
  status?: string;
}

export interface StateData {
  plan?: TaskData[];
  ledger?: TaskData[];
  current_task_pointer?: number;
  [key: string]: unknown;
}

export interface TaskDetail {
  taskId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  steps: TaskStep[];
}

export interface TaskStep {
  type: 'planning' | 'query_generation' | 'web_research' | 'reflection' | 'content_enhancement' | 'evaluation' | 'completion';
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  timestamp?: string;
  data?: EventData;
  details?: StepDetail[];
}

export interface StepDetail {
  type: 'search_queries' | 'sources' | 'analysis' | 'decision';
  content: string;
  metadata?: {
    count?: number;
    sources?: SourceData[];
    is_sufficient?: boolean;
    knowledge_gap?: string;
    follow_up_queries?: string[];
    status?: string;
    decision?: string;
    [key: string]: unknown;
  };
}

export interface PlanningInfo {
  totalTasks: number;
  currentTaskIndex: number;
  tasks: Array<{
    id: string;
    description: string;
    status: string;
  }>;
}

export interface ProcessedResearchData {
  planning: PlanningInfo | null;
  tasks: TaskDetail[];
  currentTaskId: string | null;
  overallStatus: 'planning' | 'researching' | 'completed';
}

/**
 * 主转换函数：将事件流转换为层次化结构
 */
export function transformEventsToHierarchy(
  events: EventData[],
  messages: EventData[]
): ProcessedResearchData {
  
  // console.log(`🔄 开始转换 ${events.length} 个事件`);
  
  // 统计事件类型
  const eventTypes: Record<string, number> = {};
  events.forEach(event => {
    Object.keys(event).forEach(key => {
      eventTypes[key] = (eventTypes[key] || 0) + 1;
    });
  });
  
  // console.log(`📊 事件类型统计:`, eventTypes);
  
  // 初始化结果结构
  const result: ProcessedResearchData = {
    planning: null,
    tasks: [],
    currentTaskId: null,
    overallStatus: 'planning'
  };

  // 收集所有状态信息
  let latestState: StateData = {};
  
  // 从事件中提取最新状态
  events.forEach(event => {
    Object.keys(event).forEach(key => {
      if (event[key] && typeof event[key] === 'object') {
        latestState = { ...latestState, ...event[key] as StateData };
      }
    });
  });

  // 如果有messages，从最后一条AI消息中提取状态
  const lastAIMessage = [...messages].reverse().find(msg => 
    typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'ai'
  );
  if (lastAIMessage && typeof lastAIMessage === 'object' && 'content' in lastAIMessage) {
    // 尝试解析可能包含的状态信息
    // 这里可以根据需要扩展状态提取逻辑
  }

  // 1. 处理Planning信息
  result.planning = extractPlanningInfo(events, latestState);
  
  // 2. 构建任务详情
  result.tasks = buildTaskDetails(events, latestState);
  
  // 3. 确定当前任务和整体状态
  result.currentTaskId = getCurrentTaskId(events, latestState);
  result.overallStatus = determineOverallStatus(events);

  return result;
}

/**
 * 提取Planning信息
 */
function extractPlanningInfo(events: EventData[], state: StateData): PlanningInfo | null {
  // 查找planning相关事件
  const planningEvent = events.find(event => 
    event.planner || event.planner_node || event.planning
  );
  
  if (!planningEvent && !state.plan) {
    return null;
  }

  const plan = state.plan || [];
  const currentPointer = state.current_task_pointer || 0;

  return {
    totalTasks: plan.length,
    currentTaskIndex: currentPointer,
    tasks: plan.map((task: TaskData) => ({
      id: task.id || 'unknown',
      description: task.description || 'Unknown task',
      status: task.status || 'pending'
    }))
  };
}

/**
 * 构建任务详情
 */
function buildTaskDetails(events: EventData[], state: StateData): TaskDetail[] {
  // 🎯 NEW: 固定的3步骤工作流
  const fixedSteps = [
    { id: 'planning', title: '研究计划', description: '澄清需求和制定研究计划' },
    { id: 'research', title: '执行研究', description: '搜索资料并进行分析' },
    { id: 'report', title: '生成报告', description: '撰写最终研究报告' }
  ];

  // 检查关键信号
  const hasWriteResearchBrief = events.some(event => event.write_research_brief);
  const hasResearchSupervisor = events.some(event => event.research_supervisor);
  const hasFinalReportGeneration = events.some(event => event.final_report_generation);

  // 🎯 根据信号确定每个步骤的状态
  const getStepStatus = (stepId: string): 'pending' | 'in_progress' | 'completed' => {
    switch (stepId) {
      case 'planning':
        // 研究计划：一开始就是进行中，收到write_research_brief信号后完成
        return hasWriteResearchBrief ? 'completed' : 'in_progress';
      
      case 'research':
        // 执行研究：research_brief完成后开始，收到research_supervisor信号后完成
        if (!hasWriteResearchBrief) return 'pending';
        return hasResearchSupervisor ? 'completed' : 'in_progress';
      
      case 'report':
        // 生成报告：research_supervisor完成后开始，收到final_report_generation信号后完成
        if (!hasResearchSupervisor) return 'pending';
        return hasFinalReportGeneration ? 'completed' : 'in_progress';
      
      default:
        return 'pending';
    }
  };

  // 🎯 创建固定的3个步骤任务
  const tasks: TaskDetail[] = fixedSteps.map((step, index) => {
    const stepStatus = getStepStatus(step.id);
    
    return {
      taskId: `step-${step.id}`,
      description: step.title,
      status: stepStatus,
      steps: [{
        type: step.id === 'planning' ? 'planning' : (step.id === 'research' ? 'web_research' : 'completion'),
        title: step.title,
        status: stepStatus,
        timestamp: new Date().toISOString(),
        details: [{
          type: 'analysis',
          content: step.description,
          metadata: {
            phase: step.id,
            status: stepStatus,
            step_index: index + 1
          }
        }]
      }]
    };
  });

  console.log(`🎯 固定3步骤状态:`, {
    planning: getStepStatus('planning'),
    research: getStepStatus('research'), 
    report: getStepStatus('report'),
    signals: { hasWriteResearchBrief, hasResearchSupervisor, hasFinalReportGeneration }
  });

  return tasks;
}

/**
 * 构建任务步骤 - 更新版本，支持新后端事件结构
 */
function buildTaskSteps(
  events: EventData[], 
  state: StateData, 
  taskId: string, 
  shouldShowSteps: boolean // 当前任务或已完成任务都显示步骤
): TaskStep[] {
  const steps: TaskStep[] = [];

  // console.log(`🔧 构建任务步骤 for ${taskId}, shouldShowSteps: ${shouldShowSteps}`);
  // console.log(`📊 事件总数: ${events.length}`);

  // 如果是当前任务或已完成任务，根据事件构建步骤
  if (shouldShowSteps) {
    
    // 🔧 NEW: 事件现在包含实时状态，无需推断
    // 我们现在通过 get_stream_writer() 获得真正的实时状态
    
    // 🔧 NEW: 确定总体进度状态，用于判断哪些步骤是正在进行的
    const totalEvents = events.length;
    const isOverallCompleted = events.some(event => event.final_report_generation);
    
    // 🔧 NEW: 支持新后端的事件结构
    // 1. Clarify with User
    const clarifyEvents = events.filter(event => event.clarify_with_user);
    // console.log(`🔍 Clarify事件数: ${clarifyEvents.length}`);
    if (clarifyEvents.length > 0) {
      steps.push({
        type: 'planning',
        title: 'Clarifying Requirements',
        status: 'completed',
        data: clarifyEvents[clarifyEvents.length - 1].clarify_with_user as EventData,
        details: [{
          type: 'analysis',
          content: 'Analyzed user request and determined research scope',
          metadata: { 
            phase: 'requirement_analysis',
            status: 'completed'
          }
        }]
      });
    }

    // 2. Write Research Brief
    const briefEvents = events.filter(event => event.write_research_brief);
    // console.log(`🔍 Research Brief事件数: ${briefEvents.length}`);
    if (briefEvents.length > 0) {
      steps.push({
        type: 'planning',
        title: 'Writing Research Brief',
        status: 'completed',
        data: briefEvents[briefEvents.length - 1].write_research_brief as EventData,
        details: [{
          type: 'analysis',
          content: 'Created detailed research brief and strategy',
          metadata: { 
            phase: 'strategy_planning',
            status: 'completed'
          }
        }]
      });
    }

    // 3. Supervisor
    const supervisorEvents = events.filter(event => event.supervisor);
    // console.log(`🔍 Supervisor事件数: ${supervisorEvents.length}`);
    if (supervisorEvents.length > 0) {
      steps.push({
        type: 'planning',
        title: 'Research Supervision',
        status: 'completed',
        data: supervisorEvents[supervisorEvents.length - 1].supervisor as EventData,
        details: [{
          type: 'analysis',
          content: 'Coordinated research activities and monitored progress',
          metadata: { 
            phase: 'research_coordination',
            status: 'completed'
          }
        }]
      });
    }

    // 4. Supervisor Tools
    const supervisorToolsEvents = events.filter(event => event.supervisor_tools);
    // console.log(`🔍 Supervisor Tools事件数: ${supervisorToolsEvents.length}`);
    if (supervisorToolsEvents.length > 0) {
      steps.push({
        type: 'planning',
        title: 'Supervisor Analysis',
        status: 'completed',
        data: supervisorToolsEvents[supervisorToolsEvents.length - 1].supervisor_tools as EventData,
        details: [{
          type: 'decision',
          content: 'Evaluated research progress and determined next steps',
          metadata: { 
            phase: 'progress_evaluation',
            status: 'completed'
          }
        }]
      });
    }

    // 5. Researcher
    const researcherEvents = events.filter(event => event.researcher);
    // console.log(`🔍 Researcher事件数: ${researcherEvents.length}`);
    if (researcherEvents.length > 0) {
      steps.push({
        type: 'query_generation',
        title: 'Research Planning',
        status: 'completed',
        data: researcherEvents[researcherEvents.length - 1].researcher as EventData,
        details: [{
          type: 'search_queries',
          content: 'Planned detailed research approach and generated search queries',
          metadata: { 
            phase: 'query_generation',
            status: 'completed'
          }
        }]
      });
    }

    // 🆕 5.5. Execute Research Tools (扁平图新节点) - 处理研究工具准备
    const executeToolsEvents = events.filter(event => event.execute_research_tools);
    if (executeToolsEvents.length > 0) {
      executeToolsEvents.forEach((event, index) => {
        const toolsData = event.execute_research_tools as any;
        
        // 🔧 工具准备步骤通常很快完成，保持为已完成状态
        let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
        
        steps.push({
          type: 'planning',
          title: `🛠️ Preparing Research Tools ${index + 1}`,
          status: stepStatus,
          data: toolsData,
          details: [{
            type: 'decision',
            content: 'Research tools prepared successfully',
            metadata: { 
              phase: 'tool_preparation',
              status: stepStatus
            }
          }]
        });
      });
    }

    // 6. Researcher Tools - 改进版本，支持子图事件
    const researcherToolsEvents = events.filter(event => {
      // 检查直接的researcher_tools事件
      if (event.researcher_tools) return true;
      
      // 检查子图事件（带namespace的）
      if ((event.namespace || event.ns) && 
          (event.namespace?.includes('researcher') || event.ns?.includes('researcher'))) {
        // 检查是否包含researcher_tools节点
        return Object.keys(event).some(key => key === 'researcher_tools');
      }
      
      return false;
    });
    // console.log(`🔍 Researcher Tools事件数（包括子图）: ${researcherToolsEvents.length}`);
    
    // 🆕 处理扁平图的搜索事件
    const performSearchesEvents = events.filter(event => event.perform_searches);
    // console.log(`🔍 Perform Searches事件数（扁平图）: ${performSearchesEvents.length}`);
    
    // 🆕 处理扁平图的搜索结果分析事件
    const analyzeResultsEvents = events.filter(event => event.analyze_search_results);
    // console.log(`🔍 Analyze Search Results事件数（扁平图）: ${analyzeResultsEvents.length}`);
    if (researcherToolsEvents.length > 0) {
      // 为每个researcher_tools事件创建单独的步骤
      researcherToolsEvents.forEach((event, index) => {
        const toolsData = event.researcher_tools as any;
        let stepTitle = `Research Operation ${index + 1}`;
        let stepContent = 'Executed research operation';
        let stepType: TaskStep['type'] = 'web_research';
        
        // 尝试从工具数据中获取更具体的信息
        if (toolsData && typeof toolsData === 'object') {
          // console.log(`🔍 分析Researcher Tools事件 ${index + 1}:`, toolsData);
          
          // 检查不同类型的工具调用
          if (toolsData.search_queries || toolsData.query || toolsData.tavily_search) {
            stepTitle = `Tavily Web Search ${index + 1}`;
            stepContent = `Performed web search and gathered sources`;
            stepType = 'web_research';
          } else if (toolsData.summary || toolsData.summarize || toolsData.analysis) {
            stepTitle = `Content Summary ${index + 1}`;
            stepContent = `Analyzed and summarized research content`;
            stepType = 'content_enhancement';
          } else if (toolsData.tools_called || toolsData.tool_calls) {
            stepTitle = `Research Tools ${index + 1}`;
            stepContent = `Executed research tools and processed results`;
            stepType = 'web_research';
          } else if (toolsData.sources || toolsData.results) {
            stepTitle = `Source Processing ${index + 1}`;
            stepContent = `Processed and validated research sources`;
            stepType = 'web_research';
          }
          
          // 如果有更多具体信息，尝试提取
          const details = [];
          if (toolsData.query) {
            details.push({
              type: 'search_queries' as const,
              content: `Search Query: "${toolsData.query}"`,
              metadata: { query: toolsData.query }
            });
          }
          if (toolsData.sources_count || toolsData.results_count) {
            const count = toolsData.sources_count || toolsData.results_count;
            details.push({
              type: 'sources' as const,
              content: `Found ${count} sources`,
              metadata: { count: count }
            });
          }
          
          // 🔧 NEW: 智能状态判断 - 最后几个操作可能仍在进行中
          let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
          if (!isOverallCompleted && index >= researcherToolsEvents.length - 2) {
            // 如果整体未完成，最后1-2个工具事件可能仍在处理中
            stepStatus = index === researcherToolsEvents.length - 1 ? 'in_progress' : 'completed';
          }
          
          steps.push({
            type: stepType,
            title: stepTitle,
            status: stepStatus,
            data: toolsData,
            details: details.length > 0 ? details : [{
              type: 'sources',
              content: stepContent,
              metadata: { 
                phase: 'data_collection',
                status: stepStatus,
                operation_index: index + 1
              }
            }]
          });
        } else {
          // 默认步骤也应用智能状态判断
          let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
          if (!isOverallCompleted && index >= researcherToolsEvents.length - 2) {
            stepStatus = index === researcherToolsEvents.length - 1 ? 'in_progress' : 'completed';
          }
          
          steps.push({
            type: 'web_research',
            title: stepTitle,
            status: stepStatus,
            data: toolsData,
            details: [{
              type: 'sources',
              content: stepContent,
              metadata: { 
                phase: 'data_collection',
                status: stepStatus,
                operation_index: index + 1
              }
            }]
          });
        }
      });
    }
    
    // 🆕 6.5. 处理扁平图搜索事件
    if (performSearchesEvents.length > 0) {
      performSearchesEvents.forEach((event, index) => {
        const searchData = event.perform_searches as any;
        
        // 🔧 NEW: 从事件数据中获取真实状态
        let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
        if (searchData && searchData.status) {
          stepStatus = searchData.status;
        }
        
        // 根据状态设置标题
        const titlePrefix = stepStatus === 'in_progress' ? '⏳ 搜索资料' : '🔍 搜索资料';
        
        steps.push({
          type: 'web_research',
          title: `${titlePrefix}${index > 0 ? ` ${index + 1}` : ''}`,
          status: stepStatus,
          timestamp: new Date().toISOString(),
          data: searchData,
          details: [{
            type: 'search_queries',
            content: stepStatus === 'in_progress' ? '⏳ 进行中...' : 'Tavily 搜索完成，已收集信息',
            metadata: { 
              phase: 'web_search',
              status: stepStatus,
              search_index: index + 1
            }
          }]
        });
      });
    }
    
    // 🆕 6.6. 处理扁平图搜索结果分析事件  
    if (analyzeResultsEvents.length > 0) {
      analyzeResultsEvents.forEach((event, index) => {
        const analysisData = event.analyze_search_results as any;
        
        // 🔧 NEW: 从事件数据中获取真实状态
        let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
        if (analysisData && analysisData.status) {
          stepStatus = analysisData.status;
        }
        
        // 根据状态设置标题
        const titlePrefix = stepStatus === 'in_progress' ? '⏳ 分析搜索结果' : '📊 分析搜索结果';
        
        steps.push({
          type: 'content_enhancement',
          title: `${titlePrefix}${index > 0 ? ` ${index + 1}` : ''}`,
          status: stepStatus,
          timestamp: new Date().toISOString(),
          data: analysisData,
          details: [{
            type: 'analysis',
            content: stepStatus === 'in_progress' ? '⏳ 进行中...' : '搜索结果分析完成',
            metadata: { 
              phase: 'data_analysis',
              status: stepStatus,
              analysis_index: index + 1
            }
          }]
        });
      });
    }
    
    // 🆕 6.7. 处理扁平图的最终报告生成事件
    const generateFinalReportEvents = events.filter(event => event.generate_final_report);
    if (generateFinalReportEvents.length > 0) {
      generateFinalReportEvents.forEach((event, index) => {
        const reportData = event.generate_final_report as any;
        
        // 🔧 NEW: 从事件数据中获取真实状态
        let stepStatus: 'pending' | 'in_progress' | 'completed' = 'completed';
        if (reportData && reportData.status) {
          stepStatus = reportData.status;
        }
        
        // 根据状态设置标题
        const titlePrefix = stepStatus === 'in_progress' ? '⏳ 生成报告' : '📝 生成报告';
        
        steps.push({
          type: 'completion',
          title: `${titlePrefix}${index > 0 ? ` ${index + 1}` : ''}`,
          status: stepStatus,
          timestamp: new Date().toISOString(),
          data: reportData,
          details: [{
            type: 'analysis',
            content: stepStatus === 'in_progress' ? '⏳ 进行中...' : '综合研究报告生成完成',
            metadata: { 
              phase: 'report_generation',
              status: stepStatus,
              report_index: index + 1
            }
          }]
        });
      });
    }

    // 7. Compress Research
    const compressEvents = events.filter(event => event.compress_research);
    // console.log(`🔍 Compress Research事件数: ${compressEvents.length}`);
    if (compressEvents.length > 0) {
      steps.push({
        type: 'content_enhancement',
        title: 'Compressing Research Data',
        status: 'completed',
        data: compressEvents[compressEvents.length - 1].compress_research as EventData,
        details: [{
          type: 'analysis',
          content: 'Analyzed and summarized collected research information',
          metadata: { 
            phase: 'data_synthesis',
            status: 'completed'
          }
        }]
      });
    }

    // 8. Final Report Generation
    const finalReportEvents = events.filter(event => event.final_report_generation);
    // console.log(`🔍 Final Report事件数: ${finalReportEvents.length}`);
    if (finalReportEvents.length > 0) {
      steps.push({
        type: 'completion',
        title: 'Generating Final Report',
        status: 'completed',
        data: finalReportEvents[finalReportEvents.length - 1].final_report_generation as EventData,
        details: [{
          type: 'analysis',
          content: 'Created comprehensive research report with findings and analysis',
          metadata: { 
            phase: 'report_generation',
            status: 'completed'
          }
        }]
      });
    }

    // 🔧 FALLBACK: 保留旧后端事件处理逻辑以向后兼容
    // 1. Query Generation (旧)
    const queryEvents = events.filter(event => event.generate_query);
    // console.log(`🔍 Query事件数: ${queryEvents.length}`);
    if (queryEvents.length > 0) {
      const lastQueryEvent = queryEvents[queryEvents.length - 1];
      const queryData = lastQueryEvent.generate_query as { query_list?: string[] };
      steps.push({
        type: 'query_generation',
        title: 'Generating Search Queries',
        status: 'completed',
        data: lastQueryEvent.generate_query as EventData,
        details: [{
          type: 'search_queries',
          content: queryData.query_list?.join(', ') || 'No queries',
          metadata: { 
            count: queryData.query_list?.length || 0,
            queries: queryData.query_list || []
          }
        }]
      });
    }

    // 2. Web Research - 改进版本，显示更多详情
    const webResearchEvents = events.filter(event => event.web_research);
    // console.log(`🔍 Web Research事件数: ${webResearchEvents.length}`);
    if (webResearchEvents.length > 0) {
      webResearchEvents.forEach((event) => {
        const researchData = event.web_research as { 
          sources_gathered?: SourceData[];
          executed_search_queries?: string[];
          search_query?: string;
          total_sources?: number;
        };
        
        // 从executed_search_queries或search_query中获取真实的查询
        let searchQuery = 'Unknown Query';
        if (researchData.executed_search_queries && researchData.executed_search_queries.length > 0) {
          searchQuery = researchData.executed_search_queries[0];
        } else if (researchData.search_query) {
          searchQuery = researchData.search_query;
        }
        
        const sources = researchData.sources_gathered || [];
        
        // 从sources中提取真实的信息，按照后端返回的实际结构
        const processedSources = sources.map((source: SourceData & { label?: string; short_url?: string; value?: string }) => {
          // 后端返回的sources结构：{label, short_url, value, title?, snippet?}
          return {
            title: source.title || source.label || 'Source',
            url: source.value || source.short_url || source.url || '',
            label: source.label || 'Web',
            snippet: source.snippet || 'No preview available'
          };
        });
        
        steps.push({
          type: 'web_research',
          title: `Web Research: ${searchQuery}`,
          status: 'completed',
          data: event.web_research as EventData,
          details: [
            {
              type: 'search_queries',
              content: `Query: "${searchQuery}"`,
              metadata: { query: searchQuery }
            },
            {
              type: 'sources',
              content: `Found ${sources.length} relevant sources`,
              metadata: { 
                count: sources.length,
                sources: processedSources,
                totalFound: sources.length
              }
            }
          ]
        });
      });
    }

    // 3. Reflection
    const reflectionEvents = events.filter(event => event.reflection);
    // console.log(`🔍 Reflection事件数: ${reflectionEvents.length}`);
    if (reflectionEvents.length > 0) {
      const lastReflection = reflectionEvents[reflectionEvents.length - 1];
      // console.log(`🤔 Reflection数据:`, lastReflection.reflection);
      const reflectionData = lastReflection.reflection as {
        reflection_is_sufficient?: boolean;
        reflection_knowledge_gap?: string;
        reflection_follow_up_queries?: string[];
      };
      
      const details = [];
      
      // 主要分析结果
      details.push({
        type: 'analysis' as const,
        content: reflectionData.reflection_is_sufficient 
          ? '✅ Research quality meets requirements - sufficient information gathered'
          : '⚠️ Additional research needed - quality requirements not met',
        metadata: {
          is_sufficient: reflectionData.reflection_is_sufficient,
          status: reflectionData.reflection_is_sufficient ? 'sufficient' : 'insufficient'
        }
      });
      
      // 知识差距分析
      if (reflectionData.reflection_knowledge_gap) {
        details.push({
          type: 'analysis' as const,
          content: `Knowledge Gap Identified: ${reflectionData.reflection_knowledge_gap}`,
          metadata: {
            knowledge_gap: reflectionData.reflection_knowledge_gap,
            gap_type: 'content_depth'
          }
        });
      }
      
      // Follow-up queries
      if (reflectionData.reflection_follow_up_queries && reflectionData.reflection_follow_up_queries.length > 0) {
        details.push({
          type: 'decision' as const,
          content: `Recommended follow-up research areas: ${reflectionData.reflection_follow_up_queries.length} queries identified`,
          metadata: {
            follow_up_queries: reflectionData.reflection_follow_up_queries,
            action_needed: !reflectionData.reflection_is_sufficient
          }
        });
      }
      
      // console.log(`🤔 添加Reflection步骤，详情数量: ${details.length}`);
      steps.push({
        type: 'reflection',
        title: 'Reflection Analysis',
        status: 'completed',
        data: lastReflection.reflection as EventData,
        details: details
      });
    }

    // 4. Content Enhancement
    const enhancementEvents = events.filter(event => event.content_enhancement);
    // console.log(`🔍 Content Enhancement事件数: ${enhancementEvents.length}`);
    if (enhancementEvents.length > 0) {
      const lastEnhancement = enhancementEvents[enhancementEvents.length - 1];
      // console.log(`🔧 Content Enhancement数据:`, lastEnhancement.content_enhancement);
      const enhancementData = lastEnhancement.content_enhancement as {
        enhancement_status?: string;
        enhancement_decision?: string;
        enhancement_reasoning?: string;
      };
      const status = enhancementData.enhancement_status;
      
      const details = [];
      
      // Enhancement决策
      details.push({
        type: 'decision' as const,
        content: getEnhancementStatusMessage(status || 'unknown'),
        metadata: { 
          status,
          decision: enhancementData.enhancement_decision,
          automated: true
        }
      });
      
      // Enhancement reasoning如果存在
      if (enhancementData.enhancement_reasoning) {
        details.push({
          type: 'analysis' as const,
          content: `Reasoning: ${enhancementData.enhancement_reasoning}`,
          metadata: {
            reasoning_type: 'content_quality',
            reasoning: enhancementData.enhancement_reasoning
          }
        });
      }
      
      // console.log(`🔧 添加Content Enhancement步骤，状态: ${status}, 详情数量: ${details.length}`);
      steps.push({
        type: 'content_enhancement',
        title: 'Content Enhancement Analysis',
        status: status === 'skipped' ? 'skipped' : 'completed',
        data: lastEnhancement.content_enhancement as EventData,
        details: details
      });
    }

    // 5. Research Evaluation
    const evaluationEvents = events.filter(event => event.evaluate_research_enhanced);
    // console.log(`🔍 Research Evaluation事件数: ${evaluationEvents.length}`);
    if (evaluationEvents.length > 0) {
      const lastEvaluation = evaluationEvents[evaluationEvents.length - 1];
      // console.log(`📊 Research Evaluation数据:`, lastEvaluation.evaluate_research_enhanced);
      const evaluationData = lastEvaluation.evaluate_research_enhanced as {
        evaluation_is_sufficient?: boolean;
        evaluation_reasoning?: string;
        quality_score?: number;
      };
      
      const details = [];
      
      // 主要评估结果
      details.push({
        type: 'analysis' as const,
        content: evaluationData.evaluation_is_sufficient
          ? '✅ Research meets quality standards - ready for report generation'
          : '❌ Research quality insufficient - additional work required',
        metadata: {
          is_sufficient: evaluationData.evaluation_is_sufficient,
          evaluation_type: 'quality_assessment',
          quality_score: evaluationData.quality_score
        }
      });
      
      // 评估推理信息
      if (evaluationData.evaluation_reasoning) {
        details.push({
          type: 'analysis' as const,
          content: `Quality Assessment: ${evaluationData.evaluation_reasoning}`,
          metadata: {
            reasoning: evaluationData.evaluation_reasoning,
            assessment_type: 'automated'
          }
        });
      }
      
      // console.log(`📊 添加Research Evaluation步骤，是否充分: ${evaluationData.evaluation_is_sufficient}, 详情数量: ${details.length}`);
      steps.push({
        type: 'evaluation',
        title: 'Research Quality Evaluation',
        status: 'completed',
        data: lastEvaluation.evaluate_research_enhanced as EventData,
        details: details
      });
    }

    // 6. Task Completion
    const completionEvents = events.filter(event => event.record_task_completion);
    if (completionEvents.length > 0) {
      steps.push({
        type: 'completion',
        title: 'Task Completion Recorded',
        status: 'completed',
        data: completionEvents[completionEvents.length - 1].record_task_completion as EventData
      });
    }
  }

  return steps;
}

/**
 * 获取当前任务ID
 */
function getCurrentTaskId(events: EventData[], state: StateData): string | null {
  // 🎯 NEW: 基于固定3步骤确定当前任务ID
  const hasFinalReportGeneration = events.some(event => event.final_report_generation);
  const hasResearchSupervisor = events.some(event => event.research_supervisor);
  const hasWriteResearchBrief = events.some(event => event.write_research_brief);
  
  // 如果已完成报告生成，没有当前任务（全部完成）
  if (hasFinalReportGeneration) {
    return null;
  }
  
  // 如果完成了研究监督，当前任务是生成报告
  if (hasResearchSupervisor) {
    return 'step-report';
  }
  
  // 如果完成了研究简报，当前任务是执行研究
  if (hasWriteResearchBrief) {
    return 'step-research';
  }
  
  // 否则当前任务是研究计划
  return 'step-planning';
}

/**
 * 确定整体状态
 */
function determineOverallStatus(events: EventData[]): 'planning' | 'researching' | 'completed' {
  // 🎯 NEW: 基于固定3步骤的状态判断
  const hasFinalReportGeneration = events.some(event => event.final_report_generation);
  const hasResearchSupervisor = events.some(event => event.research_supervisor);
  const hasWriteResearchBrief = events.some(event => event.write_research_brief);
  
  // 如果已完成报告生成，整体状态为已完成
  if (hasFinalReportGeneration) {
    return 'completed';
  }
  
  // 如果已完成研究简报，进入研究阶段
  if (hasWriteResearchBrief) {
    return 'researching';
  }
  
  // 否则还在规划阶段
  return 'planning';

  // 🔧 FALLBACK: 检查旧后端事件
  // 检查是否有finalize_answer事件
  const finalizeEvents = events.filter(event => event.finalize_answer);
  if (finalizeEvents.length > 0) {
    return 'completed';
  }

  // 检查是否有planning
  const planningEvents = events.filter(event => event.planner || event.planner_node);
  if (planningEvents.length > 0) {
    return 'researching';
  }

  return 'planning';
}

/**
 * 获取增强状态消息
 */
function getEnhancementStatusMessage(status: string): string {
  const statusMessages: Record<string, string> = {
    "skipped": "Content enhancement skipped - quality sufficient",
    "completed": "Content enhancement completed successfully", 
    "failed": "Content enhancement failed",
    "error": "Content enhancement encountered errors",
    "analyzing": "Analyzing content enhancement needs",
    "skipped_no_api": "Content enhancement skipped - no API key"
  };
  
  return statusMessages[status] || `Status: ${status}`;
}

/**
 * 调试函数：打印转换结果
 */
export function debugTransformResult(data: ProcessedResearchData): void {
  // console.log('🔍 转换结果分析:', {
  //   planning: data.planning,
  //   tasksCount: data.tasks.length,
  //   currentTaskId: data.currentTaskId,
  //   overallStatus: data.overallStatus,
  //   tasks: data.tasks.map(task => ({
  //     id: task.taskId,
  //     description: task.description,
  //     status: task.status,
  //     stepsCount: task.steps.length
  //   }))
  // });
} 