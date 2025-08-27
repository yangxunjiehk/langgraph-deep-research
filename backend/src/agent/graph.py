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
import tiktoken  # 需确保环境已安装 tiktoken
from langchain_openai import AzureChatOpenAI

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
    integrated_report_instructions,
)
# from langchain_google_genai import ChatGoogleGenerativeAI
from agent.utils import (
    get_citations,
    get_research_topic,
    insert_citation_markers,
    resolve_urls,
)
# Import intelligent content enhancement modules
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
if os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") is None:
    raise ValueError("AZURE_OPENAI_DEPLOYMENT_NAME is not set")

# Azure OpenAI辅助函数
def get_azure_openai_llm(model_name: str, temperature: float = 0.3, max_retries: int = 2) -> AzureChatOpenAI:
    """创建Azure OpenAI模型实例"""
    return AzureChatOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"),
        openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
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

        # 使用Azure OpenAI进行搜索查询分析（简化版，不使用Google Search）
        llm = get_azure_openai_llm(
            model_name=configurable.query_generator_model,
            temperature=0.1
        )
        
        # 使用Azure OpenAI生成研究内容（简化版本）
        response_text = llm.invoke(formatted_prompt).content
        
        current_task_id = state.get("current_task_id", "unknown")
        
        # 创建模拟的搜索结果和来源
        sources_gathered = [{
            "title": f"Research for: {state['search_query']}",
            "url": f"https://research.example.com/query/{state['id']}",
            "snippet": response_text[:200] + "..."
        }]

        # Create detailed findings entry with task ID
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
        
        # Increment research loop counter
        state["research_loop_count"] = state.get("research_loop_count", 0) + 1
        
        reasoning_model = configurable.reasoning_model
        current_date = get_current_date()
        research_topic = get_research_topic(state["messages"])
        
        # Safely retrieve web research results and truncate overly long content
        web_research_results = state.get("web_research_result", [])
        
        # Content truncation: limit total characters to avoid API limits
        MAX_CHARS = 50000  # Approximately 12500 tokens
        truncated_results = []
        total_chars = 0
        
        for result in web_research_results:
            result_str = str(result)
            if total_chars + len(result_str) <= MAX_CHARS:
                truncated_results.append(result_str)
                total_chars += len(result_str)
            else:
                # Partially truncate the last result
                remaining_chars = MAX_CHARS - total_chars
                if remaining_chars > 500:  # Keep at least 500 characters
                    truncated_results.append(result_str[:remaining_chars] + "...[truncated]")
                break
        
        print(f"🔍 Reflection analysis: {len(web_research_results)} results, {len(truncated_results)} after truncation, {total_chars} characters")
        
        formatted_prompt = reflection_instructions.format(
            current_date=current_date,
            research_topic=research_topic,
            summaries="\n\n---\n\n".join(truncated_results),
        )
        
        # Check prompt length
        prompt_length = len(formatted_prompt)
        print(f"📏 Reflection prompt length: {prompt_length} characters")
        
        if prompt_length > 100000:  # If still too long, further truncate
            print("⚠️ Prompt too long, further truncating summaries section")
            truncated_summaries = "\n\n---\n\n".join(truncated_results[:3])  # Keep only first 3 results
            formatted_prompt = reflection_instructions.format(
                current_date=current_date,
                research_topic=research_topic,
                summaries=truncated_summaries,
            )
        
        # Initialize LLM
        llm = get_azure_openai_llm(
            model_name=reasoning_model,
            temperature=1.0,
            max_retries=3
        )
        
        # Try structured output
        try:
            print("🤖 Calling Gemini API for reflection analysis...")
            result = llm.with_structured_output(Reflection).invoke(formatted_prompt)
            print("✅ Reflection analysis completed successfully")
            
        except Exception as api_error:
            print(f"❌ Structured output failed: {str(api_error)}")
            print("🔄 Trying fallback approach...")
            
            # Fallback: use simple text generation instead of structured output
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
        error_message = f"Reflection node encountered critical error: {str(e)}"
        print(f"💥 {error_message}")
        
        # Emergency fallback: always consider current results sufficient to avoid flow interruption
        result = Reflection(
            is_sufficient=True,
            knowledge_gap="Analysis completed despite technical difficulties",
            follow_up_queries=[]
        )
        print("🚨 Using emergency fallback, marking as sufficient to continue flow")

    # Return updated state with reflection results
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
    """
    Generate the final research report using holistic integration of all research findings.
    
    OPTIMIZATION STRATEGY:
    This function implements a comprehensive refactor from the previous task-segmented approach
    to a unified holistic integration strategy. Instead of concatenating individual task sections,
    it synthesizes all research data through a single LLM call for coherent narrative flow.
    
    KEY IMPROVEMENTS:
    1. Cross-task data aggregation: Combines findings from all research streams
    2. Thematic organization: Structures content by analytical themes, not task boundaries  
    3. Executive-grade synthesis: Generates consulting-quality integrated reports
    4. Narrative coherence: Maintains unified strategic perspective throughout
    
    INPUT SOURCES:
    - Task-specific research results from ledger
    - Detailed research content from task_specific_results
    - Source attribution from sources_gathered
    - Original user query and research plan context
    
    OUTPUT:
    Unified professional research report with integrated analysis across all investigation areas.
    """
    try:
        configurable = Configuration.from_runnable_config(config)
        llm = get_azure_openai_llm(
            model_name=configurable.reflection_model,
            temperature=0.3,
            max_retries=2
        )
        
        plan = state.get("plan", [])
        user_query = state.get("user_query", "Research Analysis")
        
        if not plan:
            return {
                "messages": [AIMessage(content="No research plan available to generate report")],
                "final_report_markdown": "No research plan available to generate report"
            }
        
        # Build comprehensive research dataset from all sources
        ledger = state.get("ledger", [])
        task_specific_results = state.get("task_specific_results", [])
        sources_gathered = state.get("sources_gathered", [])
        
        # Create research plan summary for context
        research_plan_summary = "\n".join([
            f"• {task['description']}" for task in plan
        ])
        
        # Aggregate all research findings with proper attribution
        comprehensive_research_data = []
        
        # Add comprehensive findings from ledger with all available detail
        for entry in ledger:
            detailed_snippets = entry.get('detailed_snippets', [])
            citations = entry.get('citations_for_snippets', [])
            
            # Build comprehensive task context with all available information
            task_context = f"""
RESEARCH FOCUS: {entry['description']}
KEY FINDINGS: {entry['findings_summary']}

DETAILED RESEARCH CONTENT:
{chr(10).join(detailed_snippets)}

SUPPORTING CITATIONS:
{chr(10).join([f"- {cite.get('snippet', '')[:200]}... [Source: {cite.get('source', 'Unknown')}]" for cite in citations[:5]])}
"""
            comprehensive_research_data.append(task_context)
        
        # Add task-specific detailed results with enhanced context
        for result in task_specific_results:
            sources_info = ""
            if result.get('sources'):
                sources_list = [f"- {source.get('title', 'Unknown')} ({source.get('url', 'N/A')})" 
                              for source in result.get('sources', [])[:3]]
                sources_info = f"\nSOURCES:\n{chr(10).join(sources_list)}"
            
            task_detail = f"""
RESEARCH STREAM: {result.get('task_id', 'Unknown')}
CONTENT: {result.get('content', '')}
TIMESTAMP: {result.get('timestamp', '')}{sources_info}
"""
            comprehensive_research_data.append(task_detail)
        
        # Build source mapping for citation conversion
        source_mapping = build_source_mapping(sources_gathered)
        
        # Combine all research data
        research_dataset = "\n" + "="*80 + "\n".join(comprehensive_research_data)
        
        # Convert citations to readable format
        research_dataset = convert_citations_to_readable(research_dataset, source_mapping)
        
        # Apply token limits to prevent API overload
        research_dataset_batches = split_by_tokens([research_dataset], max_tokens=120000)
        final_research_data = "\n\n".join(research_dataset_batches[0]) if research_dataset_batches else ""
        
        # REPORT-LEVEL ENHANCEMENT: Analyze if additional targeted content is needed
        try:
            from agent.report_level_enhancement import integrate_report_enhancement_into_finalize
            
            # Convert sources_gathered to the format expected by report enhancement
            available_sources = []
            for source in sources_gathered:
                if isinstance(source, dict):
                    available_sources.append({
                        'title': source.get('title', ''),
                        'url': source.get('url', ''),
                        'snippet': source.get('snippet', '')
                    })
            
            print(f"🎯 启动报告级别增强分析...")
            enhanced_research_data, enhancement_results = integrate_report_enhancement_into_finalize(
                user_query=user_query,
                research_plan=plan,
                aggregated_research_data=final_research_data,
                available_sources=available_sources,
                config=config
            )
            
            # Use enhanced data if available
            final_research_data = enhanced_research_data
            
            # Log enhancement results
            successful_enhancements = [r for r in enhancement_results if r.success]
            if successful_enhancements:
                print(f"✅ 报告级别增强成功: {len(successful_enhancements)} 个增强点")
                for result in successful_enhancements:
                    print(f"   - 质量: {result.enhancement_quality}, 源数量: {len(result.sources_used)}")
            else:
                print("ℹ️  报告级别增强: 未执行或无有效增强")
                
        except Exception as e:
            print(f"⚠️ 报告级别增强异常，继续使用原始数据: {str(e)}")
            # Continue with original data if enhancement fails
        
        # Generate integrated report using the enhanced holistic approach
        formatted_prompt = integrated_report_instructions.format(
            user_query=user_query,
            research_plan_summary=research_plan_summary,
            comprehensive_research_data=final_research_data
        )
        
        print(f"🔄 Generating integrated report for: {user_query}")
        print(f"📊 Research data length: {len(final_research_data)} characters")
        print(f"📋 Tasks integrated: {len(plan)} research streams")
        
        # Generate the final integrated report
        integrated_report = llm.invoke(formatted_prompt).content
        
        # Apply final quality improvements
        integrated_report = clean_generated_content(integrated_report)
        integrated_report = remove_prompt_remnants(integrated_report)
        integrated_report = final_quality_check(integrated_report)
        
        print(f"✅ Integrated report generated: {len(integrated_report)} characters")
        
        return {
            "messages": [AIMessage(content=integrated_report)],
            "final_report_markdown": integrated_report
        }
        
    except Exception as e:
        error_message = f"Error generating integrated report: {str(e)}"
        print(f"❌ {error_message}")
        return {
            "messages": [AIMessage(content=error_message)],
            "final_report_markdown": error_message
        }

def build_source_mapping(sources_gathered):
    """构建源文件映射，用于引用转换"""
    mapping = {}
    for i, source in enumerate(sources_gathered):
        # Extract domain from URL for readable citation
        original_url = source.get("value", "")
        domain = extract_domain(original_url)
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
                    "value": original_url if original_url and not original_url.startswith('https://vertexaisearch') else ""
                }
        
        # Also try direct URL mapping if available
        if original_url and not original_url.startswith('https://vertexaisearch'):
            # Create a simple mapping using domain as key
            domain_key = domain.lower().replace(' ', '')
            mapping[domain_key] = {
                "label": label,
                "domain": domain,  
                "value": original_url
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
    """Convert raw citation markers to readable, verifiable citation formats with complete source information"""
    import re
    
    def replace_citation(match):
        citation_id = match.group(1)
        if citation_id in source_mapping:
            source_info = source_mapping[citation_id]
            # Create comprehensive citation with verifiable information
            domain = source_info.get('domain', 'Unknown Source')
            url = source_info.get('value', '')
            label = source_info.get('label', domain)
            
            # Format: [Source: Domain (URL)] for verifiability
            if url and url.startswith('http') and 'vertexaisearch.cloud.google.com' not in url:
                return f"[Source: {label} ({url})]"
            else:
                return f"[Source: {label}]"
        return f"[Source: {citation_id}]"  # Fallback with original ID
    
    # Convert Vertex AI citations with full source information
    content = re.sub(r'\[vertexaisearch\.cloud\.google\.com/id/([^\]]+)\]', 
                     replace_citation, content)
    
    # Convert other citation formats while preserving source identification
    content = re.sub(r'\[([a-z0-9\-]+)\]', replace_citation, content)
    
    # Clean up any remaining malformed citations
    content = clean_malformed_citations(content)
    
    return content

def clean_malformed_citations(content):
    """Clean up malformed citation formats in content"""
    import re
    
    # Fix mixed citation formats like [Source: domain](https://vertexaisearch...)
    content = re.sub(r'\[Source: ([^\]]+)\]\(https://vertexaisearch\.cloud\.google\.com[^)]*\)', 
                     r'[Source: \1]', content)
    
    # Remove any remaining vertexaisearch URLs that shouldn't be there
    content = re.sub(r'\(https://vertexaisearch\.cloud\.google\.com[^)]*\)', '', content)
    
    # Fix double closing brackets
    content = re.sub(r'\]\]', ']', content)
    
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
    """Final quality check and cleanup while preserving citation URLs and source information"""
    import re
    
    # Remove standalone URLs that are NOT part of citations
    # Use a different approach to preserve citation URLs
    lines = content.split('\n')
    cleaned_lines = []
    
    for line in lines:
        # Check if the line contains a citation with URL
        if '[Source:' in line and 'http' in line:
            # Keep lines with citations intact
            cleaned_lines.append(line)
        else:
            # Remove standalone URLs from lines without citations
            cleaned_line = re.sub(r'\bhttps?://[^\s\[\]]+', '', line)
            cleaned_lines.append(cleaned_line)
    
    content = '\n'.join(cleaned_lines)
    
    # Fix spacing issues
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = re.sub(r'[ \t]+', ' ', content)
    
    # Remove standalone punctuation lines
    content = re.sub(r'^\s*[-.•]+\s*$', '', content, flags=re.MULTILINE)
    
    # Ensure proper spacing around headers
    content = re.sub(r'\n(#+[^\n]+)\n', r'\n\n\1\n\n', content)
    
    # Clean up extra spaces around citations
    content = re.sub(r'\s+(\[Source:[^\]]+\])', r' \1', content)
    
    # Final citation cleanup
    content = clean_malformed_citations(content)
    
    return content.strip()


def planner_node(state: OverallState, config: RunnableConfig) -> dict:
    """LangGraph node that generates a multi-step research plan based on the user's question."""
    configurable = Configuration.from_runnable_config(config)
    llm = get_azure_openai_llm(
        model_name=configurable.query_generator_model,
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
builder.add_node("content_enhancement", content_enhancement_analysis)  # Enhanced content analysis node
builder.add_node("evaluate_research_enhanced", evaluate_research_enhanced)  # Enhanced research evaluation node
builder.add_node("record_task_completion", record_task_completion_node)  # Task completion recording node
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

# Modified routing logic after reflection - added intelligent content enhancement decision
builder.add_conditional_edges(
    "reflection", 
    should_enhance_content, 
    {
        "analyze_enhancement_need": "content_enhancement",
        "continue_without_enhancement": "evaluate_research_enhanced"
    }
)

# Enter evaluation phase after content enhancement completion
builder.add_edge("content_enhancement", "evaluate_research_enhanced")

# Decide next step after evaluation completion - continue research or complete task
builder.add_conditional_edges(
    "evaluate_research_enhanced", 
    decide_next_research_step, 
    ["web_research", "record_task_completion"]  # Can route to these two targets
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
