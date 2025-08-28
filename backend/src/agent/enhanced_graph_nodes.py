"""
增强的Graph节点 - 集成智能Firecrawl内容增强功能
"""

import os
import json
from typing import List, Dict, Any
from datetime import datetime
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import AIMessage

from agent.state import OverallState, ReflectionState
from agent.content_enhancement_decision import (
    get_content_enhancement_decision_maker,
    EnhancementDecision
)
from agent.utils import get_research_topic


def content_enhancement_analysis(state: OverallState, config: RunnableConfig) -> dict:
    """
    智能内容增强分析节点 - 决定是否需要使用Firecrawl进行深度抓取
    
    这个节点会：
    1. 分析当前研究结果的质量
    2. 评估是否需要深度内容增强
    3. 选择优先的URL进行Firecrawl抓取
    4. 执行内容增强（如果需要）
    5. 将增强的内容合并到研究结果中
    """
    
    try:
        # 获取当前研究上下文
        plan = state.get("plan", [])
        current_pointer = state.get("current_task_pointer", 0)
        
        # 确定研究主题
        if plan and current_pointer < len(plan):
            research_topic = plan[current_pointer]["description"]
        else:
            research_topic = state.get("user_query") or get_research_topic(state["messages"])
        
        # 获取当前研究发现
        current_findings = state.get("web_research_result", [])
        
        # 获取grounding sources（从最近的搜索结果中提取）
        grounding_sources = []
        sources_gathered = state.get("sources_gathered", [])
        for source in sources_gathered[-10:]:  # 最近的10个源
            if isinstance(source, dict):
                grounding_sources.append({
                    "title": source.get("title", ""),
                    "url": source.get("url", ""),
                    "snippet": source.get("snippet", "")
                })
        
        print(f"🤔 分析内容增强需求...")
        print(f"  研究主题: {research_topic}")
        print(f"  当前发现数量: {len(current_findings)}")
        print(f"  可用信息源: {len(grounding_sources)}")
        
        # 使用智能决策器进行分析
        decision = get_content_enhancement_decision_maker().analyze_enhancement_need(
            research_topic=research_topic,
            current_findings=current_findings,
            grounding_sources=grounding_sources,
            config=config
        )
        
        print(f"📊 增强决策结果:")
        print(f"  需要增强: {decision.needs_enhancement}")
        print(f"  置信度: {decision.confidence_score:.2f}")
        print(f"  增强类型: {decision.enhancement_type}")
        print(f"  优先URL数量: {len(decision.priority_urls)}")
        
        # 保存决策到状态
        state_update = {
            "enhancement_decision": {
                "needs_enhancement": decision.needs_enhancement,
                "confidence_score": decision.confidence_score,
                "enhancement_type": decision.enhancement_type,
                "reasoning": decision.reasoning,
                "priority_urls": decision.priority_urls
            }
        }
        
        # 如果不需要增强，直接返回
        if not decision.needs_enhancement:
            print("✅ 当前内容质量充足，无需增强")
            state_update["enhancement_status"] = "skipped"
            return state_update
        
        # 如果没有Firecrawl API Key，跳过增强
        if not get_content_enhancement_decision_maker().firecrawl_app:
            print("⚠️ 缺少FIRECRAWL_API_KEY，跳过内容增强")
            state_update["enhancement_status"] = "skipped_no_api"
            return state_update
        
        # 执行内容增强
        print(f"🔥 执行Firecrawl内容增强...")
        enhanced_results = []
        
        # 同步调用（暂时简化，后续可改为异步）
        for url_info in decision.priority_urls:
            url = url_info.get("url")
            if not url:
                continue
            
            try:
                print(f"  正在抓取: {url_info.get('title', 'Unknown')}")
                
                result = get_content_enhancement_decision_maker().firecrawl_app.scrape_url(url)
                
                if result and result.success:
                    markdown_content = result.markdown or ''
                    
                    enhanced_results.append({
                        "url": url,
                        "title": url_info.get("title", ""),
                        "original_priority": url_info.get("priority_score", 0),
                        "enhanced_content": markdown_content,
                        "content_length": len(markdown_content),
                        "source_type": "firecrawl_enhanced",
                        "timestamp": datetime.now().isoformat()
                    })
                    
                    print(f"    ✅ 成功: {len(markdown_content)} 字符")
                else:
                    print(f"    ❌ 失败: {result.error if hasattr(result, 'error') else '未知错误'}")
                    
            except Exception as e:
                print(f"    ❌ 异常: {str(e)}")
                continue
        
        if enhanced_results:
            # 将增强内容添加到研究结果中
            enhanced_contents = []
            for result in enhanced_results:
                # 格式化增强内容
                formatted_content = f"""

## 深度内容增强 - {result['title']}

来源: {result['url']}
内容长度: {result['content_length']} 字符

{result['enhanced_content'][:3000]}{'...' if len(result['enhanced_content']) > 3000 else ''}

---
"""
                enhanced_contents.append(formatted_content)
            
            state_update.update({
                "enhanced_content_results": enhanced_results,
                "web_research_result": enhanced_contents,  # 添加到研究结果中
                "enhancement_status": "completed",
                "enhanced_sources_count": len(enhanced_results)
            })
            
            print(f"✅ 内容增强完成: {len(enhanced_results)} 个源")
        else:
            print("❌ 内容增强失败，没有成功抓取任何内容")
            state_update["enhancement_status"] = "failed"
        
        return state_update
        
    except Exception as e:
        error_message = f"内容增强分析节点异常: {str(e)}"
        print(f"❌ {error_message}")
        return {
            "enhancement_status": "error",
            "enhancement_error": error_message
        }


def should_enhance_content(state: OverallState) -> str:
    """
    条件边函数 - 决定是否进入内容增强流程
    
    基于以下条件判断:
    1. 是否配置了Firecrawl API Key
    2. 当前研究循环次数
    3. 用户配置的增强偏好
    """
    
    # 检查Firecrawl可用性
    if not os.getenv("FIRECRAWL_API_KEY"):
        print("⚠️ 跳过内容增强: 未配置FIRECRAWL_API_KEY")
        return "continue_without_enhancement"
    
    # 检查研究循环次数（避免在早期循环中增强）
    research_loop_count = state.get("research_loop_count", 0)
    if research_loop_count < 1:  # 至少进行一轮研究后再考虑增强
        print(f"⚠️ 跳过内容增强: 研究循环次数不足 ({research_loop_count})")
        return "continue_without_enhancement"
    
    # 检查是否已经进行过增强（避免重复增强）
    if state.get("enhancement_status") in ["completed", "skipped"]:
        print("[WARNING] 跳过内容增强: 已经完成增强")
        return "continue_without_enhancement"
    
    # 检查当前发现数量（至少要有一些基础内容）
    current_findings = state.get("web_research_result", [])
    if len(current_findings) < 1:
        print("[WARNING] 跳过内容增强: 缺少基础研究内容")
        return "continue_without_enhancement"
    
    print("[SUCCESS] 满足增强条件，进入内容增强分析")
    return "analyze_enhancement_need"


def enhanced_reflection(state: OverallState, config: RunnableConfig) -> ReflectionState:
    """
    增强版反思节点 - 在原有reflection基础上考虑内容增强的结果
    """
    
    # 先调用原有的reflection逻辑
    from agent.graph import reflection
    reflection_result = reflection(state, config)
    
    # 如果进行了内容增强，调整reflection的判断
    enhancement_status = state.get("enhancement_status")
    enhanced_sources_count = state.get("enhanced_sources_count", 0)
    
    if enhancement_status == "completed" and enhanced_sources_count > 0:
        print(f"📈 内容增强完成，调整反思判断")
        print(f"  增强了 {enhanced_sources_count} 个信息源")
        
        # 如果成功增强了内容，更倾向于认为信息充足
        # 但仍然保留LLM的判断权重
        if not reflection_result["is_sufficient"]:
            # 给增强内容一定的"加分"
            enhancement_boost = min(enhanced_sources_count * 0.3, 0.8)
            print(f"  由于内容增强，提升充足性评估 (+{enhancement_boost:.1f})")
            
            # 如果增强效果很好，可能将"不充足"改为"充足"
            if enhancement_boost >= 0.6:
                print("  ✅ 基于内容增强结果，判定信息已充足")
                reflection_result["is_sufficient"] = True
                reflection_result["knowledge_gap"] = "内容已通过深度抓取得到充分补充"
    
    elif enhancement_status == "skipped":
        print("📝 内容增强被跳过，使用原始反思结果")
    
    elif enhancement_status == "failed":
        print("⚠️ 内容增强失败，可能需要更多研究循环")
    
    return reflection_result


# 辅助函数：格式化增强决策信息用于日志
def format_enhancement_decision_log(decision: EnhancementDecision) -> str:
    """格式化增强决策信息用于日志输出"""
    
    log_lines = [
        f"📊 内容增强决策报告:",
        f"  决策: {'需要增强' if decision.needs_enhancement else '无需增强'}",
        f"  置信度: {decision.confidence_score:.2f}",
        f"  增强类型: {decision.enhancement_type}",
        f"  优先URL数量: {len(decision.priority_urls)}"
    ]
    
    if decision.priority_urls:
        log_lines.append("  优先URLs:")
        for i, url_info in enumerate(decision.priority_urls, 1):
            log_lines.append(f"    {i}. {url_info.get('title', 'N/A')} (评分: {url_info.get('priority_score', 0):.2f})")
    
    log_lines.append(f"  推理: {decision.reasoning[:200]}...")
    
    return "\n".join(log_lines) 