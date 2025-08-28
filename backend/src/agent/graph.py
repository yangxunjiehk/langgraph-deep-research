import os
import json
from typing import List
from datetime import datetime

from agent.tools_and_schemas import SearchQueryList, Reflection, ResearchPlan, LedgerEntry
from dotenv import load_dotenv
from langchain_core.messages import AIMessage
from langgraph.types import Send
from langgraph.graph import StateGraph
from langgraph.graph import START, END
from langchain_core.runnables import RunnableConfig
from google.genai import Client
import tiktoken  # 需确保环境已安装 tiktoken
from langchain_openai import AzureChatOpenAI
from tavily import TavilyClient

from agent.state import (
    OverallState,
    QueryGenerationState,
    ReflectionState,
    WebSearchState,
)
from agent.configuration import Configuration
from agent.prompts import (
    get_current_date,
    query_writer_instructions,
    web_searcher_instructions,
    reflection_instructions,
    answer_instructions,
    planning_instructions,
)
from langchain_google_genai import ChatGoogleGenerativeAI
from agent.utils import (
    get_citations,
    get_research_topic,
    insert_citation_markers,
    resolve_urls,
)
# 导入智能内容增强模块
from agent.enhanced_graph_nodes import (
    content_enhancement_analysis,
    should_enhance_content
)

load_dotenv()

# 检查Azure OpenAI配置
if os.getenv("AZURE_OPENAI_API_KEY") is None:
    raise ValueError("AZURE_OPENAI_API_KEY is not set")
if os.getenv("AZURE_OPENAI_ENDPOINT") is None:
    raise ValueError("AZURE_OPENAI_ENDPOINT is not set")

# 检查Tavily搜索配置
if os.getenv("TAVILY_API_KEY") is None:
    print("[WARNING] TAVILY_API_KEY is not set, using placeholder")
    
# 创建Tavily客户端
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY", "tvly-placeholder"))

# Azure OpenAI辅助函数
def get_azure_openai_llm(model_name: str, temperature: float = 0.3, max_retries: int = 2) -> AzureChatOpenAI:
    """创建Azure OpenAI模型实例，支持动态模型部署映射"""
    
    # 根据模型名称选择对应的Azure部署
    deployment_mapping = {
        "gpt-4o": os.getenv("AZURE_OPENAI_GPT4O_DEPLOYMENT", "gpt-4o"),
        "gpt-4.1": os.getenv("AZURE_OPENAI_GPT41_DEPLOYMENT", "gpt-4.1"), 
        "gpt-4o-mini": os.getenv("AZURE_OPENAI_GPT4O_MINI_DEPLOYMENT", "gpt-4o-mini")
    }
    
    deployment_name = deployment_mapping.get(model_name, model_name)
    print(f"[MODEL] Using {model_name} with deployment: {deployment_name}")
    
    return AzureChatOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        azure_deployment=deployment_name,
        openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
        api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        temperature=temperature,
        max_retries=max_retries,
    )


# Nodes
def generate_query(state: OverallState, config: RunnableConfig) -> QueryGenerationState:
    """LangGraph node that generates search queries based on the current research task from the plan."""
    configurable = Configuration.from_runnable_config(config)

    # check for custom initial search query count
    if state.get("initial_search_query_count") is None:
        state["initial_search_query_count"] = configurable.number_of_initial_queries

    # init Azure OpenAI
    llm = get_azure_openai_llm(
        model_name=configurable.query_generator_model,
        temperature=1.0,
        max_retries=2
    )
    structured_llm = llm.with_structured_output(SearchQueryList)

    # New logic: prioritize generating queries based on current plan task
    plan = state.get("plan")
    pointer = state.get("current_task_pointer")
    if plan and pointer is not None and pointer < len(plan):
        research_topic = plan[pointer]["description"]
    else:
        # Fallback to user_query or messages
        research_topic = state.get("user_query") or get_research_topic(state["messages"])

    current_date = get_current_date()
    formatted_prompt = query_writer_instructions.format(
        current_date=current_date,
        research_topic=research_topic,
        number_queries=state["initial_search_query_count"],
    )
    result = structured_llm.invoke(formatted_prompt)
    
    return {
        "query_list": result.query,
        "plan": state.get("plan", []),
        "current_task_pointer": state.get("current_task_pointer", 0)
    }


def continue_to_web_research(state: QueryGenerationState):
    """LangGraph node that sends the search queries to the web research node.

    This is used to spawn n number of web research nodes, one for each search query.
    """
    # Get current task info
    plan = state.get("plan", [])
    current_pointer = state.get("current_task_pointer", 0)
    current_task_id = "unknown"
    
    if plan and current_pointer < len(plan):
        current_task_id = plan[current_pointer]["id"]
    
    return [
        Send("web_research", {
            "search_query": search_query, 
            "id": int(idx),
            "current_task_id": current_task_id
        })
        for idx, search_query in enumerate(state["query_list"])
    ]


def web_research(state: WebSearchState, config: RunnableConfig) -> OverallState:
    """LangGraph node that performs web research using the native Google Search API tool.

    Executes a web search using the native Google Search API tool in combination with Gemini 2.0 Flash.

    Args:
        state: Current graph state containing the search query and research loop count
        config: Configuration for the runnable, including search API settings

    Returns:
        Dictionary with state update, including sources_gathered, research_loop_count, and web_research_results
    """
    try:
        # Configure
        configurable = Configuration.from_runnable_config(config)
        formatted_prompt = web_searcher_instructions.format(
            current_date=get_current_date(),
            research_topic=state["search_query"],
        )

        # 使用Tavily进行真实网络搜索
        try:
            print(f"[SEARCH] Performing Tavily search for: {state['search_query']}")
            search_result = tavily_client.search(
                query=state["search_query"],
                max_results=5,
                include_raw_content=True
            )
            
            print(f"[DEBUG] Tavily search result: {search_result}")  # 调试日志
            
            sources_gathered = []
            research_content_parts = []
            
            for result in search_result.get("results", []):
                source = {
                    "title": result.get("title", "No title"),
                    "url": result.get("url", ""),
                    "snippet": result.get("content", "")[:500]
                }
                sources_gathered.append(source)
                
                # 整合搜索结果内容
                content = result.get("raw_content", result.get("content", ""))[:2000]  # 限制内容长度
                research_content_parts.append(f"Source: {result.get('title', 'Unknown')}\nURL: {result.get('url', 'N/A')}\nContent: {content}\n")
            
            # 汇总搜索结果
            response_text = f"Web research results for '{state['search_query']}':\n\n" + "\n---\n".join(research_content_parts)
            print(f"[SEARCH] Found {len(sources_gathered)} sources")
            
        except Exception as e:
            print(f"[ERROR] Tavily search failed: {str(e)}")
            # 回退到基本响应
            response_text = f"Search for '{state['search_query']}' encountered an error. Please try a different query."
            sources_gathered = []

        # Create detailed findings entry with task ID
        current_task_id = state.get("current_task_id", "unknown")
        detailed_finding = {
            "task_id": current_task_id,
            "query_id": state["id"],
            "content": response_text,
            "source": sources_gathered[0] if sources_gathered else None,
            "timestamp": datetime.now().isoformat()
        }

        # Add task-specific metadata to the research result
        task_specific_result = {
            "task_id": current_task_id,
            "content": response_text,
            "sources": sources_gathered,
            "timestamp": datetime.now().isoformat()
        }

        return {
            "sources_gathered": sources_gathered,
            "executed_search_queries": [state["search_query"]],
            "web_research_result": [response_text],
            "current_task_detailed_findings": [detailed_finding],
            "task_specific_results": [task_specific_result]
        }
    except Exception as e:
        # Error handling for API or processing errors
        current_task_id = state.get("current_task_id", "unknown")
        error_message = f"Error during web research: {str(e)}"
        
        detailed_finding = {
            "task_id": current_task_id,
            "query_id": state["id"],
            "content": error_message,
            "source": None,
            "timestamp": datetime.now().isoformat()
        }
        
        task_specific_result = {
            "task_id": current_task_id,
            "content": error_message,
            "sources": [],
            "timestamp": datetime.now().isoformat()
        }
        
        return {
            "sources_gathered": [],
            "executed_search_queries": [state["search_query"]],
            "web_research_result": [error_message],
            "current_task_detailed_findings": [detailed_finding],
            "task_specific_results": [task_specific_result]
        }


def reflection(state: OverallState, config: RunnableConfig) -> OverallState:
    """LangGraph node that identifies knowledge gaps and generates potential follow-up queries.

    This is where we check if our search results are sufficient to answer the research question.
    If not, we generate follow-up queries to address the knowledge gap.
    """
    try:
        configurable = Configuration.from_runnable_config(config)
        
        # 递增研究循环计数
        state["research_loop_count"] = state.get("research_loop_count", 0) + 1
        
        reasoning_model = configurable.reasoning_model
        current_date = get_current_date()
        research_topic = get_research_topic(state["messages"])
        
        # 安全地获取web research结果，并截断过长内容
        web_research_results = state.get("web_research_result", [])
        
        # 内容截断：限制总字符数以避免API限制
        MAX_CHARS = 50000  # 约12500 tokens
        truncated_results = []
        total_chars = 0
        
        for result in web_research_results:
            result_str = str(result)
            if total_chars + len(result_str) <= MAX_CHARS:
                truncated_results.append(result_str)
                total_chars += len(result_str)
            else:
                # 部分截取最后一个结果
                remaining_chars = MAX_CHARS - total_chars
                if remaining_chars > 500:  # 至少保留500字符
                    truncated_results.append(result_str[:remaining_chars] + "...[truncated]")
                break
        
        print(f"🔍 Reflection分析: {len(web_research_results)} 个结果，截断后 {len(truncated_results)} 个，{total_chars} 字符")
        
        formatted_prompt = reflection_instructions.format(
            current_date=current_date,
            research_topic=research_topic,
            summaries="\n\n---\n\n".join(truncated_results),
        )
        
        # 检查prompt长度
        prompt_length = len(formatted_prompt)
        print(f"📏 Reflection prompt长度: {prompt_length} 字符")
        
        if prompt_length > 100000:  # 如果仍然过长，进一步截断
            print("⚠️ Prompt过长，进一步截断summaries部分")
            truncated_summaries = "\n\n---\n\n".join(truncated_results[:3])  # 只保留前3个结果
            formatted_prompt = reflection_instructions.format(
                current_date=current_date,
                research_topic=research_topic,
                summaries=truncated_summaries,
            )
        
        # 初始化LLM
        llm = get_azure_openai_llm(
            model_name=reasoning_model,
            temperature=1.0,
            max_retries=3
        )
        
        # 尝试结构化输出
        try:
            print("🤖 正在调用Gemini API进行reflection分析...")
            result = llm.with_structured_output(Reflection).invoke(formatted_prompt)
            print("✅ Reflection分析成功完成")
            
        except Exception as api_error:
            print(f"❌ Structured output失败: {str(api_error)}")
            print("🔄 尝试fallback方案...")
            
            # Fallback: 使用简单的文本生成而不是structured output
            simple_prompt = f"""Based on the research topic: {research_topic}
            
Research results summary: {len(truncated_results)} sources analyzed.

Please evaluate if this research is sufficient and respond in this exact JSON format:
{{
  "is_sufficient": true,
  "knowledge_gap": "Research appears comprehensive based on available sources",
  "follow_up_queries": []
}}

Important: Respond only with valid JSON."""
            
            try:
                fallback_response = llm.invoke(simple_prompt)
                import json
                # 尝试解析JSON响应
                response_text = fallback_response.content if hasattr(fallback_response, 'content') else str(fallback_response)
                # 提取JSON部分
                import re
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if json_match:
                    result_dict = json.loads(json_match.group())
                    # 创建Reflection对象
                    result = Reflection(
                        is_sufficient=result_dict.get("is_sufficient", True),
                        knowledge_gap=result_dict.get("knowledge_gap", "Analysis completed with available data"),
                        follow_up_queries=result_dict.get("follow_up_queries", [])
                    )
                    print("✅ Fallback方案成功")
                else:
                    raise ValueError("无法解析JSON响应")
                    
            except Exception as fallback_error:
                print(f"❌ Fallback方案也失败: {str(fallback_error)}")
                print("🛡️ 使用默认reflection结果")
                
                # 最终fallback: 基于结果数量的简单判断
                has_sufficient_results = len(web_research_results) >= 3
                result = Reflection(
                    is_sufficient=has_sufficient_results,
                    knowledge_gap="Analysis completed with available research data" if has_sufficient_results else "Limited research data available",
                    follow_up_queries=[] if has_sufficient_results else [f"additional information about {research_topic}"]
                )
                print(f"🛡️ 默认判断: sufficient={has_sufficient_results}, 基于{len(web_research_results)}个搜索结果")

    except Exception as e:
        error_message = f"Reflection节点发生严重错误: {str(e)}"
        print(f"💥 {error_message}")
        
        # 紧急fallback: 总是认为当前结果足够，避免中断流程
        result = Reflection(
            is_sufficient=True,
            knowledge_gap="Analysis completed despite technical difficulties",
            follow_up_queries=[]
        )
        print("🚨 使用紧急fallback，标记为sufficient以继续流程")

    # 返回更新的状态，包含reflection结果
    return {
        "research_loop_count": state["research_loop_count"],
        "reflection_is_sufficient": result.is_sufficient,  # 新增字段保存reflection结果
        "reflection_knowledge_gap": result.knowledge_gap,  # 新增字段保存知识差距
        "reflection_follow_up_queries": result.follow_up_queries,  # 新增字段保存follow-up查询
        "number_of_ran_queries": len(state.get("executed_search_queries", [])),
        "plan": state.get("plan", []),
        "current_task_pointer": state.get("current_task_pointer", 0)
    }


def evaluate_research_enhanced(state: OverallState, config: RunnableConfig) -> dict:
    """
    增强版研究评估节点 - 更新状态中的评估结果
    
    这个函数只负责状态更新，不负责路由决策
    """
    configurable = Configuration.from_runnable_config(config)
    
    # 获取reflection结果
    research_loop_count = state.get("research_loop_count", 0)
    max_research_loops = configurable.max_research_loops
    reflection_is_sufficient = state.get("reflection_is_sufficient", False)
    reflection_follow_up_queries = state.get("reflection_follow_up_queries", [])
    
    # 检查是否已经完成增强以及增强的效果
    enhancement_status = state.get("enhancement_status")
    enhanced_sources_count = state.get("enhanced_sources_count", 0)
    
    # 智能决策：考虑reflection结果和增强效果
    is_sufficient = reflection_is_sufficient
    
    # 如果reflection认为不充足，但我们成功进行了内容增强，可能需要重新评估
    if not is_sufficient and enhancement_status == "completed" and enhanced_sources_count > 0:
        print(f"📈 内容增强完成 ({enhanced_sources_count} 个源)，提升充足性评估")
        # 给增强内容一定的"加分"
        enhancement_boost = min(enhanced_sources_count * 0.3, 0.8)
        if enhancement_boost >= 0.6:
            print(f"  ✅ 基于内容增强结果，判定信息已充足")
            is_sufficient = True
    
    # 准备follow-up查询（如果需要继续研究）
    follow_up_queries = reflection_follow_up_queries or []
    if not follow_up_queries and not is_sufficient:
        # 如果没有follow-up查询但信息不充足，生成简单的查询
        plan = state.get("plan", [])
        current_pointer = state.get("current_task_pointer", 0)
        if plan and current_pointer < len(plan):
            task_description = plan[current_pointer]["description"]
            follow_up_queries = [f"more details about {task_description}"]
    
    # 记录评估结果到状态
    final_decision = is_sufficient or research_loop_count >= max_research_loops
    
    print(f"🏁 研究评估完成 - 充足性: {is_sufficient}, 循环次数: {research_loop_count}/{max_research_loops}")
    if enhancement_status == "completed":
        print(f"  🔥 本轮包含Firecrawl内容增强: {enhanced_sources_count} 个源")
    
    return {
        "evaluation_is_sufficient": is_sufficient,
        "evaluation_should_continue": not final_decision,
        "evaluation_follow_up_queries": follow_up_queries,
        "evaluation_research_complete": final_decision,
        "evaluation_enhancement_boost": enhanced_sources_count if enhancement_status == "completed" else 0
    }


def decide_next_research_step(state: OverallState):
    """
    条件边函数 - 决定研究是否完成还是继续
    可以返回字符串路由或Send对象列表
    """
    # 从状态中获取评估结果
    should_continue = state.get("evaluation_should_continue", False)
    research_complete = state.get("evaluation_research_complete", False)
    
    if research_complete or not should_continue:
        print("🏁 研究流程完成，记录任务结果")
        return "record_task_completion"
    else:
        print("🔄 继续研究，执行follow-up查询")
        # 生成follow-up查询的Send对象
        follow_up_queries = state.get("evaluation_follow_up_queries", [])
        
        if not follow_up_queries:
            print("⚠️ 没有follow-up查询，直接完成")
            return "record_task_completion"
        
        # Get current task info for follow-up research
        plan = state.get("plan", [])
        current_pointer = state.get("current_task_pointer", 0)
        current_task_id = "unknown"
        
        if plan and current_pointer < len(plan):
            current_task_id = plan[current_pointer]["id"]
        
        print(f"🔄 生成 {len(follow_up_queries)} 个follow-up查询")
        
        # 返回follow-up查询的Send列表
        from langgraph.types import Send
        return [
            Send(
                "web_research",
                {
                    "search_query": follow_up_query,
                    "id": state.get("number_of_ran_queries", 0) + int(idx),
                    "current_task_id": current_task_id
                },
            )
            for idx, follow_up_query in enumerate(follow_up_queries)
        ]


def finalize_answer(state: OverallState, config: RunnableConfig) -> dict:
    """Generate the final research report by synthesizing all task findings, using batch generation for detailed content."""
    try:
        configurable = Configuration.from_runnable_config(config)
        llm = get_azure_openai_llm(
            model_name=configurable.answer_model,
            temperature=0.3,
            max_retries=2
        )
        
        plan = state.get("plan", [])
        if not plan:
            return {
                "messages": [AIMessage(content="No research plan available to generate report")],
                "final_report_markdown": "No research plan available to generate report"
            }
        
        # Build ledger map and task results map
        ledger = state.get("ledger", [])
        ledger_map = {entry["task_id"]: entry for entry in ledger}
        
        task_specific_results = state.get("task_specific_results", [])
        task_results_map = {}
        for result in task_specific_results:
            task_id = result.get("task_id")
            if task_id:
                if task_id not in task_results_map:
                    task_results_map[task_id] = []
                task_results_map[task_id].append(result)
        
        # Build source mapping for citation conversion
        sources_gathered = state.get("sources_gathered", [])
        source_mapping = build_source_mapping(sources_gathered)
        
        report_sections = []
        
        # Introduction
        intro_prompt = f"""As a Senior Research Analyst at a leading global consultancy, write a professional Executive Summary for this research report.

Research Topic: {state.get('user_query', 'Research Topic')}

EXECUTIVE SUMMARY REQUIREMENTS:
- **Strategic Context**: Establish the business importance and relevance of this research
- **Key Market Dynamics**: Highlight the most critical trends and drivers shaping this space
- **Core Insights**: Summarize the 3-4 most significant findings that executives need to know
- **Strategic Implications**: What this means for business leaders, investors, and policymakers
- **Market Opportunity**: Size the opportunity and highlight key growth drivers

WRITING STYLE:
- Executive-level language: professional, authoritative, accessible
- Lead with business impact and strategic significance
- Include specific data points that demonstrate market scale and momentum
- Focus on actionable insights rather than academic abstractions
- 3-4 well-structured paragraphs

EXAMPLE OPENING: "The global [market/sector] is experiencing unprecedented transformation, driven by [key factors]. With market valuations reaching $X billion and projected growth of Y%, this represents a critical inflection point for [stakeholder groups]..."

IMPORTANT: Write only the Executive Summary content. No meta-commentary, no section headers."""

        try:
            introduction = llm.invoke(intro_prompt).content
            introduction = clean_generated_content(introduction)
            report_sections.append(f"# {state.get('user_query', 'Research Report')}\n\n## Executive Summary\n\n{introduction}\n")
        except Exception as e:
            report_sections.append(f"# {state.get('user_query', 'Research Report')}\n\n## Executive Summary\n\n*Executive Summary generation encountered technical issues. Report continues with detailed analysis.*\n")

        # Generate sections for each task
        for task in plan:
            task_id = task["id"]
            task_description = task["description"]
            ledger_entry = ledger_map.get(task_id)
            if not ledger_entry:
                report_sections.append(f"## {task_description}\n\n*Analysis pending - comprehensive data collection in progress.*\n")
                continue
            
            # Get task-specific results first, then fall back to web_research_result if empty
            task_results = task_results_map.get(task_id, [])
            detailed_contents = [result["content"] for result in task_results]
            
            # Fallback: if no task-specific results, use all web_research_result as content
            if not detailed_contents:
                web_research_result = state.get("web_research_result", [])
                detailed_contents = web_research_result
                print(f"Warning: No task-specific results for {task_id}, using fallback web_research_result with {len(detailed_contents)} items")
            
            if not detailed_contents:
                # If still no content, create a section with just the summary
                section_content = ledger_entry['findings_summary']
                report_sections.append(f"## {task_description}\n\n{section_content}\n")
                continue
            
            batches = split_by_tokens(detailed_contents, max_tokens=150000)  # Increased token limit
            section_content = ""
            previous_content = ""
            
            for i, batch in enumerate(batches):
                is_last = (i == len(batches) - 1)
                batched_content = "\n\n".join(batch)
                
                # Convert citations to readable format
                batched_content = convert_citations_to_readable(batched_content, source_mapping)
                
                section_prompt = f"""As a Senior Research Analyst at a leading global consultancy, synthesize these research findings into a professional analysis section.

SECTION FOCUS: {task_description}
STRATEGIC CONTEXT: {ledger_entry['findings_summary']}

RESEARCH DATA:
{batched_content}

PROFESSIONAL ANALYSIS REQUIREMENTS:
1. **Market Intelligence**: Present data within strategic business context
2. **Competitive Landscape**: Highlight key players, market dynamics, and positioning
3. **Technology Trends**: Identify innovation drivers and disruptive forces
4. **Implementation Insights**: Showcase real-world case studies and best practices  
5. **Business Implications**: Connect findings to strategic decision-making
6. **Risk Assessment**: Identify challenges, barriers, and mitigation strategies

WRITING STANDARDS:
- Lead with executive insights, support with data
- Transform raw information into strategic intelligence
- Use professional attribution: "According to industry analysis from [source]..." 
- Include specific metrics that demonstrate scale and trajectory
- Organize with clear subheadings for easy navigation
- Prioritize actionable insights over academic detail

STRUCTURE GUIDELINES:
- **Market Overview**: Size, growth, key dynamics
- **Technology Analysis**: Current capabilities and emerging innovations  
- **Case Studies**: Real-world implementations and lessons learned
- **Strategic Implications**: What this means for market participants

CITATION APPROACH:
- Integrate sources naturally: "Research from McKinsey indicates..."
- Provide credible context: "According to government data released in 2024..."
- Emphasize authoritative sources: major consulting firms, industry associations, government agencies

OUTPUT REQUIREMENTS:
- Professional consulting report section
- Clear strategic narrative with supporting evidence
- Executive-appropriate language and insights
- Logical flow from analysis to business implications"""

                if previous_content:
                    section_prompt += f"\n\nBUILD UPON PREVIOUS ANALYSIS:\n{previous_content}\n\nContinue the strategic narrative, avoiding redundancy while building comprehensive coverage."
                
                if is_last:
                    section_prompt += "\n\nCONCLUSION: Synthesize this section with strategic implications and key takeaways for executives."
                else:
                    section_prompt += "\n\nCONTINUATION: Develop this analysis further - more detailed findings follow."

                section_prompt += "\n\nIMPORTANT: Output professional analysis content only. No meta-commentary or process notes."

                try:
                    batch_content = llm.invoke(section_prompt).content
                    
                    # Enhanced content cleaning
                    batch_content = clean_generated_content(batch_content)
                    batch_content = remove_prompt_remnants(batch_content)
                    
                    section_content += batch_content + "\n"
                    previous_content = section_content
                except Exception as e:
                    section_content += f"*Error generating batch content: {str(e)}*\n"
            
            report_sections.append(f"## {task_description}\n\n{section_content}\n")

        # Conclusion
        conclusion_prompt = f"""As a Senior Research Analyst at a leading global consultancy, write a comprehensive Strategic Implications & Recommendations section for this research report.

RESEARCH TOPIC: {state.get('user_query', 'Not specified')}

KEY FINDINGS SUMMARY:
{chr(10).join([f"- {task['description']}: {ledger_map.get(task['id'], {}).get('findings_summary', 'Analysis in progress')}" for task in plan])}

STRATEGIC IMPLICATIONS REQUIREMENTS:
1. **Market Trajectory**: Where is this industry/sector heading? What are the key inflection points?
2. **Investment Thesis**: What opportunities present the highest return potential?
3. **Strategic Priorities**: What should business leaders prioritize in the next 12-24 months?
4. **Risk Mitigation**: What are the primary risks and how can they be managed?
5. **Competitive Advantage**: How can organizations position themselves to win?

RECOMMENDATIONS FRAMEWORK:
- **Immediate Actions** (0-6 months): Tactical steps for quick wins
- **Strategic Initiatives** (6-18 months): Medium-term capability building  
- **Long-term Positioning** (18+ months): Future market preparation

EXECUTIVE COMMUNICATION STYLE:
- Lead with business impact and competitive implications
- Provide specific, actionable recommendations with clear rationale
- Include investment and resource allocation guidance
- Address both opportunities and risks with balanced perspective
- Use authoritative, confident language appropriate for C-suite audience

CONCLUSION STRUCTURE:
1. **Strategic Synthesis**: Connect findings to broader market dynamics
2. **Key Recommendations**: 3-4 priority actions with business rationale
3. **Future Outlook**: Market evolution and emerging opportunities
4. **Next Steps**: Specific actions for continued competitive advantage

IMPORTANT: Write as a senior consultant presenting to executive leadership. Focus on strategic implications and actionable intelligence rather than academic conclusions."""

        try:
            conclusion = llm.invoke(conclusion_prompt).content
            conclusion = clean_generated_content(conclusion)
            report_sections.append(f"## Strategic Implications & Recommendations\n\n{conclusion}\n")
        except Exception as e:
            report_sections.append(f"## Strategic Implications & Recommendations\n\n*Strategic analysis and recommendations section is being finalized to provide executive-level insights and actionable guidance.*\n")

        # Assemble final report
        final_report_markdown = "\n\n---\n\n".join(report_sections)
        
        # Final quality check and cleaning
        final_report_markdown = final_quality_check(final_report_markdown)
        
        return {
            "messages": [AIMessage(content=final_report_markdown)],
            "final_report_markdown": final_report_markdown
        }
    except Exception as e:
        error_message = f"Error generating final report: {str(e)}"
        return {
            "messages": [AIMessage(content=error_message)],
            "final_report_markdown": error_message
        }

def build_source_mapping(sources_gathered):
    """构建源文件映射，用于引用转换"""
    mapping = {}
    for i, source in enumerate(sources_gathered):
        # Extract domain from URL for readable citation
        domain = extract_domain(source.get("value", ""))
        label = source.get("label", domain)
        
        # Create mapping for different citation formats
        short_url = source.get("short_url", "")
        if short_url:
            # Extract ID from short URL
            import re
            id_match = re.search(r'/id/([^/]+)', short_url)
            if id_match:
                citation_id = id_match.group(1)
                mapping[citation_id] = {
                    "label": label,
                    "domain": domain,
                    "value": source.get("value", "")
                }
    return mapping

def extract_domain(url):
    """从URL中提取域名"""
    import re
    if not url:
        return "Unknown"
    
    # Extract domain from URL
    domain_match = re.search(r'https?://(?:www\.)?([^/]+)', url)
    if domain_match:
        domain = domain_match.group(1)
        # Simplify common domains
        if "google.com" in domain:
            return "Google"
        elif "wikipedia" in domain:
            return "Wikipedia" 
        elif "youtube" in domain:
            return "YouTube"
        else:
            return domain.split('.')[0].title()
    return "Web Source"

def convert_citations_to_readable(content, source_mapping):
    """将原始引用标记转换为可读的引用格式"""
    import re
    
    def replace_citation(match):
        citation_id = match.group(1)
        if citation_id in source_mapping:
            source_info = source_mapping[citation_id]
            return f"[Source: {source_info['domain']}]"
        return ""
    
    # Convert Vertex AI citations
    content = re.sub(r'\[vertexaisearch\.cloud\.google\.com/id/([^\]]+)\]', 
                     replace_citation, content)
    
    # Convert other citation formats
    content = re.sub(r'\[([a-z0-9\-]+)\]', r'[Source: \1]', content)
    
    return content

def clean_generated_content(content):
    """清理生成内容中的元文本和无关信息"""
    if not content:
        return content
    
    # Remove common meta-text at beginning
    meta_prefixes = [
        "here is", "this is", "based on", "according to", "好的", "根据",
        "以下是", "here's", "below is", "following is"
    ]
    
    lines = content.split('\n')
    cleaned_lines = []
    
    for line in lines:
        line = line.strip()
        if line:
            # Skip lines that start with meta-text
            line_lower = line.lower()
            is_meta = any(line_lower.startswith(prefix) for prefix in meta_prefixes)
            if not is_meta:
                cleaned_lines.append(line)
    
    return '\n'.join(cleaned_lines)

def remove_prompt_remnants(content):
    """移除内容中的Prompt残留"""
    import re
    
    # Remove instruction-like text
    content = re.sub(r'INSTRUCTIONS?:.*?(?=\n\n|\n[A-Z]|\Z)', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'REQUIREMENTS?:.*?(?=\n\n|\n[A-Z]|\Z)', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'IMPORTANT:.*?(?=\n\n|\n[A-Z]|\Z)', '', content, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove standalone bullets or dashes
    content = re.sub(r'^\s*[-•]\s*$', '', content, flags=re.MULTILINE)
    
    # Remove multiple consecutive line breaks
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    return content.strip()

def final_quality_check(content):
    """最终质量检查和清理"""
    # Remove any remaining citation URLs
    import re
    content = re.sub(r'https?://[^\s\]]+', '', content)
    
    # Fix spacing issues
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = re.sub(r'[ \t]+', ' ', content)
    
    # Remove standalone punctuation lines
    content = re.sub(r'^\s*[-.•]+\s*$', '', content, flags=re.MULTILINE)
    
    # Ensure proper spacing around headers
    content = re.sub(r'\n(#+[^\n]+)\n', r'\n\n\1\n\n', content)
    
    return content.strip()


def planner_node(state: OverallState, config: RunnableConfig) -> dict:
    """LangGraph node that generates a multi-step research plan based on the user's question."""
    configurable = Configuration.from_runnable_config(config)
    llm = get_azure_openai_llm(
        model_name=configurable.reflection_model,
        temperature=0.7,
        max_retries=2
    )
    structured_llm = llm.with_structured_output(ResearchPlan)

    # Get user query, prioritize from user_query, fallback to messages
    user_query = state.get("user_query") or get_research_topic(state["messages"])
    
    # Use centrally managed planning prompt
    formatted_prompt = planning_instructions.format(user_query=user_query)
    
    try:
        result = structured_llm.invoke(formatted_prompt)
        # Convert ResearchPlan to expected format
        plan = [{"id": task.id, "description": task.description, "info_needed": True, "source_hint": task.description, "status": "pending"} for task in result.tasks]
        
        return {
            "user_query": user_query,
            "plan": plan,
            "current_task_pointer": 0
        }
    except Exception as e:
        print(f"Planning failed: {e}")
        # Provide default single-task plan as fallback
        return {
            "user_query": user_query,
            "plan": [{"id": "task-1", "description": f"Research and answer: {user_query}", "info_needed": True, "source_hint": user_query, "status": "pending"}],
            "current_task_pointer": 0
        }


def record_task_completion_node(state: OverallState, config: RunnableConfig) -> dict:
    """Record the findings for the current task and prepare for the next task."""
    try:
        # Get current task info
        plan = state.get("plan", [])
        current_pointer = state.get("current_task_pointer", 0)
        
        if not plan or current_pointer >= len(plan):
            return {
                "messages": [AIMessage(content="Error: Invalid task pointer or empty plan")],
                "next_node_decision": "end"
            }
            
        current_task = plan[current_pointer]
        current_task_id = current_task.get("id")
        
        # Get detailed findings for current task
        detailed_findings = state.get("current_task_detailed_findings", [])
        task_specific_findings = [
            finding["content"] for finding in detailed_findings 
            if finding.get("task_id") == current_task_id
        ]
        
        # If no task-specific findings found, try to get recent web results as fallback
        if not task_specific_findings:
            print(f"Warning: No task-specific findings found for task {current_task_id}, using recent web results as fallback")
            web_results = state.get("web_research_result", [])
            # Take the most recent results (assume they belong to current task)
            task_specific_findings = web_results[-3:] if len(web_results) > 3 else web_results
        
        # Generate task summary
        task_summary = _summarize_task_findings(
            current_task["description"],
            task_specific_findings,
            config
        )
        
        # Create citations from detailed findings
        citations_for_snippets = []
        for finding in detailed_findings:
            if finding.get("task_id") == current_task_id and finding.get("source"):
                citations_for_snippets.append({
                    "snippet": finding["content"],
                    "source": str(finding["source"])
                })
        
        # Create ledger entry with detailed findings
        ledger_entry = {
            "task_id": current_task_id,
            "description": current_task["description"],
            "findings_summary": task_summary,
            "detailed_snippets": task_specific_findings,
            "citations_for_snippets": citations_for_snippets
        }
        
        # Update plan status
        plan[current_pointer]["status"] = "completed"
        
        # Clear current task findings to prepare for next task
        return {
            "ledger": [ledger_entry],
            "global_summary_memory": [task_summary],
            "plan": plan,
            "current_task_pointer": current_pointer + 1,
            "current_task_detailed_findings": [],  # Clear for next task
            "next_node_decision": "continue" if current_pointer + 1 < len(plan) else "end"
        }
    except Exception as e:
        error_message = f"Error in record_task_completion_node: {str(e)}"
        print(error_message)
        return {
            "messages": [AIMessage(content=error_message)],
            "next_node_decision": "end"
        }


def _summarize_task_findings(task_description: str, web_results: List[str], config: RunnableConfig) -> str:
    """Helper function to summarize web research results for a specific task."""
    if not web_results:
        return f"No specific findings available for task: {task_description}"
    
    # Use recent results (last 3 entries) to avoid overwhelming context
    recent_results = web_results[-3:] if len(web_results) > 3 else web_results
    context_to_summarize = "\n---\n".join(recent_results)
    
    configurable = Configuration.from_runnable_config(config)
    llm = get_azure_openai_llm(
        model_name=configurable.reflection_model,
        temperature=0.3,
        max_retries=2
    )
    
    prompt = f"""Given the research task: "{task_description}"

And the following research findings:
{context_to_summarize}

Please provide a concise summary (1-2 sentences) of the key findings that directly address this specific task.

Task Summary:"""
    
    try:
        response = llm.invoke(prompt)
        return response.content if hasattr(response, 'content') else str(response)
    except Exception as e:
        print(f"Task summarization failed: {e}")
        return f"Completed research for: {task_description}"


def decide_next_step_in_plan(state: OverallState) -> str:
    """Conditional edge function that determines whether to continue with next task or finalize."""
    current_pointer = state.get("current_task_pointer", 0)
    plan = state.get("plan", [])
    
    if current_pointer < len(plan):
        print(f"--- Moving to next task (pointer: {current_pointer}) ---")
        return "generate_query"
    else:
        print("--- All tasks completed. Finalizing answer ---")
        return "finalize_answer"


# Create our Agent Graph
builder = StateGraph(OverallState, config_schema=Configuration)

# Define the nodes we will cycle between
builder.add_node("planner", planner_node)
builder.add_node("generate_query", generate_query)
builder.add_node("web_research", web_research)
builder.add_node("reflection", reflection)
builder.add_node("content_enhancement", content_enhancement_analysis)  # 新增内容增强节点
builder.add_node("evaluate_research_enhanced", evaluate_research_enhanced)  # 新增增强版评估节点
builder.add_node("record_task_completion", record_task_completion_node)  # New node for Day 2
builder.add_node("finalize_answer", finalize_answer)

# Set the entrypoint as `planner`
builder.add_edge(START, "planner")
builder.add_edge("planner", "generate_query")

# Add conditional edge to continue with search queries in a parallel branch
builder.add_conditional_edges(
    "generate_query", continue_to_web_research, ["web_research"]
)

# Reflect on the web research
builder.add_edge("web_research", "reflection")

# 修改reflection后的路由逻辑 - 添加智能内容增强判断
builder.add_conditional_edges(
    "reflection", 
    should_enhance_content, 
    {
        "analyze_enhancement_need": "content_enhancement",
        "continue_without_enhancement": "evaluate_research_enhanced"
    }
)

# 内容增强完成后进入评估阶段
builder.add_edge("content_enhancement", "evaluate_research_enhanced")

# 评估完成后决定下一步 - 继续研究或完成任务
builder.add_conditional_edges(
    "evaluate_research_enhanced", 
    decide_next_research_step, 
    ["web_research", "record_task_completion"]  # 可以路由到这两个目标
)

# 当decide_next_research_step返回"continue_research"时，使用follow-up查询
# 这将通过continue_research_with_followup函数生成新的web_research任务

# After recording task completion, decide next step in plan (multi-task loop)
builder.add_conditional_edges(
    "record_task_completion", 
    decide_next_step_in_plan, 
    ["generate_query", "finalize_answer"]
)

# Finalize the answer
builder.add_edge("finalize_answer", END)

graph = builder.compile(name="pro-search-agent")

def split_by_tokens(texts, max_tokens=150000, encoding_name="cl100k_base"):
    """智能分批处理文本，保留重要上下文和信息完整性"""
    try:
        encoding = tiktoken.get_encoding(encoding_name)
    except ImportError:
        # Fallback to simple character-based estimation
        return simple_split_by_chars(texts, max_tokens * 4)  # Rough estimation: 4 chars per token
    
    batches = []
    current_batch = []
    current_tokens = 0
    
    for text in texts:
        if not text:
            continue
            
        text_tokens = len(encoding.encode(str(text)))
        
        # If single text is too large, intelligently extract key sections
        if text_tokens > max_tokens * 0.8:
            text = extract_key_sections(text, max_tokens * 0.7, encoding)
            text_tokens = len(encoding.encode(str(text)))
        
        # Check if adding this text would exceed the limit
        if current_tokens + text_tokens > max_tokens and current_batch:
            # Finalize current batch
            batches.append(current_batch)
            current_batch = [text]
            current_tokens = text_tokens
        else:
            current_batch.append(text)
            current_tokens += text_tokens
    
    # Add the last batch if it has content
    if current_batch:
        batches.append(current_batch)
    
    return batches

def extract_key_sections(content, max_tokens, encoding):
    """从长内容中智能提取关键部分，优先保留重要信息"""
    if not content:
        return content
    
    # Split content into sections
    sections = content.split('\n\n')
    key_sections = []
    tokens_used = 0
    priority_sections = []
    regular_sections = []
    
    # Categorize sections by importance
    for section in sections:
        if is_factual_section(section):
            priority_sections.append(section)
        else:
            regular_sections.append(section)
    
    # Add priority sections first
    for section in priority_sections:
        section_tokens = len(encoding.encode(section))
        if tokens_used + section_tokens <= max_tokens:
            key_sections.append(section)
            tokens_used += section_tokens
        elif is_critical_section(section):
            # For critical sections, truncate but include
            truncated = truncate_section(section, max_tokens - tokens_used, encoding)
            if truncated:
                key_sections.append(truncated)
            break
    
    # Add regular sections if space allows
    for section in regular_sections:
        section_tokens = len(encoding.encode(section))
        if tokens_used + section_tokens <= max_tokens:
            key_sections.append(section)
            tokens_used += section_tokens
        else:
            break
    
    return '\n\n'.join(key_sections)

def is_factual_section(section):
    """判断段落是否包含重要事实信息"""
    factual_indicators = [
        r'\d{4}',  # Years
        r'\$[\d,]+',  # Money amounts
        r'\d+%',  # Percentages
        r'\d+\.?\d*\s*(million|billion|thousand)',  # Large numbers
        r'(acquired|purchased|bought|sold)',  # Business actions
        r'(announced|launched|released)',  # Event verbs
        r'[A-Z][a-z]+\s+(Inc|Corp|Ltd|Company)',  # Company names
    ]
    
    import re
    for pattern in factual_indicators:
        if re.search(pattern, section, re.IGNORECASE):
            return True
    return False

def is_critical_section(section):
    """判断是否为关键段落（即使超长也要保留）"""
    critical_keywords = [
        'acquisition', 'merger', 'financial', 'revenue', 'profit',
        'strategy', 'impact', 'result', 'conclusion', 'summary'
    ]
    
    section_lower = section.lower()
    return any(keyword in section_lower for keyword in critical_keywords)

def truncate_section(section, max_tokens, encoding):
    """智能截取段落，保留最重要的部分"""
    if not section:
        return ""
    
    sentences = section.split('. ')
    truncated_sentences = []
    tokens_used = 0
    
    for sentence in sentences:
        sentence_tokens = len(encoding.encode(sentence))
        if tokens_used + sentence_tokens <= max_tokens:
            truncated_sentences.append(sentence)
            tokens_used += sentence_tokens
        else:
            break
    
    result = '. '.join(truncated_sentences)
    if result and not result.endswith('.'):
        result += '.'
    
    return result

def simple_split_by_chars(texts, max_chars):
    """字符级别的简单分批（备用方案）"""
    batches = []
    current_batch = []
    current_chars = 0
    
    for text in texts:
        text_chars = len(str(text))
        if current_chars + text_chars > max_chars and current_batch:
            batches.append(current_batch)
            current_batch = [text]
            current_chars = text_chars
        else:
            current_batch.append(text)
            current_chars += text_chars
    
    if current_batch:
        batches.append(current_batch)
    
    return batches
